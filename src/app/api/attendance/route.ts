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

// GET /api/attendance - Get attendance sessions
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");

    if (!classId) {
      return NextResponse.json([]);
    }

    // Check access
    if (user.role === "TEACHER") {
      const { data: cls } = await supabase
        .from("Class")
        .select("id")
        .eq("id", classId)
        .eq("ownerId", user.id)
        .single();
      
      if (!cls) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    } else {
      const { data: enrollment } = await supabase
        .from("Enrollment")
        .select("id")
        .eq("classId", classId)
        .eq("studentId", user.id)
        .single();
      
      if (!enrollment) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    // Get sessions
    const { data: sessions, error } = await supabase
      .from("AttendanceSession")
      .select(`
        *,
        submissions:AttendanceSubmission (
          id,
          studentId,
          status,
          submissionStatus,
          submittedAt
        )
      `)
      .eq("classId", classId)
      .eq("isActive", true)
      .order("date", { ascending: false });

    if (error) {
      console.error("Error fetching sessions:", error);
      return NextResponse.json([]);
    }

    return NextResponse.json(sessions || []);
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
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { classId, title, date, lateThresholdMinutes } = body;

    if (!classId) {
      return NextResponse.json({ error: "Class ID required" }, { status: 400 });
    }

    // Verify ownership
    const { data: cls } = await supabase
      .from("Class")
      .select("id, ownerId")
      .eq("id", classId)
      .single();

    if (!cls || cls.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Create session
    const { data: session, error } = await supabase
      .from("AttendanceSession")
      .insert({
        classId,
        title: title || `Attendance - ${new Date(date || Date.now()).toLocaleDateString()}`,
        date: date || new Date().toISOString(),
        lateThresholdMinutes: lateThresholdMinutes || 15,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating session:", error);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error("Create attendance error:", error);
    return NextResponse.json(
      { error: "Failed to create attendance session" },
      { status: 500 }
    );
  }
}
