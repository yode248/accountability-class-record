import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Helper to get current user
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

// GET /api/export - Export class data
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");
    const format = searchParams.get("format") || "json";

    if (!classId) {
      return NextResponse.json({ error: "Class ID required" }, { status: 400 });
    }

    // Get class info
    const { data: cls, error: classError } = await supabase
      .from("Class")
      .select("*, GradingScheme (*)")
      .eq("id", classId)
      .single();

    if (classError || !cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Check access
    if (user.role === "TEACHER" && cls.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get activities
    const { data: activities } = await supabase
      .from("Activity")
      .select("*")
      .eq("classId", classId)
      .eq("archived", false)
      .order("order", { ascending: true });

    // Get enrollments with students
    const { data: enrollments } = await supabase
      .from("Enrollment")
      .select(`
        *,
        profile:StudentProfile (*),
        student:User (id, name, email)
      `)
      .eq("classId", classId)
      .eq("isActive", true);

    // Get submissions for this class
    const activityIds = activities?.map((a) => a.id) || [];
    const { data: submissions } = await supabase
      .from("ScoreSubmission")
      .select("*")
      .in("activityId", activityIds);

    // Process students with grades
    const students = enrollments?.map((enrollment) => {
      const studentSubmissions = submissions?.filter(
        (s) => s.studentId === enrollment.studentId
      ) || [];

      // Calculate grades
      const wwSubmissions = studentSubmissions.filter((s) => {
        const activity = activities?.find((a) => a.id === s.activityId);
        return activity?.category === "WRITTEN_WORK";
      });
      
      const ptSubmissions = studentSubmissions.filter((s) => {
        const activity = activities?.find((a) => a.id === s.activityId);
        return activity?.category === "PERFORMANCE_TASK";
      });
      
      const qaSubmissions = studentSubmissions.filter((s) => {
        const activity = activities?.find((a) => a.id === s.activityId);
        return activity?.category === "QUARTERLY_ASSESSMENT";
      });

      return {
        studentId: enrollment.studentId,
        studentName: enrollment.profile?.fullName || enrollment.student?.name,
        lrn: enrollment.profile?.lrn,
        submissions: studentSubmissions,
        grades: {
          ww: wwSubmissions,
          pt: ptSubmissions,
          qa: qaSubmissions,
        },
      };
    }) || [];

    // Export as Excel if requested
    if (format === "excel") {
      // For now, return JSON (Excel export would need additional library)
      return NextResponse.json({
        class: cls,
        activities,
        students,
      });
    }

    return NextResponse.json({
      class: cls,
      activities,
      students,
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 }
    );
  }
}
