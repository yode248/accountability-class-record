import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

const submitAttendanceSchema = z.object({
  status: z.enum(["PRESENT", "LATE", "ABSENT"]),
  proofUrl: z.string().nullish(),
  notes: z.string().nullish(),
  qrToken: z.string().nullish(),
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

// GET /api/attendance/[sessionId] - Get attendance session details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;

    const { data: attendanceSession, error } = await supabase
      .from("AttendanceSession")
      .select(`
        *,
        Class (
          id,
          name,
          ownerId,
          Enrollment (
            id,
            studentId,
            profile:StudentProfile (*)
          )
        )
      `)
      .eq("id", sessionId)
      .single();

    if (error || !attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Check access
    const isOwner = attendanceSession.Class?.ownerId === user.id;
    const isEnrolled = attendanceSession.Class?.Enrollment?.some(
      (e: { studentId: string }) => e.studentId === user.id
    );

    if (!isOwner && !isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get submissions based on role
    let submissionsQuery = supabase
      .from("AttendanceSubmission")
      .select(`
        *,
        student:User (id, name),
        profile:StudentProfile (*)
      `)
      .eq("sessionId", sessionId);

    if (user.role === "STUDENT") {
      submissionsQuery = submissionsQuery.eq("studentId", user.id);
    }

    const { data: submissions } = await submissionsQuery;

    return NextResponse.json({
      ...attendanceSession,
      submissions: submissions || [],
    });
  } catch (error) {
    console.error("Get attendance session error:", error);
    return NextResponse.json(
      { error: "Failed to get attendance session" },
      { status: 500 }
    );
  }
}

// POST /api/attendance/[sessionId] - Submit attendance (Student)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "STUDENT") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    const body = await request.json();
    const validated = submitAttendanceSchema.parse(body);

    // Get session and verify enrollment
    const { data: attendanceSession, error: sessionError } = await supabase
      .from("AttendanceSession")
      .select(`
        *,
        Class (
          id,
          Enrollment!Enrollment_classId_fkey (studentId)
        )
      `)
      .eq("id", sessionId)
      .single();

    if (sessionError || !attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const isEnrolled = attendanceSession.Class?.Enrollment?.some(
      (e: { studentId: string }) => e.studentId === user.id
    );

    if (!isEnrolled) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check QR if enabled
    if (attendanceSession.qrToken) {
      if (!validated.qrToken || validated.qrToken !== attendanceSession.qrToken) {
        return NextResponse.json(
          { error: "Invalid QR code" },
          { status: 400 }
        );
      }
      if (attendanceSession.qrExpiresAt && new Date() > new Date(attendanceSession.qrExpiresAt)) {
        return NextResponse.json(
          { error: "QR code has expired" },
          { status: 400 }
        );
      }
    }

    // Check for existing submission
    const { data: existing } = await supabase
      .from("AttendanceSubmission")
      .select("*")
      .eq("sessionId", sessionId)
      .eq("studentId", user.id)
      .single();

    if (existing && existing.submissionStatus !== "NEEDS_REVISION" && existing.submissionStatus !== "DECLINED") {
      return NextResponse.json(
        { error: "Attendance already submitted" },
        { status: 400 }
      );
    }

    // Determine if late based on threshold
    let finalStatus = validated.status;
    if (validated.status === "PRESENT" && attendanceSession.lateThresholdMinutes) {
      const sessionTime = new Date(attendanceSession.date);
      const now = new Date();
      const diffMinutes = (now.getTime() - sessionTime.getTime()) / (1000 * 60);
      if (diffMinutes > attendanceSession.lateThresholdMinutes) {
        finalStatus = "LATE";
      }
    }

    // Upsert submission
    const { data: submission, error: submitError } = await supabase
      .from("AttendanceSubmission")
      .upsert({
        sessionId,
        studentId: user.id,
        status: finalStatus,
        proofUrl: validated.proofUrl,
        notes: validated.notes,
        checkedInAt: new Date().toISOString(),
        submissionStatus: "PENDING",
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, {
        onConflict: "sessionId_studentId"
      })
      .select()
      .single();

    if (submitError) {
      console.error("Submit error:", submitError);
      return NextResponse.json(
        { error: "Failed to submit attendance" },
        { status: 500 }
      );
    }

    // Create audit log
    await supabase.from("AuditLog").insert({
      userId: user.id,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "AttendanceSubmission",
      entityId: submission.id,
      newValue: JSON.stringify(submission),
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(submission);
  } catch (error) {
    console.error("Submit attendance error:", error);
    return NextResponse.json(
      { error: "Failed to submit attendance" },
      { status: 500 }
    );
  }
}

// PUT /api/attendance/[sessionId] - Update attendance session (Teacher)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    const body = await request.json();

    // Get session and verify ownership
    const { data: attendanceSession, error: sessionError } = await supabase
      .from("AttendanceSession")
      .select(`
        *,
        Class (ownerId)
      `)
      .eq("id", sessionId)
      .single();

    if (sessionError || !attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (attendanceSession.Class?.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { data: updated, error: updateError } = await supabase
      .from("AttendanceSession")
      .update({
        title: body.title,
        lateThresholdMinutes: body.lateThresholdMinutes,
        isActive: body.isActive,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update session" },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update attendance session error:", error);
    return NextResponse.json(
      { error: "Failed to update attendance session" },
      { status: 500 }
    );
  }
}

// DELETE /api/attendance/[sessionId] - Delete attendance session
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    
    if (!user || user.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;

    // Get session and verify ownership
    const { data: attendanceSession, error: sessionError } = await supabase
      .from("AttendanceSession")
      .select(`
        *,
        Class (ownerId)
      `)
      .eq("id", sessionId)
      .single();

    if (sessionError || !attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (attendanceSession.Class?.ownerId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from("AttendanceSession")
      .delete()
      .eq("id", sessionId);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete session" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete attendance session error:", error);
    return NextResponse.json(
      { error: "Failed to delete attendance session" },
      { status: 500 }
    );
  }
}
