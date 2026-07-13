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

    // Aplicar automáticamente cualquier saldo a favor PREEXISTENTE de la unidad (de
    // pagos anteriores) contra facturas pendientes — pedido cliente 12-jul-2026 vía
    // Reinaldo: "que se integre automáticamente siempre, no que haga falta aplicarlo
    // manual". El propio pago recién creado ya se auto-asignó arriba (allocations);
    // esto cubre el crédito de pagos VIEJOS que quedó sin aplicar.
    await applyUnitCreditCore(tx, { organizationId: input.organizationId, unitId: input.unitId });

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

/** Revierte los allocations de un pago (restaura paidBss/paidUsd/status de cada factura afectada). */
async function reverseAllocations(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  allocations: { invoiceId: string; amountBss: { toString(): string }; amountUsd: { toString(): string } }[],
) {
  for (const alloc of allocations) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: alloc.invoiceId } });
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
      data: { paidBss: newPaidBss.toFixed(2), paidUsd: newPaidUsd.toFixed(2), status: newStatus },
    });
  }
}

/**
 * Aplica el saldo a favor (anticipo) de una unidad — la porción de sus pagos NO
 * históricos que no quedó asignada a ninguna factura — contra sus facturas pendientes,
 * de la más antigua a la más reciente (FIFO). No lanza error si no hay crédito o no hay
 * facturas pendientes: simplemente devuelve `applied: []` (para poder llamarse
 * automáticamente sin que una unidad sin crédito rompa el flujo que la invoca).
 *
 * Pedido cliente 12-jul-2026 vía Reinaldo: "que el ajuste de saldo a favor se integre
 * automáticamente siempre, no que haga falta aplicarlo manual". Antes solo existía como
 * mutación manual (`finance.applyUnitCredit`, botón "✨ Aplicar a recibos pendientes"
 * en Estado de cuenta) — ahora también se llama sola desde `recordPayment` (crédito
 * viejo de la unidad) y desde `issueMonthlyInvoices` (crédito existente contra la
 * factura recién emitida).
 */
export async function applyUnitCreditCore(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  params: { organizationId: string; unitId: string; actorId?: string },
): Promise<{ applied: { invoiceNumber: string; usd: string; bss: string }[] }> {
  const payments = await tx.payment.findMany({
    where: { unitId: params.unitId, voidedAt: null, organizationId: params.organizationId, isHistorical: false },
    include: { allocations: { select: { amountBss: true, amountUsd: true } } },
    orderBy: { paidAt: "asc" },
  });

  const creditByPayment: { id: string; remBss: Decimal; remUsd: Decimal }[] = [];
  for (const p of payments) {
    const allocBss = p.allocations.reduce((s, a) => s.plus(a.amountBss.toString()), new Decimal(0));
    const allocUsd = p.allocations.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
    const remBss = new Decimal(p.amountBss.toString()).minus(allocBss);
    const remUsd = new Decimal(p.amountUsd.toString()).minus(allocUsd);
    if (remUsd.gt(0.005)) creditByPayment.push({ id: p.id, remBss, remUsd });
  }
  if (creditByPayment.length === 0) return { applied: [] };

  const pending = await tx.invoice.findMany({
    where: {
      unitId: params.unitId,
      organizationId: params.organizationId,
      status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
    },
    orderBy: { dueDate: "asc" },
    select: { id: true, invoiceNumber: true, currencyPrimary: true, totalBss: true, totalUsd: true, paidBss: true, paidUsd: true },
  });
  if (pending.length === 0) return { applied: [] };

  const applied: { invoiceNumber: string; usd: string; bss: string }[] = [];

  for (const inv of pending) {
    const invIsUsd = inv.currencyPrimary === "USD";
    const totalPrim = new Decimal((invIsUsd ? inv.totalUsd : inv.totalBss).toString());
    const paidPrim = new Decimal((invIsUsd ? inv.paidUsd : inv.paidBss).toString());
    let invBalance = totalPrim.minus(paidPrim);
    if (invBalance.lte(0)) continue;

    for (const c of creditByPayment) {
      if (invBalance.lte(0)) break;
      const cAmount = invIsUsd ? c.remUsd : c.remBss;
      if (cAmount.lte(0.005)) continue;
      const toApply = Decimal.min(cAmount, invBalance);
      const ratio = toApply.div(cAmount);
      const allocUsd = c.remUsd.mul(ratio);
      const allocBss = c.remBss.mul(ratio);

      // Upsert, no create: si este mismo pago YA tenía una allocation contra esta
      // factura (de una aplicación anterior — parcial o manual), (paymentId,invoiceId)
      // es único, así que hay que SUMAR sobre la fila existente, no insertar otra.
      await tx.paymentAllocation.upsert({
        where: { paymentId_invoiceId: { paymentId: c.id, invoiceId: inv.id } },
        create: {
          paymentId: c.id,
          invoiceId: inv.id,
          amountBss: allocBss.toFixed(2),
          amountUsd: allocUsd.toFixed(2),
        },
        update: {
          amountBss: { increment: allocBss.toFixed(2) },
          amountUsd: { increment: allocUsd.toFixed(2) },
        },
      });

      c.remUsd = c.remUsd.minus(allocUsd);
      c.remBss = c.remBss.minus(allocBss);
      invBalance = invBalance.minus(toApply);
    }

    const updatedAllocs = await tx.paymentAllocation.findMany({
      where: { invoiceId: inv.id }, select: { amountBss: true, amountUsd: true },
    });
    const newPaidBss = updatedAllocs.reduce((s, a) => s.plus(a.amountBss.toString()), new Decimal(0));
    const newPaidUsd = updatedAllocs.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
    const newPaidPrim = invIsUsd ? newPaidUsd : newPaidBss;
    const status = newPaidPrim.gte(totalPrim) ? "PAID" : newPaidPrim.gt(0) ? "PARTIAL" : "ISSUED";

    await tx.invoice.update({
      where: { id: inv.id },
      data: { paidBss: newPaidBss.toFixed(2), paidUsd: newPaidUsd.toFixed(2), status },
    });

    const appliedAmount = totalPrim.minus(paidPrim).minus(invBalance);
    applied.push({
      invoiceNumber: inv.invoiceNumber,
      usd: invIsUsd ? appliedAmount.toFixed(2) : "—",
      bss: invIsUsd ? "—" : appliedAmount.toFixed(2),
    });
  }

  if (applied.length === 0) return { applied: [] };

  await tx.auditLog.create({
    data: {
      organizationId: params.organizationId,
      actorId: params.actorId ?? null,
      action: "UPDATE",
      entityType: "Unit",
      entityId: params.unitId,
      after: { event: "CREDIT_APPLIED", invoicesAffected: applied.length, applied, auto: !params.actorId },
    },
  });

  return { applied };
}

export type UpdatePaymentInput = {
  organizationId: string;
  paymentId: string;
  actorId: string;
  paidAt?: Date;
  method?: PaymentMethod;
  reference?: string;
  bankAccountId?: string | null;
  notes?: string;
  amount?: Decimal.Value;
  currencyPrimary?: Currency;
  exchangeRateOverride?: Decimal.Value;
  /** Si false, el nuevo monto queda sin asignar (anticipo) en vez de re-aplicarse FIFO. Default true. */
  autoAllocate?: boolean;
};

/**
 * Edita un pago ya registrado (fecha, método, referencia, banco, notas, monto, moneda,
 * tasa). Si cambia el monto/moneda/tasa, revierte las allocations existentes y
 * re-aplica FIFO a las facturas pendientes de la misma unidad (mismo patrón que
 * recordPayment). No se puede editar un pago ya anulado.
 */
export async function updatePayment(params: UpdatePaymentInput) {
  const existing = await db.payment.findFirstOrThrow({
    where: { id: params.paymentId, organizationId: params.organizationId },
  });
  if (existing.voidedAt) {
    throw new TRPCError({ code: "CONFLICT", message: "El pago está anulado — no se puede editar" });
  }

  const newPaidAt = params.paidAt ?? existing.paidAt;
  const newCurrency = params.currencyPrimary ?? existing.currencyPrimary;
  const newAmount = params.amount ?? (
    existing.currencyPrimary === "USD" ? existing.amountUsd.toString() : existing.amountBss.toString()
  );

  const rate = params.exchangeRateOverride
    ? new Decimal(params.exchangeRateOverride)
    : new Decimal((await getCurrentRate((existing.exchangeSource ?? "BCV") as ExchangeSource, newPaidAt)).vesPerUsd);
  const { amountBss, amountUsd } = buildBimonetary(newAmount, newCurrency, rate);

  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: params.paymentId },
      include: { allocations: true },
    });

    const before = {
      amountUsd: payment.amountUsd.toString(), amountBss: payment.amountBss.toString(),
      paidAt: payment.paidAt, method: payment.method, reference: payment.reference,
      currencyPrimary: payment.currencyPrimary,
    };

    await reverseAllocations(tx, payment.allocations);
    await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });

    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        paidAt: newPaidAt,
        method: params.method ?? payment.method,
        reference: params.reference !== undefined ? params.reference : payment.reference,
        bankAccountId: params.bankAccountId !== undefined ? params.bankAccountId : payment.bankAccountId,
        notes: params.notes !== undefined ? params.notes : payment.notes,
        amountBss: amountBss.toFixed(2),
        amountUsd: amountUsd.toFixed(2),
        exchangeRate: rate.toFixed(8),
        exchangeSource: params.exchangeRateOverride ? "MANUAL" : (payment.exchangeSource ?? "BCV"),
        currencyPrimary: newCurrency,
      },
    });

    if (params.autoAllocate !== false) {
      const pendingInvoices = await tx.invoice.findMany({
        where: {
          organizationId: params.organizationId,
          unitId: payment.unitId,
          status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
        },
        orderBy: { dueDate: "asc" },
      });
      let remaining = new Decimal(newAmount);
      const isPrimaryUsd = newCurrency === "USD";
      for (const inv of pendingInvoices) {
        if (remaining.lte(0)) break;
        const total = isPrimaryUsd ? new Decimal(inv.totalUsd.toString()) : new Decimal(inv.totalBss.toString());
        const paid = isPrimaryUsd ? new Decimal(inv.paidUsd.toString()) : new Decimal(inv.paidBss.toString());
        const balance = total.minus(paid);
        if (balance.lte(0)) continue;
        const toApply = Decimal.min(remaining, balance);
        const allocBimonetary = buildBimonetary(toApply, newCurrency, rate);
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
        const isPrimUsd = inv.currencyPrimary === "USD";
        const totalPrimary = isPrimUsd ? totalUsd : totalBss;
        const newPaidPrimary = isPrimUsd ? newPaidUsd : newPaidBss;
        let newStatus: InvoiceStatus = inv.status;
        if (newPaidPrimary.gte(totalPrimary)) newStatus = "PAID";
        else if (newPaidPrimary.gt(0)) newStatus = "PARTIAL";

        await tx.invoice.update({
          where: { id: inv.id },
          data: { paidBss: newPaidBss.toFixed(2), paidUsd: newPaidUsd.toFixed(2), status: newStatus },
        });

        remaining = remaining.minus(toApply);
      }
    }

    await tx.auditLog.create({
      data: {
        organizationId: params.organizationId,
        actorId: params.actorId,
        action: "UPDATE",
        entityType: "Payment",
        entityId: payment.id,
        before,
        after: {
          amountUsd: updated.amountUsd.toString(), amountBss: updated.amountBss.toString(),
          paidAt: updated.paidAt, method: updated.method, reference: updated.reference,
          currencyPrimary: updated.currencyPrimary,
        },
      },
    });

    return updated;
  });
}

/**
 * Elimina DEFINITIVAMENTE un pago (a diferencia de voidPayment, que solo lo anula).
 * Pedido explícito del cliente para poder borrar pagos mal registrados/duplicados.
 * Revierte las allocations antes de borrar, y deja un snapshot completo en
 * AuditLog (el registro Payment en sí desaparece, pero queda rastro auditable).
 */
export async function deletePayment(params: {
  organizationId: string;
  paymentId: string;
  reason: string;
  actorId: string;
}) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirstOrThrow({
      where: { id: params.paymentId, organizationId: params.organizationId },
      include: { allocations: true },
    });

    await reverseAllocations(tx, payment.allocations);

    const snapshot = {
      amountUsd: payment.amountUsd.toString(),
      amountBss: payment.amountBss.toString(),
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt,
      unitId: payment.unitId,
      notes: payment.notes,
      currencyPrimary: payment.currencyPrimary,
      voidedAt: payment.voidedAt,
      allocations: payment.allocations.map((a) => ({
        invoiceId: a.invoiceId, amountUsd: a.amountUsd.toString(), amountBss: a.amountBss.toString(),
      })),
    };

    await tx.auditLog.create({
      data: {
        organizationId: params.organizationId,
        actorId: params.actorId,
        action: "DELETE",
        entityType: "Payment",
        entityId: payment.id,
        before: snapshot,
        after: { reason: params.reason, hardDeleted: true },
      },
    });

    // PaymentAllocation tiene onDelete: Cascade — se borran solas con el Payment.
    await tx.payment.delete({ where: { id: payment.id } });
  });
}
