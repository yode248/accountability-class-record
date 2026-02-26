import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { nanoid } from "nanoid";
import { z } from "zod";

// Generate unique class code
function generateClassCode(): string {
  return nanoid(8).toUpperCase();
}

const createClassSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  section: z.string().min(1),
  schoolYear: z.string().min(1),
  quarter: z.number().min(1).max(4).optional(),
});

// GET /api/classes - Get user's classes
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let classes;
    if (session.user.role === "TEACHER") {
      // Teacher sees their owned classes
      classes = await db.class.findMany({
        where: { ownerId: session.user.id },
        include: {
          _count: {
            select: { enrollments: true, activities: true },
          },
          gradingScheme: true,
          linkedFrom: { select: { id: true, name: true, subject: true, quarter: true } },
          linkedTo: { select: { id: true, name: true, subject: true, quarter: true } },
        },
        orderBy: [
          { schoolYear: "desc" },
          { quarter: "asc" },
          { createdAt: "desc" },
        ],
      });
    } else {
      // Student sees their enrolled classes
      classes = await db.class.findMany({
        where: {
          enrollments: {
            some: { studentId: session.user.id },
          },
        },
        include: {
          owner: { select: { name: true } },
          _count: {
            select: { activities: true },
          },
          linkedFrom: { select: { id: true, name: true, quarter: true } },
          linkedTo: { select: { id: true, name: true, quarter: true } },
        },
        orderBy: [
          { schoolYear: "desc" },
          { quarter: "asc" },
          { createdAt: "desc" },
        ],
      });
    }

    return NextResponse.json(classes);
  } catch (error) {
    console.error("Get classes error:", error);
    return NextResponse.json(
      { error: "Failed to get classes" },
      { status: 500 }
    );
  }
}

// POST /api/classes - Create new class (Teacher only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createClassSchema.parse(body);

    const classCode = generateClassCode();
    
    // Quarter defaults to 1 (Q1) if not specified
    const quarter = validated.quarter || 1;

    // Create default transmutation rules (DepEd style)
    const transmutationRules = [
      { minPercent: 0, maxPercent: 4.99, transmutedGrade: 70 },
      { minPercent: 5, maxPercent: 9.99, transmutedGrade: 71 },
      { minPercent: 10, maxPercent: 14.99, transmutedGrade: 72 },
      { minPercent: 15, maxPercent: 19.99, transmutedGrade: 73 },
      { minPercent: 20, maxPercent: 24.99, transmutedGrade: 74 },
      { minPercent: 25, maxPercent: 29.99, transmutedGrade: 75 },
      { minPercent: 30, maxPercent: 34.99, transmutedGrade: 76 },
      { minPercent: 35, maxPercent: 39.99, transmutedGrade: 77 },
      { minPercent: 40, maxPercent: 44.99, transmutedGrade: 78 },
      { minPercent: 45, maxPercent: 49.99, transmutedGrade: 79 },
      { minPercent: 50, maxPercent: 54.99, transmutedGrade: 80 },
      { minPercent: 55, maxPercent: 59.99, transmutedGrade: 81 },
      { minPercent: 60, maxPercent: 64.99, transmutedGrade: 82 },
      { minPercent: 65, maxPercent: 69.99, transmutedGrade: 83 },
      { minPercent: 70, maxPercent: 74.99, transmutedGrade: 84 },
      { minPercent: 75, maxPercent: 79.99, transmutedGrade: 85 },
      { minPercent: 80, maxPercent: 84.99, transmutedGrade: 86 },
      { minPercent: 85, maxPercent: 89.99, transmutedGrade: 87 },
      { minPercent: 90, maxPercent: 94.99, transmutedGrade: 88 },
      { minPercent: 95, maxPercent: 100, transmutedGrade: 90 },
    ];

    const newClass = await db.class.create({
      data: {
        name: validated.name,
        subject: validated.subject,
        section: validated.section,
        schoolYear: validated.schoolYear,
        quarter,
        code: classCode,
        ownerId: session.user.id,
        gradingScheme: {
          create: {
            writtenWorksPercent: 30,
            performanceTasksPercent: 50,
            quarterlyAssessmentPercent: 20,
            transmutationRules: {
              create: transmutationRules,
            },
          },
        },
      },
    });

    return NextResponse.json(newClass);
  } catch (error) {
    console.error("Create class error:", error);
    return NextResponse.json(
      { error: "Failed to create class" },
      { status: 500 }
    );
  }
}
