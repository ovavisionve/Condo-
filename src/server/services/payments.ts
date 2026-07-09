import { Decimal } from "decimal.js";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db/client";
import { getCurrentRate } from "@/server/services/exchange";
import { buildBimonetary } from "@/server/services/invoicing";
import { notifyPerson } from "@/server/services/notifications";
import type { Currency, ExchangeSource, PaymentMethod, InvoiceStatus } from "@prisma/client";

export type RecordPaymentInput = {
  organizationId: string;
  communityId: string;
  unitId: string;
  amount: Decimal.Value;
  currencyPrimary: Currency;
  exchangeSource?: ExchangeSource;
  /** Si se provee, se usa esta tasa exacta en vez de la tasa automática del día (getCurrentRate). */
  exchangeRateOverride?: Decimal.Value;
  method: PaymentMethod;
  reference?: string;
  paidAt: Date;
  bankAccountId?: string;
  notes?: string;
  /**
   * Asignación a facturas. Si está vacío, se intenta auto-asignar a las facturas
   * pendientes de la unidad ordenadas por fecha de vencimiento (la más antigua primero).
   * El sobrante después de cubrir todas las facturas queda como anticipo.
   * Para forzar que todo el monto quede como anticipo, pasar `[]` y `autoAllocate=false`.
   */
  allocations?: { invoiceId: string; amount: Decimal.Value }[];
  /** Si true (default), aplica automáticamente a facturas más antiguas si no se proveen allocations. */
  autoAllocate?: boolean;
  createdById: string;
};

/** Métodos de pago bancarios que requieren número de referencia obligatorio. */
const METHODS_REQUIRING_REFERENCE: PaymentMethod[] = [
  "TRANSFER_BSS",
  "TRANSFER_USD",
  "ZELLE",
  "PAGO_MOVIL",
  "CHECK",
];

/**
 * Registra un pago de una unidad. Si se proveen allocations:
 * - La suma de allocations.amount debe igualar el monto total del pago (en moneda primaria).
 * - Cada Invoice asignada se actualiza: paidBss/paidUsd y status (PARTIAL/PAID).
 * Si no hay allocations, queda como anticipo (a aplicar luego).
 *
 * Auditado y atómico.
 */
export async function recordPayment(input: RecordPaymentInput) {
  // #7: Referencia obligatoria para métodos bancarios.
  if (METHODS_REQUIRING_REFERENCE.includes(input.method)) {
    const ref = input.reference?.trim();
    if (!ref) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El número de referencia es obligatorio para pagos por ${input.method.replace("_", " ").toLowerCase()}.`,
      });
    }
  }

  const rate = input.exchangeRateOverride
    ? { date: input.paidAt, source: "MANUAL" as ExchangeSource, vesPerUsd: new Decimal(input.exchangeRateOverride) }
    : await getCurrentRate(input.exchangeSource ?? "BCV", input.paidAt);
  const { amountBss, amountUsd } = buildBimonetary(
    input.amount,
    input.currencyPrimary,
    rate.vesPerUsd,
  );

  // #11: Auto-asignar a las facturas más antiguas si no se proveen allocations explícitas.
  const autoAllocate = input.autoAllocate ?? true;
  let allocations = input.allocations;
  if ((!allocations || allocations.length === 0) && autoAllocate) {
    const pendingInvoices = await db.invoice.findMany({
      where: {
        organizationId: input.organizationId,
        unitId: input.unitId,
        status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
      },
      orderBy: { dueDate: "asc" },
      select: { id: true, totalBss: true, totalUsd: true, paidBss: true, paidUsd: true },
    });
    let remaining = new Decimal(input.amount);
    const auto: { invoiceId: string; amount: Decimal.Value }[] = [];
    const isPrimaryUsd = input.currencyPrimary === "USD";
    for (const inv of pendingInvoices) {
      if (remaining.lte(0)) break;
      const total = isPrimaryUsd
        ? new Decimal(inv.totalUsd.toString())
        : new Decimal(inv.totalBss.toString());
      const paid = isPrimaryUsd
        ? new Decimal(inv.paidUsd.toString())
        : new Decimal(inv.paidBss.toString());
      const balance = total.minus(paid);
      if (balance.lte(0)) continue;
      const toApply = Decimal.min(remaining, balance);
      auto.push({ invoiceId: inv.id, amount: toApply.toFixed(2) });
      remaining = remaining.minus(toApply);
    }
    if (auto.length > 0) allocations = auto;
  }

  // Validar que las allocations no excedan el monto total.
  // Si sum < total → el sobrante queda como anticipo (crédito para la unidad). OK.
  // Si sum > total → error, no se puede asignar más de lo recibido.
  if (allocations && allocations.length > 0) {
    const sumAlloc = allocations.reduce(
      (acc, a) => acc.plus(a.amount),
      new Decimal(0),
    );
    if (sumAlloc.gt(new Decimal(input.amount))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Las asignaciones (${sumAlloc.toFixed(2)}) superan el monto recibido (${new Decimal(input.amount).toFixed(2)}). Reduce los montos asignados.`,
      });
    }
  }

  const payment = await db.$transaction(async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({
      where: { id: input.unitId, organizationId: input.organizationId, deletedAt: null },
    });
    if (unit.communityId !== input.communityId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Unidad no pertenece a esta comunidad" });
    }

    const payment = await tx.payment.create({
      data: {
        organizationId: input.organizationId,
        communityId: input.communityId,
        unitId: input.unitId,
        amountBss: amountBss.toFixed(2),
        amountUsd: amountUsd.toFixed(2),
        exchangeRate: rate.vesPerUsd.toFixed(8),
        exchangeSource: rate.source,
        currencyPrimary: input.currencyPrimary,
        method: input.method,
        reference: input.reference,
        paidAt: input.paidAt,
        bankAccountId: input.bankAccountId,
        notes: input.notes,
        createdById: input.createdById,
      },
    });

    if (allocations && allocations.length > 0) {
      for (const alloc of allocations) {
        const inv = await tx.invoice.findFirstOrThrow({
          where: { id: alloc.invoiceId, organizationId: input.organizationId },
        });
        if (inv.unitId !== input.unitId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `La factura ${inv.invoiceNumber} no pertenece a esta unidad`,
          });
        }
        if (inv.status === "VOIDED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `La factura ${inv.invoiceNumber} está anulada`,
          });
        }

        const allocBimonetary = buildBimonetary(alloc.amount, input.currencyPrimary, rate.vesPerUsd);
        const allocBssRounded = allocBimonetary.amountBss.toDecimalPlaces(2);
        const allocUsdRounded = allocBimonetary.amountUsd.toDecimalPlaces(2);

        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: inv.id,
            amountBss: allocBssRounded.toFixed(2),
            amountUsd: allocUsdRounded.toFixed(2),
          },
        });

        const newPaidBss = new Decimal(inv.paidBss.toString()).plus(allocBssRounded);
        const newPaidUsd = new Decimal(inv.paidUsd.toString()).plus(allocUsdRounded);
        const totalBss = new Decimal(inv.totalBss.toString());
        const totalUsd = new Decimal(inv.totalUsd.toString());

        // Comparamos en MONEDA PRIMARIA para evitar diferencias de redondeo.
        const isPrimaryUsd = inv.currencyPrimary === "USD";
        const totalPrimary = isPrimaryUsd ? totalUsd : totalBss;
        const newPaidPrimary = isPrimaryUsd ? newPaidUsd : newPaidBss;

        let newStatus: InvoiceStatus = inv.status;
        if (newPaidPrimary.gte(totalPrimary)) newStatus = "PAID";
        else if (newPaidPrimary.gt(0)) newStatus = "PARTIAL";

        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            paidBss: newPaidBss.toFixed(2),
            paidUsd: newPaidUsd.toFixed(2),
            status: newStatus,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.createdById,
        action: "PAYMENT_RECORDED",
        entityType: "Payment",
        entityId: payment.id,
        after: {
          unitId: input.unitId,
          method: input.method,
          amount: new Decimal(input.amount).toString(),
          currency: input.currencyPrimary,
          allocations: allocations?.length ?? 0,
          autoAllocated: !input.allocations || input.allocations.length === 0
            ? (allocations?.length ?? 0) > 0
            : false,
        },
      },
    });

    return payment;
  });

  // Fire-and-forget: notify the unit's current owner that the payment was received.
  void (async () => {
    const ownership = await db.ownership.findFirst({
      where: { unitId: input.unitId, endDate: null },
      select: { personId: true },
    });
    if (!ownership) return;
    await notifyPerson({
      organizationId: input.organizationId,
      communityId: input.communityId,
      unitId: input.unitId,
      personId: ownership.personId,
      event: "PAYMENT_RECEIVED",
      vars: { monto_usd: amountUsd.toFixed(2) },
    }).catch(() => {/* ignore notification errors */});
  })();

  return payment;
}

/**
 * Anula un pago. Revierte los allocations en las facturas afectadas.
 * El registro Payment se conserva (legal): solo se marca voidedAt.
 */
export async function voidPayment(params: {
  organizationId: string;
  paymentId: string;
  reason: string;
  actorId: string;
}) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirstOrThrow({
      where: { id: params.paymentId, organizationId: params.organizationId },
      include: { allocations: { include: { invoice: true } } },
    });
    if (payment.voidedAt) {
      throw new TRPCError({ code: "CONFLICT", message: "El pago ya está anulado" });
    }

    for (const alloc of payment.allocations) {
      const inv = alloc.invoice;
      const newPaidBss = new Decimal(inv.paidBss.toString()).minus(alloc.amountBss.toString());
      const newPaidUsd = new Decimal(inv.paidUsd.toString()).minus(alloc.amountUsd.toString());
      const totalBss = new Decimal(inv.totalBss.toString());
      const totalUsd = new Decimal(inv.totalUsd.toString());
      const isPrimaryUsd = inv.currencyPrimary === "USD";
      const totalPrimary = isPrimaryUsd ? totalUsd : totalBss;
      const newPaidPrimary = isPrimaryUsd ? newPaidUsd : newPaidBss;

      let newStatus: InvoiceStatus;
      if (newPaidPrimary.gte(totalPrimary)) newStatus = "PAID";
      else if (newPaidPrimary.gt(0)) newStatus = "PARTIAL";
      else newStatus = inv.status === "VOIDED" ? "VOIDED" : "ISSUED";

      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          paidBss: newPaidBss.toFixed(2),
          paidUsd: newPaidUsd.toFixed(2),
          status: newStatus,
        },
      });
    }

    await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
    const voided = await tx.payment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidedById: params.actorId, voidReason: params.reason },
    });

    await tx.auditLog.create({
      data: {
        organizationId: params.organizationId,
        actorId: params.actorId,
        action: "PAYMENT_VOIDED",
        entityType: "Payment",
        entityId: payment.id,
        after: { reason: params.reason },
      },
    });

    return voided;
  });
}
