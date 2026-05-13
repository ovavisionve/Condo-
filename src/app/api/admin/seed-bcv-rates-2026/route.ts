/**
 * Seed BCV rates 2026 — bulk insert de tasas históricas desde el Excel del cliente.
 *
 * - 85 fechas desde 2/1/2026 hasta 14/5/2026 (Bs.S por USD según BCV oficial).
 * - Idempotente: usa upsert por (source, date) → corrida múltiple no duplica.
 * - Aplica también la migración SQL para agregar towerScope a WorkOrder.
 *
 * Tras correrlo, todo pago/factura registrado con fecha histórica usará la tasa
 * correcta del día (vía getCurrentRate(BCV, date) que ya consulta la BD).
 *
 * Llamada:
 *   curl -X POST https://residia.vercel.app/api/admin/seed-bcv-rates-2026 \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";
import ratesData from "./rates.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

type RateRow = { date: string; rate: number };

export async function POST(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: {
    migration: { step: string; ok: boolean; detail?: string }[];
    rates: { upserted: number; firstDate: string; lastDate: string };
    payments: { recalculated: number };
  } = {
    migration: [],
    rates: { upserted: 0, firstDate: "", lastDate: "" },
    payments: { recalculated: 0 },
  };

  try {
    // ── 1. Migración: agregar towerScope a WorkOrder ─────────────────
    await db.$executeRawUnsafe(`
      ALTER TABLE "WorkOrder"
      ADD COLUMN IF NOT EXISTS "towerScope" TEXT
    `);
    result.migration.push({ step: "WorkOrder.towerScope", ok: true });

    // ── 2. Bulk upsert de tasas BCV ──────────────────────────────────
    const rates = ratesData as RateRow[];
    for (const r of rates) {
      const date = new Date(r.date + "T12:00:00Z");
      await db.exchangeRate.upsert({
        where: {
          date_source: { date, source: "BCV" },
        },
        update: { vesPerUsd: r.rate.toFixed(8) },
        create: { source: "BCV", date, vesPerUsd: r.rate.toFixed(8) },
      });
      result.rates.upserted++;
    }
    result.rates.firstDate = rates[rates.length - 1]?.date ?? "";
    result.rates.lastDate = rates[0]?.date ?? "";

    // ── 3. Recalcular bimonetario de pagos cuya tasa no coincide con la histórica ──
    // Si un pago se registró antes de tener las tasas históricas, su exchangeRate
    // puede ser la tasa "actual del momento" (incorrecto). Lo recalculamos contra
    // la tasa BCV histórica del día del pago, ajustando amountBss si la moneda
    // primaria es USD (amountUsd queda fijo) o amountUsd si la primaria es VES
    // (amountBss queda fijo).
    const allPayments = await db.payment.findMany({
      where: { voidedAt: null },
      select: {
        id: true, paidAt: true, exchangeRate: true,
        amountUsd: true, amountBss: true, currencyPrimary: true,
      },
    });

    for (const p of allPayments) {
      // Tasa BCV correcta para la fecha del pago
      const day = new Date(Date.UTC(p.paidAt.getUTCFullYear(), p.paidAt.getUTCMonth(), p.paidAt.getUTCDate(), 12, 0, 0));
      const historic = await db.exchangeRate.findUnique({
        where: { date_source: { date: day, source: "BCV" } },
      });
      if (!historic) continue;
      const newRate = Number(historic.vesPerUsd);
      const oldRate = Number(p.exchangeRate);
      // Tolerancia 0.01 Bs/$ — si está dentro de eso lo dejamos
      if (Math.abs(newRate - oldRate) < 0.01) continue;

      if (p.currencyPrimary === "USD") {
        // amountUsd queda fijo, amountBss se recalcula
        const newAmountBss = Number(p.amountUsd) * newRate;
        await db.payment.update({
          where: { id: p.id },
          data: {
            exchangeRate: newRate.toFixed(8),
            amountBss: newAmountBss.toFixed(2),
          },
        });
      } else {
        // amountBss queda fijo, amountUsd se recalcula
        const newAmountUsd = Number(p.amountBss) / newRate;
        await db.payment.update({
          where: { id: p.id },
          data: {
            exchangeRate: newRate.toFixed(8),
            amountUsd: newAmountUsd.toFixed(2),
          },
        });
      }
      result.payments.recalculated++;
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      partial: result,
    }, { status: 500 });
  }
}
