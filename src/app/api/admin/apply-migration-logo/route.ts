/**
 * One-shot: agrega columna Community.logoUrl si no existe.
 * Llamar: GET /api/admin/apply-migration-logo
 * Borrar luego.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await db.$executeRawUnsafe(
      `ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;`,
    );
    return NextResponse.json({ ok: true, msg: "Community.logoUrl ready" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
