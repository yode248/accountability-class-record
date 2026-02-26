import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { nanoid } from "nanoid";

const createSessionSchema = z.object({
  classId: z.string(),
  date: z.string(),
  title: z.string().nullish(),
  lateThresholdMinutes: z.number().optional(),
  enableQr: z.boolean().optional(),
});

// GET /api/attendance - Get attendance sessions
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

    // Verify access
    const cls = await db.class.findUnique({
      where: { id: classId },
      include: {
        enrollments: session.user.role === "STUDENT" 
          ? { where: { studentId: session.user.id } }
          : true,
      },
    });

    if (!cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const isOwner = cls.ownerId === session.user.id;
    const hasAccess = isOwner || (session.user.role === "STUDENT" && cls.enrollments.length > 0);

    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const attendanceSessions = await db.attendanceSession.findMany({
      where: { classId },
      include: {
        _count: {
          select: { submissions: true },
        },
        submissions: session.user.role === "TEACHER"
          ? { include: { student: { include: { studentProfile: true } } } }
          : { where: { studentId: session.user.id } },
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json(attendanceSessions);
  } catch (error) {
    console.error("Get attendance error:", error);
    return NextResponse.json(
      { error: "Failed to get attendance" },
      { status: 500 }
    );
  }
}

// POST /api/attendance - Create attendance session (Teacher only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createSessionSchema.parse(body);

    // Verify ownership
    const cls = await db.class.findUnique({
      where: { id: validated.classId },
    });

    if (!cls || cls.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const qrToken = validated.enableQr ? nanoid(10).toUpperCase() : null;
    const qrExpiresAt = validated.enableQr
      ? new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      : null;

    const attendanceSession = await db.attendanceSession.create({
      data: {
        classId: validated.classId,
        date: new Date(validated.date),
        title: validated.title,
        lateThresholdMinutes: validated.lateThresholdMinutes ?? 15,
        qrToken,
        qrExpiresAt,
      },
    });

    return NextResponse.json(attendanceSession);
  } catch (error) {
    console.error("Create attendance session error:", error);
    return NextResponse.json(
      { error: "Failed to create attendance session" },
      { status: 500 }
    );
  }
}
