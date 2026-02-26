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

const createActivitySchema = z.object({
  classId: z.string(),
  category: z.enum(["WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"]),
  title: z.string().min(1),
  description: z.string().nullish(),
  maxScore: z.number().positive(),
  dueDate: z.string().nullish(),
  instructions: z.string().nullish(),
  requiresEvidence: z.boolean().optional(),
  evidenceTypes: z.array(z.string()).optional(),
});

// GET /api/activities - Get activities for a class
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");

    if (!classId) {
      return NextResponse.json({ error: "Class ID required" }, { status: 400 });
    }

    // Verify access
    const { data: cls, error: classError } = await supabase
      .from("classes")
      .select("id, ownerId")
      .eq("id", classId)
      .single();

    if (classError || !cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const isOwner = cls.ownerId === user.id;
    
    // Check enrollment for students
    let isEnrolled = false;
    if (user.role === "STUDENT") {
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("classId", classId)
        .eq("studentId", user.id)
        .single();
      isEnrolled = !!enrollment;
    }

    if (!isOwner && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get activities
    let query = supabase
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
        archiveReason,
        createdAt,
        class:classes (name),
        submissions (count)
      `)
      .eq("classId", classId);

    // Students can't see archived activities
    if (user.role === "STUDENT") {
      query = query.eq("archived", false);
    }

    const { data: activities, error } = await query;

    if (error) throw error;

    // Sort by category then order
    const sorted = (activities || []).sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return (a.order || 0) - (b.order || 0);
    });

    return NextResponse.json(sorted);
  } catch (error) {
    console.error("Get activities error:", error);
    return NextResponse.json(
      { error: "Failed to get activities" },
      { status: 500 }
    );
  }
}

// POST /api/activities - Create activity (Teacher only)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createActivitySchema.parse(body);

    // Verify ownership
    const { data: cls, error: classError } = await supabase
      .from("classes")
      .select("id, ownerId, gradingPeriodStatus")
      .eq("id", validated.classId)
      .single();

    if (classError || !cls || cls.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if grading period is completed
    if (cls.gradingPeriodStatus === "COMPLETED") {
      return NextResponse.json({ 
        error: "Cannot add new activities after the grading period has been completed" 
      }, { status: 400 });
    }

    // Get max order for this category
    const { data: maxOrderActivity } = await supabase
      .from("activities")
      .select("order")
      .eq("classId", validated.classId)
      .eq("category", validated.category)
      .order("order", { ascending: false })
      .limit(1)
      .single();

    const order = (maxOrderActivity?.order || 0) + 1;

    // Create activity
    const { data: activity, error } = await supabase
      .from("activities")
      .insert({
        classId: validated.classId,
        category: validated.category,
        title: validated.title,
        description: validated.description,
        maxScore: validated.maxScore,
        dueDate: validated.dueDate ? new Date(validated.dueDate).toISOString() : null,
        instructions: validated.instructions,
        requiresEvidence: validated.requiresEvidence ?? false,
        evidenceTypes: validated.evidenceTypes ? JSON.stringify(validated.evidenceTypes) : null,
        order,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(activity);
  } catch (error) {
    console.error("Create activity error:", error);
    return NextResponse.json(
      { error: "Failed to create activity" },
      { status: 500 }
    );
  }
}
