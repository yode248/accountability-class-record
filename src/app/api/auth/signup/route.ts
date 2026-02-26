import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["TEACHER", "STUDENT"]),
  // Student-specific fields
  fullName: z.string().optional(),
  lrn: z.string().optional(),
  sex: z.enum(["M", "F"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Check database connection first
    try {
      await db.$queryRaw`SELECT 1`;
    } catch (dbError) {
      console.error("Database connection error:", dbError);
      return NextResponse.json(
        { error: "Database connection failed. Please check if the database is configured correctly." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const validated = signupSchema.parse(body);

    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { email: validated.email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(validated.password, 10);

    // Create user with transaction
    const user = await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: validated.email,
          name: validated.name,
          password: hashedPassword,
          role: validated.role,
        },
      });

      // Create student profile if role is STUDENT
      if (validated.role === "STUDENT" && validated.fullName && validated.lrn) {
        await tx.studentProfile.create({
          data: {
            userId: newUser.id,
            fullName: validated.fullName,
            lrn: validated.lrn,
            sex: validated.sex,
          },
        });
      }

      return newUser;
    });

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (error) {
    console.error("Signup error:", error);
    
    // Return more specific error message
    let errorMessage = "Failed to create account";
    if (error instanceof Error) {
      if (error.message.includes("database") || error.message.includes("connection")) {
        errorMessage = "Database connection error. Please try again later.";
      } else if (error.message.includes("Unique constraint")) {
        errorMessage = "Email or LRN already exists";
      }
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
