/**
 * Router tRPC — Centro Comercial (Cc* models)
 * Completamente separado del sistema residencial.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Decimal } from "@prisma/client/runtime/library";
import { router, orgProcedure, publicProcedure } from "@/server/trpc/init";
import { getCurrentRate } from "@/server/services/exchange";

const orgIdInput = z.object({ organizationId: z.string() });

// ── Helper: auto-aplicar pagos en anticipo a una nueva factura ────────────────
async function applyAnticipToNewInvoice(
  db: {
    ccInvoice: { findUnique: Function; update: Function };
    ccPayment: { findMany: Function };
    ccPaymentAllocation: { createMany: Function };
  },
  invoiceId: string,
  localId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = await (db.ccInvoice.findUnique as any)({ where: { id: invoiceId } });
  if (!invoice) return;

  let remainingDebt = Number(invoice.totalUsd) - Number(invoice.paidUsd);
  if (remainingDebt <= 0.001) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments = await (db.ccPayment.findMany as any)({
    where: { localId, voidedAt: null },
    include: { allocations: { include: { invoice: { select: { status: true } } } } },
    orderBy: { paidAt: "asc" },
  });

  let totalAppliedUsd = 0;
  const newAllocations: Array<{
    paymentId: string;
    invoiceId: string;
    localId: string;
    amountUsd: number;
    amountBss: number;
  }> = [];

  for (const payment of payments) {
    if (remainingDebt <= 0.001) break;
    // Ignorar allocations de facturas anuladas (pueden quedar huérfanas si void no limpió)
    const totalAllocated = payment.allocations
      .filter((a: { invoice?: { status?: string } }) => a.invoice?.status !== "VOIDED")
      .reduce((s: number, a: { amountUsd: unknown }) => s + Number(a.amountUsd), 0);
    const surplus = Number(payment.amountUsd) - totalAllocated;
    if (surplus <= 0.001) continue;
    const apply = Math.min(surplus, remainingDebt);
    newAllocations.push({
      paymentId: payment.id,
      invoiceId,
      localId,
      amountUsd: apply,
      amountBss: apply * Number(payment.exchangeRate),
    });
    totalAppliedUsd += apply;
    remainingDebt -= apply;
  }

  if (newAllocations.length === 0) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.ccPaymentAllocation.createMany as any)({ data: newAllocations });

  const newPaidUsd = Number(invoice.paidUsd) + totalAppliedUsd;
  const newPaidBss = Number(invoice.paidBss) + totalAppliedUsd * Number(invoice.exchangeRate);
  const newStatus = newPaidUsd >= Number(invoice.totalUsd) - 0.001 ? "PAID" : "PARTIAL";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.ccInvoice.update as any)({
    where: { id: invoiceId },
    data: { paidUsd: newPaidUsd, paidBss: newPaidBss, status: newStatus },
  });
}

export const comercialRouter = router({

  // ── Malls ──────────────────────────────────────────────────────────────
  malls: router({
    list: orgProcedure
      .input(orgIdInput)
      .query(({ ctx, input }) =>
        ctx.db.ccMall.findMany({
          where: { organizationId: input.organizationId, deletedAt: null },
          include: { _count: { select: { locales: true } } },
          orderBy: { name: "asc" },
        }),
      ),

    byId: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string() }))
      .query(async ({ ctx, input }) => {
        const mall = await ctx.db.ccMall.findUniqueOrThrow({
          where: { id: input.mallId },
          include: {
            locales: {
              where: { deletedAt: null },
              include: {
                tenancies: { where: { endDate: null }, take: 1, orderBy: { startDate: "desc" } },
                _count: { select: { invoices: true } },
              },
              orderBy: [{ floor: "asc" }, { code: "asc" }],
            },
          },
        });
        if (mall.organizationId !== input.organizationId)
          throw new TRPCError({ code: "NOT_FOUND" });
        return mall;
      }),

    create: orgProcedure
      .input(
        orgIdInput.extend({
          name: z.string().min(2),
          rif: z.string().optional(),
          address: z.string().min(2),
          city: z.string().min(2),
          state: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional(),
          website: z.string().optional(),
          totalLocales: z.number().int().min(0).default(0),
          floorsCount: z.number().int().positive().optional(),
          openedAt: z.coerce.date().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, ...data } = input;
        return ctx.db.ccMall.create({ data: { ...data, organizationId } });
      }),

    update: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          name: z.string().min(2).optional(),
          rif: z.string().optional().nullable(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional().nullable(),
          phone: z.string().optional().nullable(),
          email: z.string().email().optional().nullable(),
          website: z.string().optional().nullable(),
          totalLocales: z.number().int().min(0).optional(),
          floorsCount: z.number().int().positive().optional().nullable(),
          notes: z.string().optional().nullable(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { mallId, organizationId: _org, ...data } = input;
        return ctx.db.ccMall.update({ where: { id: mallId }, data });
      }),

    /** Métricas del dashboard para un mall: ocupación, renta/m², deuda y ventas del período actual. */
    metrics: orgProcedure
      .input(z.object({ organizationId: z.string(), mallId: z.string() }))
      .query(async ({ ctx, input }) => {
        const { mallId, organizationId } = input;
        const today = new Date();

        const [locals, activeContracts, pendingInvoices, salesDeclarations] = await Promise.all([
          ctx.db.ccLocal.findMany({
            where: { mallId, organizationId, active: true, deletedAt: null },
            select: { id: true, areaM2: true, type: true },
          }),
          ctx.db.ccTenancy.findMany({
            where: {
              local: { mallId, organizationId },
              startDate: { lte: today },
              OR: [{ endDate: null }, { endDate: { gte: today } }],
            },
            select: { id: true, localId: true, canonUsd: true },
          }),
          ctx.db.ccInvoice.findMany({
            where: { mallId, organizationId, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
            select: { totalUsd: true, paidUsd: true },
          }),
          ctx.db.ccSalesDeclaration.findMany({
            where: {
              mallId,
              organizationId,
              periodYear: today.getFullYear(),
              periodMonth: today.getMonth() + 1,
            },
            select: { salesAmountUsd: true },
          }),
        ]);

        const totalLocals = locals.length;
        const occupiedLocalIds = new Set(activeContracts.map((c) => c.localId));
        const occupiedLocals = occupiedLocalIds.size;
        const vacantLocals = totalLocals - occupiedLocals;

        const totalAreaM2 = locals.reduce((s, l) => s + Number(l.areaM2 ?? 0), 0);
        const totalRentUsd = activeContracts.reduce((s, c) => s + Number(c.canonUsd ?? 0), 0);
        const rentPerM2 = totalAreaM2 > 0 ? (totalRentUsd / totalAreaM2).toFixed(2) : "0";

        const totalPending = pendingInvoices.reduce(
          (s, i) => s + Number(i.totalUsd) - Number(i.paidUsd),
          0,
        );
        const totalSales = salesDeclarations.reduce(
          (s, d) => s + Number(d.salesAmountUsd ?? 0),
          0,
        );

        return {
          totalLocals,
          occupiedLocals,
          vacantLocals,
          vacancyRate: totalLocals > 0 ? Number(((vacantLocals / totalLocals) * 100).toFixed(1)) : 0,
          occupancyRate: totalLocals > 0 ? Number(((occupiedLocals / totalLocals) * 100).toFixed(1)) : 0,
          totalAreaM2: totalAreaM2.toFixed(0),
          totalRentUsd: totalRentUsd.toFixed(2),
          rentPerM2,
          pendingDebtUsd: totalPending.toFixed(2),
          monthlySalesUsd: totalSales.toFixed(2),
        };
      }),
  }),

  // ── Locales ─────────────────────────────────────────────────────────────
  locales: router({
    list: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string(), includeInactive: z.boolean().default(false) }))
      .query(async ({ ctx, input }) => {
        const locals = await ctx.db.ccLocal.findMany({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            deletedAt: null,
            ...(input.includeInactive ? {} : { active: true }),
          },
          include: {
            tenancies: { where: { endDate: null }, take: 1, orderBy: { startDate: "desc" } },
            invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true } },
            payments: { where: { voidedAt: null }, select: { amountUsd: true } },
          },
          orderBy: [{ floor: "asc" }, { code: "asc" }],
        });
        return locals.map((l) => {
          const totalInvoicedUsd = l.invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
          const totalPaidUsd = l.payments.reduce((s, p) => s + Number(p.amountUsd), 0);
          const balanceUsd = totalPaidUsd - totalInvoicedUsd; // positivo = saldo a favor, negativo = deuda
          return { ...l, totalInvoicedUsd, totalPaidUsd, balanceUsd };
        });
      }),

    byId: orgProcedure
      .input(orgIdInput.extend({ localId: z.string() }))
      .query(async ({ ctx, input }) => {
        // Aislamiento multi-tenant: filtrar por organizationId en el WHERE.
        // findFirst + check explícito en lugar de findUniqueOrThrow para evitar IDOR.
        const local = await ctx.db.ccLocal.findFirst({
          where: { id: input.localId, organizationId: input.organizationId },
          include: {
            tenancies: { orderBy: { startDate: "desc" } },
            invoices: {
              where: { status: { not: "VOIDED" } },
              orderBy: { issuedAt: "desc" },
              take: 24,
              include: { items: true },
            },
            payments: {
              where: { voidedAt: null },
              orderBy: { paidAt: "desc" },
              take: 20,
              include: {
                allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
              },
            },
            salesDeclarations: {
              orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
              take: 12,
            },
          },
        });
        if (!local) throw new TRPCError({ code: "NOT_FOUND" });
        return local;
      }),

    create: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          code: z.string().min(1),
          type: z.enum(["LOCAL", "ANCORA", "FOOD_COURT", "RESTAURANT", "BANCO", "CINE", "QUIOSCO", "OFICINA", "OTHER"]).default("LOCAL"),
          name: z.string().optional(),
          floor: z.number().int().optional(),
          wing: z.string().optional(),
          areaM2: z.coerce.number().positive().optional(),
          aliquot: z.coerce.number().min(0).max(100).optional(),
          canonType: z.enum(["FIXED", "VARIABLE_SALES", "MIXED"]).default("FIXED"),
          canonUsd: z.coerce.number().nonnegative().optional(),
          salesPct: z.coerce.number().min(0).max(100).optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { organizationId, ...data } = input;
        return ctx.db.ccLocal.create({ data: { ...data, organizationId } });
      }),

    update: orgProcedure
      .input(
        orgIdInput.extend({
          localId: z.string(),
          code: z.string().optional(),
          type: z.enum(["LOCAL", "ANCORA", "FOOD_COURT", "RESTAURANT", "BANCO", "CINE", "QUIOSCO", "OFICINA", "OTHER"]).optional(),
          name: z.string().optional().nullable(),
          floor: z.number().int().optional().nullable(),
          wing: z.string().optional().nullable(),
          areaM2: z.coerce.number().positive().optional().nullable(),
          aliquot: z.coerce.number().min(0).max(100).optional().nullable(),
          canonType: z.enum(["FIXED", "VARIABLE_SALES", "MIXED"]).optional(),
          canonUsd: z.coerce.number().nonnegative().optional().nullable(),
          salesPct: z.coerce.number().min(0).max(100).optional().nullable(),
          notes: z.string().optional().nullable(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { localId, organizationId: _org, ...data } = input;
        return ctx.db.ccLocal.update({ where: { id: localId }, data });
      }),
  }),

  // ── Arrendatarios ────────────────────────────────────────────────────────
  tenancies: router({
    create: orgProcedure
      .input(
        orgIdInput.extend({
          localId: z.string(),
          tenantName: z.string().min(2),
          tenantRif: z.string().optional(),
          tenantEmail: z.string().email().optional(),
          tenantPhone: z.string().optional(),
          tenantContact: z.string().optional(),
          canonType: z.enum(["FIXED", "VARIABLE_SALES", "MIXED"]).default("FIXED"),
          canonUsd: z.coerce.number().nonnegative().optional(),
          salesPct: z.coerce.number().min(0).max(100).optional(),
          startDate: z.coerce.date(),
          endDate: z.coerce.date().optional(),
          depositUsd: z.coerce.number().nonnegative().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, ...data } = input;
        await ctx.db.ccTenancy.updateMany({
          where: { localId: data.localId, endDate: null, organizationId },
          data: { endDate: data.startDate },
        });
        return ctx.db.ccTenancy.create({ data: { ...data, organizationId } });
      }),

    terminate: orgProcedure
      .input(orgIdInput.extend({ tenancyId: z.string(), endDate: z.coerce.date() }))
      .mutation(({ ctx, input }) =>
        ctx.db.ccTenancy.update({
          where: { id: input.tenancyId },
          data: { endDate: input.endDate },
        }),
      ),

    update: orgProcedure
      .input(
        orgIdInput.extend({
          tenancyId: z.string(),
          tenantName: z.string().min(2).optional(),
          tenantRif: z.string().optional().nullable(),
          tenantEmail: z.string().email().optional().nullable(),
          tenantPhone: z.string().optional().nullable(),
          tenantContact: z.string().optional().nullable(),
          canonUsd: z.coerce.number().nonnegative().optional().nullable(),
          salesPct: z.coerce.number().min(0).max(100).optional().nullable(),
          depositUsd: z.coerce.number().nonnegative().optional().nullable(),
          notes: z.string().optional().nullable(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { tenancyId, organizationId: _org, ...data } = input;
        return ctx.db.ccTenancy.update({ where: { id: tenancyId }, data });
      }),

    /** Contratos próximos a vencer en los próximos N días, agrupados en buckets de 30/60/90 días. */
    expiring: orgProcedure
      .input(
        z.object({
          organizationId: z.string(),
          mallId: z.string(),
          daysAhead: z.number().int().min(1).max(365).default(90),
        }),
      )
      .query(async ({ ctx, input }) => {
        const today = new Date();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + input.daysAhead);

        const tenancies = await ctx.db.ccTenancy.findMany({
          where: {
            organizationId: input.organizationId,
            local: { mallId: input.mallId },
            endDate: { not: null, lte: cutoff, gte: today },
          },
          include: {
            local: { select: { id: true, code: true, name: true, floor: true, mallId: true } },
          },
          orderBy: { endDate: "asc" },
        });

        const now = new Date();
        return tenancies.map((t) => {
          const daysLeft = Math.ceil(
            (new Date(t.endDate!).getTime() - now.getTime()) / 86_400_000,
          );
          return {
            id: t.id,
            tenantName: t.tenantName,
            localCode: t.local.code,
            localName: t.local.name ?? t.local.code,
            floorLevel: t.local.floor,
            endDate: t.endDate!.toISOString(),
            daysLeft,
            canonUsd: t.canonUsd?.toString() ?? "0",
            bucket: daysLeft <= 30 ? "30" : daysLeft <= 60 ? "60" : "90",
          };
        });
      }),
  }),

  // ── Gastos ───────────────────────────────────────────────────────────────
  expenses: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.ccExpense.findMany({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            voidedAt: null,
          },
          orderBy: { createdAt: "desc" },
        }),
      ),

    create: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          category: z.enum([
            "ELECTRICIDAD", "DIESEL_PLANTA", "AGUA_CISTERNA", "LIMPIEZA", "SEGURIDAD",
            "HVAC", "ASCENSORES", "MARKETING", "ADMINISTRACION", "MANTENIMIENTO",
            "SEGUROS", "NOMINA_STAFF", "IMPUESTOS", "FONDO_RESERVA", "OTHER",
          ]),
          customCategory: z.string().max(100).optional(),
          description: z.string().min(2).max(500),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
          /** Monto en la moneda primaria. La tasa y conversión se calculan en el server. */
          amount: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          supplierName: z.string().max(200).optional(),
          invoiceNumber: z.string().max(50).optional(),
          /** Fecha del comprobante. Se usa para tomar la tasa de cambio correcta. */
          receiptDate: z.coerce.date().optional(),
          notes: z.string().max(500).optional(),
          isIndividual: z.boolean().default(false),
          targetLocalId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // #4 — Bloqueo: si ya hay facturas no anuladas del período, no permitir gastos prorrateables.
        if (!input.isIndividual) {
          const issued = await ctx.db.ccInvoice.findFirst({
            where: {
              mallId: input.mallId,
              organizationId: input.organizationId,
              periodYear: input.periodYear,
              periodMonth: input.periodMonth,
              status: { not: "VOIDED" },
            },
            select: { id: true },
          });
          if (issued) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Ya se emitieron facturas para ${String(input.periodMonth).padStart(2, "0")}/${input.periodYear}. No se pueden añadir gastos comunes a un período cerrado. Marca el gasto como individual o anula las facturas para re-emitirlas.`,
            });
          }
        }

        // #2 — Tasa de cambio según la fecha del comprobante, no del registro.
        const rate = await getCurrentRate(input.exchangeSource, input.receiptDate ?? new Date());
        const amount = new Decimal(input.amount);
        const isPrimaryUsd = input.currencyPrimary === "USD";
        const amountUsd = isPrimaryUsd ? amount : amount.div(rate.vesPerUsd);
        const amountBss = isPrimaryUsd ? amount.mul(rate.vesPerUsd) : amount;

        const { organizationId, amount: _a, ...rest } = input;
        return ctx.db.ccExpense.create({
          data: {
            ...rest,
            organizationId,
            amountUsd: amountUsd.toFixed(2),
            amountBss: amountBss.toFixed(2),
            exchangeRate: rate.vesPerUsd.toFixed(8),
          },
        });
      }),

    void: orgProcedure
      .input(orgIdInput.extend({ expenseId: z.string(), voidReason: z.string().optional() }))
      .mutation(({ ctx, input }) =>
        ctx.db.ccExpense.update({
          where: { id: input.expenseId },
          data: { voidedAt: new Date(), voidReason: input.voidReason },
        }),
      ),
  }),

  // ── Ingresos ─────────────────────────────────────────────────────────────
  incomes: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.ccIncome.findMany({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            voidedAt: null,
          },
          orderBy: { createdAt: "desc" },
        }),
      ),

    create: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          category: z.enum([
            "PUBLICIDAD_INTERNA", "ALQUILER_ESPACIO", "ESTACIONAMIENTO",
            "PATROCINIOS", "INTERESES", "PENALIDADES", "OTHER",
          ]),
          customCategory: z.string().max(100).optional(),
          description: z.string().min(2).max(500),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
          /** Monto en la moneda primaria. Tasa calculada server-side. */
          amount: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          /** Fecha real del hecho económico (cobro recibido). Se usa para la tasa. */
          receivedAt: z.coerce.date().optional(),
          reference: z.string().max(100).optional(),
          affectsInvoice: z.boolean().default(false),
          notes: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // #2 — Tasa según la fecha del cobro recibido, no del registro.
        const rate = await getCurrentRate(input.exchangeSource, input.receivedAt ?? new Date());
        const amount = new Decimal(input.amount);
        const isPrimaryUsd = input.currencyPrimary === "USD";
        const amountUsd = isPrimaryUsd ? amount : amount.div(rate.vesPerUsd);
        const amountBss = isPrimaryUsd ? amount.mul(rate.vesPerUsd) : amount;

        const { organizationId, amount: _a, ...rest } = input;
        return ctx.db.ccIncome.create({
          data: {
            ...rest,
            organizationId,
            amountUsd: amountUsd.toFixed(2),
            amountBss: amountBss.toFixed(2),
            exchangeRate: rate.vesPerUsd.toFixed(8),
          },
        });
      }),

    void: orgProcedure
      .input(orgIdInput.extend({ incomeId: z.string(), voidReason: z.string().optional() }))
      .mutation(({ ctx, input }) =>
        ctx.db.ccIncome.update({
          where: { id: input.incomeId },
          data: { voidedAt: new Date(), voidReason: input.voidReason },
        }),
      ),
  }),

  // ── Facturas ─────────────────────────────────────────────────────────────
  invoices: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          localId: z.string().optional(),
          periodYear: z.number().int().optional(),
          periodMonth: z.number().int().optional(),
          status: z.enum(["DRAFT", "ISSUED", "PARTIAL", "PAID", "OVERDUE", "VOIDED"]).optional(),
        }),
      )
      .query(({ ctx, input }) => {
        const { organizationId, mallId, localId, periodYear, periodMonth, status } = input;
        return ctx.db.ccInvoice.findMany({
          where: {
            organizationId,
            mallId,
            ...(localId ? { localId } : {}),
            ...(periodYear ? { periodYear } : {}),
            ...(periodMonth ? { periodMonth } : {}),
            ...(status ? { status } : {}),
          },
          include: {
            local: { select: { code: true, name: true } },
            items: true,
          },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { local: { code: "asc" } }],
        });
      }),

    issueCanon: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          localId: z.string(),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
          /** Monto en moneda primaria. Tasa calculada server-side. */
          amount: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          type: z.enum(["CANON", "CANON_SALES", "ALIQUOT", "EXTRA_FEE", "FINE", "OTHER"]).default("CANON"),
          description: z.string().default("Canon de arrendamiento"),
          dueDaysAfterIssue: z.number().int().min(1).default(5),
          notes: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const dueDate = new Date(now.getTime() + input.dueDaysAfterIssue * 24 * 60 * 60 * 1000);

        // #2 — Tasa según fecha de emisión (hoy).
        const rate = await getCurrentRate(input.exchangeSource, now);
        const amount = new Decimal(input.amount);
        const isPrimaryUsd = input.currencyPrimary === "USD";
        const amountUsd = isPrimaryUsd ? amount : amount.div(rate.vesPerUsd);
        const amountBss = isPrimaryUsd ? amount.mul(rate.vesPerUsd) : amount;

        const count = await ctx.db.ccInvoice.count({ where: { mallId: input.mallId } });
        const invoiceNumber = `${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}-${String(count + 1).padStart(4, "0")}`;

        const invoice = await ctx.db.ccInvoice.create({
          data: {
            organizationId: input.organizationId,
            mallId: input.mallId,
            localId: input.localId,
            invoiceNumber,
            type: input.type,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            issuedAt: now,
            dueDate,
            totalBss: amountBss.toFixed(2),
            totalUsd: amountUsd.toFixed(2),
            exchangeRate: rate.vesPerUsd.toFixed(8),
            exchangeSource: input.exchangeSource,
            currencyPrimary: input.currencyPrimary,
            notes: input.notes,
            items: {
              create: {
                description: input.description,
                amountBss: amountBss.toFixed(2),
                amountUsd: amountUsd.toFixed(2),
              },
            },
          },
          include: { items: true, local: { select: { code: true, name: true } } },
        });

        // Auto-aplicar anticipo existente a la nueva factura
        await applyAnticipToNewInvoice(ctx.db, invoice.id, input.localId);
        return invoice;
      }),

    // Emitir canon a TODOS los locales activos del mall de un período
    /**
     * #3 — Vista previa de emisión: lista cada local con canon activo y su monto
     * a facturar para el período, sin crear nada. Usado por el wizard antes de
     * confirmar la emisión masiva.
     */
    previewMonth: orgProcedure
      .input(orgIdInput.extend({
        mallId: z.string(),
        periodYear: z.number().int(),
        periodMonth: z.number().int().min(1).max(12),
      }))
      .query(async ({ ctx, input }) => {
        // 1. Detectar si ya hay facturas no anuladas del período (bloqueo)
        const existing = await ctx.db.ccInvoice.count({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            type: { in: ["CANON", "CANON_SALES"] },
            status: { not: "VOIDED" },
          },
        });
        const alreadyIssued = existing > 0;

        // 2. Locales con tenancy activa y canon fijo/mixto
        const locales = await ctx.db.ccLocal.findMany({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            active: true,
            deletedAt: null,
            canonType: { in: ["FIXED", "MIXED"] },
            tenancies: { some: { endDate: null } },
          },
          include: {
            tenancies: {
              where: { endDate: null },
              take: 1,
              select: { tenantName: true, tenantEmail: true },
            },
          },
          orderBy: [{ floor: "asc" }, { code: "asc" }],
        });

        // 3. Tasa para hoy (sirve como referencia visual; la real se aplica al emitir)
        const rate = await getCurrentRate("BCV", new Date());

        const rows = locales
          .filter((l) => l.canonUsd && Number(l.canonUsd) > 0)
          .map((l) => {
            const canonUsd = new Decimal(l.canonUsd!.toString());
            const canonBss = canonUsd.mul(rate.vesPerUsd);
            return {
              localId: l.id,
              code: l.code,
              name: l.name ?? null,
              floor: l.floor ?? null,
              tenantName: l.tenancies[0]?.tenantName ?? "(sin contrato activo)",
              canonUsd: canonUsd.toFixed(2),
              canonBss: canonBss.toFixed(2),
            };
          });

        const totalUsd = rows.reduce((s, r) => s.plus(r.canonUsd), new Decimal(0));
        const totalBss = rows.reduce((s, r) => s.plus(r.canonBss), new Decimal(0));

        return {
          period: { year: input.periodYear, month: input.periodMonth },
          alreadyIssued,
          rate: rate.vesPerUsd.toFixed(4),
          rateDate: rate.date.toISOString().slice(0, 10),
          rows,
          summary: {
            localesToInvoice: rows.length,
            totalUsd: totalUsd.toFixed(2),
            totalBss: totalBss.toFixed(2),
          },
        };
      }),

    bulkIssueCanon: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          dueDaysAfterIssue: z.number().int().min(1).default(5),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // #3 — Bloquear si ya hay facturas no anuladas del período.
        const existingCount = await ctx.db.ccInvoice.count({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            type: { in: ["CANON", "CANON_SALES"] },
            status: { not: "VOIDED" },
          },
        });
        if (existingCount > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya se emitieron facturas para ${String(input.periodMonth).padStart(2, "0")}/${input.periodYear}. Anula las facturas existentes para re-emitirlas.`,
          });
        }

        // #2 — Tasa según la fecha de emisión (hoy), calculada server-side.
        const issuedAtRate = await getCurrentRate(input.exchangeSource, new Date());
        const exchangeRateNum = Number(issuedAtRate.vesPerUsd.toString());
        // Obtener locales con arrendatario activo y canon fijo o mixto
        const locales = await ctx.db.ccLocal.findMany({
          where: {
            mallId: input.mallId,
            active: true,
            deletedAt: null,
            canonType: { in: ["FIXED", "MIXED"] },
            tenancies: { some: { endDate: null } },
          },
          include: { tenancies: { where: { endDate: null }, take: 1 } },
        });

        // Datos del mall (una sola consulta antes del loop)
        const mall = await ctx.db.ccMall.findUniqueOrThrow({
          where: { id: input.mallId },
          select: { name: true, address: true, phone: true, email: true },
        });

        const now = new Date();
        const dueDate = new Date(now.getTime() + input.dueDaysAfterIssue * 24 * 60 * 60 * 1000);
        const results = { issued: 0, skipped: 0, errors: 0, emailsSent: 0 };

        for (const local of locales) {
          if (!local.canonUsd || Number(local.canonUsd) <= 0) { results.skipped++; continue; }

          // No duplicar si ya existe factura CANON para este período+local
          const existing = await ctx.db.ccInvoice.findFirst({
            where: {
              localId: local.id,
              periodYear: input.periodYear,
              periodMonth: input.periodMonth,
              type: { in: ["CANON", "CANON_SALES"] },
              status: { not: "VOIDED" },
            },
          });
          if (existing) { results.skipped++; continue; }

          try {
            const count = await ctx.db.ccInvoice.count({ where: { mallId: input.mallId } });
            const invoiceNumber = `${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}-${String(count + 1).padStart(4, "0")}`;
            const amountUsd = Number(local.canonUsd);
            const amountBss = amountUsd * exchangeRateNum;
            const description = `Canon de arrendamiento — ${new Date(input.periodYear, input.periodMonth - 1).toLocaleDateString("es-VE", { month: "long", year: "numeric" })}`;

            const createdInvoice = await ctx.db.ccInvoice.create({
              data: {
                organizationId: input.organizationId,
                mallId: input.mallId,
                localId: local.id,
                invoiceNumber,
                type: "CANON",
                periodYear: input.periodYear,
                periodMonth: input.periodMonth,
                issuedAt: now,
                dueDate,
                totalBss: amountBss,
                totalUsd: amountUsd,
                exchangeRate: exchangeRateNum,
                exchangeSource: input.exchangeSource,
                currencyPrimary: "USD",
                items: {
                  create: { description, amountBss, amountUsd },
                },
              },
            });
            // Auto-aplicar anticipo existente a la nueva factura
            await applyAnticipToNewInvoice(ctx.db, createdInvoice.id, local.id);
            results.issued++;

            // Email automático al arrendatario (silencioso: no rompe el batch si falla)
            const tenancy = local.tenancies[0];
            if (tenancy?.tenantEmail) {
              try {
                const { buildCcInvoiceEmail, sendEmail } = await import("@/server/services/email");
                const emailData = buildCcInvoiceEmail({
                  mallName: mall.name,
                  mallAddress: mall.address ?? undefined,
                  mallPhone: mall.phone ?? undefined,
                  mallEmail: mall.email ?? undefined,
                  tenantName: tenancy.tenantName,
                  localCode: local.code,
                  localName: local.name,
                  invoiceNumber,
                  periodYear: input.periodYear,
                  periodMonth: input.periodMonth,
                  issuedAt: now,
                  dueDate,
                  type: "CANON",
                  items: [{ description, amountUsd: String(amountUsd), amountBss: String(amountBss) }],
                  totalUsd: String(amountUsd),
                  totalBss: String(amountBss),
                  paidUsd: "0",
                  exchangeRate: String(exchangeRateNum),
                  status: "ISSUED",
                });
                await sendEmail({ to: tenancy.tenantEmail, subject: emailData.subject, html: emailData.html, text: emailData.text });
                results.emailsSent++;
              } catch {
                // Email failure no cancela la emisión
              }
            }
          } catch {
            results.errors++;
          }
        }

        return results;
      }),

    void: orgProcedure
      .input(orgIdInput.extend({
        invoiceId: z.string(),
        voidReason: z.string().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        // Aislamiento multi-tenant: validar que la factura pertenece a la org del actor.
        const invoice = await ctx.db.ccInvoice.findFirst({
          where: { id: input.invoiceId, organizationId: input.organizationId },
          select: { localId: true, status: true },
        });
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

        // 1. Eliminar allocations vinculadas a esta factura → libera el anticipo de los pagos
        await ctx.db.ccPaymentAllocation.deleteMany({ where: { invoiceId: input.invoiceId } });

        // 2. Anular la factura (paidUsd/paidBss a 0 porque las allocations ya no existen)
        await ctx.db.ccInvoice.update({
          where: { id: input.invoiceId },
          data: { status: "VOIDED", voidedAt: new Date(), voidReason: input.voidReason, paidUsd: 0, paidBss: 0 },
        });

        // 3. Re-aplicar el anticipo liberado a otras facturas pendientes del mismo local
        const pendingInvoices = await ctx.db.ccInvoice.findMany({
          where: {
            localId: invoice.localId,
            organizationId: input.organizationId, // multi-tenant lock
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
          },
          orderBy: { dueDate: "asc" },
        });
        for (const pending of pendingInvoices) {
          await applyAnticipToNewInvoice(ctx.db, pending.id, invoice.localId);
        }

        return { success: true };
      }),

    /** Genera PDF de la factura CC y lo devuelve como base64. */
    downloadPdf: orgProcedure
      .input(orgIdInput.extend({ invoiceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const inv = await ctx.db.ccInvoice.findFirstOrThrow({
          where: { id: input.invoiceId, organizationId: input.organizationId },
          include: {
            items: true,
            local: { select: { code: true, name: true, floor: true } },
          },
        });

        // Datos del mall
        const mall = await ctx.db.ccMall.findUniqueOrThrow({
          where: { id: inv.mallId },
          select: { name: true, address: true, rif: true, phone: true, email: true, city: true, notes: true },
        });

        // Arrendatario activo del local al momento de la factura
        const tenancy = await ctx.db.ccTenancy.findFirst({
          where: {
            localId: inv.localId,
            startDate: { lte: inv.issuedAt },
            OR: [{ endDate: null }, { endDate: { gte: inv.issuedAt } }],
          },
          orderBy: { startDate: "desc" },
        });

        const { generateCcInvoicePdf } = await import("@/server/services/pdf");

        const buffer = await generateCcInvoicePdf({
          mallName: mall.name,
          mallAddress: mall.address,
          mallRif: mall.rif,
          mallPhone: mall.phone,
          mallEmail: mall.email,
          mallCity: mall.city,
          invoiceNumber: inv.invoiceNumber,
          periodYear: inv.periodYear,
          periodMonth: inv.periodMonth,
          issuedAt: inv.issuedAt,
          dueDate: inv.dueDate,
          status: inv.status,
          type: inv.type,
          exchangeRate: inv.exchangeRate.toString(),
          localCode: inv.local.code,
          localName: inv.local.name,
          localFloor: inv.local.floor,
          tenantName: tenancy?.tenantName ?? null,
          tenantRif: tenancy?.tenantRif ?? null,
          tenantPhone: tenancy?.tenantPhone ?? null,
          tenantEmail: tenancy?.tenantEmail ?? null,
          items: inv.items.map((it) => ({
            description: it.description,
            amountUsd: it.amountUsd.toString(),
            amountBss: it.amountBss.toString(),
          })),
          totalUsd: inv.totalUsd.toString(),
          totalBss: inv.totalBss.toString(),
          paidUsd: inv.paidUsd.toString(),
          paidBss: inv.paidBss.toString(),
          notes: inv.notes,
          paymentInstructions: mall.notes,
        });

        return {
          base64: buffer.toString("base64"),
          fileName: `Factura-CC-${inv.invoiceNumber}.pdf`,
        };
      }),

    /** Envía la factura CC por email al arrendatario. */
    sendByEmail: orgProcedure
      .input(orgIdInput.extend({ invoiceId: z.string(), overrideEmail: z.string().email().optional() }))
      .mutation(async ({ ctx, input }) => {
        const inv = await ctx.db.ccInvoice.findFirstOrThrow({
          where: { id: input.invoiceId, organizationId: input.organizationId },
          include: { items: true, local: { select: { code: true, name: true } } },
        });

        const [mall, tenancy] = await Promise.all([
          ctx.db.ccMall.findUniqueOrThrow({
            where: { id: inv.mallId },
            select: { name: true, address: true, rif: true, phone: true, email: true },
          }),
          ctx.db.ccTenancy.findFirst({
            where: {
              localId: inv.localId,
              startDate: { lte: inv.issuedAt },
              OR: [{ endDate: null }, { endDate: { gte: inv.issuedAt } }],
            },
            orderBy: { startDate: "desc" },
          }),
        ]);

        const toEmail = input.overrideEmail ?? tenancy?.tenantEmail;
        if (!toEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "El arrendatario no tiene email registrado" });

        const { buildCcInvoiceEmail } = await import("@/server/services/email");
        const { sendEmail } = await import("@/server/services/email");

        const emailData = buildCcInvoiceEmail({
          mallName: mall.name,
          mallAddress: mall.address,
          mallPhone: mall.phone ?? undefined,
          mallEmail: mall.email ?? undefined,
          tenantName: tenancy?.tenantName ?? "Arrendatario",
          localCode: inv.local.code,
          localName: inv.local.name,
          invoiceNumber: inv.invoiceNumber,
          periodYear: inv.periodYear,
          periodMonth: inv.periodMonth,
          issuedAt: inv.issuedAt,
          dueDate: inv.dueDate,
          type: inv.type,
          items: inv.items.map((it) => ({
            description: it.description,
            amountUsd: it.amountUsd.toString(),
            amountBss: it.amountBss.toString(),
          })),
          totalUsd: inv.totalUsd.toString(),
          totalBss: inv.totalBss.toString(),
          paidUsd: inv.paidUsd.toString(),
          exchangeRate: inv.exchangeRate.toString(),
          status: inv.status,
          notes: inv.notes,
        });

        const result = await sendEmail({ to: toEmail, subject: emailData.subject, html: emailData.html, text: emailData.text });
        if (!result.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error ?? "Error al enviar email" });

        return { sent: true, to: toEmail };
      }),

    // Marcar como OVERDUE las que ya vencieron (usado por cron)
    markOverdue: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const result = await ctx.db.ccInvoice.updateMany({
          where: {
            organizationId: input.organizationId,
            ...(input.mallId ? { mallId: input.mallId } : {}),
            status: { in: ["ISSUED", "PARTIAL"] },
            dueDate: { lt: now },
          },
          data: { status: "OVERDUE" },
        });
        return { count: result.count };
      }),
  }),

  // ── Pagos ────────────────────────────────────────────────────────────────
  payments: router({
    list: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string(), localId: z.string().optional(), take: z.number().int().min(1).max(200).default(50) }))
      .query(({ ctx, input }) =>
        ctx.db.ccPayment.findMany({
          where: {
            organizationId: input.organizationId,
            mallId: input.mallId,
            ...(input.localId ? { localId: input.localId } : {}),
            voidedAt: null,
          },
          include: {
            local: { select: { code: true, name: true } },
            allocations: {
              include: {
                invoice: { select: { invoiceNumber: true, periodYear: true, periodMonth: true } },
              },
            },
          },
          orderBy: { paidAt: "desc" },
          take: input.take,
        }),
      ),

    record: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          localId: z.string(),
          /** Monto en la moneda primaria. Tasa y conversión se calculan server-side desde paidAt. */
          amount: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          method: z.enum(["CASH_BSS", "CASH_USD", "TRANSFER_BSS", "TRANSFER_USD", "ZELLE", "PAGO_MOVIL", "CRYPTO", "CHECK", "OTHER"]),
          reference: z.string().max(100).optional(),
          paidAt: z.coerce.date(),
          notes: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // #7 — Referencia obligatoria para métodos bancarios.
        const METHODS_REQUIRING_REFERENCE = ["TRANSFER_BSS", "TRANSFER_USD", "ZELLE", "PAGO_MOVIL", "CHECK"] as const;
        if ((METHODS_REQUIRING_REFERENCE as readonly string[]).includes(input.method)) {
          const ref = input.reference?.trim();
          if (!ref) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `El número de referencia es obligatorio para pagos por ${input.method.replace("_", " ").toLowerCase()}.`,
            });
          }
        }

        // #2 — Tasa de cambio según la fecha real del pago.
        const rate = await getCurrentRate(input.exchangeSource, input.paidAt);
        const amount = new Decimal(input.amount);
        const isPrimaryUsd = input.currencyPrimary === "USD";
        const amountUsd = isPrimaryUsd ? amount : amount.div(rate.vesPerUsd);
        const amountBss = isPrimaryUsd ? amount.mul(rate.vesPerUsd) : amount;

        // #11 — Auto-asignación FIFO por fecha de vencimiento (la más antigua primero).
        const pendingInvoices = await ctx.db.ccInvoice.findMany({
          where: {
            organizationId: input.organizationId,
            localId: input.localId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
          },
          orderBy: { dueDate: "asc" },
        });

        let remaining = amountUsd;
        const allocations: Array<{ invoiceId: string; localId: string; amountBss: string; amountUsd: string }> = [];
        for (const inv of pendingInvoices) {
          if (remaining.lte(0)) break;
          const pendingUsd = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
          if (pendingUsd.lte(0)) continue;
          const apply = Decimal.min(remaining, pendingUsd);
          const applyBss = apply.mul(rate.vesPerUsd);
          allocations.push({
            invoiceId: inv.id,
            localId: input.localId,
            amountUsd: apply.toFixed(2),
            amountBss: applyBss.toFixed(2),
          });
          remaining = remaining.minus(apply);
        }

        const { organizationId, amount: _a, ...rest } = input;
        const payment = await ctx.db.ccPayment.create({
          data: {
            ...rest,
            organizationId,
            amountUsd: amountUsd.toFixed(2),
            amountBss: amountBss.toFixed(2),
            exchangeRate: rate.vesPerUsd.toFixed(8),
            allocations: { create: allocations },
          },
          include: { local: { select: { code: true, name: true } } },
        });

        for (const alloc of allocations) {
          const inv = pendingInvoices.find((i) => i.id === alloc.invoiceId)!;
          const newPaidUsd = new Decimal(inv.paidUsd.toString()).plus(alloc.amountUsd);
          const newPaidBss = new Decimal(inv.paidBss.toString()).plus(alloc.amountBss);
          const newStatus =
            newPaidUsd.gte(new Decimal(inv.totalUsd.toString()).minus("0.001")) ? "PAID"
            : newPaidUsd.gt(0) ? "PARTIAL"
            : "ISSUED";
          await ctx.db.ccInvoice.update({
            where: { id: inv.id },
            data: { paidUsd: newPaidUsd.toFixed(2), paidBss: newPaidBss.toFixed(2), status: newStatus },
          });
        }

        return payment;
      }),

    void: orgProcedure
      .input(orgIdInput.extend({ paymentId: z.string(), voidReason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        // Revertir allocations: restar paidUsd/paidBss de cada factura afectada
        const payment = await ctx.db.ccPayment.findUniqueOrThrow({
          where: { id: input.paymentId },
          include: {
            allocations: {
              include: { invoice: true },
            },
          },
        });

        for (const alloc of payment.allocations) {
          const inv = alloc.invoice;
          const newPaidUsd = Math.max(0, Number(inv.paidUsd) - Number(alloc.amountUsd));
          const newPaidBss = Math.max(0, Number(inv.paidBss) - Number(alloc.amountBss));
          const newStatus =
            newPaidUsd <= 0 ? (new Date(inv.dueDate) < new Date() ? "OVERDUE" : "ISSUED")
            : "PARTIAL";
          await ctx.db.ccInvoice.update({
            where: { id: inv.id },
            data: { paidUsd: newPaidUsd, paidBss: newPaidBss, status: newStatus },
          });
        }

        return ctx.db.ccPayment.update({
          where: { id: input.paymentId },
          data: { voidedAt: new Date(), voidReason: input.voidReason },
        });
      }),

    /** #9 — Saldo a favor (anticipo) del local: suma de pagos no asignados a facturas. */
    localBalance: orgProcedure
      .input(orgIdInput.extend({ localId: z.string() }))
      .query(async ({ ctx, input }) => {
        const payments = await ctx.db.ccPayment.findMany({
          where: {
            organizationId: input.organizationId,
            localId: input.localId,
            voidedAt: null,
          },
          select: {
            amountUsd: true,
            amountBss: true,
            allocations: { select: { amountUsd: true, amountBss: true } },
          },
        });
        let creditUsd = new Decimal(0);
        let creditBss = new Decimal(0);
        for (const p of payments) {
          const allocUsd = p.allocations.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
          const allocBss = p.allocations.reduce((s, a) => s.plus(a.amountBss.toString()), new Decimal(0));
          const remUsd = new Decimal(p.amountUsd.toString()).minus(allocUsd);
          const remBss = new Decimal(p.amountBss.toString()).minus(allocBss);
          if (remUsd.gt(0)) creditUsd = creditUsd.plus(remUsd);
          if (remBss.gt(0)) creditBss = creditBss.plus(remBss);
        }
        return {
          creditUsd: creditUsd.toFixed(2),
          creditBss: creditBss.toFixed(2),
        };
      }),

    /**
     * #9 — Aplicar el saldo a favor (anticipos no asignados) a las facturas pendientes
     * más antiguas del local (FIFO por dueDate). Genera PaymentAllocation por cada match.
     */
    applyLocalCredit: orgProcedure
      .input(orgIdInput.extend({ localId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // 1. Pagos del local con saldo no asignado
        const payments = await ctx.db.ccPayment.findMany({
          where: {
            organizationId: input.organizationId,
            localId: input.localId,
            voidedAt: null,
          },
          include: { allocations: { select: { amountBss: true, amountUsd: true } } },
          orderBy: { paidAt: "asc" },
        });

        // 2. Facturas pendientes ordenadas por dueDate ASC (FIFO)
        const pendingInvoices = await ctx.db.ccInvoice.findMany({
          where: {
            organizationId: input.organizationId,
            localId: input.localId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
          },
          orderBy: { dueDate: "asc" },
        });

        let creditUsd = new Decimal(0);
        const paymentsWithCredit: Array<{ id: string; creditUsd: Decimal; rate: Decimal }> = [];
        for (const p of payments) {
          const allocUsd = p.allocations.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
          const rem = new Decimal(p.amountUsd.toString()).minus(allocUsd);
          if (rem.gt(0)) {
            paymentsWithCredit.push({
              id: p.id,
              creditUsd: rem,
              rate: new Decimal(p.exchangeRate.toString()),
            });
            creditUsd = creditUsd.plus(rem);
          }
        }

        if (creditUsd.lte(0) || pendingInvoices.length === 0) {
          return { applied: 0, totalAppliedUsd: "0.00", invoicesUpdated: 0 };
        }

        let appliedCount = 0;
        let totalApplied = new Decimal(0);
        const invoicesUpdated = new Set<string>();

        for (const pay of paymentsWithCredit) {
          let remaining = pay.creditUsd;
          for (const inv of pendingInvoices) {
            if (remaining.lte(0)) break;
            const pendingUsd = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
            if (pendingUsd.lte(0)) continue;
            const toApply = Decimal.min(remaining, pendingUsd);
            const toApplyBss = toApply.mul(pay.rate);

            await ctx.db.ccPaymentAllocation.create({
              data: {
                paymentId: pay.id,
                invoiceId: inv.id,
                localId: input.localId,
                amountUsd: toApply.toFixed(2),
                amountBss: toApplyBss.toFixed(2),
              },
            });

            // Actualizar paidUsd/paidBss/status de la factura
            const updatedAllocs = await ctx.db.ccPaymentAllocation.findMany({
              where: { invoiceId: inv.id },
              select: { amountUsd: true, amountBss: true },
            });
            const newPaidUsd = updatedAllocs.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
            const newPaidBss = updatedAllocs.reduce((s, a) => s.plus(a.amountBss.toString()), new Decimal(0));
            const newStatus =
              newPaidUsd.gte(new Decimal(inv.totalUsd.toString()).minus("0.001")) ? "PAID"
              : newPaidUsd.gt(0) ? "PARTIAL"
              : "ISSUED";
            await ctx.db.ccInvoice.update({
              where: { id: inv.id },
              data: {
                paidUsd: newPaidUsd.toFixed(2),
                paidBss: newPaidBss.toFixed(2),
                status: newStatus,
              },
            });

            // Reflejar en memoria para próxima iteración del mismo `pendingInvoices`
            inv.paidUsd = newPaidUsd as never;
            inv.paidBss = newPaidBss as never;

            appliedCount++;
            invoicesUpdated.add(inv.id);
            totalApplied = totalApplied.plus(toApply);
            remaining = remaining.minus(toApply);
          }
        }

        return {
          applied: appliedCount,
          totalAppliedUsd: totalApplied.toFixed(2),
          invoicesUpdated: invoicesUpdated.size,
        };
      }),
  }),

  // ── Declaraciones de ventas ──────────────────────────────────────────────
  salesDeclarations: router({
    list: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string(), localId: z.string().optional() }))
      .query(({ ctx, input }) =>
        ctx.db.ccSalesDeclaration.findMany({
          where: {
            organizationId: input.organizationId,
            mallId: input.mallId,
            ...(input.localId ? { localId: input.localId } : {}),
          },
          include: { local: { select: { code: true, name: true } } },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
        }),
      ),

    upsert: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          localId: z.string(),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
          salesAmountBss: z.coerce.number().nonnegative(),
          salesAmountUsd: z.coerce.number().nonnegative(),
          exchangeRate: z.coerce.number().positive(),
          evidenceUrl: z.string().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { organizationId, localId, periodYear, periodMonth, ...data } = input;
        return ctx.db.ccSalesDeclaration.upsert({
          where: { localId_periodYear_periodMonth: { localId, periodYear, periodMonth } },
          create: { organizationId, localId, periodYear, periodMonth, ...data },
          update: data,
        });
      }),

    verify: orgProcedure
      .input(orgIdInput.extend({ declarationId: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db.ccSalesDeclaration.update({
          where: { id: input.declarationId },
          data: { verified: true, verifiedAt: new Date(), verifiedById: ctx.user.id },
        }),
      ),

    /** Calcula el canon variable (CAV/CAM) a partir de una declaración de ventas. */
    calculateVariableCanon: orgProcedure
      .input(
        z.object({
          organizationId: z.string(),
          mallId: z.string(),
          declarationId: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const decl = await ctx.db.ccSalesDeclaration.findFirst({
          where: { id: input.declarationId, organizationId: input.organizationId, mallId: input.mallId },
          include: { local: true },
        });
        if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaración no encontrada" });

        // Obtener la tenencia activa del local (endDate null o en el futuro)
        const tenancy = await ctx.db.ccTenancy.findFirst({
          where: {
            localId: decl.localId,
            startDate: { lte: new Date() },
            OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
          },
          orderBy: { startDate: "desc" },
        });
        if (!tenancy) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sin contrato activo para este local" });
        }

        const totalSalesUsd = Number(decl.salesAmountUsd);
        const percentOfSales = Number(tenancy.salesPct ?? 0);
        const canonFijoUsd = Number(tenancy.canonUsd ?? 0);
        let calculatedCanonUsd = 0;

        if (tenancy.canonType === "VARIABLE_SALES") {
          calculatedCanonUsd = totalSalesUsd * (percentOfSales / 100);
        } else if (tenancy.canonType === "MIXED") {
          const variable = totalSalesUsd * (percentOfSales / 100);
          calculatedCanonUsd = Math.max(canonFijoUsd, variable);
        } else {
          calculatedCanonUsd = canonFijoUsd;
        }

        return {
          canonType: tenancy.canonType,
          totalSalesUsd: decl.salesAmountUsd.toString(),
          percentOfSales: tenancy.salesPct?.toString() ?? "0",
          canonFijoUsd: tenancy.canonUsd?.toString() ?? "0",
          calculatedCanonUsd: calculatedCanonUsd.toFixed(2),
        };
      }),
  }),

  // ── Reportes ─────────────────────────────────────────────────────────────
  reports: router({
    // Tendencia financiera: N meses de gastos, ingresos extra y pagos recibidos
    financialTrend: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string(), months: z.number().int().min(1).max(24).default(12) }))
      .query(async ({ ctx, input }) => {
        const now = new Date();
        const result = [];

        for (let i = input.months - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const year = d.getFullYear();
          const month = d.getMonth() + 1;

          const [expenses, incomes, payments] = await Promise.all([
            ctx.db.ccExpense.aggregate({
              where: { mallId: input.mallId, periodYear: year, periodMonth: month, voidedAt: null },
              _sum: { amountUsd: true },
            }),
            ctx.db.ccIncome.aggregate({
              where: { mallId: input.mallId, periodYear: year, periodMonth: month, voidedAt: null },
              _sum: { amountUsd: true },
            }),
            ctx.db.ccPayment.aggregate({
              where: {
                mallId: input.mallId,
                voidedAt: null,
                paidAt: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) },
              },
              _sum: { amountUsd: true },
            }),
          ]);

          result.push({
            year,
            month,
            label: new Date(year, month - 1).toLocaleDateString("es-VE", { month: "short", year: "2-digit" }),
            expensesUsd: Number(expenses._sum.amountUsd ?? 0),
            incomesUsd: Number(incomes._sum.amountUsd ?? 0),
            paymentsUsd: Number(payments._sum.amountUsd ?? 0),
          });
        }

        return result;
      }),

    // Aging de cartera
    aging: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string() }))
      .query(async ({ ctx, input }) => {
        const now = new Date();
        const invoices = await ctx.db.ccInvoice.findMany({
          where: {
            mallId: input.mallId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
          },
          include: { local: { select: { code: true, name: true } } },
          orderBy: { dueDate: "asc" },
        });

        const buckets = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
        const details: Array<{
          localCode: string; localName: string | null;
          invoiceNumber: string; dueDate: Date;
          pendingUsd: number; daysPast: number;
        }> = [];

        for (const inv of invoices) {
          const pending = Number(inv.totalUsd) - Number(inv.paidUsd);
          if (pending <= 0) continue;
          const daysPast = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24));

          if (daysPast <= 0) buckets.current += pending;
          else if (daysPast <= 30) buckets.days30 += pending;
          else if (daysPast <= 60) buckets.days60 += pending;
          else if (daysPast <= 90) buckets.days90 += pending;
          else buckets.over90 += pending;

          details.push({
            localCode: inv.local.code,
            localName: inv.local.name,
            invoiceNumber: inv.invoiceNumber,
            dueDate: inv.dueDate,
            pendingUsd: pending,
            daysPast: Math.max(0, daysPast),
          });
        }

        const totalUsd = Object.values(buckets).reduce((a, b) => a + b, 0);
        return { buckets, details, totalUsd };
      }),

    // Exportar facturas para Excel
    exportInvoices: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          periodYear: z.number().int().optional(),
          periodMonth: z.number().int().optional(),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.ccInvoice.findMany({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            ...(input.periodYear ? { periodYear: input.periodYear } : {}),
            ...(input.periodMonth ? { periodMonth: input.periodMonth } : {}),
            status: { not: "VOIDED" },
          },
          include: {
            local: { select: { code: true, name: true, aliquot: true } },
            items: true,
          },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { local: { code: "asc" } }],
        }),
      ),

    // Exportar pagos para Excel
    exportPayments: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.ccPayment.findMany({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            voidedAt: null,
            ...((input.from ?? input.to) ? {
              paidAt: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lte: input.to } : {}),
              },
            } : {}),
          },
          include: {
            local: { select: { code: true, name: true } },
            allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
          },
          orderBy: { paidAt: "desc" },
        }),
      ),

    // Resumen general del mall
    summary: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string() }))
      .query(async ({ ctx, input }) => {
        const now = new Date();
        const thisYear = now.getFullYear();
        const thisMonth = now.getMonth() + 1;

        const [
          totalLocales, occupiedLocales,
          expensesThisMonth, incomesThisMonth,
          paymentsThisMonth, pendingInvoices,
          expensesYTD, paymentsYTD,
        ] = await Promise.all([
          ctx.db.ccLocal.count({ where: { mallId: input.mallId, deletedAt: null } }),
          ctx.db.ccLocal.count({ where: { mallId: input.mallId, active: true, deletedAt: null, tenancies: { some: { endDate: null } } } }),
          ctx.db.ccExpense.aggregate({ where: { mallId: input.mallId, periodYear: thisYear, periodMonth: thisMonth, voidedAt: null }, _sum: { amountUsd: true } }),
          ctx.db.ccIncome.aggregate({ where: { mallId: input.mallId, periodYear: thisYear, periodMonth: thisMonth, voidedAt: null }, _sum: { amountUsd: true } }),
          ctx.db.ccPayment.aggregate({ where: { mallId: input.mallId, voidedAt: null, paidAt: { gte: new Date(thisYear, thisMonth - 1, 1) } }, _sum: { amountUsd: true } }),
          ctx.db.ccInvoice.aggregate({ where: { mallId: input.mallId, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } }, _sum: { totalUsd: true, paidUsd: true }, _count: { id: true } }),
          ctx.db.ccExpense.aggregate({ where: { mallId: input.mallId, periodYear: thisYear, voidedAt: null }, _sum: { amountUsd: true } }),
          ctx.db.ccPayment.aggregate({ where: { mallId: input.mallId, voidedAt: null, paidAt: { gte: new Date(thisYear, 0, 1) } }, _sum: { amountUsd: true } }),
        ]);

        return {
          totalLocales,
          occupiedLocales,
          occupancyPct: totalLocales > 0 ? Math.round(occupiedLocales / totalLocales * 100) : 0,
          expensesThisMonthUsd: Number(expensesThisMonth._sum.amountUsd ?? 0),
          incomesThisMonthUsd: Number(incomesThisMonth._sum.amountUsd ?? 0),
          paymentsThisMonthUsd: Number(paymentsThisMonth._sum.amountUsd ?? 0),
          pendingDebtUsd: Number(pendingInvoices._sum.totalUsd ?? 0) - Number(pendingInvoices._sum.paidUsd ?? 0),
          pendingCount: pendingInvoices._count.id,
          expensesYTDUsd: Number(expensesYTD._sum.amountUsd ?? 0),
          paymentsYTDUsd: Number(paymentsYTD._sum.amountUsd ?? 0),
        };
      }),
  }),

  // ── Métricas dashboard ───────────────────────────────────────────────────
  metrics: orgProcedure
    .input(orgIdInput.extend({ mallId: z.string() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const [totalLocales, activeLocales, pendingInvoices, recentPayments] = await Promise.all([
        ctx.db.ccLocal.count({ where: { mallId: input.mallId, deletedAt: null } }),
        ctx.db.ccLocal.count({ where: { mallId: input.mallId, active: true, deletedAt: null } }),
        ctx.db.ccInvoice.aggregate({
          where: { mallId: input.mallId, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
          _sum: { totalUsd: true, paidUsd: true },
          _count: { id: true },
        }),
        ctx.db.ccPayment.aggregate({
          where: { mallId: input.mallId, voidedAt: null, paidAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
          _sum: { amountUsd: true },
        }),
      ]);

      const overdueCount = await ctx.db.ccInvoice.count({ where: { mallId: input.mallId, status: "OVERDUE" } });

      return {
        totalLocales,
        activeLocales,
        occupiedLocales: await ctx.db.ccLocal.count({
          where: { mallId: input.mallId, active: true, deletedAt: null, tenancies: { some: { endDate: null } } },
        }),
        pendingInvoicesCount: pendingInvoices._count.id,
        pendingDebtUsd: Number(pendingInvoices._sum.totalUsd ?? 0) - Number(pendingInvoices._sum.paidUsd ?? 0),
        overdueCount,
        collectedThisMonthUsd: Number(recentPayments._sum.amountUsd ?? 0),
      };
    }),

  // ── Portal del arrendatario (público) ────────────────────────────────────
  portal: router({
    /** Genera un enlace firmado para que el arrendatario acceda al portal. Requiere auth admin. */
    generateLink: orgProcedure
      .input(orgIdInput.extend({ tenancyId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const tenancy = await ctx.db.ccTenancy.findFirstOrThrow({
          where: { id: input.tenancyId, organizationId: input.organizationId },
          include: { local: { select: { mallId: true } } },
        });

        const { generateCcPortalToken } = await import("@/lib/cc-portal-token");

        const token = generateCcPortalToken({
          tenancyId: tenancy.id,
          localId: tenancy.localId,
          mallId: tenancy.local.mallId,
          organizationId: input.organizationId,
        }, 180); // 180 días

        const baseUrl = process.env.NEXTAUTH_URL ?? "https://condominios-theta.vercel.app";
        return { url: `${baseUrl}/portal-cc?token=${token}`, token };
      }),

    /** Notificación de pago desde el portal — pública (firmada con token) */
    notifyPayment: publicProcedure
      .input(z.object({
        token: z.string(),
        method: z.string(),
        amountUsd: z.coerce.number().positive(),
        reference: z.string().optional(),
        bankName: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { verifyCcPortalToken } = await import("@/lib/cc-portal-token");
        const payload = verifyCcPortalToken(input.token);

        const [local, tenancy, mall] = await Promise.all([
          ctx.db.ccLocal.findUniqueOrThrow({ where: { id: payload.localId }, select: { code: true, name: true } }),
          ctx.db.ccTenancy.findUniqueOrThrow({ where: { id: payload.tenancyId }, select: { tenantName: true, tenantEmail: true } }),
          ctx.db.ccMall.findUniqueOrThrow({ where: { id: payload.mallId }, select: { name: true, email: true } }),
        ]);

        // Enviar email al correo del mall (si tiene)
        const adminEmail = mall.email;
        if (adminEmail) {
          const { sendEmail } = await import("@/server/services/email");
          const localLabel = local.name ? `${local.code} — ${local.name}` : local.code;
          const html = `
            <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
              <h2 style="color:#1e40af">📢 Notificación de pago recibida</h2>
              <p><strong>Mall:</strong> ${mall.name}</p>
              <p><strong>Local:</strong> ${localLabel}</p>
              <p><strong>Arrendatario:</strong> ${tenancy.tenantName}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
              <p><strong>Método de pago:</strong> ${input.method}</p>
              <p><strong>Monto USD:</strong> $${input.amountUsd.toFixed(2)}</p>
              ${input.reference ? `<p><strong>Referencia:</strong> ${input.reference}</p>` : ""}
              ${input.bankName ? `<p><strong>Banco:</strong> ${input.bankName}</p>` : ""}
              ${input.notes ? `<p><strong>Notas:</strong> ${input.notes}</p>` : ""}
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
              <p style="color:#6b7280;font-size:12px">Esta notificación fue enviada por el arrendatario desde el portal del CC. Verifique el pago y regístrelo en el sistema.</p>
            </div>`;
          await sendEmail({
            to: adminEmail,
            subject: `[${mall.name}] Notificación de pago — ${tenancy.tenantName} (Local ${local.code})`,
            html,
            text: `Notificación de pago de ${tenancy.tenantName} (Local ${local.code}) — ${input.method} $${input.amountUsd.toFixed(2)} ${input.reference ? `Ref: ${input.reference}` : ""}`,
          });
        }

        // Guardar registro en DB para que el admin lo vea en el panel
        const notifPayload = JSON.stringify({
          mallId: payload.mallId,
          localId: payload.localId,
          tenancyId: payload.tenancyId,
          localCode: local.code,
          localName: local.name ?? null,
          tenantName: tenancy.tenantName,
          tenantEmail: tenancy.tenantEmail ?? null,
          method: input.method,
          amountUsd: input.amountUsd,
          reference: input.reference ?? null,
          bankName: input.bankName ?? null,
          notes: input.notes ?? null,
          fechaPago: new Date().toISOString(),
          estado: "PENDIENTE",
          createdAt: new Date().toISOString(),
        });
        await ctx.db.notification.create({
          data: {
            channel: "IN_APP",
            event: "ANNOUNCEMENT",
            status: "SENT",
            organizationId: payload.organizationId,
            body: `CC_PAGO_POR_VERIFICAR:${notifPayload}`,
          },
        });

        return { sent: !!adminEmail, tenantName: tenancy.tenantName };
      }),

    /** Lista las notificaciones de pago enviadas por arrendatarios desde el portal CC. */
    listPaymentNotifications: orgProcedure
      .input(z.object({ organizationId: z.string(), mallId: z.string() }))
      .query(async ({ ctx, input }) => {
        const notifications = await ctx.db.notification.findMany({
          where: {
            organizationId: input.organizationId,
            body: { startsWith: "CC_PAGO_POR_VERIFICAR:" },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { id: true, body: true, createdAt: true },
        });

        type CcPaymentPayload = {
          mallId: string; localId: string; tenancyId: string;
          localCode: string; localName: string | null;
          tenantName: string; tenantEmail: string | null;
          method: string; amountUsd: number;
          reference: string | null; bankName: string | null;
          notes: string | null; fechaPago: string;
          estado: string; createdAt: string;
        };

        return notifications
          .map((n) => {
            try {
              const raw = n.body.replace(/^CC_PAGO_POR_VERIFICAR:/, "");
              const data = JSON.parse(raw) as CcPaymentPayload;
              // Filtrar por mallId si corresponde
              if (data.mallId !== input.mallId) return null;
              return { id: n.id, ...data, notifiedAt: n.createdAt };
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }),

    /** Elimina una notificación CC_PAGO_POR_VERIFICAR una vez registrado el pago. */
    dismissPaymentNotification: orgProcedure
      .input(z.object({ organizationId: z.string(), notificationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.notification.deleteMany({
          where: { id: input.notificationId, organizationId: input.organizationId },
        });
        return { ok: true };
      }),

    /** Consulta pública — valida el token y devuelve el portal del arrendatario (enriquecido). */
    getByToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ ctx, input }) => {
        const { verifyCcPortalToken } = await import("@/lib/cc-portal-token");

        let payload;
        try {
          payload = verifyCcPortalToken(input.token);
        } catch {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Enlace inválido o expirado" });
        }

        const [tenancy, local, mall, invoices, payments, rateRec] = await Promise.all([
          ctx.db.ccTenancy.findUniqueOrThrow({ where: { id: payload.tenancyId } }),
          ctx.db.ccLocal.findUniqueOrThrow({ where: { id: payload.localId } }),
          ctx.db.ccMall.findUniqueOrThrow({
            where: { id: payload.mallId },
            select: { name: true, address: true, phone: true, email: true, city: true, rif: true, notes: true },
          }),
          ctx.db.ccInvoice.findMany({
            where: { localId: payload.localId, status: { not: "DRAFT" } },
            include: { items: true },
            orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
            take: 36,
          }),
          ctx.db.ccPayment.findMany({
            where: { localId: payload.localId, voidedAt: null },
            include: { allocations: { include: { invoice: { select: { invoiceNumber: true } } } } },
            orderBy: { paidAt: "desc" },
            take: 36,
          }),
          ctx.db.exchangeRate.findFirst({
            orderBy: { date: "desc" },
          }),
        ]);

        const today = new Date();
        const todayRate = rateRec ? Number(rateRec.vesPerUsd) : 1;

        // Pending invoices con aging
        const pendingInvoicesRaw = invoices.filter((i) => ["ISSUED", "PARTIAL", "OVERDUE"].includes(i.status));
        const pendingInvoices = pendingInvoicesRaw.map((i) => {
          const daysOverdue = Math.max(0, Math.floor((today.getTime() - new Date(i.dueDate).getTime()) / 86400000));
          return { ...i, pendingUsdNum: Number(i.totalUsd) - Number(i.paidUsd), daysOverdue, monthsOverdue: Math.ceil(daysOverdue / 30) };
        });
        const totalPendingUsd = pendingInvoices.reduce((s, i) => s + i.pendingUsdNum, 0);

        // Aging buckets
        const agingBuckets = [
          { label: "0-30d", usd: 0 }, { label: "31-60d", usd: 0 },
          { label: "61-90d", usd: 0 }, { label: "90+d", usd: 0 },
        ];
        for (const inv of pendingInvoices) {
          if (inv.daysOverdue <= 30) agingBuckets[0]!.usd += inv.pendingUsdNum;
          else if (inv.daysOverdue <= 60) agingBuckets[1]!.usd += inv.pendingUsdNum;
          else if (inv.daysOverdue <= 90) agingBuckets[2]!.usd += inv.pendingUsdNum;
          else agingBuckets[3]!.usd += inv.pendingUsdNum;
        }

        // Monthly payment totals (last 6 months)
        const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const monthlyMap = new Map<string, number>();
        const MESES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
        for (const p of payments) {
          const d = new Date(p.paidAt);
          if (d < sixMonthsAgo) continue;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + Number(p.amountUsd));
        }
        const monthlyPaymentTotals = Array.from(monthlyMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([ym, total]) => {
            const parts = ym.split("-");
            const yr = Number(parts[0]); const mo = Number(parts[1]);
            return { yearMonth: ym, label: `${MESES_SHORT[mo - 1]}/${yr}`, totalUsd: total };
          });

        // Payments con saldo anterior / queda pendiente
        const invoicesAsc = [...invoices].filter(i => i.status !== "VOIDED")
          .sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime());
        const paymentsAsc = [...payments].sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime());
        let cumPaid = 0;
        const paymentsWithBalance = paymentsAsc.map((p) => {
          const totalInvoiced = invoicesAsc
            .filter(i => new Date(i.issuedAt) <= new Date(p.paidAt))
            .reduce((s, i) => s + Number(i.totalUsd), 0);
          const saldoAnterior = Math.max(0, totalInvoiced - cumPaid);
          cumPaid += Number(p.amountUsd);
          return {
            id: p.id, paidAt: p.paidAt,
            amountUsd: p.amountUsd.toString(), amountBss: p.amountBss.toString(),
            method: p.method, reference: p.reference,
            invoiceNumbers: p.allocations.map((a) => a.invoice?.invoiceNumber ?? "").filter(Boolean),
            saldoAnteriorUsd: saldoAnterior.toFixed(2),
            quedaPendienteUsd: Math.max(0, saldoAnterior - Number(p.amountUsd)).toFixed(2),
          };
        });
        paymentsWithBalance.reverse(); // desc again

        return {
          tenancy: { id: tenancy.id, tenantName: tenancy.tenantName, tenantRif: tenancy.tenantRif, startDate: tenancy.startDate, endDate: tenancy.endDate },
          local: { code: local.code, name: local.name, floor: local.floor },
          mall: { name: mall.name, address: mall.address, phone: mall.phone, email: mall.email, city: mall.city, rif: mall.rif, paymentInstructions: mall.notes },
          invoices: invoices.map((inv) => ({
            id: inv.id, invoiceNumber: inv.invoiceNumber,
            periodYear: inv.periodYear, periodMonth: inv.periodMonth,
            type: inv.type, status: inv.status,
            totalUsd: inv.totalUsd.toString(), totalBss: inv.totalBss.toString(),
            paidUsd: inv.paidUsd.toString(),
            exchangeRate: inv.exchangeRate.toString(),
            dueDate: inv.dueDate, issuedAt: inv.issuedAt,
            items: inv.items.map((it) => ({ description: it.description, amountUsd: it.amountUsd.toString(), amountBss: it.amountBss.toString() })),
          })),
          payments: paymentsWithBalance,
          pendingInvoices: pendingInvoices.map((inv) => ({
            id: inv.id, invoiceNumber: inv.invoiceNumber,
            periodYear: inv.periodYear, periodMonth: inv.periodMonth,
            totalUsd: inv.totalUsd.toString(), paidUsd: inv.paidUsd.toString(),
            pendingUsd: inv.pendingUsdNum.toFixed(2),
            dueDate: inv.dueDate, daysOverdue: inv.daysOverdue, monthsOverdue: inv.monthsOverdue, status: inv.status,
          })),
          summary: { totalPendingUsd, pendingCount: pendingInvoices.length },
          agingBuckets,
          monthlyPaymentTotals,
          lastInvoice: invoices[0] ? {
            id: invoices[0].id, invoiceNumber: invoices[0].invoiceNumber,
            totalUsd: invoices[0].totalUsd.toString(), totalBss: invoices[0].totalBss.toString(),
            periodYear: invoices[0].periodYear, periodMonth: invoices[0].periodMonth,
          } : null,
          lastPayment: payments[0] ? {
            amountUsd: payments[0].amountUsd.toString(), amountBss: payments[0].amountBss.toString(),
            paidAt: payments[0].paidAt,
          } : null,
          todayRate: todayRate.toFixed(4),
          todayRateSource: rateRec?.source ?? "MANUAL",
        };
      }),

    /** Deuda general del mall — todos los locales (acceso con token). */
    getMallDebt: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ ctx, input }) => {
        const { verifyCcPortalToken } = await import("@/lib/cc-portal-token");
        let payload;
        try { payload = verifyCcPortalToken(input.token); }
        catch { throw new TRPCError({ code: "UNAUTHORIZED", message: "Token inválido" }); }

        const locales = await ctx.db.ccLocal.findMany({
          where: { mallId: payload.mallId, deletedAt: null },
          include: {
            tenancies: { where: { endDate: null }, orderBy: { startDate: "desc" }, take: 1 },
            invoices: {
              where: { status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
              select: { totalUsd: true, paidUsd: true, dueDate: true },
            },
          },
          orderBy: [{ floor: "asc" }, { code: "asc" }],
        });

        const today = new Date();
        const agingBuckets = [
          { label: "0-30d", usd: 0 }, { label: "31-60d", usd: 0 },
          { label: "61-90d", usd: 0 }, { label: "90+d", usd: 0 },
        ];

        const localesData = locales.map((local) => {
          const tenancy = local.tenancies[0];
          let pendingUsd = 0; let maxDays = 0;
          for (const inv of local.invoices) {
            const p = Number(inv.totalUsd) - Number(inv.paidUsd);
            pendingUsd += p;
            const days = Math.max(0, Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86400000));
            if (days > maxDays) maxDays = days;
            if (days <= 30) agingBuckets[0]!.usd += p;
            else if (days <= 60) agingBuckets[1]!.usd += p;
            else if (days <= 90) agingBuckets[2]!.usd += p;
            else agingBuckets[3]!.usd += p;
          }
          return {
            localCode: local.code, localName: local.name, floor: local.floor,
            tenantName: tenancy?.tenantName ?? null,
            pendingUsd: pendingUsd.toFixed(2),
            overdueMonths: Math.ceil(maxDays / 30),
          };
        });

        const totalPendingUsd = localesData.reduce((s, l) => s + Number(l.pendingUsd), 0);
        return {
          totalPendingUsd: totalPendingUsd.toFixed(2),
          agingBuckets,
          locales: localesData.sort((a, b) => Number(b.pendingUsd) - Number(a.pendingUsd)),
        };
      }),

    /** Descarga PDF de factura CC desde el portal (sin auth admin). */
    downloadInvoicePdf: publicProcedure
      .input(z.object({ token: z.string(), invoiceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { verifyCcPortalToken } = await import("@/lib/cc-portal-token");
        let payload;
        try { payload = verifyCcPortalToken(input.token); }
        catch { throw new TRPCError({ code: "UNAUTHORIZED", message: "Token inválido" }); }

        const inv = await ctx.db.ccInvoice.findFirstOrThrow({
          where: { id: input.invoiceId, localId: payload.localId },
          include: { items: true, local: { select: { code: true, name: true, floor: true } } },
        });
        const [mall, tenancy] = await Promise.all([
          ctx.db.ccMall.findUniqueOrThrow({
            where: { id: payload.mallId },
            select: { name: true, address: true, rif: true, phone: true, email: true, city: true, notes: true },
          }),
          ctx.db.ccTenancy.findUniqueOrThrow({ where: { id: payload.tenancyId } }),
        ]);

        const { generateCcInvoicePdf } = await import("@/server/services/pdf");
        const buffer = await generateCcInvoicePdf({
          mallName: mall.name, mallAddress: mall.address, mallRif: mall.rif,
          mallPhone: mall.phone, mallEmail: mall.email, mallCity: mall.city,
          invoiceNumber: inv.invoiceNumber, periodYear: inv.periodYear, periodMonth: inv.periodMonth,
          issuedAt: inv.issuedAt, dueDate: inv.dueDate, status: inv.status, type: inv.type,
          exchangeRate: inv.exchangeRate.toString(),
          localCode: inv.local.code, localName: inv.local.name, localFloor: inv.local.floor,
          tenantName: tenancy.tenantName, tenantRif: tenancy.tenantRif,
          tenantPhone: tenancy.tenantPhone, tenantEmail: tenancy.tenantEmail,
          items: inv.items.map((it) => ({ description: it.description, amountUsd: it.amountUsd.toString(), amountBss: it.amountBss.toString() })),
          totalUsd: inv.totalUsd.toString(), totalBss: inv.totalBss.toString(),
          paidUsd: inv.paidUsd.toString(), paidBss: inv.paidBss.toString(),
          notes: inv.notes, paymentInstructions: mall.notes,
        });
        return { base64: buffer.toString("base64"), fileName: `Factura-CC-${inv.invoiceNumber}.pdf`, mimeType: "application/pdf" };
      }),

    /** Descarga comprobante de pago (bauche) desde el portal CC. */
    downloadPaymentVoucher: publicProcedure
      .input(z.object({ token: z.string(), paymentId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { verifyCcPortalToken } = await import("@/lib/cc-portal-token");
        let payload;
        try { payload = verifyCcPortalToken(input.token); }
        catch { throw new TRPCError({ code: "UNAUTHORIZED", message: "Token inválido" }); }

        const payment = await ctx.db.ccPayment.findFirstOrThrow({
          where: { id: input.paymentId, localId: payload.localId },
          include: { allocations: { include: { invoice: { select: { invoiceNumber: true, periodYear: true, periodMonth: true } } } } },
        });
        const [mall, tenancy, local] = await Promise.all([
          ctx.db.ccMall.findUniqueOrThrow({
            where: { id: payload.mallId },
            select: { name: true, address: true, rif: true, phone: true, email: true },
          }),
          ctx.db.ccTenancy.findUniqueOrThrow({ where: { id: payload.tenancyId }, select: { tenantName: true, tenantRif: true } }),
          ctx.db.ccLocal.findUniqueOrThrow({ where: { id: payload.localId }, select: { code: true } }),
        ]);

        const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
        const invoicesData = payment.allocations.map((alloc) => ({
          number: alloc.invoice?.invoiceNumber ?? "",
          period: (alloc.invoice?.periodMonth && alloc.invoice?.periodYear)
            ? `${MESES_ES[(alloc.invoice.periodMonth) - 1]} ${alloc.invoice.periodYear}` : "",
          amountUsd: alloc.amountUsd.toString(),
        }));

        const { generatePaymentVoucherPdf } = await import("@/server/services/pdf");
        const buffer = await generatePaymentVoucherPdf({
          communityName: mall.name, communityAddress: mall.address ?? undefined,
          communityRif: mall.rif ?? undefined, communityPhone: mall.phone ?? undefined,
          communityEmail: mall.email ?? undefined,
          paymentId: payment.id, unitCode: local.code,
          personName: tenancy.tenantName, personId: tenancy.tenantRif ?? undefined,
          amountUsd: payment.amountUsd.toString(), amountBss: payment.amountBss.toString(),
          exchangeRate: payment.exchangeRate.toString(),
          method: payment.method, reference: payment.reference ?? undefined,
          paidAt: payment.paidAt, invoices: invoicesData,
        });
        return { base64: buffer.toString("base64"), fileName: `Bauche-CC-${payment.id.slice(-8).toUpperCase()}.pdf`, mimeType: "application/pdf" };
      }),
  }),

  // ── Importación masiva ────────────────────────────────────────────────────
  imports: router({
    /**
     * Importa locales (y opcionalmente arrendatarios) desde CSV.
     * Si un local con el mismo code ya existe en el mall → actualiza.
     * Si tiene datos de arrendatario → crea una CcTenancy activa.
     */
    bulkLocales: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          rows: z.array(
            z.object({
              code: z.string().min(1),
              name: z.string().optional(),
              floor: z.coerce.number().int().optional(),
              areaM2: z.coerce.number().optional(),
              canonType: z.enum(["FIXED", "VARIABLE_SALES", "MIXED"]).default("FIXED"),
              canonUsd: z.coerce.number().optional(),
              aliquot: z.coerce.number().optional(),
              // Datos del arrendatario (opcional)
              tenantName: z.string().optional(),
              tenantRif: z.string().optional(),
              tenantPhone: z.string().optional(),
              tenantEmail: z.string().email().optional().or(z.literal("")),
              tenantStartDate: z.coerce.date().optional(),
              depositUsd: z.coerce.number().optional(),
            }),
          ).min(1).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, mallId, rows } = input;

        // Verificar que el mall pertenece a la org
        const mall = await ctx.db.ccMall.findFirstOrThrow({ where: { id: mallId, organizationId } });

        let created = 0;
        let updated = 0;
        let tenantsCreated = 0;
        const errors: string[] = [];

        for (const row of rows) {
          try {
            const existing = await ctx.db.ccLocal.findFirst({
              where: { mallId: mall.id, code: row.code.toUpperCase() },
            });

            let localId: string;

            if (existing) {
              // Actualizar
              await ctx.db.ccLocal.update({
                where: { id: existing.id },
                data: {
                  name: row.name ?? existing.name,
                  floor: row.floor ?? existing.floor,
                  areaM2: row.areaM2 ?? existing.areaM2,
                  canonType: row.canonType,
                  canonUsd: row.canonUsd ?? existing.canonUsd,
                  aliquot: row.aliquot ?? existing.aliquot,
                },
              });
              localId = existing.id;
              updated++;
            } else {
              // Crear nuevo local
              const local = await ctx.db.ccLocal.create({
                data: {
                  organizationId,
                  mallId,
                  code: row.code.toUpperCase(),
                  name: row.name,
                  floor: row.floor,
                  areaM2: row.areaM2,
                  canonType: row.canonType,
                  canonUsd: row.canonUsd,
                  aliquot: row.aliquot,
                  active: true,
                },
              });
              localId = local.id;
              created++;
            }

            // Crear arrendatario si hay datos mínimos
            if (row.tenantName) {
              const alreadyHasTenant = await ctx.db.ccTenancy.findFirst({
                where: { localId, endDate: null },
              });

              if (!alreadyHasTenant) {
                await ctx.db.ccTenancy.create({
                  data: {
                    organizationId,
                    localId,
                    tenantName: row.tenantName,
                    tenantRif: row.tenantRif,
                    tenantPhone: row.tenantPhone,
                    tenantEmail: row.tenantEmail || undefined,
                    startDate: row.tenantStartDate ?? new Date(),
                    depositUsd: row.depositUsd,
                  },
                });
                tenantsCreated++;
              }
            }
          } catch (err) {
            errors.push(`Local "${row.code}": ${err instanceof Error ? err.message : "Error"}`);
          }
        }

        return { created, updated, tenantsCreated, errors, total: rows.length };
      }),

    // ── bulkPayments — Importar pagos históricos ────────────────────────────
    bulkPayments: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          rows: z.array(z.object({
            localCode: z.string().min(1),
            amountUsd: z.coerce.number().positive(),
            exchangeRate: z.coerce.number().positive().optional(),
            method: z.enum(["CASH_BSS","CASH_USD","TRANSFER_BSS","TRANSFER_USD","ZELLE","PAGO_MOVIL","CRYPTO","CHECK","OTHER"]).default("TRANSFER_USD"),
            paidAt: z.coerce.date(),
            reference: z.string().optional(),
            notes: z.string().optional(),
          })).min(1).max(1000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, mallId, rows } = input;
        let created = 0;
        const errors: string[] = [];

        for (const row of rows) {
          try {
            const local = await ctx.db.ccLocal.findFirst({
              where: { mallId, organizationId, code: row.localCode.toUpperCase() },
            });
            if (!local) { errors.push(`Local "${row.localCode}": no encontrado`); continue; }

            const rate = row.exchangeRate ?? 1;
            const amountBss = row.amountUsd * rate;

            // Buscar facturas pendientes oldest-first
            const pendingInvoices = await ctx.db.ccInvoice.findMany({
              where: { localId: local.id, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
              orderBy: { dueDate: "asc" },
            });

            let remaining = row.amountUsd;
            const allocations: Array<{ invoiceId: string; localId: string; amountBss: number; amountUsd: number }> = [];

            for (const inv of pendingInvoices) {
              if (remaining <= 0) break;
              const pendingUsd = Number(inv.totalUsd) - Number(inv.paidUsd);
              if (pendingUsd <= 0) continue;
              const apply = Math.min(remaining, pendingUsd);
              allocations.push({ invoiceId: inv.id, localId: local.id, amountBss: apply * rate, amountUsd: apply });
              remaining -= apply;
            }

            await ctx.db.ccPayment.create({
              data: {
                organizationId,
                mallId,
                localId: local.id,
                amountUsd: row.amountUsd,
                amountBss,
                exchangeRate: rate,
                exchangeSource: "MANUAL",
                currencyPrimary: "USD",
                method: row.method,
                reference: row.reference,
                paidAt: row.paidAt,
                notes: row.notes,
                allocations: { create: allocations },
              },
            });

            // Actualizar facturas con las allocations
            for (const alloc of allocations) {
              const inv = pendingInvoices.find((i) => i.id === alloc.invoiceId)!;
              const newPaidUsd = Number(inv.paidUsd) + alloc.amountUsd;
              const newPaidBss = Number(inv.paidBss) + alloc.amountBss;
              const newStatus =
                newPaidUsd >= Number(inv.totalUsd) - 0.001 ? "PAID"
                : newPaidUsd > 0 ? "PARTIAL"
                : "ISSUED";
              await ctx.db.ccInvoice.update({
                where: { id: inv.id },
                data: { paidUsd: newPaidUsd, paidBss: newPaidBss, status: newStatus },
              });
            }

            created++;
          } catch (err) {
            errors.push(`Local "${row.localCode}": ${err instanceof Error ? err.message : "Error"}`);
          }
        }

        return { created, errors };
      }),

    // ── bulkInvoices — Importar facturas históricas ─────────────────────────
    bulkInvoices: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          rows: z.array(z.object({
            localCode: z.string().min(1),
            periodYear: z.number().int(),
            periodMonth: z.number().int().min(1).max(12),
            amountUsd: z.coerce.number().positive(),
            exchangeRate: z.coerce.number().positive().optional(),
            type: z.enum(["CANON","CANON_SALES","ALIQUOT","EXTRA_FEE","FINE","OTHER"]).default("CANON"),
            description: z.string().optional(),
            dueDate: z.coerce.date().optional(),
            issuedAt: z.coerce.date().optional(),
            status: z.enum(["ISSUED","PAID","PARTIAL","OVERDUE","VOIDED"]).optional(),
            paidUsd: z.coerce.number().optional(),
          })).min(1).max(1000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, mallId, rows } = input;
        let created = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const row of rows) {
          try {
            const local = await ctx.db.ccLocal.findFirst({
              where: { mallId, organizationId, code: row.localCode.toUpperCase() },
            });
            if (!local) { errors.push(`Local "${row.localCode}": no encontrado`); continue; }

            // No duplicar si ya existe factura del mismo tipo+período+local (no VOIDED)
            const existing = await ctx.db.ccInvoice.findFirst({
              where: {
                localId: local.id,
                periodYear: row.periodYear,
                periodMonth: row.periodMonth,
                type: row.type,
                status: { not: "VOIDED" },
              },
            });
            if (existing) { skipped++; continue; }

            const rate = row.exchangeRate ?? 1;
            const amountBss = row.amountUsd * rate;
            const issuedAt = row.issuedAt ?? new Date();
            const dueDate = row.dueDate ?? new Date(issuedAt.getTime() + 5 * 24 * 60 * 60 * 1000);

            const count = await ctx.db.ccInvoice.count({ where: { mallId } });
            const invoiceNumber = `${row.periodYear}-${String(row.periodMonth).padStart(2, "0")}-${String(count + 1).padStart(4, "0")}`;

            const paidUsd = row.paidUsd ?? 0;
            const paidBss = paidUsd * rate;
            let status = row.status ?? "ISSUED";
            if (!row.status && paidUsd > 0) {
              status = paidUsd >= row.amountUsd - 0.001 ? "PAID" : "PARTIAL";
            }

            const description = row.description ?? `${row.type} ${row.periodYear}-${String(row.periodMonth).padStart(2, "0")}`;

            await ctx.db.ccInvoice.create({
              data: {
                organizationId,
                mallId,
                localId: local.id,
                invoiceNumber,
                type: row.type,
                periodYear: row.periodYear,
                periodMonth: row.periodMonth,
                issuedAt,
                dueDate,
                totalBss: amountBss,
                totalUsd: row.amountUsd,
                paidUsd,
                paidBss,
                exchangeRate: rate,
                exchangeSource: "MANUAL",
                currencyPrimary: "USD",
                status,
                items: { create: { description, amountBss, amountUsd: row.amountUsd } },
              },
            });
            created++;
          } catch (err) {
            errors.push(`Local "${row.localCode}" ${row.periodYear}/${row.periodMonth}: ${err instanceof Error ? err.message : "Error"}`);
          }
        }

        return { created, skipped, errors };
      }),

    // ── bulkSalesDeclarations — Importar declaraciones de ventas ───────────
    bulkSalesDeclarations: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          rows: z.array(z.object({
            localCode: z.string().min(1),
            periodYear: z.number().int(),
            periodMonth: z.number().int().min(1).max(12),
            salesAmountUsd: z.coerce.number().nonnegative(),
            salesAmountBss: z.coerce.number().nonnegative().optional(),
            exchangeRate: z.coerce.number().positive().optional(),
            verified: z.boolean().default(false),
          })).min(1).max(1000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, mallId, rows } = input;
        let created = 0;
        let updated = 0;
        const errors: string[] = [];

        for (const row of rows) {
          try {
            const local = await ctx.db.ccLocal.findFirst({
              where: { mallId, organizationId, code: row.localCode.toUpperCase() },
            });
            if (!local) { errors.push(`Local "${row.localCode}": no encontrado`); continue; }

            const rate = row.exchangeRate ?? 1;
            const salesAmountBss = row.salesAmountBss ?? row.salesAmountUsd * rate;

            const existing = await ctx.db.ccSalesDeclaration.findUnique({
              where: { localId_periodYear_periodMonth: { localId: local.id, periodYear: row.periodYear, periodMonth: row.periodMonth } },
            });

            if (existing) {
              await ctx.db.ccSalesDeclaration.update({
                where: { id: existing.id },
                data: {
                  salesAmountUsd: row.salesAmountUsd,
                  salesAmountBss,
                  exchangeRate: rate,
                  verified: row.verified,
                },
              });
              updated++;
            } else {
              await ctx.db.ccSalesDeclaration.create({
                data: {
                  organizationId,
                  mallId,
                  localId: local.id,
                  periodYear: row.periodYear,
                  periodMonth: row.periodMonth,
                  salesAmountUsd: row.salesAmountUsd,
                  salesAmountBss,
                  exchangeRate: rate,
                  verified: row.verified,
                },
              });
              created++;
            }
          } catch (err) {
            errors.push(`Local "${row.localCode}" ${row.periodYear}/${row.periodMonth}: ${err instanceof Error ? err.message : "Error"}`);
          }
        }

        return { created, updated, errors };
      }),

    // ── bulkIncomes — Importar recaudación extra ────────────────────────────
    bulkIncomes: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          rows: z.array(z.object({
            category: z.enum(["PUBLICIDAD_INTERNA","ALQUILER_ESPACIO","ESTACIONAMIENTO","PATROCINIOS","INTERESES","PENALIDADES","OTHER"]).default("OTHER"),
            description: z.string().min(1),
            amountUsd: z.coerce.number().positive(),
            exchangeRate: z.coerce.number().positive().optional(),
            periodYear: z.number().int(),
            periodMonth: z.number().int().min(1).max(12),
            reference: z.string().optional(),
            affectsInvoice: z.boolean().default(false),
            notes: z.string().optional(),
          })).min(1).max(1000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, mallId, rows } = input;
        let created = 0;
        const errors: string[] = [];

        for (const row of rows) {
          try {
            const rate = row.exchangeRate ?? 1;
            const amountBss = row.amountUsd * rate;

            await ctx.db.ccIncome.create({
              data: {
                organizationId,
                mallId,
                category: row.category,
                description: row.description,
                amountUsd: row.amountUsd,
                amountBss,
                exchangeRate: rate,
                exchangeSource: "MANUAL",
                currencyPrimary: "USD",
                periodYear: row.periodYear,
                periodMonth: row.periodMonth,
                reference: row.reference,
                affectsInvoice: row.affectsInvoice,
                notes: row.notes,
              },
            });
            created++;
          } catch (err) {
            errors.push(`Fila "${row.description}": ${err instanceof Error ? err.message : "Error"}`);
          }
        }

        return { created, errors };
      }),
  }),

  // ── Cierre de mes ──────────────────────────────────────────────────────────
  monthClose: router({
    /** Lista los cierres de mes del mall */
    list: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.ccMonthClose.findMany({
          where: { mallId: input.mallId, organizationId: input.organizationId },
          orderBy: [{ year: "desc" }, { month: "desc" }],
        }),
      ),

    /** Crea el snapshot de cierre para el mes indicado */
    close: orgProcedure
      .input(orgIdInput.extend({
        mallId: z.string(),
        year: z.number().int().min(2020).max(2099),
        month: z.number().int().min(1).max(12),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verificar que no exista ya un cierre para este período
        const existing = await ctx.db.ccMonthClose.findUnique({
          where: { mallId_year_month: { mallId: input.mallId, year: input.year, month: input.month } },
        });
        if (existing) throw new TRPCError({ code: "CONFLICT", message: `Ya existe un cierre para ${input.month}/${input.year}` });

        // Calcular snapshot del período
        const [invoices, payments, expenses] = await Promise.all([
          ctx.db.ccInvoice.findMany({
            where: {
              mallId: input.mallId,
              periodYear: input.year,
              periodMonth: input.month,
              status: { not: "VOIDED" },
            },
            select: { totalUsd: true, paidUsd: true, status: true },
          }),
          ctx.db.ccPayment.aggregate({
            where: {
              mallId: input.mallId,
              paidAt: {
                gte: new Date(input.year, input.month - 1, 1),
                lt: new Date(input.year, input.month, 1),
              },
            },
            _sum: { amountUsd: true },
          }),
          ctx.db.ccExpense.aggregate({
            where: {
              mallId: input.mallId,
              periodYear: input.year,
              periodMonth: input.month,
            },
            _sum: { amountUsd: true },
          }),
        ]);

        const totalInvoicedUsd = invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
        const totalCollectedUsd = Number(payments._sum?.amountUsd ?? 0);
        const totalExpensesUsd = Number(expenses._sum?.amountUsd ?? 0);
        const paidCount = invoices.filter((i) => i.status === "PAID").length;
        const pendingCount = invoices.filter((i) => ["ISSUED", "PARTIAL", "OVERDUE"].includes(i.status)).length;
        const collectionPct = totalInvoicedUsd > 0 ? (totalCollectedUsd / totalInvoicedUsd) * 100 : 0;

        return ctx.db.ccMonthClose.create({
          data: {
            organizationId: input.organizationId,
            mallId: input.mallId,
            year: input.year,
            month: input.month,
            closedById: ctx.session?.user?.id ?? "system",
            notes: input.notes,
            summary: {
              totalInvoicedUsd,
              totalCollectedUsd,
              totalExpensesUsd,
              collectionPct: Math.round(collectionPct * 100) / 100,
              invoiceCount: invoices.length,
              paidCount,
              pendingCount,
            },
          },
        });
      }),

    /** Elimina un cierre de mes (para corrección) */
    reopen: orgProcedure
      .input(orgIdInput.extend({ closeId: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db.ccMonthClose.delete({ where: { id: input.closeId } }),
      ),
  }),
});
