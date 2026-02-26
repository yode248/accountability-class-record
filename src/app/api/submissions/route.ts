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

const createSubmissionSchema = z.object({
  activityId: z.string(),
  rawScore: z.number().min(0),
  evidenceUrl: z.string().nullish(),
  evidenceType: z.string().nullish(),
  notes: z.string().nullish(),
});

// GET /api/submissions - Get submissions
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");
    const activityId = searchParams.get("activityId");
    const studentId = searchParams.get("studentId");
    const status = searchParams.get("status");

    if (user.role === "TEACHER") {
      // Teacher sees all submissions for their classes
      if (!classId && !studentId) {
        return NextResponse.json({ error: "Class ID or Student ID required" }, { status: 400 });
      }

      // Verify access
      if (classId) {
        const { data: cls } = await supabase
          .from("classes")
          .select("id, ownerId")
          .eq("id", classId)
          .single();

        if (!cls || cls.ownerId !== user.id) {
          return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }
      }

      // If studentId provided, verify the student is in teacher's class
      if (studentId && !classId) {
        const { data: enrollment } = await supabase
          .from("enrollments")
          .select("id")
          .eq("studentId", studentId)
          .eq("isActive", true)
          .in("classId", (
            await supabase
              .from("classes")
              .select("id")
              .eq("ownerId", user.id)
          ).data?.map(c => c.id) || [])
          .single();

        if (!enrollment) {
          return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }
      }

      // Build query
      let query = supabase
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
          submittedAt,
          updatedAt,
          activity:activities (
            id,
            title,
            category,
            maxScore,
            class:classes (id, name)
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
        .order("submittedAt", { ascending: false });

      if (classId) {
        query = query.in("activityId", (
          await supabase
            .from("activities")
            .select("id")
            .eq("classId", classId)
        ).data?.map(a => a.id) || []);
      }
      if (studentId) query = query.eq("studentId", studentId);
      if (activityId) query = query.eq("activityId", activityId);
      if (status) query = query.eq("status", status);

      const { data: submissions, error } = await query;

      if (error) throw error;

      return NextResponse.json(submissions);
    } else {
      // Student sees their own submissions
      let query = supabase
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
          activity:activities (
            id,
            title,
            category,
            maxScore,
            class:classes (id, name, subject)
          )
        `)
        .eq("studentId", user.id)
        .order("submittedAt", { ascending: false });

      if (activityId) query = query.eq("activityId", activityId);
      if (status) query = query.eq("status", status);

      const { data: submissions, error } = await query;

      if (error) throw error;

      return NextResponse.json(submissions);
    }
  } catch (error) {
    console.error("Get submissions error:", error);
    return NextResponse.json(
      { error: "Failed to get submissions" },
      { status: 500 }
    );
  }
}

// POST /api/submissions - Submit score (Student only)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "STUDENT") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createSubmissionSchema.parse(body);

    // Get activity and verify enrollment
    const { data: activity, error: activityError } = await supabase
      .from("activities")
      .select(`
        id,
        maxScore,
        classId,
        class:classes (
          id,
          enrollments:enrollments!enrollments_classId_fkey (studentId)
        )
      `)
      .eq("id", validated.activityId)
      .single();

    if (activityError || !activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    // Check enrollment
    const classData = activity.class as { enrollments?: { studentId: string }[] } | null;
    const isEnrolled = classData?.enrollments?.some(e => e.studentId === user.id);
    
    if (!isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Validate score range
    if (validated.rawScore > activity.maxScore) {
      return NextResponse.json(
        { error: `Score cannot exceed maximum score of ${activity.maxScore}` },
        { status: 400 }
      );
    }

    // Check for existing submission
    const { data: existing } = await supabase
      .from("score_submissions")
      .select("id, status")
      .eq("activityId", validated.activityId)
      .eq("studentId", user.id)
      .single();

    if (existing) {
      // Update existing submission if it needs revision
      if (existing.status === "NEEDS_REVISION" || existing.status === "DECLINED") {
        const { data: updated, error: updateError } = await supabase
          .from("score_submissions")
          .update({
            rawScore: validated.rawScore,
            evidenceUrl: validated.evidenceUrl,
            evidenceType: validated.evidenceType,
            notes: validated.notes,
            status: "PENDING",
            teacherFeedback: null,
            submittedAt: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();

        if (updateError) throw updateError;

        return NextResponse.json(updated);
      }

      return NextResponse.json(
        { error: "Submission already exists" },
        { status: 400 }
      );
    }

    // Create new submission
    const { data: submission, error } = await supabase
      .from("score_submissions")
      .insert({
        activityId: validated.activityId,
        studentId: user.id,
        rawScore: validated.rawScore,
        evidenceUrl: validated.evidenceUrl,
        evidenceType: validated.evidenceType,
        notes: validated.notes,
        status: "PENDING",
      })
      .select()
      .single();

    if (error) throw error;

    // Create audit log
    await supabase.from("audit_logs").insert({
      userId: user.id,
      action: "CREATE",
      entityType: "ScoreSubmission",
      entityId: submission.id,
      newValue: JSON.stringify(submission),
      scoreSubmissionId: submission.id,
    });

    return NextResponse.json(submission);
  } catch (error) {
    console.error("Create submission error:", error);
    return NextResponse.json(
      { error: "Failed to create submission" },
      { status: 500 }
    );
  }
}
