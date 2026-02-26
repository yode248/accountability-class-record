import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const joinClassSchema = z.object({
  code: z.string().min(1),
});

// POST /api/classes/join - Join a class using code
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "STUDENT") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = joinClassSchema.parse(body);

    // Find class by code
    const cls = await db.class.findUnique({
      where: { code: validated.code.toUpperCase() },
    });

    if (!cls) {
      return NextResponse.json({ error: "Invalid class code" }, { status: 404 });
    }

    if (!cls.isActive) {
      return NextResponse.json({ error: "Class is not active" }, { status: 400 });
    }

    // Q2-Q4 classes do not allow manual joins - students are auto-enrolled from previous quarter
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
    const existingEnrollment = await db.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: cls.id,
          studentId: session.user.id,
        },
      },
    });

    if (existingEnrollment) {
      return NextResponse.json({ error: "Already enrolled in this class" }, { status: 400 });
    }

    // Get student profile
    const profile = await db.studentProfile.findUnique({
      where: { userId: session.user.id },
    });

    if (!profile) {
      return NextResponse.json({ error: "Please complete your profile first" }, { status: 400 });
    }

    // Create enrollment
    const enrollment = await db.enrollment.create({
      data: {
        classId: cls.id,
        studentId: session.user.id,
        profileId: profile.id,
      },
      include: {
        class: true,
      },
    });

    // Update profile section if not set
    if (!profile.section) {
      await db.studentProfile.update({
        where: { id: profile.id },
        data: { section: cls.section },
      });
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
