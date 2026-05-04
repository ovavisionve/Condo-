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
  method: PaymentMethod;
  reference?: string;
  paidAt: Date;
  bankAccountId?: string;
  notes?: string;
  /** Asignación a facturas. Si está vacío, queda como anticipo (no aplicado). */
  allocations?: { invoiceId: string; amount: Decimal.Value }[];
  createdById: string;
};

/**
 * Registra un pago de una unidad. Si se proveen allocations:
 * - La suma de allocations.amount debe igualar el monto total del pago (en moneda primaria).
 * - Cada Invoice asignada se actualiza: paidBss/paidUsd y status (PARTIAL/PAID).
 * Si no hay allocations, queda como anticipo (a aplicar luego).
 *
 * Auditado y atómico.
 */
export async function recordPayment(input: RecordPaymentInput) {
  const source = input.exchangeSource ?? "BCV";
  const rate = await getCurrentRate(source, input.paidAt);
  const { amountBss, amountUsd } = buildBimonetary(
    input.amount,
    input.currencyPrimary,
    rate.vesPerUsd,
  );

  // Validar que las allocations no excedan el monto total.
  // Si sum < total → el sobrante queda como anticipo (crédito para la unidad). OK.
  // Si sum > total → error, no se puede asignar más de lo recibido.
  if (input.allocations && input.allocations.length > 0) {
    const sumAlloc = input.allocations.reduce(
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

    if (input.allocations && input.allocations.length > 0) {
      for (const alloc of input.allocations) {
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
          allocations: input.allocations?.length ?? 0,
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
