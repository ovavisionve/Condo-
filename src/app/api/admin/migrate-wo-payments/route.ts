/**
 * Ruta temporal de migración — crear tabla WorkOrderPayment.
 * Llamar UNA sola vez con:
 *   curl https://condominios-theta.vercel.app/api/admin/migrate-wo-payments
 * Luego eliminar este archivo y redesplegar.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const results: string[] = [];

  try {
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS "WorkOrderPayment" (
        "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
        "organizationId"  TEXT        NOT NULL,
        "communityId"     TEXT        NOT NULL,
        "workOrderId"     TEXT        NOT NULL,
        "amountUsd"       DECIMAL(18,2) NOT NULL,
        "amountBss"       DECIMAL(18,2) NOT NULL,
        "exchangeRate"    DECIMAL(18,8) NOT NULL DEFAULT 1,
        "exchangeSource"  TEXT        NOT NULL DEFAULT 'BCV',
        "currencyPrimary" TEXT        NOT NULL DEFAULT 'USD',
        "method"          TEXT        NOT NULL DEFAULT 'TRANSFER_USD',
        "reference"       TEXT,
        "description"     TEXT,
        "paidAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "notes"           TEXT,
        "createdById"     TEXT,
        "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WorkOrderPayment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "WorkOrderPayment_workOrderId_fkey"
          FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `;
    results.push("✅ Tabla WorkOrderPayment creada (o ya existía)");
  } catch (e) {
    results.push(`❌ WorkOrderPayment: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    await db.$executeRaw`
      CREATE INDEX IF NOT EXISTS "WorkOrderPayment_workOrderId_idx"
        ON "WorkOrderPayment"("workOrderId")
    `;
    await db.$executeRaw`
      CREATE INDEX IF NOT EXISTS "WorkOrderPayment_organizationId_idx"
        ON "WorkOrderPayment"("organizationId")
    `;
    results.push("✅ Índices creados");
  } catch (e) {
    results.push(`⚠️ Índices: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({ ok: true, results });
}
