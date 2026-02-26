import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

// Helper to get current user
async function getCurrentUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  
  const { data: userData } = await db.user.findUnique({
    where: { id: user.id }
  });
  
  return userData;
}

// GET /api/audit - Get audit logs
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
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
      const submissions = await db.scoreSubmission.findMany({
        where: { studentId },
      });
      const attendanceSubmissions = await db.attendanceSubmission.findMany({
        where: { studentId },
      });

      const scoreIds = submissions.map((s) => s.id);
      const attendanceIds = attendanceSubmissions.map((a) => a.id);

      where.OR = [
        { scoreSubmissionId: { in: scoreIds } },
        { attendanceSubmissionId: { in: attendanceIds } },
      ];
    }

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
