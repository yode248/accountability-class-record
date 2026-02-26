import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

// Helper to get current user
async function getCurrentUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  
  const { data: userData } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", user.id)
    .single();
  
  return userData;
}

const updateAttendanceSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "DECLINED", "NEEDS_REVISION"]).optional(),
  attendanceStatus: z.enum(["PRESENT", "LATE", "ABSENT"]).optional(),
  teacherFeedback: z.string().nullish(),
  reason: z.string().nullish(),
});

// GET /api/approval - Get pending approvals (Teacher)
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");
    const type = searchParams.get("type") || "all"; // all, scores, attendance
    const status = searchParams.get("status") || "PENDING";

    // Get teacher's classes
    const { data: classes } = await supabase
      .from("classes")
      .select("id")
      .eq("ownerId", user.id);

    const classIds = classes?.map(c => c.id) || [];
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
      // Get activity IDs for filtered classes
      const { data: activities } = await supabase
        .from("activities")
        .select("id")
        .in("classId", filterClassIds);

      const activityIds = activities?.map(a => a.id) || [];

      let scoreQuery = supabase
        .from("score_submissions")
        .select(`
          id,
          rawScore,
          evidenceUrl,
          notes,
          status,
          teacherFeedback,
          submittedAt,
          activity:activities (
            id,
            title,
            maxScore,
            category,
            class:classes (id, name)
          ),
          student:users!score_submissions_studentId_fkey (
            id,
            name,
            studentProfile:student_profiles (
              fullName,
              lrn
            )
          )
        `)
        .in("activityId", activityIds)
        .order("submittedAt", { ascending: false })
        .limit(50);

      if (status !== "all") {
        scoreQuery = scoreQuery.eq("status", status);
      }

      const { data: scores } = await scoreQuery;
      result.scores = scores || [];
    }

    // Get attendance submissions
    if (type === "all" || type === "attendance") {
      // Get session IDs for filtered classes
      const { data: sessions } = await supabase
        .from("attendance_sessions")
        .select("id")
        .in("classId", filterClassIds);

      const sessionIds = sessions?.map(s => s.id) || [];

      let attendanceQuery = supabase
        .from("attendance_submissions")
        .select(`
          id,
          status,
          proofUrl,
          checkedInAt,
          notes,
          submissionStatus,
          teacherFeedback,
          submittedAt,
          session:attendance_sessions (
            id,
            date,
            title,
            class:classes (id, name)
          ),
          student:users!attendance_submissions_studentId_fkey (
            id,
            name,
            studentProfile:student_profiles (
              fullName,
              lrn
            )
          )
        `)
        .in("sessionId", sessionIds)
        .order("submittedAt", { ascending: false })
        .limit(50);

      if (status !== "all") {
        attendanceQuery = attendanceQuery.eq("submissionStatus", status);
      }

      const { data: attendance } = await attendanceQuery;
      result.attendance = attendance || [];
    }

    // Get stats
    // Pending scores count
    const { data: pendingActivities } = await supabase
      .from("activities")
      .select("id")
      .in("classId", classIds);

    const pendingActivityIds = pendingActivities?.map(a => a.id) || [];

    const { count: pendingScoresCount } = await supabase
      .from("score_submissions")
      .select("id", { count: "exact", head: true })
      .in("activityId", pendingActivityIds)
      .eq("status", "PENDING");

    result.stats.pendingScores = pendingScoresCount || 0;

    // Pending attendance count
    const { data: pendingSessions } = await supabase
      .from("attendance_sessions")
      .select("id")
      .in("classId", classIds);

    const pendingSessionIds = pendingSessions?.map(s => s.id) || [];

    const { count: pendingAttendanceCount } = await supabase
      .from("attendance_submissions")
      .select("id", { count: "exact", head: true })
      .in("sessionId", pendingSessionIds)
      .eq("submissionStatus", "PENDING");

    result.stats.pendingAttendance = pendingAttendanceCount || 0;

    // Approved today count
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: approvedTodayCount } = await supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("userId", user.id)
      .eq("action", "APPROVED")
      .gte("createdAt", today.toISOString());

    result.stats.approvedToday = approvedTodayCount || 0;

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
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validated = updateAttendanceSchema.parse(body);

    // Get submission with session info
    const { data: submission, error: submissionError } = await supabase
      .from("attendance_submissions")
      .select(`
        id,
        status,
        submissionStatus,
        teacherFeedback,
        session:attendance_sessions (
          id,
          class:classes (ownerId)
        )
      `)
      .eq("id", id)
      .single();

    if (submissionError || !submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Check ownership
    const sessionData = submission.session as { class?: { ownerId: string } } | null;
    if (!sessionData?.class || sessionData.class.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const oldValue = JSON.stringify(submission);
    const updateData: Record<string, unknown> = {
      reviewedAt: new Date().toISOString(),
      reviewedBy: user.id,
    };

    if (validated.status) updateData.submissionStatus = validated.status;
    if (validated.attendanceStatus) updateData.status = validated.attendanceStatus;
    if (validated.teacherFeedback !== undefined) {
      updateData.teacherFeedback = validated.teacherFeedback;
    }

    const { data: updated, error: updateError } = await supabase
      .from("attendance_submissions")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create audit log
    await supabase.from("audit_logs").insert({
      userId: user.id,
      action: validated.status || "UPDATE",
      entityType: "AttendanceSubmission",
      entityId: id,
      oldValue,
      newValue: JSON.stringify(updated),
      reason: validated.reason || validated.teacherFeedback,
      attendanceSubmissionId: id,
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
