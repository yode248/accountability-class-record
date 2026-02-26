import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/health - Health check endpoint
export async function GET() {
  const checks = {
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasDirectUrl: !!process.env.DIRECT_DATABASE_URL,
      hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
      hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
      nextAuthUrl: process.env.NEXTAUTH_URL || "not set",
    },
    database: {
      connected: false,
      error: null as string | null,
    },
  };

  try {
    // Test database connection
    await db.$queryRaw`SELECT 1`;
    checks.database.connected = true;
  } catch (error) {
    checks.status = "error";
    checks.database.error = error instanceof Error ? error.message : "Unknown database error";
  }

  // Return appropriate status code
  const statusCode = checks.status === "ok" ? 200 : 500;

  return NextResponse.json(checks, { status: statusCode });
}
