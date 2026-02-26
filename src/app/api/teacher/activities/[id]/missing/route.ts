import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/teacher/activities/:id/missing
// Returns list of students with their submission status for a specific activity
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: activityId } = await params;

    // Get the activity and verify ownership
    const activity = await db.activity.findUnique({
      where: { id: activityId },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            ownerId: true,
          },
        },
      },
    });

    if (!activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Verify teacher owns this class
    if (activity.class.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get all enrolled students with their profiles
    const enrollments = await db.enrollment.findMany({
      where: { classId: activity.classId, isActive: true },
      include: {
        profile: {
          select: {
            fullName: true,
            lrn: true,
          },
        },
        student: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Get all submissions for this activity
    const submissions = await db.scoreSubmission.findMany({
      where: { activityId },
      select: {
        studentId: true,
        status: true,
        rawScore: true,
        submittedAt: true,
      },
    });

    // Create a map of student submissions
    const submissionMap = new Map(
      submissions.map((sub) => [sub.studentId, sub])
    );

    // Build roster with status
    const roster = enrollments.map((enrollment) => {
      const submission = submissionMap.get(enrollment.studentId);
      
      let status: string;
      if (!submission) {
        status = "NO_SUBMISSION";
      } else {
        status = submission.status;
      }

      return {
        studentId: enrollment.studentId,
        studentName: enrollment.profile.fullName || enrollment.student.name || "Unknown",
        lrn: enrollment.profile.lrn,
        status,
        rawScore: submission?.rawScore ?? null,
        submittedAt: submission?.submittedAt ?? null,
      };
    });

    // Calculate counts
    const counts = {
      total: roster.length,
      noSubmission: roster.filter((s) => s.status === "NO_SUBMISSION").length,
      needsRevision: roster.filter((s) => s.status === "NEEDS_REVISION").length,
      declined: roster.filter((s) => s.status === "DECLINED").length,
      pending: roster.filter((s) => s.status === "PENDING").length,
      approved: roster.filter((s) => s.status === "APPROVED").length,
    };

    return NextResponse.json({
      activity: {
        id: activity.id,
        title: activity.title,
        maxScore: activity.maxScore,
        dueDate: activity.dueDate,
        category: activity.category,
      },
      class: activity.class,
      counts,
      roster,
    });
  } catch (error) {
    console.error("Get missing students error:", error);
    return NextResponse.json(
      { error: "Failed to get missing students" },
      { status: 500 }
    );
  }
}
