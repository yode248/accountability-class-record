import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Helper to get current user
async function getCurrentUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  
  const { data: userData } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", user.id)
    .single();
  
  return userData;
}

// PUT /api/notifications/[id]/read - Mark notification as read
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify the notification belongs to this user
    const { data: notification, error: notificationError } = await supabase
      .from("notifications")
      .select("id, toUserId")
      .eq("id", id)
      .single();

    if (notificationError || !notification) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    if (notification.toUserId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Mark as read
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ isRead: true })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return NextResponse.json(
      { error: "Failed to mark notification as read" },
      { status: 500 }
    );
  }
}
