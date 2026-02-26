import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

const notifySchema = z.object({
  includeStatuses: z.array(z.string()),
  title: z.string().min(1),
  messageTemplate: z.string().min(1),
});

// Helper to get current user
async function getCurrentUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  
  const { data: userData } = await supabase
    .from("User")
    .select("id, role, name")
    .eq("id", user.id)
    .single();
  
  return userData;
}

// POST /api/teacher/activities/[id]/notify
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: activityId } = await params;
    const body = await request.json();
    const validated = notifySchema.parse(body);

    // Get the activity and verify ownership
    const { data: activity, error: activityError } = await supabase
      .from("Activity")
      .select(`
        id,
        title,
        dueDate,
        classId,
        Class!inner (id, name, ownerId)
      `)
      .eq("id", activityId)
      .single();

    if (activityError || !activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Verify teacher owns this class
    const cls = activity.Class as { id: string; name: string; ownerId: string };
    if (cls.ownerId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get all enrolled students
    const { data: enrollments } = await supabase
      .from("Enrollment")
      .select(`
        studentId,
        profile:StudentProfile (fullName)
      `)
      .eq("classId", activity.classId)
      .eq("isActive", true);

    // Get all submissions for this activity
    const { data: submissions } = await supabase
      .from("ScoreSubmission")
      .select("studentId, status")
      .eq("activityId", activityId);

    // Create a map of student submissions
    const submissionMap = new Map(
      submissions?.map((sub) => [sub.studentId, sub.status]) || []
    );

    // Filter students by status
    const recipients = (enrollments || []).filter((enrollment) => {
      const status = submissionMap.get(enrollment.studentId) || "NO_SUBMISSION";
      return validated.includeStatuses.includes(status);
    });

    // Determine notification type
    let notificationType = "GENERAL";
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

    // Create notifications for each recipient
    const notifications = [];
    for (const recipient of recipients) {
      // Personalize message
      const personalizedMessage = validated.messageTemplate
        .replace(/{StudentName}/g, recipient.profile?.fullName || "Student")
        .replace(/{ActivityTitle}/g, activity.title)
        .replace(/{DueDate}/g, dueDateStr)
        .replace(/{TeacherName}/g, user.name || "Your Teacher");

      const { data: notification, error: notifError } = await supabase
        .from("Notification")
        .insert({
          toUserId: recipient.studentId,
          fromUserId: user.id,
          classId: activity.classId,
          activityId: activityId,
          type: notificationType,
          title: validated.title.replace(/{ActivityTitle}/g, activity.title),
          message: personalizedMessage,
          isRead: false,
          createdAt: new Date().toISOString(),
        })
        .select()
        .single();

      if (!notifError && notification) {
        notifications.push(notification);
      }
    }

    // Create audit log
    await supabase.from("AuditLog").insert({
      userId: user.id,
      action: "NOTIFICATION_SENT",
      entityType: "ACTIVITY",
      entityId: activityId,
      newValue: JSON.stringify({
        includedStatuses: validated.includeStatuses,
        recipientCount: recipients.length,
        title: validated.title,
        notificationType,
      }),
      createdAt: new Date().toISOString(),
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
