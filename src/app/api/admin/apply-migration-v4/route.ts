/**
 * Migración v4 — UnidentifiedPayment (pagos no identificados en conciliación)
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
        msg.includes("42P07")
      ) {
        steps.push(`⏭️  ${label} (ya existía)`);
      } else {
        errors.push(`❌ ${label}: ${msg}`);
      }
    }
  }

  // ── UnidentifiedPayment (tabla nueva) ────────────────────────────────────────
  await run(
    "CREATE UnidentifiedPayment",
    `CREATE TABLE IF NOT EXISTS "UnidentifiedPayment" (
      "id"                TEXT NOT NULL,
      "organizationId"    TEXT NOT NULL,
      "communityId"       TEXT NOT NULL,
      "bankDate"          TEXT NOT NULL,
      "bankRef"           TEXT,
      "bankAmountUsd"     DECIMAL(18,2) NOT NULL,
      "bankDescription"   TEXT,
      "notes"             TEXT,
      "assignedAt"        TIMESTAMP(3),
      "assignedUnitId"    TEXT,
      "assignedPaymentId" TEXT,
      "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdById"       TEXT,
      CONSTRAINT "UnidentifiedPayment_pkey" PRIMARY KEY ("id")
    )`,
  );

  await run(
    "FK UnidentifiedPayment.assignedUnitId → Unit",
    `ALTER TABLE "UnidentifiedPayment"
     ADD CONSTRAINT "UnidentifiedPayment_assignedUnitId_fkey"
     FOREIGN KEY ("assignedUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL`,
  );

  await run(
    "INDEX UnidentifiedPayment communityId",
    `CREATE INDEX IF NOT EXISTS "UnidentifiedPayment_communityId_assignedAt_idx"
     ON "UnidentifiedPayment"("communityId", "assignedAt")`,
  );

  await run(
    "INDEX UnidentifiedPayment organizationId",
    `CREATE INDEX IF NOT EXISTS "UnidentifiedPayment_organizationId_idx"
     ON "UnidentifiedPayment"("organizationId")`,
  );

  // ── Registrar en _prisma_migrations ────────────────────────────────────────
  await run(
    "_prisma_migrations marker",
    `INSERT INTO "_prisma_migrations"
       ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
     VALUES
       (gen_random_uuid(),'migration-v4-manual',NOW(),'20260502100000_v4_unidentified_payment',NULL,NULL,NOW(),1)
     ON CONFLICT DO NOTHING`,
  );

  return NextResponse.json({ steps, errors, ok: errors.length === 0 });
}
