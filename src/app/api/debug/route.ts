/**
 * Debug endpoint — protegido con CRON_SECRET.
 * Solo lectura: NO modifica datos en producción.
 * No expone strings/keys completos, solo metadatos.
 */
import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function verifyAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided = auth.replace(/^Bearer\s+/i, "");
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const errors: string[] = [];
  const rawUrl = process.env.DATABASE_URL ?? "";
  const maskedUrl = rawUrl.replace(/:([^@:]+)@/, ":***@");

  // Test 1: DB connection (read-only)
  let userCount = 0;
  try {
    const { db } = await import("@/server/db/client");
    userCount = await db.user.count();
    errors.push(`DB OK: ${userCount} users`);
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
      DATABASE_URL_MASKED: maskedUrl,
      DATABASE_URL_LENGTH: rawUrl.length,
      HAS_PGBOUNCER: rawUrl.includes("pgbouncer"),
      HAS_CONNECTION_LIMIT: rawUrl.includes("connection_limit"),
      PORT_6543: rawUrl.includes(":6543"),
      PORT_5432: rawUrl.includes(":5432"),
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "MISSING",
      // Solo reportar SET/MISSING — nunca el secreto ni su longitud completa
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "SET" : "MISSING",
      NODE_ENV: process.env.NODE_ENV,
    },
    tests: errors,
  });
}
