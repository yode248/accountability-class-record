import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const updateSubmissionSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "DECLINED", "NEEDS_REVISION"]).optional(),
  teacherFeedback: z.string().nullish(),
  reason: z.string().nullish(), // For override
  rawScore: z.number().optional(), // For override
});

// GET /api/submissions/[id] - Get submission details
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

    const submission = await db.scoreSubmission.findUnique({
      where: { id },
      include: {
        activity: {
          include: { class: true },
        },
        student: {
          include: { studentProfile: true },
        },
      },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Check access
    const isOwner = submission.activity.class.ownerId === session.user.id;
    const isStudent = submission.studentId === session.user.id;

    if (!isOwner && !isStudent) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json(submission);
  } catch (error) {
    console.error("Get submission error:", error);
    return NextResponse.json(
      { error: "Failed to get submission" },
      { status: 500 }
    );
  }
}

// PUT /api/submissions/[id] - Update submission (approve/decline/override)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validated = updateSubmissionSchema.parse(body);

    const submission = await db.scoreSubmission.findUnique({
      where: { id },
      include: { activity: { include: { class: true } } },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Teacher approval/decline
    if (session.user.role === "TEACHER") {
      if (submission.activity.class.ownerId !== session.user.id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      const oldValue = JSON.stringify(submission);
      const updateData: Record<string, unknown> = {
        reviewedAt: new Date(),
        reviewedBy: session.user.id,
      };

      if (validated.status) updateData.status = validated.status;
      if (validated.teacherFeedback !== undefined) {
        updateData.teacherFeedback = validated.teacherFeedback;
      }

      // Handle override
      if (validated.rawScore !== undefined && validated.status === "APPROVED") {
        if (!validated.reason) {
          return NextResponse.json(
            { error: "Reason required for override" },
            { status: 400 }
          );
        }
        updateData.rawScore = Math.min(validated.rawScore, submission.activity.maxScore);
      }

      const updated = await db.scoreSubmission.update({
        where: { id },
        data: updateData,
      });

      // Create audit log
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: validated.rawScore !== undefined ? "OVERRIDE" : validated.status || "UPDATE",
          entityType: "ScoreSubmission",
          entityId: id,
          oldValue,
          newValue: JSON.stringify(updated),
          reason: validated.reason || validated.teacherFeedback,
          scoreSubmissionId: id,
        },
      });

      return NextResponse.json(updated);
    }

    // Student update (only for NEEDS_REVISION)
    if (submission.studentId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (submission.status !== "NEEDS_REVISION" && submission.status !== "DECLINED") {
      return NextResponse.json(
        { error: "Cannot update this submission" },
        { status: 400 }
      );
    }

    const updated = await db.scoreSubmission.update({
      where: { id },
      data: {
        rawScore: validated.rawScore ?? submission.rawScore,
        status: "PENDING",
        teacherFeedback: null,
        submittedAt: new Date(),
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entityType: "ScoreSubmission",
        entityId: id,
        oldValue: JSON.stringify(submission),
        newValue: JSON.stringify(updated),
        scoreSubmissionId: id,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update submission error:", error);
    return NextResponse.json(
      { error: "Failed to update submission" },
      { status: 500 }
    );
  }
}
