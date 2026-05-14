/**
 * Migración: agrega Community.reserveFundPct (porcentaje de Fondo de Reserva auto-calculado).
 * Default 10% (estándar venezolano). Idempotente.
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await db.$executeRawUnsafe(`
      ALTER TABLE "Community"
      ADD COLUMN IF NOT EXISTS "reserveFundPct" DECIMAL(5,4) NOT NULL DEFAULT 0.10
    `);
    return NextResponse.json({ ok: true, message: "reserveFundPct agregado (default 10%)" });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
