import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { nanoid } from "nanoid";

// Generate unique class code
function generateClassCode(): string {
  return nanoid(8).toUpperCase();
}

// GET /api/classes/[id] - Get class details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("includeArchived") === "true";

    const cls = await db.class.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        gradingScheme: {
          include: { transmutationRules: { orderBy: { minPercent: 'asc' } } },
        },
        activities: {
          orderBy: [{ category: "asc" }, { order: "asc" }],
        },
        attendanceSessions: {
          orderBy: { date: "desc" },
        },
        enrollments: {
          include: {
            profile: true,
            student: { select: { id: true, name: true, email: true } },
          },
        },
        linkedFrom: { select: { id: true, name: true, subject: true, quarter: true } },
        linkedTo: { select: { id: true, name: true, subject: true, quarter: true } },
      },
    });

    if (!cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Check access
    const isOwner = cls.ownerId === session.user.id;
    const isEnrolled = cls.enrollments.some(
      (e) => e.studentId === session.user.id
    );

    if (!isOwner && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // For students, always filter out archived activities
    // For teachers, filter based on includeArchived parameter
    let activities = cls.activities;
    if (session.user.role === "STUDENT") {
      activities = activities.filter(a => !a.archived);
    } else if (!includeArchived) {
      activities = activities.filter(a => !a.archived);
    }

    return NextResponse.json({
      ...cls,
      activities,
      _count: {
        activities: activities.length,
        archivedActivities: cls.activities.filter(a => a.archived).length,
        enrollments: cls.enrollments.length,
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const cls = await db.class.findUnique({ 
      where: { id },
      include: { 
        gradingScheme: {
          include: { transmutationRules: true }
        },
        enrollments: true,
      }
    });
    if (!cls || cls.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Handle generateNextQuarter action
    if (body.generateNextQuarter) {
      // Verify this is not Q4 (can't generate Q5)
      if (cls.quarter >= 4) {
        return NextResponse.json({ 
          error: "Cannot generate next quarter from Q4 class" 
        }, { status: 400 });
      }

      // Check if next quarter class already exists
      const existingNext = await db.class.findFirst({
        where: { linkedFromClassId: id },
      });
      if (existingNext) {
        return NextResponse.json({ 
          error: `Q${cls.quarter + 1} class already exists for this class`,
          existingClass: existingNext,
        }, { status: 400 });
      }

      const classCode = generateClassCode();
      const nextQuarter = cls.quarter + 1;
      const customName = body.name || `${cls.name} - Q${nextQuarter}`;

      // Create next quarter class with copied enrollments
      const nextQuarterClass = await db.class.create({
        data: {
          name: customName,
          subject: cls.subject,
          section: cls.section,
          schoolYear: cls.schoolYear,
          quarter: nextQuarter,
          code: classCode,
          ownerId: session.user.id,
          linkedFromClassId: id,
          gradingScheme: {
            create: {
              writtenWorksPercent: cls.gradingScheme?.writtenWorksPercent || 30,
              performanceTasksPercent: cls.gradingScheme?.performanceTasksPercent || 50,
              quarterlyAssessmentPercent: cls.gradingScheme?.quarterlyAssessmentPercent || 20,
              transmutationRules: {
                create: cls.gradingScheme?.transmutationRules.map(rule => ({
                  minPercent: rule.minPercent,
                  maxPercent: rule.maxPercent,
                  transmutedGrade: rule.transmutedGrade,
                })) || [],
              },
            },
          },
          // Copy all enrollments
          enrollments: {
            create: cls.enrollments.map(enrollment => ({
              studentId: enrollment.studentId,
              profileId: enrollment.profileId,
              isActive: true,
            })),
          },
        },
        include: {
          enrollments: true,
        },
      });

      // Create audit log
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "GENERATE_NEXT_QUARTER_CLASS",
          entityType: "Class",
          entityId: nextQuarterClass.id,
          newValue: JSON.stringify({
            sourceClassId: id,
            sourceQuarter: cls.quarter,
            newQuarter: nextQuarter,
            newClassId: nextQuarterClass.id,
            enrollmentsCopied: cls.enrollments.length,
          }),
        },
      });

      return NextResponse.json({ 
        success: true, 
        message: `Q${nextQuarter} class created successfully`,
        class: nextQuarterClass,
      });
    }

    // Handle grading scheme update
    if (body.gradingScheme) {
      // Check if grading period is completed - don't allow scheme changes
      if (cls.gradingPeriodStatus === "COMPLETED") {
        return NextResponse.json({ 
          error: "Cannot modify grading scheme after grading period is completed" 
        }, { status: 400 });
      }
      
      const { writtenWorksPercent, performanceTasksPercent, quarterlyAssessmentPercent } = body.gradingScheme;
      
      // Validate percentages
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

      // Get old values for audit
      const oldScheme = cls.gradingScheme;

      // Update or create grading scheme
      if (cls.gradingScheme) {
        await db.gradingScheme.update({
          where: { classId: id },
          data: {
            writtenWorksPercent: ww,
            performanceTasksPercent: pt,
            quarterlyAssessmentPercent: qa,
          },
        });
      } else {
        await db.gradingScheme.create({
          data: {
            classId: id,
            writtenWorksPercent: ww,
            performanceTasksPercent: pt,
            quarterlyAssessmentPercent: qa,
          },
        });
      }

      // Create audit log for grading scheme change
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "UPDATE_GRADING_SCHEME",
          entityType: "GradingScheme",
          entityId: id,
          oldValue: JSON.stringify({
            writtenWorksPercent: oldScheme?.writtenWorksPercent || 30,
            performanceTasksPercent: oldScheme?.performanceTasksPercent || 50,
            quarterlyAssessmentPercent: oldScheme?.quarterlyAssessmentPercent || 20,
          }),
          newValue: JSON.stringify({
            writtenWorksPercent: ww,
            performanceTasksPercent: pt,
            quarterlyAssessmentPercent: qa,
          }),
        },
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
        // Complete the grading period
        const updated = await db.class.update({
          where: { id },
          data: {
            gradingPeriodStatus: "COMPLETED",
            gradingPeriodCompletedAt: new Date(),
            gradingPeriodCompletedBy: session.user.id,
          },
        });

        // Create audit log
        await db.auditLog.create({
          data: {
            userId: session.user.id,
            action: "COMPLETE_GRADING_PERIOD",
            entityType: "Class",
            entityId: id,
            oldValue: JSON.stringify({ gradingPeriodStatus: cls.gradingPeriodStatus }),
            newValue: JSON.stringify({ gradingPeriodStatus: "COMPLETED" }),
          },
        });

        return NextResponse.json({ 
          success: true, 
          message: "Grading period marked as completed",
          class: updated,
        });
      } else if (action === "reopen") {
        // Reopen the grading period
        const updated = await db.class.update({
          where: { id },
          data: {
            gradingPeriodStatus: "OPEN",
            gradingPeriodCompletedAt: null,
            gradingPeriodCompletedBy: null,
          },
        });

        // Create audit log
        await db.auditLog.create({
          data: {
            userId: session.user.id,
            action: "REOPEN_GRADING_PERIOD",
            entityType: "Class",
            entityId: id,
            oldValue: JSON.stringify({ gradingPeriodStatus: cls.gradingPeriodStatus }),
            newValue: JSON.stringify({ gradingPeriodStatus: "OPEN" }),
            reason: body.reason || "Teacher reopened grading period",
          },
        });

        return NextResponse.json({ 
          success: true, 
          message: "Grading period reopened",
          class: updated,
        });
      }
    }

    // Regular class update
    const updated = await db.class.update({
      where: { id },
      data: {
        name: body.name,
        subject: body.subject,
        section: body.section,
        schoolYear: body.schoolYear,
        quarter: body.quarter,
        isActive: body.isActive,
      },
    });

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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const cls = await db.class.findUnique({ where: { id } });
    if (!cls || cls.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await db.class.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete class error:", error);
    return NextResponse.json(
      { error: "Failed to delete class" },
      { status: 500 }
    );
  }
}
