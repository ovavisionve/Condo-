/**
 * Migración: agrupación de plantillas recurrentes en el recibo.
 *
 * Cambios:
 *  - Expense.recurringTemplateId (TEXT, nullable, FK a RecurringExpenseTemplate.id)
 *  - RecurringExpenseTemplate.isProvision (BOOLEAN, default false)
 *  - índice Expense_recurringTemplateId_idx
 *
 * Pattern: GET con Bearer CRON_SECRET. Idempotente (IF NOT EXISTS).
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const steps: string[] = [];
  const errors: string[] = [];

  async function run(label: string, sql: string) {
    try {
      await db.$executeRawUnsafe(sql);
      steps.push(`✅ ${label}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already exists") || msg.includes("duplicate column")) {
        steps.push(`⚪ ${label} (ya aplicado)`);
      } else {
        errors.push(`❌ ${label}: ${msg}`);
      }
    }
  }

  await run(
    "Expense.recurringTemplateId column",
    `ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "recurringTemplateId" TEXT;`,
  );
  await run(
    "RecurringExpenseTemplate.isProvision column",
    `ALTER TABLE "RecurringExpenseTemplate" ADD COLUMN IF NOT EXISTS "isProvision" BOOLEAN NOT NULL DEFAULT false;`,
  );
  await run(
    "Expense_recurringTemplateId_idx",
    `CREATE INDEX IF NOT EXISTS "Expense_recurringTemplateId_idx" ON "Expense"("recurringTemplateId");`,
  );
  // FK con SET NULL (igual al schema Prisma)
  await run(
    "Expense_recurringTemplateId_fkey",
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_name = 'Expense_recurringTemplateId_fkey'
       ) THEN
         ALTER TABLE "Expense"
           ADD CONSTRAINT "Expense_recurringTemplateId_fkey"
           FOREIGN KEY ("recurringTemplateId")
           REFERENCES "RecurringExpenseTemplate"(id)
           ON DELETE SET NULL ON UPDATE CASCADE;
       END IF;
     END; $$;`,
  );

  return NextResponse.json({ steps, errors, ok: errors.length === 0 });
}
