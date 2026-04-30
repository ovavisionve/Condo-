import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const errors: string[] = [];

  // URL completa (sin password)
  const rawUrl = process.env.DATABASE_URL ?? "";
  const maskedUrl = rawUrl.replace(/:([^@:]+)@/, ":***@");

  // Test 1: DB connection
  let userCount = 0;
  try {
    const { db } = await import("@/server/db/client");
    userCount = await db.user.count();
    errors.push(`DB OK: ${userCount} users`);
  } catch (e) {
    errors.push(`DB ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Test 2: Write + Read (UPDATE y verificación)
  try {
    const { db } = await import("@/server/db/client");
    const community = await db.community.findFirst({ where: { deletedAt: null } });
    if (community) {
      const testVal = "77.77";
      const prevVal = community.monthlyFeeUsd?.toString() ?? null;

      // Escribe
      await db.community.update({
        where: { id: community.id },
        data: { monthlyFeeUsd: testVal, monthlyFeeSetAt: new Date() },
      });

      // Lee de vuelta en la misma conexión
      const after = await db.community.findUnique({ where: { id: community.id } });
      const readBack = after?.monthlyFeeUsd?.toString();
      errors.push(`WRITE TEST: wrote 77.77, read back: ${readBack} → ${readBack === testVal ? "✅ OK" : "❌ FALLO"}`);

      // Restaurar
      await db.community.update({
        where: { id: community.id },
        data: { monthlyFeeUsd: prevVal ? prevVal : null, monthlyFeeSetAt: prevVal ? community.monthlyFeeSetAt : null },
      });
      errors.push(`RESTORE: restaurado a ${prevVal ?? "null"}`);
    } else {
      errors.push("WRITE TEST: no hay community para probar");
    }
  } catch (e) {
    errors.push(`WRITE TEST ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Test 3: Auth import
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
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? `SET(${process.env.NEXTAUTH_SECRET.length} chars)` : "MISSING",
      NODE_ENV: process.env.NODE_ENV,
    },
    tests: errors,
  });
}
