import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Helper to get current user with role check
async function getCurrentUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  
  const { data: userData } = await supabase
    .from("User")
    .select("id, role, name")
    .eq("id", user.id)
    .single();
  
  return userData;
}

// GET /api/approval - Get pending approvals for teacher
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");

    // Get classes owned by this teacher
    let classQuery = supabase
      .from("Class")
      .select("id")
      .eq("ownerId", user.id);
    
    if (classId) {
      classQuery = classQuery.eq("id", classId);
    }
    
    const { data: classes } = await classQuery;
    const classIds = classes?.map((c) => c.id) || [];

    if (classIds.length === 0) {
      return NextResponse.json({ scores: [], attendance: [], stats: { pendingScores: 0, pendingAttendance: 0, approvedToday: 0 } });
    }

    // Get pending score submissions
    const { data: scoreSubmissions } = await supabase
      .from("ScoreSubmission")
      .select(`
        id,
        rawScore,
        notes,
        status,
        submittedAt,
        teacherFeedback,
        activityId,
        studentId,
        Activity (id, title, maxScore, category),
        student:User!ScoreSubmission_studentId_fkey (id, name, email)
      `)
      .in("activityId", classIds)
      .eq("status", "PENDING")
      .order("submittedAt", { ascending: false });

    // Get pending attendance submissions
    const { data: attendanceSubmissions } = await supabase
      .from("AttendanceSubmission")
      .select(`
        id,
        status,
        submissionStatus,
        submittedAt,
        notes,
        sessionId,
        studentId,
        AttendanceSession (id, date, title),
        student:User!AttendanceSubmission_studentId_fkey (id, name, email)
      `)
      .in("sessionId", classIds)
      .eq("submissionStatus", "PENDING")
      .order("submittedAt", { ascending: false });

    // Get stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: approvedToday } = await supabase
      .from("ScoreSubmission")
      .select("*", { count: "exact", head: true })
      .in("activityId", classIds)
      .eq("status", "APPROVED")
      .gte("reviewedAt", today.toISOString());

    return NextResponse.json({
      scores: scoreSubmissions || [],
      attendance: attendanceSubmissions || [],
      stats: {
        pendingScores: scoreSubmissions?.length || 0,
        pendingAttendance: attendanceSubmissions?.length || 0,
        approvedToday: approvedToday || 0,
      },
    });
  } catch (error) {
    console.error("Get approvals error:", error);
    return NextResponse.json(
      { error: "Failed to get approvals" },
      { status: 500 }
    );
  }
}
