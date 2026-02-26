import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    
    // Get current auth user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json(
        { error: "Not authenticated", user: null },
        { status: 401 }
      );
    }

    // Get user profile from database
    const { data: userData, error: userError } = await supabase
      .from("User")
      .select("id, email, name, role, avatar, createdAt")
      .eq("id", authUser.id)
      .single();

    if (userError || !userData) {
      // User exists in auth but not in database - create from metadata
      const { data: newUser, error: createError } = await supabase
        .from("User")
        .insert({
          id: authUser.id,
          email: authUser.email!,
          name: authUser.user_metadata?.name || authUser.email!.split("@")[0],
          role: authUser.user_metadata?.role || "STUDENT",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) {
        return NextResponse.json(
          { error: "Failed to get user profile", user: null },
          { status: 500 }
        );
      }

      return NextResponse.json({ user: newUser });
    }

    // Get student profile if applicable
    let studentProfile = null;
    if (userData.role === "STUDENT") {
      const { data: profileData } = await supabase
        .from("StudentProfile")
        .select("*")
        .eq("userId", userData.id)
        .single();
      studentProfile = profileData;
    }

    return NextResponse.json({
      user: {
        ...userData,
        studentProfile,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    return NextResponse.json(
      { error: "Failed to get user", user: null },
      { status: 500 }
    );
  }
}
