/**
 * Migración — PaymentPlan (planes de pago con morosos)
 *
 * Patrón one-shot: desplegar → llamar con Bearer CRON_SECRET → borrar → redesplegar.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export async function GET(req: Request) {
  const { verifyBearerToken } = await import("@/lib/auth-utils");
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const steps: string[] = [];
  const errors: string[] = [];

  async function run(label: string, sql: string) {
    try {
      await db.$executeRawUnsafe(sql);
      steps.push(`✅ ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("42701") ||
        msg.includes("42P07") ||
        msg.includes("42710")
      ) {
        steps.push(`⏭️  ${label} (ya existía)`);
      } else {
        errors.push(`❌ ${label}: ${msg}`);
      }
    }
  }

  // ── Enum PaymentPlanStatus ─────────────────────────────────────────────────
  await run(
    "CREATE TYPE PaymentPlanStatus",
    `DO $$ BEGIN
       CREATE TYPE "PaymentPlanStatus" AS ENUM ('ACTIVE','COMPLETED','CANCELLED','DEFAULTED');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
  );

  // ── Tabla PaymentPlan ──────────────────────────────────────────────────────
  await run(
    "CREATE PaymentPlan",
    `CREATE TABLE IF NOT EXISTS "PaymentPlan" (
      "id"             TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "communityId"    TEXT NOT NULL,
      "unitId"         TEXT NOT NULL,
      "totalUsd"       DECIMAL(18,2) NOT NULL,
      "installments"   INTEGER NOT NULL,
      "installmentUsd" DECIMAL(18,2) NOT NULL,
      "startDate"      TIMESTAMP(3) NOT NULL,
      "status"         "PaymentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
      "notes"          TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdById"    TEXT,
      "cancelledAt"    TIMESTAMP(3),
      "cancelReason"   TEXT,
      CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
    )`,
  );

  await run(
    "FK PaymentPlan.communityId → Community",
    `ALTER TABLE "PaymentPlan"
     ADD CONSTRAINT "PaymentPlan_communityId_fkey"
     FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE`,
  );

  await run(
    "FK PaymentPlan.unitId → Unit",
    `ALTER TABLE "PaymentPlan"
     ADD CONSTRAINT "PaymentPlan_unitId_fkey"
     FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT`,
  );

  await run(
    "INDEX PaymentPlan communityId+unitId",
    `CREATE INDEX IF NOT EXISTS "PaymentPlan_communityId_unitId_idx"
     ON "PaymentPlan"("communityId", "unitId")`,
  );

  await run(
    "INDEX PaymentPlan organizationId",
    `CREATE INDEX IF NOT EXISTS "PaymentPlan_organizationId_idx"
     ON "PaymentPlan"("organizationId")`,
  );

  // ── Registrar en _prisma_migrations ────────────────────────────────────────
  await run(
    "_prisma_migrations marker",
    `INSERT INTO "_prisma_migrations"
       ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
     VALUES
       (gen_random_uuid(),'migration-payment-plan-manual',NOW(),'20260511120000_payment_plan',NULL,NULL,NOW(),1)
     ON CONFLICT DO NOTHING`,
  );

  return NextResponse.json({ steps, errors, ok: errors.length === 0 });
}
