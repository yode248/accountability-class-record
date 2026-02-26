import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["TEACHER", "STUDENT"]),
  fullName: z.string().optional(),
  lrn: z.string().optional(),
  sex: z.enum(["M", "F"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const body = await request.json();
    const validated = signupSchema.parse(body);

    // Create auth user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: validated.email,
      password: validated.password,
      options: {
        data: {
          name: validated.name,
          role: validated.role,
        },
      },
    });

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      );
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: "Failed to create user" },
        { status: 500 }
      );
    }

    // Insert into User table
    const { error: userError } = await supabase.from("User").insert({
      id: authData.user.id,
      email: validated.email,
      name: validated.name,
      role: validated.role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    if (userError) {
      console.error("Error creating user record:", userError);
      return NextResponse.json(
        { error: "Failed to create user record" },
        { status: 500 }
      );
    }

    // Create student profile if role is STUDENT
    if (validated.role === "STUDENT" && validated.fullName && validated.lrn) {
      const { error: profileError } = await supabase.from("StudentProfile").insert({
        userId: authData.user.id,
        fullName: validated.fullName,
        lrn: validated.lrn,
        sex: validated.sex || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      if (profileError) {
        console.error("Error creating student profile:", profileError);
      }
    }

    return NextResponse.json({
      id: authData.user.id,
      email: validated.email,
      name: validated.name,
      role: validated.role,
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create account" },
      { status: 500 }
    );
  }
}
