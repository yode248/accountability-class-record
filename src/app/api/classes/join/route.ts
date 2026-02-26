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

// POST /api/classes/join - Join a class using code
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json({ error: "Class code is required" }, { status: 400 });
    }

    // Find class by code
    const { data: cls, error: classError } = await supabase
      .from("Class")
      .select("*")
      .eq("code", code.toUpperCase())
      .single();

    if (classError || !cls) {
      return NextResponse.json({ error: "Invalid class code" }, { status: 404 });
    }

    if (!cls.isActive) {
      return NextResponse.json({ error: "Class is not active" }, { status: 400 });
    }

    // Q2-Q4 classes do not allow manual joins
    if (cls.quarter > 1 && cls.linkedFromClassId) {
      return NextResponse.json({ 
        error: "This class does not accept new enrollments. Students are automatically enrolled from the previous quarter's class.",
        quarterInfo: {
          quarter: cls.quarter,
          linkedFromClassId: cls.linkedFromClassId,
        }
      }, { status: 400 });
    }

    // Check if already enrolled
    const { data: existingEnrollment } = await supabase
      .from("Enrollment")
      .select("*")
      .eq("classId", cls.id)
      .eq("studentId", user.id)
      .single();

    if (existingEnrollment) {
      return NextResponse.json({ error: "Already enrolled in this class" }, { status: 400 });
    }

    // Get student profile
    const { data: profile } = await supabase
      .from("StudentProfile")
      .select("*")
      .eq("userId", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Please complete your profile first" }, { status: 400 });
    }

    // Create enrollment
    const { data: enrollment, error: enrollmentError } = await supabase
      .from("Enrollment")
      .insert({
        classId: cls.id,
        studentId: user.id,
        profileId: profile.id,
        enrolledAt: new Date().toISOString(),
        isActive: true,
      })
      .select(`
        *,
        class:Class (*)
      `)
      .single();

    if (enrollmentError) {
      console.error("Enrollment error:", enrollmentError);
      return NextResponse.json({ error: "Failed to join class" }, { status: 500 });
    }

    // Update profile section if not set
    if (!profile.section && cls.section) {
      await supabase
        .from("StudentProfile")
        .update({ section: cls.section, updatedAt: new Date().toISOString() })
        .eq("id", profile.id);
    }

    return NextResponse.json(enrollment);
  } catch (error) {
    console.error("Join class error:", error);
    return NextResponse.json(
      { error: "Failed to join class" },
      { status: 500 }
    );
  }
}
