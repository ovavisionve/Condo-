/**
 * Migración: agrega "LEGAL" al enum ExpenseCategory (gastos de abogados/honorarios
 * profesionales, categoría propia solicitada por Luis). Idempotente.
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
    await db.$executeRawUnsafe(`ALTER TYPE "ExpenseCategory" ADD VALUE 'LEGAL'`);
    return NextResponse.json({ ok: true, message: "ExpenseCategory.LEGAL agregado" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("42710")) {
      return NextResponse.json({ ok: true, message: "ExpenseCategory.LEGAL ya existía" });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
