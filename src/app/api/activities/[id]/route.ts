import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/activities/[id] - Get activity details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const activity = await db.activity.findUnique({
      where: { id },
      include: {
        class: {
          include: {
            enrollments: { where: { studentId: session.user.id } },
          },
        },
        submissions: session.user.role === "TEACHER" ? {
          include: {
            student: { include: { studentProfile: true } },
          },
        } : {
          where: { studentId: session.user.id },
        },
      },
    });

    if (!activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Check access
    const isOwner = activity.class.ownerId === session.user.id;
    const isEnrolled = activity.class.enrollments.length > 0;

    if (!isOwner && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Students cannot see archived activities
    if (session.user.role === "STUDENT" && activity.archived) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    return NextResponse.json(activity);
  } catch (error) {
    console.error("Get activity error:", error);
    return NextResponse.json(
      { error: "Failed to get activity" },
      { status: 500 }
    );
  }
}

// PUT /api/activities/[id] - Update activity (including archive/unarchive)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const activity = await db.activity.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!activity || activity.class.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Handle archive action
    if (body.action === "archive") {
      const updated = await db.activity.update({
        where: { id },
        data: {
          archived: true,
          archivedAt: new Date(),
          archivedBy: session.user.id,
          archiveReason: body.archiveReason || null,
        },
      });

      // Create audit log
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ARCHIVE",
          entityType: "Activity",
          entityId: id,
          oldValue: JSON.stringify({ 
            title: activity.title, 
            archived: false 
          }),
          newValue: JSON.stringify({ 
            title: activity.title, 
            archived: true,
            reason: body.archiveReason 
          }),
        },
      });

      return NextResponse.json(updated);
    }

    // Handle unarchive action
    if (body.action === "unarchive") {
      const updated = await db.activity.update({
        where: { id },
        data: {
          archived: false,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
        },
      });

      // Create audit log
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "UNARCHIVE",
          entityType: "Activity",
          entityId: id,
          oldValue: JSON.stringify({ 
            title: activity.title, 
            archived: true 
          }),
          newValue: JSON.stringify({ 
            title: activity.title, 
            archived: false 
          }),
        },
      });

      return NextResponse.json(updated);
    }

    // Regular update
    const updated = await db.activity.update({
      where: { id },
      data: {
        title: body.title,
        description: body.description,
        maxScore: body.maxScore,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        instructions: body.instructions,
        requiresEvidence: body.requiresEvidence,
        evidenceTypes: body.evidenceTypes ? JSON.stringify(body.evidenceTypes) : null,
        isActive: body.isActive,
        category: body.category,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update activity error:", error);
    return NextResponse.json(
      { error: "Failed to update activity" },
      { status: 500 }
    );
  }
}

// DELETE /api/activities/[id] - Permanently delete activity (dangerous)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const activity = await db.activity.findUnique({
      where: { id },
      include: { 
        class: true,
        submissions: true 
      },
    });

    if (!activity || activity.class.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Create audit log before deletion
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE_PERMANENT",
        entityType: "Activity",
        entityId: id,
        oldValue: JSON.stringify({
          title: activity.title,
          category: activity.category,
          maxScore: activity.maxScore,
          submissionCount: activity.submissions.length,
        }),
        newValue: null,
        reason: "Permanent deletion by teacher",
      },
    });

    // Delete all submissions first (cascade should handle this, but explicit is safer)
    await db.scoreSubmission.deleteMany({
      where: { activityId: id },
    });

    // Delete the activity
    await db.activity.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete activity error:", error);
    return NextResponse.json(
      { error: "Failed to delete activity" },
      { status: 500 }
    );
  }
}
