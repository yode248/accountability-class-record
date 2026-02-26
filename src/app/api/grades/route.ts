import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeGrades } from "@/lib/grading";

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

// GET /api/grades - Get computed grades for a student in a class
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");
    const requestedStudentId = searchParams.get("studentId");

    if (!classId) {
      return NextResponse.json({ error: "Class ID required" }, { status: 400 });
    }

    // Get class with grading scheme and activities
    const { data: cls, error: classError } = await supabase
      .from("classes")
      .select(`
        id,
        name,
        section,
        quarter,
        subject,
        gradingPeriodStatus,
        gradingPeriodCompletedAt,
        ownerId,
        gradingScheme:grading_schemes (
          writtenWorksPercent,
          performanceTasksPercent,
          quarterlyAssessmentPercent
        ),
        activities (
          id,
          category,
          maxScore,
          archived,
          isActive
        )
      `)
      .eq("id", classId)
      .single();

    if (classError || !cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Check access
    const isTeacher = user.role === "TEACHER" && cls.ownerId === user.id;
    let studentId = user.id;

    // Teacher can specify a studentId
    if (requestedStudentId && isTeacher) {
      studentId = requestedStudentId;
    }

    // Verify enrollment if student
    if (user.role === "STUDENT") {
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("classId", classId)
        .eq("studentId", user.id)
        .eq("isActive", true)
        .single();

      if (!enrollment) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    // Get submissions for this student in this class
    const { data: submissions, error: submissionsError } = await supabase
      .from("score_submissions")
      .select(`
        id,
        activityId,
        rawScore,
        status,
        teacherFeedback,
        updatedAt,
        activity:activities (
          id,
          category,
          maxScore,
          archived
        )
      `)
      .eq("studentId", studentId)
      .in("activityId", (cls.activities || []).map(a => a.id));

    if (submissionsError) {
      console.error("Error fetching submissions:", submissionsError);
    }

    // Prepare activities data
    const activities = (cls.activities || [])
      .filter(a => a.isActive)
      .map(a => ({
        id: a.id,
        category: a.category,
        maxScore: a.maxScore,
        archived: a.archived,
      }));

    // Prepare submissions data
    const submissionData = (submissions || []).map(s => ({
      activityId: s.activityId,
      rawScore: s.rawScore,
      status: s.status,
      activity: s.activity ? {
        id: (s.activity as { id: string }).id,
        category: (s.activity as { category: string }).category,
        maxScore: (s.activity as { maxScore: number }).maxScore,
      } : undefined,
    }));

    // Compute grades using shared function
    const gradingScheme = cls.gradingScheme ? {
      writtenWorksPercent: (cls.gradingScheme as { writtenWorksPercent: number }).writtenWorksPercent,
      performanceTasksPercent: (cls.gradingScheme as { performanceTasksPercent: number }).performanceTasksPercent,
      quarterlyAssessmentPercent: (cls.gradingScheme as { quarterlyAssessmentPercent: number }).quarterlyAssessmentPercent,
    } : null;

    const computedGrades = computeGrades(submissionData, activities, gradingScheme);

    // Get student profile for additional info
    let studentProfile: { fullName: string; lrn: string } | null = null;
    if (user.role === "STUDENT") {
      const { data: profile } = await supabase
        .from("student_profiles")
        .select("fullName, lrn")
        .eq("userId", user.id)
        .single();
      studentProfile = profile;
    }

    return NextResponse.json({
      classInfo: {
        id: cls.id,
        name: cls.name,
        section: cls.section,
        quarter: cls.quarter,
        subject: cls.subject,
        gradingPeriodStatus: cls.gradingPeriodStatus,
        gradingPeriodCompletedAt: cls.gradingPeriodCompletedAt,
      },
      studentProfile,
      gradingScheme,
      activities: activities,
      submissions: (submissions || []).map(s => ({
        id: s.id,
        activityId: s.activityId,
        rawScore: s.rawScore,
        status: s.status,
        teacherFeedback: s.teacherFeedback,
        updatedAt: s.updatedAt,
        activity: s.activity,
      })),
      grades: computedGrades,
    });
  } catch (error) {
    console.error("Grades API error:", error);
    return NextResponse.json({ error: "Failed to compute grades" }, { status: 500 });
  }
}
