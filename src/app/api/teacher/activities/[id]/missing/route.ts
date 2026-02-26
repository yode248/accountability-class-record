import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Helper to get current user
async function getCurrentUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  
  const { data: userData } = await supabase
    .from("User")
    .select("id, role")
    .eq("id", user.id)
    .single();
  
  return userData;
}

// GET /api/teacher/activities/[id]/missing
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: activityId } = await params;

    // Get the activity and verify ownership
    const { data: activity, error: activityError } = await supabase
      .from("Activity")
      .select(`
        id,
        title,
        maxScore,
        dueDate,
        category,
        classId,
        Class (id, name, ownerId)
      `)
      .eq("id", activityId)
      .single();

    if (activityError || !activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Verify teacher owns this class
    if (activity.Class?.ownerId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get all enrolled students with their profiles
    const { data: enrollments } = await supabase
      .from("Enrollment")
      .select(`
        studentId,
        profileId,
        profile:StudentProfile (fullName, lrn),
        student:User (id, name)
      `)
      .eq("classId", activity.classId)
      .eq("isActive", true);

    // Get all submissions for this activity
    const { data: submissions } = await supabase
      .from("ScoreSubmission")
      .select("studentId, status, rawScore, submittedAt")
      .eq("activityId", activityId);

    // Create a map of student submissions
    const submissionMap = new Map(
      submissions?.map((sub) => [sub.studentId, sub]) || []
    );

    // Build roster with status
    const roster = enrollments?.map((enrollment) => {
      const submission = submissionMap.get(enrollment.studentId);
      
      let status: string;
      if (!submission) {
        status = "NO_SUBMISSION";
      } else {
        status = submission.status;
      }

      return {
        studentId: enrollment.studentId,
        studentName: enrollment.profile?.fullName || enrollment.student?.name || "Unknown",
        lrn: enrollment.profile?.lrn,
        status,
        rawScore: submission?.rawScore ?? null,
        submittedAt: submission?.submittedAt ?? null,
      };
    }) || [];

    // Calculate counts
    const counts = {
      total: roster.length,
      noSubmission: roster.filter((s) => s.status === "NO_SUBMISSION").length,
      needsRevision: roster.filter((s) => s.status === "NEEDS_REVISION").length,
      declined: roster.filter((s) => s.status === "DECLINED").length,
      pending: roster.filter((s) => s.status === "PENDING").length,
      approved: roster.filter((s) => s.status === "APPROVED").length,
    };

    return NextResponse.json({
      activity: {
        id: activity.id,
        title: activity.title,
        maxScore: activity.maxScore,
        dueDate: activity.dueDate,
        category: activity.category,
      },
      class: activity.Class,
      counts,
      roster,
    });
  } catch (error) {
    console.error("Get missing students error:", error);
    return NextResponse.json(
      { error: "Failed to get missing students" },
      { status: 500 }
    );
  }
}
