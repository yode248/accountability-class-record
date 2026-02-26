import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const updateAttendanceSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "DECLINED", "NEEDS_REVISION"]).optional(),
  attendanceStatus: z.enum(["PRESENT", "LATE", "ABSENT"]).optional(),
  teacherFeedback: z.string().nullish(),
  reason: z.string().nullish(),
});

// GET /api/approval - Get pending approvals (Teacher)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");
    const type = searchParams.get("type") || "all"; // all, scores, attendance
    const status = searchParams.get("status") || "PENDING";

    // Get teacher's classes
    const classes = await db.class.findMany({
      where: { ownerId: session.user.id },
      select: { id: true },
    });

    const classIds = classes.map((c) => c.id);
    const filterClassIds = classId ? [classId] : classIds;

    const result: {
      scores: unknown[];
      attendance: unknown[];
      stats: {
        pendingScores: number;
        pendingAttendance: number;
        approvedToday: number;
      };
    } = {
      scores: [],
      attendance: [],
      stats: {
        pendingScores: 0,
        pendingAttendance: 0,
        approvedToday: 0,
      },
    };

    // Get score submissions
    if (type === "all" || type === "scores") {
      const scoreWhere: Record<string, unknown> = {
        activity: { classId: { in: filterClassIds } },
      };
      if (status !== "all") scoreWhere.status = status;

      result.scores = await db.scoreSubmission.findMany({
        where: scoreWhere,
        include: {
          activity: { include: { class: true } },
          student: { include: { studentProfile: true } },
        },
        orderBy: { submittedAt: "desc" },
        take: 50,
      });
    }

    // Get attendance submissions
    if (type === "all" || type === "attendance") {
      const attendanceWhere: Record<string, unknown> = {
        session: { classId: { in: filterClassIds } },
      };
      if (status !== "all") attendanceWhere.submissionStatus = status;

      result.attendance = await db.attendanceSubmission.findMany({
        where: attendanceWhere,
        include: {
          session: { include: { class: true } },
          student: { include: { studentProfile: true } },
        },
        orderBy: { submittedAt: "desc" },
        take: 50,
      });
    }

    // Get stats
    result.stats.pendingScores = await db.scoreSubmission.count({
      where: {
        activity: { classId: { in: classIds } },
        status: "PENDING",
      },
    });

    result.stats.pendingAttendance = await db.attendanceSubmission.count({
      where: {
        session: { classId: { in: classIds } },
        submissionStatus: "PENDING",
      },
    });

    result.stats.approvedToday = await db.auditLog.count({
      where: {
        userId: session.user.id,
        action: "APPROVED",
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Get approvals error:", error);
    return NextResponse.json(
      { error: "Failed to get approvals" },
      { status: 500 }
    );
  }
}

// PUT /api/approval/[id] - Update attendance submission (approve/decline)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validated = updateAttendanceSchema.parse(body);

    const submission = await db.attendanceSubmission.findUnique({
      where: { id },
      include: { session: { include: { class: true } } },
    });

    if (!submission || submission.session.class.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const oldValue = JSON.stringify(submission);
    const updateData: Record<string, unknown> = {
      reviewedAt: new Date(),
      reviewedBy: session.user.id,
    };

    if (validated.status) updateData.submissionStatus = validated.status;
    if (validated.attendanceStatus) updateData.status = validated.attendanceStatus;
    if (validated.teacherFeedback !== undefined) {
      updateData.teacherFeedback = validated.teacherFeedback;
    }

    const updated = await db.attendanceSubmission.update({
      where: { id },
      data: updateData,
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: validated.status || "UPDATE",
        entityType: "AttendanceSubmission",
        entityId: id,
        oldValue,
        newValue: JSON.stringify(updated),
        reason: validated.reason || validated.teacherFeedback,
        attendanceSubmissionId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update attendance submission error:", error);
    return NextResponse.json(
      { error: "Failed to update attendance submission" },
      { status: 500 }
    );
  }
}
