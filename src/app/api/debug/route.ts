import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const errors: string[] = [];

  // Test 1: DB connection
  try {
    const { db } = await import("@/server/db/client");
    const count = await db.user.count();
    errors.push(`DB OK: ${count} users`);
  } catch (e) {
    errors.push(`DB ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Test 2: Auth import
  try {
    await import("@/server/auth/config");
    errors.push("Auth import OK");
  } catch (e) {
    errors.push(`Auth ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 50) + "..." : "MISSING",
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "MISSING",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "SET(" + process.env.NEXTAUTH_SECRET.length + " chars)" : "MISSING",
      NODE_ENV: process.env.NODE_ENV,
    },
    tests: errors,
  });
}
