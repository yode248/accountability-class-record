import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/me - Get current user profile
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user from database
    const { data: user, error: userError } = await supabase
      .from("User")
      .select(`
        id,
        email,
        name,
        role,
        avatar,
        createdAt
      `)
      .eq("id", authUser.id)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get student profile if applicable
    let studentProfile = null;
    if (user.role === "STUDENT") {
      const { data: profile } = await supabase
        .from("StudentProfile")
        .select("*")
        .eq("userId", user.id)
        .single();
      studentProfile = profile;
    }

    return NextResponse.json({
      ...user,
      studentProfile,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    return NextResponse.json(
      { error: "Failed to get user" },
      { status: 500 }
    );
  }
}
