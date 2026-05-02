import { db } from "@/server/db/client";
import { getCurrentRate } from "@/server/services/exchange";
import type { IncomeCategory, ExchangeSource, Currency } from "@prisma/client";

interface RegisterIncomeInput {
  organizationId: string;
  communityId: string;
  category: IncomeCategory;
  customCategory?: string;
  description: string;
  periodYear: number;
  periodMonth: number;
  amount: number;
  currencyPrimary: Currency;
  exchangeSource: ExchangeSource;
  reference?: string;
  notes?: string;
  /**
   * Si true, este ingreso reduce el total de gastos antes del prorrateo mensual.
   * Aparece como descuento en los recibos del período.
   */
  affectsInvoice?: boolean;
  createdById?: string;
}

export async function registerIncome(input: RegisterIncomeInput) {
  const rate = await getCurrentRate(input.exchangeSource === "MANUAL" ? "MANUAL" : "BCV");
  const vesPerUsd = Number(rate.vesPerUsd.toString());

  let amountUsd: number;
  let amountBss: number;

  if (input.currencyPrimary === "USD") {
    amountUsd = input.amount;
    amountBss = input.amount * vesPerUsd;
  } else {
    amountBss = input.amount;
    amountUsd = input.amount / vesPerUsd;
  }

  return db.income.create({
    data: {
      organizationId: input.organizationId,
      communityId: input.communityId,
      category: input.category,
      customCategory: input.customCategory ?? null,
      description: input.description,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amountUsd: amountUsd.toFixed(2),
      amountBss: amountBss.toFixed(2),
      exchangeRate: rate.vesPerUsd.toString(),
      exchangeSource: rate.source,
      currencyPrimary: input.currencyPrimary,
      reference: input.reference,
      notes: input.notes,
      affectsInvoice: input.affectsInvoice ?? false,
      createdById: input.createdById,
    },
  });
}

export async function voidIncome(params: {
  organizationId: string;
  incomeId: string;
  reason: string;
}) {
  const income = await db.income.findFirstOrThrow({
    where: { id: params.incomeId, organizationId: params.organizationId, voidedAt: null },
  });
  return db.income.update({
    where: { id: income.id },
    data: { voidedAt: new Date(), voidReason: params.reason },
  });
}
