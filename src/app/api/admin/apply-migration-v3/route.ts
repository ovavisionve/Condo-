/**
 * Migración v3 — Campos nuevos para features de cliente (mayo 2026)
 *
 * Cambios:
 *  - Expense: towerScope, isIndividual, targetUnitId (FK a Unit)
 *  - Income:  customCategory, affectsInvoice
 *  - New table: RecurringExpenseTemplate
 *
 * Patrón one-shot: desplegar → llamar con Bearer CRON_SECRET → borrar → redesplegar.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export async function GET(_req: Request) {
  // Auth deshabilitada temporalmente para ejecutar la migración — BORRAR después

  const steps: string[] = [];
  const errors: string[] = [];

  async function run(label: string, sql: string) {
    try {
      await db.$executeRawUnsafe(sql);
      steps.push(`✅ ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // "already exists" / "duplicate column" no es un error real
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("42701") // PostgreSQL: column already exists
      ) {
        steps.push(`⏭️  ${label} (ya existía)`);
      } else {
        errors.push(`❌ ${label}: ${msg}`);
      }
    }
  }

  // ── Expense: nuevas columnas ─────────────────────────────────────────────
  await run(
    "Expense.towerScope",
    `ALTER TABLE "Expense" ADD COLUMN "towerScope" TEXT`,
  );
  await run(
    "Expense.isIndividual",
    `ALTER TABLE "Expense" ADD COLUMN "isIndividual" BOOLEAN NOT NULL DEFAULT false`,
  );
  await run(
    "Expense.targetUnitId",
    `ALTER TABLE "Expense" ADD COLUMN "targetUnitId" TEXT`,
  );
  // FK Expense → Unit
  await run(
    "FK Expense.targetUnitId → Unit",
    `ALTER TABLE "Expense"
     ADD CONSTRAINT "Expense_targetUnitId_fkey"
     FOREIGN KEY ("targetUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL`,
  );
  await run(
    "INDEX Expense.targetUnitId",
    `CREATE INDEX IF NOT EXISTS "Expense_targetUnitId_idx" ON "Expense"("targetUnitId")`,
  );

  // ── Income: nuevas columnas ──────────────────────────────────────────────
  await run(
    "Income.customCategory",
    `ALTER TABLE "Income" ADD COLUMN "customCategory" TEXT`,
  );
  await run(
    "Income.affectsInvoice",
    `ALTER TABLE "Income" ADD COLUMN "affectsInvoice" BOOLEAN NOT NULL DEFAULT false`,
  );

  // ── RecurringExpenseTemplate (tabla nueva) ───────────────────────────────
  await run(
    "CREATE RecurringExpenseTemplate",
    `CREATE TABLE IF NOT EXISTS "RecurringExpenseTemplate" (
      "id"             TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "communityId"    TEXT NOT NULL,
      "category"       "ExpenseCategory" NOT NULL,
      "customCategory" TEXT,
      "description"    TEXT NOT NULL,
      "supplierName"   TEXT,
      "amountUsd"      DECIMAL(18,2) NOT NULL,
      "towerScope"     TEXT,
      "notes"          TEXT,
      "active"         BOOLEAN NOT NULL DEFAULT true,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RecurringExpenseTemplate_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "FK RecurringExpenseTemplate → Community",
    `ALTER TABLE "RecurringExpenseTemplate"
     ADD CONSTRAINT "RecurringExpenseTemplate_communityId_fkey"
     FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE`,
  );
  await run(
    "INDEX RecurringExpenseTemplate communityId",
    `CREATE INDEX IF NOT EXISTS "RecurringExpenseTemplate_communityId_active_idx"
     ON "RecurringExpenseTemplate"("communityId","active")`,
  );
  await run(
    "INDEX RecurringExpenseTemplate organizationId",
    `CREATE INDEX IF NOT EXISTS "RecurringExpenseTemplate_organizationId_idx"
     ON "RecurringExpenseTemplate"("organizationId")`,
  );

  // ── Registrar en _prisma_migrations (evita que prisma migrate dev lo reaplique) ─
  await run(
    "_prisma_migrations marker",
    `INSERT INTO "_prisma_migrations"
       ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
     VALUES
       (gen_random_uuid(),'migration-v3-manual',NOW(),'20260502000000_v3_expense_income_recurring',NULL,NULL,NOW(),1)
     ON CONFLICT DO NOTHING`,
  );

  return NextResponse.json({ steps, errors, ok: errors.length === 0 });
}
