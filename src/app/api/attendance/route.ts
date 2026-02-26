import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";
import { nanoid } from "nanoid";

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
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");

    if (!classId) {
      return NextResponse.json({ error: "Class ID required" }, { status: 400 });
    }

    // Verify access
    const { data: cls, error: classError } = await supabase
      .from("classes")
      .select("id, ownerId")
      .eq("id", classId)
      .single();

    if (classError || !cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const isOwner = cls.ownerId === user.id;
    
    // Check enrollment for students
    let isEnrolled = false;
    if (user.role === "STUDENT") {
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("classId", classId)
        .eq("studentId", user.id)
        .single();
      isEnrolled = !!enrollment;
    }

    const hasAccess = isOwner || isEnrolled;

    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get attendance sessions with submissions
    const { data: sessions, error } = await supabase
      .from("attendance_sessions")
      .select(`
        id,
        date,
        title,
        lateThresholdMinutes,
        qrToken,
        qrExpiresAt,
        isActive,
        createdAt,
        submissions:attendance_submissions (
          id,
          status,
          proofUrl,
          checkedInAt,
          notes,
          submissionStatus,
          teacherFeedback,
          studentId,
          student:users!attendance_submissions_studentId_fkey (
            id,
            name,
            studentProfile:student_profiles (
              fullName,
              lrn
            )
          )
        )
      `)
      .eq("classId", classId)
      .order("date", { ascending: false });

    if (error) throw error;

    // For students, filter to only their submissions
    const result = (sessions || []).map(session => ({
      ...session,
      submissions: user.role === "STUDENT" 
        ? (session.submissions || []).filter((s: { studentId: string }) => s.studentId === user.id)
        : session.submissions,
    }));

    return NextResponse.json(result);
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
    const validated = createSessionSchema.parse(body);

    // Verify ownership
    const { data: cls, error: classError } = await supabase
      .from("classes")
      .select("id, ownerId")
      .eq("id", validated.classId)
      .single();

    if (classError || !cls || cls.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const qrToken = validated.enableQr ? nanoid(10).toUpperCase() : null;
    const qrExpiresAt = validated.enableQr
      ? new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes
      : null;

    const { data: session, error } = await supabase
      .from("attendance_sessions")
      .insert({
        classId: validated.classId,
        date: new Date(validated.date).toISOString(),
        title: validated.title,
        lateThresholdMinutes: validated.lateThresholdMinutes ?? 15,
        qrToken,
        qrExpiresAt,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(session);
  } catch (error) {
    console.error("Create attendance session error:", error);
    return NextResponse.json(
      { error: "Failed to create attendance session" },
      { status: 500 }
    );
  }
}
