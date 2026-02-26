import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeGrades } from "@/lib/grading";

// GET /api/grades - Get computed grades for a student in a class
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");

    if (!classId) {
      return NextResponse.json({ error: "Class ID required" }, { status: 400 });
    }

    // Verify access - teacher owns class or student is enrolled
    const cls = await db.class.findUnique({
      where: { id: classId },
      include: {
        gradingScheme: true,
        activities: {
          where: { isActive: true },
          orderBy: [{ category: "asc" }, { order: "asc" }],
        },
      },
    });

    if (!cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Check access
    const isTeacher = session.user.role === "TEACHER" && cls.ownerId === session.user.id;
    let studentId = session.user.id;
    
    // Teacher can specify a studentId
    const requestedStudentId = searchParams.get("studentId");
    if (requestedStudentId && isTeacher) {
      studentId = requestedStudentId;
    }

    // Verify enrollment if student
    if (session.user.role === "STUDENT") {
      const enrollment = await db.enrollment.findFirst({
        where: { classId, studentId: session.user.id, isActive: true },
      });
      if (!enrollment) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    // Get submissions for this student in this class
    const submissions = await db.scoreSubmission.findMany({
      where: {
        studentId,
        activity: { classId },
      },
      include: {
        activity: {
          select: {
            id: true,
            category: true,
            maxScore: true,
            archived: true,
          },
        },
      },
    });

    // Prepare activities data
    const activities = cls.activities.map(a => ({
      id: a.id,
      category: a.category,
      maxScore: a.maxScore,
      archived: a.archived,
    }));

    // Prepare submissions data
    const submissionData = submissions.map(s => ({
      activityId: s.activityId,
      rawScore: s.rawScore,
      status: s.status,
      activity: s.activity ? {
        id: s.activity.id,
        category: s.activity.category,
        maxScore: s.activity.maxScore,
      } : undefined,
    }));

    // Compute grades using shared function
    const gradingScheme = cls.gradingScheme ? {
      writtenWorksPercent: cls.gradingScheme.writtenWorksPercent,
      performanceTasksPercent: cls.gradingScheme.performanceTasksPercent,
      quarterlyAssessmentPercent: cls.gradingScheme.quarterlyAssessmentPercent,
    } : null;

    const computedGrades = computeGrades(submissionData, activities, gradingScheme);

    // Get student profile for additional info
    let studentProfile: { fullName: string; lrn: string } | null = null;
    if (session.user.role === "STUDENT") {
      const profile = await db.studentProfile.findUnique({
        where: { userId: session.user.id },
        select: { fullName: true, lrn: true },
      });
      studentProfile = profile;
    }

    // Debug log (remove later)
    console.log("[Grades API] Debug Info:", {
      classId,
      studentId,
      activitiesCount: activities.length,
      submissionsCount: submissions.length,
      submissionStatuses: submissions.map(s => ({ id: s.activityId, status: s.status })),
      activityCategories: activities.map(a => ({ id: a.id, category: a.category })),
      computedGrades,
    });

    return NextResponse.json({
      classInfo: {
        id: cls.id,
        name: cls.name,
        section: cls.section,
        quarter: cls.quarter,
        subject: cls.subject,
        gradingPeriodStatus: cls.gradingPeriodStatus,
        gradingPeriodCompletedAt: cls.gradingPeriodCompletedAt,
      },
      studentProfile,
      gradingScheme,
      activities: activities,
      submissions: submissions.map(s => ({
        id: s.id,
        activityId: s.activityId,
        rawScore: s.rawScore,
        status: s.status,
        teacherFeedback: s.teacherFeedback,
        updatedAt: s.updatedAt,
        activity: s.activity,
      })),
      grades: computedGrades,
    });
  } catch (error) {
    console.error("Grades API error:", error);
    return NextResponse.json({ error: "Failed to compute grades" }, { status: 500 });
  }
}
