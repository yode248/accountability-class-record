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

// GET /api/activities/[id] - Get activity details
export async function GET(
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

    // Get activity with class info
    const { data: activity, error } = await supabase
      .from("activities")
      .select(`
        id,
        category,
        title,
        description,
        maxScore,
        dueDate,
        instructions,
        requiresEvidence,
        evidenceTypes,
        order,
        isActive,
        archived,
        archivedAt,
        archivedBy,
        archiveReason,
        createdAt,
        class:classes (
          id,
          name,
          ownerId
        )
      `)
      .eq("id", id)
      .single();

    if (error || !activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Check access
    const isOwner = activity.class?.ownerId === user.id;
    
    // Check enrollment for students
    let isEnrolled = false;
    if (user.role === "STUDENT") {
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("classId", activity.class?.id)
        .eq("studentId", user.id)
        .single();
      isEnrolled = !!enrollment;
    }

    if (!isOwner && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Students cannot see archived activities
    if (user.role === "STUDENT" && activity.archived) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Get submissions
    let submissionsQuery = supabase
      .from("score_submissions")
      .select(`
        id,
        rawScore,
        evidenceUrl,
        evidenceType,
        notes,
        status,
        teacherFeedback,
        submittedAt,
        updatedAt,
        student:users!score_submissions_studentId_fkey (
          id,
          name,
          studentProfile:student_profiles (
            fullName,
            lrn
          )
        )
      `)
      .eq("activityId", id);

    if (user.role === "STUDENT") {
      submissionsQuery = submissionsQuery.eq("studentId", user.id);
    }

    const { data: submissions } = await submissionsQuery;

    return NextResponse.json({
      ...activity,
      submissions: submissions || [],
    });
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
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    // Get activity with class info
    const { data: activity, error: activityError } = await supabase
      .from("activities")
      .select("id, title, classId, class:classes (ownerId)")
      .eq("id", id)
      .single();

    if (activityError || !activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Check ownership
    const classData = activity.class as { ownerId: string } | null;
    if (!classData || classData.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Handle archive action
    if (body.action === "archive") {
      const { data: updated, error: updateError } = await supabase
        .from("activities")
        .update({
          archived: true,
          archivedAt: new Date().toISOString(),
          archivedBy: user.id,
          archiveReason: body.archiveReason || null,
        })
        .eq("id", id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Create audit log
      await supabase.from("audit_logs").insert({
        userId: user.id,
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
      });

      return NextResponse.json(updated);
    }

    // Handle unarchive action
    if (body.action === "unarchive") {
      const { data: updated, error: updateError } = await supabase
        .from("activities")
        .update({
          archived: false,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
        })
        .eq("id", id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Create audit log
      await supabase.from("audit_logs").insert({
        userId: user.id,
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
      });

      return NextResponse.json(updated);
    }

    // Regular update
    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.maxScore !== undefined) updateData.maxScore = body.maxScore;
    if (body.dueDate !== undefined) updateData.dueDate = body.dueDate ? new Date(body.dueDate).toISOString() : null;
    if (body.instructions !== undefined) updateData.instructions = body.instructions;
    if (body.requiresEvidence !== undefined) updateData.requiresEvidence = body.requiresEvidence;
    if (body.evidenceTypes !== undefined) updateData.evidenceTypes = body.evidenceTypes ? JSON.stringify(body.evidenceTypes) : null;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.category !== undefined) updateData.category = body.category;

    const { data: updated, error: updateError } = await supabase
      .from("activities")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

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
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Get activity with class info and submissions count
    const { data: activity, error: activityError } = await supabase
      .from("activities")
      .select(`
        id,
        title,
        category,
        maxScore,
        classId,
        class:classes (ownerId),
        submissions:score_submissions (id)
      `)
      .eq("id", id)
      .single();

    if (activityError || !activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Check ownership
    const classData = activity.class as { ownerId: string } | null;
    if (!classData || classData.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Create audit log before deletion
    await supabase.from("audit_logs").insert({
      userId: user.id,
      action: "DELETE_PERMANENT",
      entityType: "Activity",
      entityId: id,
      oldValue: JSON.stringify({
        title: activity.title,
        category: activity.category,
        maxScore: activity.maxScore,
        submissionCount: activity.submissions?.length || 0,
      }),
      newValue: null,
      reason: "Permanent deletion by teacher",
    });

    // Delete all submissions first
    await supabase
      .from("score_submissions")
      .delete()
      .eq("activityId", id);

    // Delete the activity
    const { error: deleteError } = await supabase
      .from("activities")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete activity error:", error);
    return NextResponse.json(
      { error: "Failed to delete activity" },
      { status: 500 }
    );
  }
}
