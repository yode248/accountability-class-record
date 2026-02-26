import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/audit - Get audit logs
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    const classId = searchParams.get("classId");
    const entityType = searchParams.get("entityType");
    const limit = parseInt(searchParams.get("limit") || "100");

    // Build where clause
    const where: Record<string, unknown> = {};
    
    if (entityType) {
      where.entityType = entityType;
    }

    // If filtering by student, we need to find logs related to their submissions
    if (studentId) {
      const scoreSubmissions = await db.scoreSubmission.findMany({
        where: { studentId },
        select: { id: true },
      });
      const attendanceSubmissions = await db.attendanceSubmission.findMany({
        where: { studentId },
        select: { id: true },
      });

      const scoreIds = scoreSubmissions.map((s) => s.id);
      const attendanceIds = attendanceSubmissions.map((a) => a.id);

      where.OR = [
        { scoreSubmissionId: { in: scoreIds } },
        { attendanceSubmissionId: { in: attendanceIds } },
      ];
    }

    // If filtering by class (teacher only)
    if (classId && session.user.role === "TEACHER") {
      const cls = await db.class.findUnique({
        where: { id: classId },
      });
      if (!cls || cls.ownerId !== session.user.id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const logs = await db.auditLog.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Get audit logs error:", error);
    return NextResponse.json(
      { error: "Failed to get audit logs" },
      { status: 500 }
    );
  }
}
