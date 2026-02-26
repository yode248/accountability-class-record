import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const submitAttendanceSchema = z.object({
  status: z.enum(["PRESENT", "LATE", "ABSENT"]),
  proofUrl: z.string().nullish(),
  notes: z.string().nullish(),
  qrToken: z.string().nullish(),
});

// GET /api/attendance/[sessionId] - Get attendance session details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;

    const attendanceSession = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: {
        class: {
          include: {
            enrollments: session.user.role === "TEACHER"
              ? { include: { profile: true, student: true } }
              : { where: { studentId: session.user.id } },
          },
        },
        submissions: session.user.role === "TEACHER"
          ? { include: { student: { include: { studentProfile: true } } } }
          : { where: { studentId: session.user.id } },
      },
    });

    if (!attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Check access
    const isOwner = attendanceSession.class.ownerId === session.user.id;
    const isEnrolled = attendanceSession.class.enrollments.length > 0;

    if (!isOwner && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json(attendanceSession);
  } catch (error) {
    console.error("Get attendance session error:", error);
    return NextResponse.json(
      { error: "Failed to get attendance session" },
      { status: 500 }
    );
  }
}

// POST /api/attendance/[sessionId] - Submit attendance (Student)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "STUDENT") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    const body = await request.json();
    const validated = submitAttendanceSchema.parse(body);

    const attendanceSession = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: {
        class: {
          include: {
            enrollments: { where: { studentId: session.user.id } },
          },
        },
      },
    });

    if (!attendanceSession || attendanceSession.class.enrollments.length === 0) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check QR if enabled
    if (attendanceSession.qrToken) {
      if (!validated.qrToken || validated.qrToken !== attendanceSession.qrToken) {
        return NextResponse.json(
          { error: "Invalid QR code" },
          { status: 400 }
        );
      }
      if (attendanceSession.qrExpiresAt && new Date() > attendanceSession.qrExpiresAt) {
        return NextResponse.json(
          { error: "QR code has expired" },
          { status: 400 }
        );
      }
    }

    // Check for existing submission
    const existing = await db.attendanceSubmission.findUnique({
      where: {
        sessionId_studentId: {
          sessionId,
          studentId: session.user.id,
        },
      },
    });

    if (existing && existing.submissionStatus !== "NEEDS_REVISION" && existing.submissionStatus !== "DECLINED") {
      return NextResponse.json(
        { error: "Attendance already submitted" },
        { status: 400 }
      );
    }

    // Determine if late based on threshold
    let finalStatus = validated.status;
    if (validated.status === "PRESENT" && attendanceSession.lateThresholdMinutes) {
      const sessionTime = new Date(attendanceSession.date);
      const now = new Date();
      const diffMinutes = (now.getTime() - sessionTime.getTime()) / (1000 * 60);
      if (diffMinutes > attendanceSession.lateThresholdMinutes) {
        finalStatus = "LATE";
      }
    }

    const submission = await db.attendanceSubmission.upsert({
      where: {
        sessionId_studentId: {
          sessionId,
          studentId: session.user.id,
        },
      },
      create: {
        sessionId,
        studentId: session.user.id,
        status: finalStatus,
        proofUrl: validated.proofUrl,
        notes: validated.notes,
        checkedInAt: new Date(),
      },
      update: {
        status: finalStatus,
        proofUrl: validated.proofUrl,
        notes: validated.notes,
        checkedInAt: new Date(),
        submissionStatus: "PENDING",
        teacherFeedback: null,
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: existing ? "UPDATE" : "CREATE",
        entityType: "AttendanceSubmission",
        entityId: submission.id,
        newValue: JSON.stringify(submission),
        attendanceSubmissionId: submission.id,
      },
    });

    return NextResponse.json(submission);
  } catch (error) {
    console.error("Submit attendance error:", error);
    return NextResponse.json(
      { error: "Failed to submit attendance" },
      { status: 500 }
    );
  }
}

// PUT /api/attendance/[sessionId] - Update attendance session (Teacher)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    const body = await request.json();

    const attendanceSession = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { class: true },
    });

    if (!attendanceSession || attendanceSession.class.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const updated = await db.attendanceSession.update({
      where: { id: sessionId },
      data: {
        title: body.title,
        lateThresholdMinutes: body.lateThresholdMinutes,
        isActive: body.isActive,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update attendance session error:", error);
    return NextResponse.json(
      { error: "Failed to update attendance session" },
      { status: 500 }
    );
  }
}

// DELETE /api/attendance/[sessionId] - Delete attendance session
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;

    const attendanceSession = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { class: true },
    });

    if (!attendanceSession || attendanceSession.class.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await db.attendanceSession.delete({ where: { id: sessionId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete attendance session error:", error);
    return NextResponse.json(
      { error: "Failed to delete attendance session" },
      { status: 500 }
    );
  }
}
