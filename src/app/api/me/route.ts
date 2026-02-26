import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/me - Get current user info
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user profile with related data
    const { data: userData, error: profileError } = await supabase
      .from("users")
      .select(`
        id,
        email,
        name,
        role,
        avatar,
        studentProfile:student_profiles (
          fullName,
          lrn,
          sex,
          section
        )
      `)
      .eq("id", authUser.id)
      .single();

    if (profileError) {
      console.error("Error fetching user profile:", profileError);
      // Return basic user data from auth
      return NextResponse.json({
        id: authUser.id,
        email: authUser.email,
        name: authUser.user_metadata?.name,
        role: authUser.user_metadata?.role || "STUDENT",
        avatar: null,
        studentProfile: null,
        classes: [],
      });
    }

    // Get classes based on role
    let classes: unknown[] = [];
    
    if (userData.role === "TEACHER") {
      const { data: ownedClasses } = await supabase
        .from("classes")
        .select("id, name, code")
        .eq("ownerId", authUser.id)
        .order("createdAt", { ascending: false })
        .limit(5);
      
      classes = ownedClasses || [];
    } else {
      const { data: enrollments } = await supabase
        .from("enrollments")
        .select(`
          class:classes (
            id,
            name,
            subject
          )
        `)
        .eq("studentId", authUser.id)
        .eq("isActive", true)
        .order("enrolledAt", { ascending: false })
        .limit(5);
      
      classes = enrollments?.map((e) => e.class).filter(Boolean) || [];
    }

    return NextResponse.json({
      id: userData.id,
      email: userData.email,
      name: userData.name,
      role: userData.role,
      avatar: userData.avatar,
      studentProfile: userData.studentProfile?.[0] || null,
      classes,
    });
  } catch (error) {
    console.error("Get user error:", error);
    return NextResponse.json(
      { error: "Failed to get user" },
      { status: 500 }
    );
  }
}

// PUT /api/me - Update user profile
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Update user name
    if (body.name) {
      const { error: updateError } = await supabase
        .from("users")
        .update({ name: body.name })
        .eq("id", authUser.id);

      if (updateError) {
        console.error("Error updating user:", updateError);
      }
    }

    // Get current user role
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", authUser.id)
      .single();

    // Update student profile if provided
    if (userData?.role === "STUDENT" && (body.fullName || body.lrn)) {
      // Check if profile exists
      const { data: existingProfile } = await supabase
        .from("student_profiles")
        .select("userId")
        .eq("userId", authUser.id)
        .single();

      if (existingProfile) {
        await supabase
          .from("student_profiles")
          .update({
            fullName: body.fullName,
            lrn: body.lrn,
            sex: body.sex,
          })
          .eq("userId", authUser.id);
      } else {
        await supabase
          .from("student_profiles")
          .insert({
            userId: authUser.id,
            fullName: body.fullName,
            lrn: body.lrn,
            sex: body.sex,
          });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
