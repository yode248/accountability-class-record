import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

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
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const { data: submission, error } = await supabase
      .from("score_submissions")
      .select(`
        id,
        rawScore,
        evidenceUrl,
        evidenceType,
        notes,
        status,
        teacherFeedback,
        reviewedAt,
        reviewedBy,
        submittedAt,
        updatedAt,
        activity:activities (
          id,
          title,
          category,
          maxScore,
          class:classes (
            id,
            name,
            subject,
            ownerId
          )
        ),
        student:users!score_submissions_studentId_fkey (
          id,
          name,
          studentProfile:student_profiles (
            fullName,
            lrn
          )
        )
      `)
      .eq("id", id)
      .single();

    if (error || !submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Check access
    const classData = submission.activity?.class as { ownerId?: string } | null;
    const isOwner = classData?.ownerId === user.id;
    const isStudent = submission.studentId === user.id;

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
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validated = updateSubmissionSchema.parse(body);

    // Get submission with activity info
    const { data: submission, error: submissionError } = await supabase
      .from("score_submissions")
      .select(`
        id,
        rawScore,
        status,
        teacherFeedback,
        activity:activities (
          id,
          maxScore,
          class:classes (
            id,
            ownerId
          )
        )
      `)
      .eq("id", id)
      .single();

    if (submissionError || !submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Teacher approval/decline
    if (user.role === "TEACHER") {
      const classData = submission.activity?.class as { ownerId?: string } | null;
      if (!classData || classData.ownerId !== user.id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      const oldValue = JSON.stringify(submission);
      const updateData: Record<string, unknown> = {
        reviewedAt: new Date().toISOString(),
        reviewedBy: user.id,
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
        updateData.rawScore = Math.min(validated.rawScore, (submission.activity as { maxScore: number }).maxScore);
      }

      const { data: updated, error: updateError } = await supabase
        .from("score_submissions")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Create audit log
      await supabase.from("audit_logs").insert({
        userId: user.id,
        action: validated.rawScore !== undefined ? "OVERRIDE" : validated.status || "UPDATE",
        entityType: "ScoreSubmission",
        entityId: id,
        oldValue,
        newValue: JSON.stringify(updated),
        reason: validated.reason || validated.teacherFeedback,
        scoreSubmissionId: id,
      });

      return NextResponse.json(updated);
    }

    // Student update (only for NEEDS_REVISION)
    if (submission.studentId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (submission.status !== "NEEDS_REVISION" && submission.status !== "DECLINED") {
      return NextResponse.json(
        { error: "Cannot update this submission" },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("score_submissions")
      .update({
        rawScore: validated.rawScore ?? submission.rawScore,
        status: "PENDING",
        teacherFeedback: null,
        submittedAt: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create audit log
    await supabase.from("audit_logs").insert({
      userId: user.id,
      action: "UPDATE",
      entityType: "ScoreSubmission",
      entityId: id,
      oldValue: JSON.stringify(submission),
      newValue: JSON.stringify(updated),
      scoreSubmissionId: id,
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
