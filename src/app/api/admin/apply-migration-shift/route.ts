/**
 * One-shot: agrega Community.invoicePeriodShift y setea shift=1 para Castaños B
 * y Los Arrayanes (post-mes — práctica venezolana). Eliminar después.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await db.$executeRawUnsafe(
      `ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS "invoicePeriodShift" INTEGER NOT NULL DEFAULT 1;`,
    );
    return NextResponse.json({ ok: true, msg: "Community.invoicePeriodShift ready (default=1)" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
