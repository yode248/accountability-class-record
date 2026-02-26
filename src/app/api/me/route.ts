import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/me - Get current user info
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      include: {
        studentProfile: true,
        ownedClasses: session.user.role === "TEACHER" ? {
          select: { id: true, name: true, code: true },
          take: 5,
          orderBy: { createdAt: "desc" },
        } : false,
        enrollments: session.user.role === "STUDENT" ? {
          include: { class: { select: { id: true, name: true, subject: true } } },
          take: 5,
          orderBy: { enrolledAt: "desc" },
        } : false,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatar: user.avatar,
      studentProfile: user.studentProfile,
      classes: user.ownedClasses || user.enrollments?.map((e) => e.class) || [],
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Update user name
    if (body.name) {
      await db.user.update({
        where: { id: session.user.id },
        data: { name: body.name },
      });
    }

    // Update student profile if provided
    if (session.user.role === "STUDENT" && (body.fullName || body.lrn)) {
      await db.studentProfile.upsert({
        where: { userId: session.user.id },
        create: {
          userId: session.user.id,
          fullName: body.fullName,
          lrn: body.lrn,
          sex: body.sex,
        },
        update: {
          fullName: body.fullName,
          lrn: body.lrn,
          sex: body.sex,
        },
      });
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
