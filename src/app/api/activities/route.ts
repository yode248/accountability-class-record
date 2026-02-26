import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const createActivitySchema = z.object({
  classId: z.string(),
  category: z.enum(["WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"]),
  title: z.string().min(1),
  description: z.string().nullish(),
  maxScore: z.number().positive(),
  dueDate: z.string().nullish(),
  instructions: z.string().nullish(),
  requiresEvidence: z.boolean().optional(),
  evidenceTypes: z.array(z.string()).optional(),
});

// GET /api/activities - Get activities for a class
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");

    if (!classId) {
      return NextResponse.json({ error: "Class ID required" }, { status: 400 });
    }

    // Verify access
    const cls = await db.class.findUnique({
      where: { id: classId },
      include: {
        enrollments: { where: { studentId: session.user.id } },
      },
    });

    if (!cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const isOwner = cls.ownerId === session.user.id;
    const isEnrolled = cls.enrollments.length > 0;

    if (!isOwner && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const activities = await db.activity.findMany({
      where: { classId },
      orderBy: [{ category: "asc" }, { order: "asc" }],
      include: {
        _count: {
          select: { submissions: true },
        },
      },
    });

    return NextResponse.json(activities);
  } catch (error) {
    console.error("Get activities error:", error);
    return NextResponse.json(
      { error: "Failed to get activities" },
      { status: 500 }
    );
  }
}

// POST /api/activities - Create activity (Teacher only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createActivitySchema.parse(body);

    // Verify ownership
    const cls = await db.class.findUnique({
      where: { id: validated.classId },
    });

    if (!cls || cls.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if grading period is completed
    if (cls.gradingPeriodStatus === "COMPLETED") {
      return NextResponse.json({ 
        error: "Cannot add new activities after the grading period has been completed" 
      }, { status: 400 });
    }

    // Get max order for this category
    const maxOrderActivity = await db.activity.findFirst({
      where: { classId: validated.classId, category: validated.category },
      orderBy: { order: "desc" },
    });

    const activity = await db.activity.create({
      data: {
        classId: validated.classId,
        category: validated.category,
        title: validated.title,
        description: validated.description,
        maxScore: validated.maxScore,
        dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
        instructions: validated.instructions,
        requiresEvidence: validated.requiresEvidence ?? false,
        evidenceTypes: validated.evidenceTypes ? JSON.stringify(validated.evidenceTypes) : null,
        order: (maxOrderActivity?.order ?? 0) + 1,
      },
    });

    return NextResponse.json(activity);
  } catch (error) {
    console.error("Create activity error:", error);
    return NextResponse.json(
      { error: "Failed to create activity" },
      { status: 500 }
    );
  }
}
