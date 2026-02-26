import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";

// Generate unique class code
function generateClassCode(): string {
  return nanoid(8).toUpperCase();
}

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

// GET /api/classes/[id] - Get class details
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
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("includeArchived") === "true";

    // Get class with all related data
    const { data: cls, error } = await supabase
      .from("classes")
      .select(`
        id,
        name,
        subject,
        section,
        schoolYear,
        quarter,
        code,
        ownerId,
        isActive,
        qrToken,
        linkedFromClassId,
        gradingPeriodStatus,
        gradingPeriodCompletedAt,
        gradingPeriodCompletedBy,
        createdAt,
        updatedAt,
        owner:users!classes_ownerId_fkey (
          id,
          name,
          email
        ),
        gradingScheme:grading_schemes (
          id,
          writtenWorksPercent,
          performanceTasksPercent,
          quarterlyAssessmentPercent,
          transmutationRules:transmutation_rules (
            id,
            minPercent,
            maxPercent,
            transmutedGrade
          )
        ),
        activities (
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
          createdAt
        ),
        attendanceSessions:attendance_sessions (
          id,
          date,
          title,
          lateThresholdMinutes,
          qrToken,
          qrExpiresAt,
          isActive,
          createdAt
        ),
        enrollments (
          id,
          studentId,
          enrolledAt,
          isActive,
          profile:student_profiles (
            id,
            fullName,
            lrn,
            sex,
            section
          ),
          student:users!enrollments_studentId_fkey (
            id,
            name,
            email
          )
        ),
        linkedFrom:linkedFromClassId (
          id,
          name,
          subject,
          quarter
        ),
        linkedTo (
          id,
          name,
          subject,
          quarter
        )
      `)
      .eq("id", id)
      .single();

    if (error || !cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Check access
    const isOwner = cls.ownerId === user.id;
    const isEnrolled = cls.enrollments?.some((e) => e.studentId === user.id);

    if (!isOwner && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Filter activities
    let activities = cls.activities || [];
    if (user.role === "STUDENT") {
      activities = activities.filter(a => !a.archived);
    } else if (!includeArchived) {
      activities = activities.filter(a => !a.archived);
    }

    // Sort activities
    activities.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return (a.order || 0) - (b.order || 0);
    });

    // Sort attendance sessions
    const attendanceSessions = (cls.attendanceSessions || []).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return NextResponse.json({
      ...cls,
      activities,
      attendanceSessions,
      _count: {
        activities: activities.length,
        archivedActivities: (cls.activities || []).filter(a => a.archived).length,
        enrollments: (cls.enrollments || []).length,
      },
    });
  } catch (error) {
    console.error("Get class error:", error);
    return NextResponse.json(
      { error: "Failed to get class" },
      { status: 500 }
    );
  }
}

// PUT /api/classes/[id] - Update class (including grading scheme)
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

    // Check class ownership
    const { data: cls, error: classError } = await supabase
      .from("classes")
      .select("id, ownerId, quarter, gradingPeriodStatus")
      .eq("id", id)
      .single();

    if (classError || !cls || cls.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Handle generateNextQuarter action
    if (body.generateNextQuarter) {
      if (cls.quarter >= 4) {
        return NextResponse.json({ 
          error: "Cannot generate next quarter from Q4 class" 
        }, { status: 400 });
      }

      // Check if next quarter class already exists
      const { data: existingNext } = await supabase
        .from("classes")
        .select("id, name, quarter")
        .eq("linkedFromClassId", id)
        .single();

      if (existingNext) {
        return NextResponse.json({ 
          error: `Q${cls.quarter + 1} class already exists for this class`,
          existingClass: existingNext,
        }, { status: 400 });
      }

      const classCode = generateClassCode();
      const nextQuarter = cls.quarter + 1;
      const customName = body.name || `${cls.name} - Q${nextQuarter}`;

      // Get current grading scheme and enrollments
      const { data: gradingScheme } = await supabase
        .from("grading_schemes")
        .select("*, transmutationRules:transmutation_rules (*)")
        .eq("classId", id)
        .single();

      const { data: enrollments } = await supabase
        .from("enrollments")
        .select("studentId, profileId")
        .eq("classId", id);

      // Create next quarter class
      const { data: nextQuarterClass, error: createError } = await supabase
        .from("classes")
        .insert({
          name: customName,
          subject: cls.subject,
          section: cls.section,
          schoolYear: cls.schoolYear,
          quarter: nextQuarter,
          code: classCode,
          ownerId: user.id,
          linkedFromClassId: id,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Create grading scheme
      if (gradingScheme) {
        const { data: newScheme } = await supabase
          .from("grading_schemes")
          .insert({
            classId: nextQuarterClass.id,
            writtenWorksPercent: gradingScheme.writtenWorksPercent,
            performanceTasksPercent: gradingScheme.performanceTasksPercent,
            quarterlyAssessmentPercent: gradingScheme.quarterlyAssessmentPercent,
          })
          .select()
          .single();

        // Copy transmutation rules
        if (newScheme && gradingScheme.transmutationRules) {
          const rulesToInsert = gradingScheme.transmutationRules.map((rule: { minPercent: number; maxPercent: number; transmutedGrade: number }) => ({
            gradingSchemeId: newScheme.id,
            minPercent: rule.minPercent,
            maxPercent: rule.maxPercent,
            transmutedGrade: rule.transmutedGrade,
          }));
          await supabase.from("transmutation_rules").insert(rulesToInsert);
        }
      }

      // Copy enrollments
      if (enrollments && enrollments.length > 0) {
        const enrollmentsToInsert = enrollments.map(e => ({
          classId: nextQuarterClass.id,
          studentId: e.studentId,
          profileId: e.profileId,
          isActive: true,
        }));
        await supabase.from("enrollments").insert(enrollmentsToInsert);
      }

      // Create audit log
      await supabase.from("audit_logs").insert({
        userId: user.id,
        action: "GENERATE_NEXT_QUARTER_CLASS",
        entityType: "Class",
        entityId: nextQuarterClass.id,
        newValue: JSON.stringify({
          sourceClassId: id,
          sourceQuarter: cls.quarter,
          newQuarter: nextQuarter,
          newClassId: nextQuarterClass.id,
          enrollmentsCopied: enrollments?.length || 0,
        }),
      });

      return NextResponse.json({ 
        success: true, 
        message: `Q${nextQuarter} class created successfully`,
        class: nextQuarterClass,
      });
    }

    // Handle grading scheme update
    if (body.gradingScheme) {
      if (cls.gradingPeriodStatus === "COMPLETED") {
        return NextResponse.json({ 
          error: "Cannot modify grading scheme after grading period is completed" 
        }, { status: 400 });
      }
      
      const { writtenWorksPercent, performanceTasksPercent, quarterlyAssessmentPercent } = body.gradingScheme;
      
      const ww = Number(writtenWorksPercent) || 0;
      const pt = Number(performanceTasksPercent) || 0;
      const qa = Number(quarterlyAssessmentPercent) || 0;
      
      if (ww < 0 || ww > 100 || pt < 0 || pt > 100 || qa < 0 || qa > 100) {
        return NextResponse.json({ 
          error: "Each percentage must be between 0 and 100" 
        }, { status: 400 });
      }
      
      if (Math.round((ww + pt + qa) * 100) / 100 !== 100) {
        return NextResponse.json({ 
          error: "Total percentage must equal 100%" 
        }, { status: 400 });
      }

      // Get existing scheme
      const { data: existingScheme } = await supabase
        .from("grading_schemes")
        .select("*")
        .eq("classId", id)
        .single();

      if (existingScheme) {
        await supabase
          .from("grading_schemes")
          .update({
            writtenWorksPercent: ww,
            performanceTasksPercent: pt,
            quarterlyAssessmentPercent: qa,
          })
          .eq("classId", id);
      } else {
        await supabase
          .from("grading_schemes")
          .insert({
            classId: id,
            writtenWorksPercent: ww,
            performanceTasksPercent: pt,
            quarterlyAssessmentPercent: qa,
          });
      }

      // Create audit log
      await supabase.from("audit_logs").insert({
        userId: user.id,
        action: "UPDATE_GRADING_SCHEME",
        entityType: "GradingScheme",
        entityId: id,
        oldValue: JSON.stringify({
          writtenWorksPercent: existingScheme?.writtenWorksPercent || 30,
          performanceTasksPercent: existingScheme?.performanceTasksPercent || 50,
          quarterlyAssessmentPercent: existingScheme?.quarterlyAssessmentPercent || 20,
        }),
        newValue: JSON.stringify({
          writtenWorksPercent: ww,
          performanceTasksPercent: pt,
          quarterlyAssessmentPercent: qa,
        }),
      });

      return NextResponse.json({ 
        success: true, 
        message: "Grading scheme updated successfully" 
      });
    }

    // Handle grading period status update
    if (body.gradingPeriodAction) {
      const action = body.gradingPeriodAction;
      
      if (action === "complete") {
        const { error: updateError } = await supabase
          .from("classes")
          .update({
            gradingPeriodStatus: "COMPLETED",
            gradingPeriodCompletedAt: new Date().toISOString(),
            gradingPeriodCompletedBy: user.id,
          })
          .eq("id", id);

        if (updateError) throw updateError;

        await supabase.from("audit_logs").insert({
          userId: user.id,
          action: "COMPLETE_GRADING_PERIOD",
          entityType: "Class",
          entityId: id,
          oldValue: JSON.stringify({ gradingPeriodStatus: cls.gradingPeriodStatus }),
          newValue: JSON.stringify({ gradingPeriodStatus: "COMPLETED" }),
        });

        return NextResponse.json({ 
          success: true, 
          message: "Grading period marked as completed",
        });
      } else if (action === "reopen") {
        const { error: updateError } = await supabase
          .from("classes")
          .update({
            gradingPeriodStatus: "OPEN",
            gradingPeriodCompletedAt: null,
            gradingPeriodCompletedBy: null,
          })
          .eq("id", id);

        if (updateError) throw updateError;

        await supabase.from("audit_logs").insert({
          userId: user.id,
          action: "REOPEN_GRADING_PERIOD",
          entityType: "Class",
          entityId: id,
          oldValue: JSON.stringify({ gradingPeriodStatus: cls.gradingPeriodStatus }),
          newValue: JSON.stringify({ gradingPeriodStatus: "OPEN" }),
          reason: body.reason || "Teacher reopened grading period",
        });

        return NextResponse.json({ 
          success: true, 
          message: "Grading period reopened",
        });
      }
    }

    // Regular class update
    const { error: updateError } = await supabase
      .from("classes")
      .update({
        name: body.name,
        subject: body.subject,
        section: body.section,
        schoolYear: body.schoolYear,
        quarter: body.quarter,
        isActive: body.isActive,
      })
      .eq("id", id);

    if (updateError) throw updateError;

    const { data: updated } = await supabase
      .from("classes")
      .select()
      .eq("id", id)
      .single();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update class error:", error);
    return NextResponse.json(
      { error: "Failed to update class" },
      { status: 500 }
    );
  }
}

// DELETE /api/classes/[id] - Delete class
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

    const { data: cls } = await supabase
      .from("classes")
      .select("id, ownerId")
      .eq("id", id)
      .single();

    if (!cls || cls.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from("classes")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete class error:", error);
    return NextResponse.json(
      { error: "Failed to delete class" },
      { status: 500 }
    );
  }
}
