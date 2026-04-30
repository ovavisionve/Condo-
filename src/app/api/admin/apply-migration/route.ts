import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

/**
 * Ruta temporal para aplicar migración a Supabase.
 * ELIMINAR después de aplicar.
 * Llamar: GET /api/admin/apply-migration?secret=CRON_SECRET
 */
export async function GET(_req: Request) {
  // Ruta temporal one-shot — eliminar después de ejecutar

  const results: string[] = [];

  try {
    await db.$executeRaw`ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS "dueDaysAfterIssue" INTEGER NOT NULL DEFAULT 5`;
    results.push("✅ Community.dueDaysAfterIssue agregada");
  } catch (e) {
    results.push(`❌ Community.dueDaysAfterIssue: ${e instanceof Error ? e.message : e}`);
  }

  try {
    await db.$executeRaw`ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "customCategory" TEXT`;
    results.push("✅ Expense.customCategory agregada");
  } catch (e) {
    results.push(`❌ Expense.customCategory: ${e instanceof Error ? e.message : e}`);
  }

  return NextResponse.json({ ok: true, results });
}
