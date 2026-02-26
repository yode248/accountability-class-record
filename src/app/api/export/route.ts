import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeClassGrades } from "@/lib/grading";
import { exec } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// GET /api/export - Export class record as Excel
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");
    const format = searchParams.get("format") || "json";

    if (!classId) {
      return NextResponse.json({ error: "Class ID required" }, { status: 400 });
    }

    // Verify access - teacher owns the class or student is enrolled
    const cls = await db.class.findUnique({
      where: { id: classId },
      include: {
        gradingScheme: {
          include: { transmutationRules: { orderBy: { minPercent: "asc" } } },
        },
        activities: {
          where: { isActive: true },
          orderBy: [{ category: "asc" }, { order: "asc" }],
        },
        attendanceSessions: {
          orderBy: { date: "asc" },
        },
      },
    });

    if (!cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Check access: teacher owns class OR student is enrolled
    const isTeacher = session.user.role === "TEACHER" && cls.ownerId === session.user.id;
    let isEnrolled = false;
    
    if (session.user.role === "STUDENT") {
      const enrollment = await db.enrollment.findFirst({
        where: { classId, studentId: session.user.id, isActive: true },
      });
      isEnrolled = !!enrollment;
    }

    if (!isTeacher && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Students can only access JSON format
    if (session.user.role === "STUDENT" && format === "excel") {
      return NextResponse.json({ error: "Only teachers can export Excel files" }, { status: 403 });
    }

    // Compute all student grades
    const grades = await computeClassGrades(classId);

    // Get attendance data
    const attendanceData = await db.attendanceSubmission.findMany({
      where: {
        session: { classId },
        submissionStatus: "APPROVED",
      },
      include: {
        session: true,
        student: { include: { studentProfile: true } },
      },
    });

    // Get pending submissions for optional sheet
    const pendingSubmissions = await db.scoreSubmission.findMany({
      where: {
        activity: { classId },
        status: { in: ["PENDING", "NEEDS_REVISION"] },
      },
      include: {
        activity: true,
        student: { include: { studentProfile: true } },
      },
    });

    // Structure for export
    const exportData = {
      classInfo: {
        name: cls.name,
        subject: cls.subject,
        section: cls.section,
        schoolYear: cls.schoolYear,
        quarter: cls.quarter,
        gradingScheme: cls.gradingScheme
          ? {
              writtenWorksPercent: cls.gradingScheme.writtenWorksPercent,
              performanceTasksPercent: cls.gradingScheme.performanceTasksPercent,
              quarterlyAssessmentPercent: cls.gradingScheme.quarterlyAssessmentPercent,
            }
          : null,
      },
      activities: cls.activities.map((a) => ({
        id: a.id,
        category: a.category,
        title: a.title,
        maxScore: a.maxScore,
        dueDate: a.dueDate,
      })),
      attendanceSessions: cls.attendanceSessions.map((s) => ({
        id: s.id,
        date: s.date,
        title: s.title,
      })),
      students: grades.map((g) => ({
        studentId: g.studentId,
        studentName: g.studentName,
        lrn: g.lrn,
        name: g.studentName,
        section: g.section,
        grade: g.grade,
        submissions: g.submissions,
        attendance: attendanceData
          .filter((a) => a.studentId === g.studentId)
          .map((a) => ({
            date: a.session.date,
            status: a.status,
          })),
      })),
      pendingSubmissions: pendingSubmissions.map((s) => ({
        studentName: s.student?.studentProfile?.fullName || s.student?.name || "Unknown",
        activityTitle: s.activity.title,
        rawScore: s.rawScore,
        maxScore: s.activity.maxScore,
        status: s.status,
      })),
    };

    if (format === "json") {
      return NextResponse.json(exportData);
    }

    // Generate Excel file using Python
    if (format === "excel") {
      const pythonScript = `
import json
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

data = json.loads(sys.argv[1])
wb = Workbook()

# Main Sheet - Class Record
ws = wb.active
ws.title = "Class Record"

# Styles
header_font = Font(name='Arial', bold=True, size=11, color='FFFFFF')
header_fill = PatternFill(start_color='2E7D32', end_color='2E7D32', fill_type='solid')
title_font = Font(name='Arial', bold=True, size=14)
subtitle_font = Font(name='Arial', bold=True, size=11)
border = Border(
    left=Side(style='thin'),
    right=Side(style='thin'),
    top=Side(style='thin'),
    bottom=Side(style='thin')
)
center = Alignment(horizontal='center', vertical='center')

# Title
ws['A1'] = f"{data['classInfo']['name']} - Class Record"
ws['A1'].font = title_font
ws.merge_cells('A1:E1')

ws['A2'] = f"Subject: {data['classInfo']['subject']} | Section: {data['classInfo']['section']} | SY: {data['classInfo']['schoolYear']} | Quarter: {data['classInfo']['quarter']}"
ws['A2'].font = subtitle_font
ws.merge_cells('A2:E2')

# Activities by category
activities_by_cat = {'WRITTEN_WORK': [], 'PERFORMANCE_TASK': [], 'QUARTERLY_ASSESSMENT': []}
for a in data['activities']:
    activities_by_cat[a['category']].append(a)

# Headers
row = 4
headers = ['LRN', 'Student Name']
for a in data['activities']:
    headers.append(a['title'][:20])
headers.extend(['WW %', 'PT %', 'QA %', 'Initial Grade', 'Transmuted Grade', 'Attendance %'])

for col, header in enumerate(headers, 1):
    cell = ws.cell(row=row, column=col, value=header)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = center
    cell.border = border

# Student data
for i, student in enumerate(data['students']):
    row += 1
    ws.cell(row=row, column=1, value=student['lrn']).border = border
    ws.cell(row=row, column=2, value=student['name']).border = border
    
    col = 3
    for a in data['activities']:
        sub = next((s for s in student['submissions'] if s['activityId'] == a['id']), None)
        cell = ws.cell(row=row, column=col, value=sub['rawScore'] if sub else '-')
        cell.border = border
        cell.alignment = center
        col += 1
    
    # Grade columns
    ws.cell(row=row, column=col, value=round(student['grade']['writtenWorksPercent'], 1)).border = border
    ws.cell(row=row, column=col+1, value=round(student['grade']['performanceTasksPercent'], 1)).border = border
    ws.cell(row=row, column=col+2, value=round(student['grade']['quarterlyAssessmentPercent'], 1)).border = border
    ws.cell(row=row, column=col+3, value=round(student['grade']['initialGrade'], 2)).border = border
    
    transmuted_cell = ws.cell(row=row, column=col+4, value=student['grade']['transmutedGrade'])
    transmuted_cell.border = border
    transmuted_cell.font = Font(bold=True)
    transmuted_cell.alignment = center
    
    # Attendance percentage
    total_sessions = len(data['attendanceSessions'])
    present_count = sum(1 for a in student['attendance'] if a['status'] in ['PRESENT', 'LATE'])
    att_pct = round((present_count / total_sessions * 100), 1) if total_sessions > 0 else 100
    ws.cell(row=row, column=col+5, value=f"{att_pct}%").border = border

# Adjust column widths
ws.column_dimensions['A'].width = 15
ws.column_dimensions['B'].width = 25
for col in range(3, len(headers) + 1):
    ws.column_dimensions[get_column_letter(col)].width = 12

# Grading Scheme Sheet
ws2 = wb.create_sheet("Grading Scheme")
ws2['A1'] = "Grading Scheme"
ws2['A1'].font = title_font
ws2.merge_cells('A1:C1')

ws2['A3'] = "Component"
ws2['B3'] = "Weight"
ws2['A3'].font = header_font
ws2['A3'].fill = header_fill
ws2['B3'].font = header_font
ws2['B3'].fill = header_fill

gs = data['classInfo']['gradingScheme']
if gs:
    ws2['A4'] = "Written Works"
    ws2['B4'] = f"{gs['writtenWorksPercent']}%"
    ws2['A5'] = "Performance Tasks"
    ws2['B5'] = f"{gs['performanceTasksPercent']}%"
    ws2['A6'] = "Quarterly Assessment"
    ws2['B6'] = f"{gs['quarterlyAssessmentPercent']}%"

# Transmutation Table
ws2['A8'] = "Transmutation Table (DepEd)"
ws2['A8'].font = subtitle_font
ws2['A9'] = "Percentage Score"
ws2['B9'] = "Transmuted Grade"
ws2['A9'].font = header_font
ws2['A9'].fill = header_fill
ws2['B9'].font = header_font
ws2['B9'].fill = header_fill

trans_rules = [
    (0, 4.99, 70), (5, 9.99, 71), (10, 14.99, 72), (15, 19.99, 73), (20, 24.99, 74),
    (25, 29.99, 75), (30, 34.99, 76), (35, 39.99, 77), (40, 44.99, 78), (45, 49.99, 79),
    (50, 54.99, 80), (55, 59.99, 81), (60, 64.99, 82), (65, 69.99, 83), (70, 74.99, 84),
    (75, 79.99, 85), (80, 84.99, 86), (85, 89.99, 87), (90, 94.99, 88), (95, 100, 90),
]
row = 10
for min_p, max_p, grade in trans_rules:
    ws2.cell(row=row, column=1, value=f"{min_p}% - {max_p}%")
    ws2.cell(row=row, column=2, value=grade)
    row += 1

# Pending Submissions Sheet (if any)
if data['pendingSubmissions']:
    ws3 = wb.create_sheet("Pending")
    ws3['A1'] = "Pending Submissions"
    ws3['A1'].font = title_font
    
    ws3['A3'] = "Student"
    ws3['B3'] = "Activity"
    ws3['C3'] = "Score"
    ws3['D3'] = "Status"
    for col in range(1, 5):
        cell = ws3.cell(row=3, column=col)
        cell.font = header_font
        cell.fill = header_fill
    
    row = 4
    for p in data['pendingSubmissions']:
        ws3.cell(row=row, column=1, value=p['studentName'])
        ws3.cell(row=row, column=2, value=p['activityTitle'])
        ws3.cell(row=row, column=3, value=f"{p['rawScore']}/{p['maxScore']}")
        ws3.cell(row=row, column=4, value=p['status'].replace('_', ' '))
        row += 1

# Attendance Sheet
ws4 = wb.create_sheet("Attendance")
ws4['A1'] = "Attendance Record"
ws4['A1'].font = title_font

# Attendance headers
att_headers = ['LRN', 'Student Name']
for s in data['attendanceSessions']:
    date_str = s['date'].split('T')[0] if 'T' in s['date'] else s['date']
    att_headers.append(date_str)
att_headers.extend(['Present', 'Late', 'Absent', 'Attendance %'])

for col, header in enumerate(att_headers, 1):
    cell = ws4.cell(row=3, column=col, value=header)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = center
    cell.border = border

# Attendance data
row = 4
for student in data['students']:
    ws4.cell(row=row, column=1, value=student['lrn']).border = border
    ws4.cell(row=row, column=2, value=student['name']).border = border
    
    present, late, absent = 0, 0, 0
    col = 3
    for s in data['attendanceSessions']:
        att = next((a for a in student['attendance'] if a['date'] == s['date']), None)
        status = att['status'] if att else '-'
        cell = ws4.cell(row=row, column=col, value=status)
        cell.border = border
        cell.alignment = center
        if status == 'PRESENT':
            present += 1
        elif status == 'LATE':
            late += 1
        elif status == 'ABSENT':
            absent += 1
        col += 1
    
    ws4.cell(row=row, column=col, value=present).border = border
    ws4.cell(row=row, column=col+1, value=late).border = border
    ws4.cell(row=row, column=col+2, value=absent).border = border
    
    total = present + late + absent
    att_pct = round((present + late) / total * 100, 1) if total > 0 else 100
    ws4.cell(row=row, column=col+3, value=f"{att_pct}%").border = border
    
    row += 1

# Adjust column widths
ws4.column_dimensions['A'].width = 15
ws4.column_dimensions['B'].width = 25
for col in range(3, len(att_headers) + 1):
    ws4.column_dimensions[get_column_letter(col)].width = 12

wb.save(sys.argv[2])
print("Success")
`;

      const tempDir = tmpdir();
      const inputFile = join(tempDir, `export_${Date.now()}.json`);
      const outputFile = join(tempDir, `class_record_${Date.now()}.xlsx`);

      // Write data to temp file
      await writeFile(inputFile, JSON.stringify(exportData));

      // Write Python script to temp file
      const scriptFile = join(tempDir, `script_${Date.now()}.py`);
      await writeFile(scriptFile, pythonScript);

      // Execute Python script
      await new Promise<void>((resolve, reject) => {
        exec(
          `python3 "${scriptFile}" '${JSON.stringify(exportData).replace(/'/g, "'\\''")}' "${outputFile}"`,
          { maxBuffer: 1024 * 1024 * 10 },
          (error, stdout, stderr) => {
            if (error) {
              console.error("Python error:", stderr);
              reject(error);
            } else {
              resolve();
            }
          }
        );
      });

      // Read the Excel file
      const { readFile } = await import("fs/promises");
      const excelBuffer = await readFile(outputFile);

      // Clean up temp files
      await unlink(inputFile).catch(() => {});
      await unlink(scriptFile).catch(() => {});
      await unlink(outputFile).catch(() => {});

      // Return Excel file
      return new NextResponse(excelBuffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="class_record_${cls.section}_Q${cls.quarter}.xlsx"`,
        },
      });
    }

    return NextResponse.json(exportData);
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Failed to export" }, { status: 500 });
  }
}
