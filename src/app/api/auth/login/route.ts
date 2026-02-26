import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const body = await request.json();
    const validated = loginSchema.parse(body);

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email: validated.email,
      password: validated.password,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      );
    }

    if (!data.user) {
      return NextResponse.json(
        { error: "Login failed" },
        { status: 401 }
      );
    }

    // Get user profile
    const { data: userData } = await supabase
      .from("User")
      .select("id, email, name, role")
      .eq("id", data.user.id)
      .single();

    // Get student profile if applicable
    let studentProfile = null;
    if (userData?.role === "STUDENT") {
      const { data: profileData } = await supabase
        .from("StudentProfile")
        .select("*")
        .eq("userId", data.user.id)
        .single();
      studentProfile = profileData;
    }

    return NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: userData?.name || data.user.user_metadata?.name,
        role: userData?.role || data.user.user_metadata?.role,
        studentProfile,
      },
      session: data.session,
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Login failed" },
      { status: 500 }
    );
  }
}
