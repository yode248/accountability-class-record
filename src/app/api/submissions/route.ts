import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const createSubmissionSchema = z.object({
  activityId: z.string(),
  rawScore: z.number().min(0),
  evidenceUrl: z.string().nullish(),
  evidenceType: z.string().nullish(),
  notes: z.string().nullish(),
});

// GET /api/submissions - Get submissions
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");
    const activityId = searchParams.get("activityId");
    const studentId = searchParams.get("studentId");
    const status = searchParams.get("status");

    if (session.user.role === "TEACHER") {
      // Teacher sees all submissions for their classes
      // If studentId is provided, get submissions for that specific student
      if (!classId && !studentId) {
        return NextResponse.json({ error: "Class ID or Student ID required" }, { status: 400 });
      }

      // Verify access
      if (classId) {
        const cls = await db.class.findUnique({
          where: { id: classId },
        });

        if (!cls || cls.ownerId !== session.user.id) {
          return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }
      }

      // If studentId provided, verify the student is in teacher's class
      if (studentId && !classId) {
        const enrollment = await db.enrollment.findFirst({
          where: {
            studentId,
            class: { ownerId: session.user.id },
          },
        });
        if (!enrollment) {
          return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }
      }

      const where: Record<string, unknown> = {};
      if (classId) where.activity = { classId };
      if (studentId) where.studentId = studentId;
      if (activityId) where.activityId = activityId;
      if (status) where.status = status;

      const submissions = await db.scoreSubmission.findMany({
        where,
        include: {
          activity: true,
          student: {
            include: { studentProfile: true },
          },
        },
        orderBy: { submittedAt: "desc" },
      });

      return NextResponse.json(submissions);
    } else {
      // Student sees their own submissions
      const where: Record<string, unknown> = { studentId: session.user.id };
      if (activityId) where.activityId = activityId;
      if (status) where.status = status;

      const submissions = await db.scoreSubmission.findMany({
        where,
        include: { activity: { include: { class: true } } },
        orderBy: { submittedAt: "desc" },
      });

      return NextResponse.json(submissions);
    }
  } catch (error) {
    console.error("Get submissions error:", error);
    return NextResponse.json(
      { error: "Failed to get submissions" },
      { status: 500 }
    );
  }
}

// POST /api/submissions - Submit score (Student only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "STUDENT") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createSubmissionSchema.parse(body);

    // Get activity and verify enrollment
    const activity = await db.activity.findUnique({
      where: { id: validated.activityId },
      include: {
        class: {
          include: {
            enrollments: { where: { studentId: session.user.id } },
          },
        },
      },
    });

    if (!activity || activity.class.enrollments.length === 0) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Validate score range
    if (validated.rawScore > activity.maxScore) {
      return NextResponse.json(
        { error: `Score cannot exceed maximum score of ${activity.maxScore}` },
        { status: 400 }
      );
    }

    // Check for existing submission
    const existing = await db.scoreSubmission.findUnique({
      where: {
        activityId_studentId: {
          activityId: validated.activityId,
          studentId: session.user.id,
        },
      },
    });

    if (existing) {
      // Update existing submission if it needs revision
      if (existing.status === "NEEDS_REVISION" || existing.status === "DECLINED") {
        const updated = await db.scoreSubmission.update({
          where: { id: existing.id },
          data: {
            rawScore: validated.rawScore,
            evidenceUrl: validated.evidenceUrl,
            evidenceType: validated.evidenceType,
            notes: validated.notes,
            status: "PENDING",
            teacherFeedback: null,
            submittedAt: new Date(),
          },
        });
        return NextResponse.json(updated);
      }

      return NextResponse.json(
        { error: "Submission already exists" },
        { status: 400 }
      );
    }

    // Create new submission
    const submission = await db.scoreSubmission.create({
      data: {
        activityId: validated.activityId,
        studentId: session.user.id,
        rawScore: validated.rawScore,
        evidenceUrl: validated.evidenceUrl,
        evidenceType: validated.evidenceType,
        notes: validated.notes,
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CREATE",
        entityType: "ScoreSubmission",
        entityId: submission.id,
        newValue: JSON.stringify(submission),
        scoreSubmissionId: submission.id,
      },
    });

    return NextResponse.json(submission);
  } catch (error) {
    console.error("Create submission error:", error);
    return NextResponse.json(
      { error: "Failed to create submission" },
      { status: 500 }
    );
  }
}
