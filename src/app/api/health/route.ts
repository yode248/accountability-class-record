import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/health - Health check endpoint
export async function GET() {
  const checks = {
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? "set" : "missing",
    },
    database: {
      connected: false,
      error: null as string | null,
    },
    auth: {
      configured: false,
      error: null as string | null,
    },
  };

  try {
    // Check environment variables first
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      checks.status = "error";
      checks.database.error = "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY";
      return NextResponse.json(checks, { status: 500 });
    }

    // Test database connection via Supabase
    const supabase = await createSupabaseServerClient();
    
    // Simple query to test connection
    const { error: dbError } = await supabase
      .from("User")
      .select("id")
      .limit(1);

    if (dbError) {
      // Check if it's just an empty table (which is fine)
      if (dbError.code === "PGRST116") {
        // Table exists but is empty - connection works
        checks.database.connected = true;
      } else {
        checks.status = "error";
        checks.database.error = dbError.message;
      }
    } else {
      checks.database.connected = true;
    }

    // Test auth
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    checks.auth.configured = !authError;
    if (authError) {
      checks.auth.error = authError.message;
    }

  } catch (error) {
    checks.status = "error";
    checks.database.error = error instanceof Error ? error.message : "Unknown error";
  }

  // Return appropriate status code
  const statusCode = checks.status === "ok" ? 200 : 500;

  return NextResponse.json(checks, { status: statusCode });
}
