import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";
import { z } from "zod";

// Generate unique class code
function generateClassCode(): string {
  return nanoid(8).toUpperCase();
}

const createClassSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  section: z.string().min(1),
  schoolYear: z.string().min(1),
  quarter: z.number().min(1).max(4).optional(),
});

// Helper to get current user
async function getCurrentUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  
  const { data: userData } = await supabase
    .from("User")
    .select("id, role")
    .eq("id", user.id)
    .single();
  
  return userData;
}

// GET /api/classes - Get user's classes
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let classes;
    
    if (user.role === "TEACHER") {
      // Teacher sees their owned classes
      const { data, error } = await supabase
        .from("Class")
        .select(`
          id,
          name,
          subject,
          section,
          schoolYear,
          quarter,
          code,
          gradingPeriodStatus,
          gradingPeriodCompletedAt,
          createdAt,
          ownerId
        `)
        .eq("ownerId", user.id)
        .order("schoolYear", { ascending: false })
        .order("quarter", { ascending: true });
      
      if (error) throw error;
      classes = data || [];

      // Get counts separately
      for (const cls of classes) {
        const [{ count: enrollmentCount }, { count: activityCount }] = await Promise.all([
          supabase.from("Enrollment").select("*", { count: "exact", head: true }).eq("classId", cls.id),
          supabase.from("Activity").select("*", { count: "exact", head: true }).eq("classId", cls.id).eq("archived", false)
        ]);
        (cls as Record<string, unknown>)._count = { enrollments: enrollmentCount || 0, activities: activityCount || 0 };
      }
    } else {
      // Student sees their enrolled classes
      const { data: enrollments, error } = await supabase
        .from("Enrollment")
        .select(`
          classId,
          isActive,
          Class (
            id,
            name,
            subject,
            section,
            schoolYear,
            quarter,
            code,
            gradingPeriodStatus,
            createdAt,
            ownerId
          )
        `)
        .eq("studentId", user.id)
        .eq("isActive", true);
      
      if (error) throw error;
      classes = enrollments?.map((e) => e.Class).filter(Boolean) || [];
    }

    return NextResponse.json(classes);
  } catch (error) {
    console.error("Get classes error:", error);
    return NextResponse.json(
      { error: "Failed to get classes" },
      { status: 500 }
    );
  }
}

// POST /api/classes - Create new class (Teacher only)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createClassSchema.parse(body);

    const classCode = generateClassCode();
    const quarter = validated.quarter || 1;

    // Create class
    const { data: newClass, error: classError } = await supabase
      .from("Class")
      .insert({
        name: validated.name,
        subject: validated.subject,
        section: validated.section,
        schoolYear: validated.schoolYear,
        quarter,
        code: classCode,
        ownerId: user.id,
        isActive: true,
        gradingPeriodStatus: "OPEN",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (classError) throw classError;

    // Create default grading scheme
    const { data: scheme, error: schemeError } = await supabase
      .from("GradingScheme")
      .insert({
        classId: newClass.id,
        writtenWorksPercent: 30,
        performanceTasksPercent: 50,
        quarterlyAssessmentPercent: 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (schemeError) {
      console.error("Error creating grading scheme:", schemeError);
    }

    // Create default transmutation rules if scheme was created
    if (scheme) {
      const transmutationRules = [
        { minPercent: 0, maxPercent: 4.99, transmutedGrade: 70 },
        { minPercent: 5, maxPercent: 9.99, transmutedGrade: 71 },
        { minPercent: 10, maxPercent: 14.99, transmutedGrade: 72 },
        { minPercent: 15, maxPercent: 19.99, transmutedGrade: 73 },
        { minPercent: 20, maxPercent: 24.99, transmutedGrade: 74 },
        { minPercent: 25, maxPercent: 29.99, transmutedGrade: 75 },
        { minPercent: 30, maxPercent: 34.99, transmutedGrade: 76 },
        { minPercent: 35, maxPercent: 39.99, transmutedGrade: 77 },
        { minPercent: 40, maxPercent: 44.99, transmutedGrade: 78 },
        { minPercent: 45, maxPercent: 49.99, transmutedGrade: 79 },
        { minPercent: 50, maxPercent: 54.99, transmutedGrade: 80 },
        { minPercent: 55, maxPercent: 59.99, transmutedGrade: 81 },
        { minPercent: 60, maxPercent: 64.99, transmutedGrade: 82 },
        { minPercent: 65, maxPercent: 69.99, transmutedGrade: 83 },
        { minPercent: 70, maxPercent: 74.99, transmutedGrade: 84 },
        { minPercent: 75, maxPercent: 79.99, transmutedGrade: 85 },
        { minPercent: 80, maxPercent: 84.99, transmutedGrade: 86 },
        { minPercent: 85, maxPercent: 89.99, transmutedGrade: 87 },
        { minPercent: 90, maxPercent: 94.99, transmutedGrade: 88 },
        { minPercent: 95, maxPercent: 100, transmutedGrade: 90 },
      ];

      const rulesToInsert = transmutationRules.map(rule => ({
        gradingSchemeId: scheme.id,
        minPercent: rule.minPercent,
        maxPercent: rule.maxPercent,
        transmutedGrade: rule.transmutedGrade,
        createdAt: new Date().toISOString(),
      }));

      await supabase.from("TransmutationRule").insert(rulesToInsert);
    }

    return NextResponse.json(newClass);
  } catch (error) {
    console.error("Create class error:", error);
    return NextResponse.json(
      { error: "Failed to create class" },
      { status: 500 }
    );
  }
}
