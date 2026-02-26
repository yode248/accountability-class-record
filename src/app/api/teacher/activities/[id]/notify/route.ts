import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const notifySchema = z.object({
  includeStatuses: z.array(z.string()),
  title: z.string().min(1),
  messageTemplate: z.string().min(1),
});

// POST /api/teacher/activities/:id/notify
// Send notifications to students with specific submission statuses
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: activityId } = await params;
    const body = await request.json();
    const validated = notifySchema.parse(body);

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

    // Get all enrolled students
    const enrollments = await db.enrollment.findMany({
      where: { classId: activity.classId, isActive: true },
      include: {
        profile: {
          select: {
            fullName: true,
            lrn: true,
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
      },
    });

    // Create a map of student submissions
    const submissionMap = new Map(
      submissions.map((sub) => [sub.studentId, sub.status])
    );

    // Filter students by status
    const recipients = enrollments.filter((enrollment) => {
      const status = submissionMap.get(enrollment.studentId) || "NO_SUBMISSION";
      return validated.includeStatuses.includes(status);
    });

    // Determine notification type based on included statuses
    let notificationType: "REMINDER_MISSING_SUBMISSION" | "REMINDER_REVISION" | "GENERAL" = "GENERAL";
    if (validated.includeStatuses.includes("NO_SUBMISSION")) {
      notificationType = "REMINDER_MISSING_SUBMISSION";
    } else if (validated.includeStatuses.includes("NEEDS_REVISION")) {
      notificationType = "REMINDER_REVISION";
    }

    // Format due date
    const dueDateStr = activity.dueDate 
      ? new Date(activity.dueDate).toLocaleDateString("en-PH", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "No due date";

    // Get teacher name
    const teacher = await db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true },
    });

    // Create notifications for each recipient
    const notifications = await Promise.all(
      recipients.map((recipient) => {
        // Personalize message
        const personalizedMessage = validated.messageTemplate
          .replace(/{StudentName}/g, recipient.profile.fullName)
          .replace(/{ActivityTitle}/g, activity.title)
          .replace(/{DueDate}/g, dueDateStr)
          .replace(/{TeacherName}/g, teacher?.name || "Your Teacher");

        return db.notification.create({
          data: {
            toUserId: recipient.studentId,
            fromUserId: session.user.id,
            classId: activity.classId,
            activityId: activityId,
            type: notificationType,
            title: validated.title
              .replace(/{ActivityTitle}/g, activity.title),
            message: personalizedMessage,
          },
        });
      })
    );

    // Create audit log
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "NOTIFICATION_SENT",
        entityType: "ACTIVITY",
        entityId: activityId,
        newValue: JSON.stringify({
          includedStatuses: validated.includeStatuses,
          recipientCount: recipients.length,
          title: validated.title,
          notificationType,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      recipientCount: recipients.length,
      notificationIds: notifications.map((n) => n.id),
    });
  } catch (error) {
    console.error("Send notifications error:", error);
    return NextResponse.json(
      { error: "Failed to send notifications" },
      { status: 500 }
    );
  }
}
