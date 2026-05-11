/**
 * Migración one-shot: agrega columnas amountBss y currencyPrimary a RecurringExpenseTemplate.
 * Idempotente. Eliminar después de aplicar.
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

  const steps: { step: string; ok: boolean; detail?: string }[] = [];

  try {
    // 1. Agregar amountBss
    await db.$executeRawUnsafe(`
      ALTER TABLE "RecurringExpenseTemplate"
      ADD COLUMN IF NOT EXISTS "amountBss" DECIMAL(18,2)
    `);
    steps.push({ step: "add amountBss", ok: true });

    // 2. Agregar currencyPrimary
    await db.$executeRawUnsafe(`
      ALTER TABLE "RecurringExpenseTemplate"
      ADD COLUMN IF NOT EXISTS "currencyPrimary" "Currency" NOT NULL DEFAULT 'USD'
    `);
    steps.push({ step: "add currencyPrimary", ok: true });

    return NextResponse.json({ ok: true, steps });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      steps,
    }, { status: 500 });
  }
}
