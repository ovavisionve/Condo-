import { z } from "zod";
import { router, orgProcedure } from "@/server/trpc/init";
import { Decimal } from "decimal.js";
import {
  getCurrentRate,
  setManualRate,
  listRecentRates,
  refreshBcvRate,
} from "@/server/services/exchange";
import {
  registerExpense,
  issueMonthlyInvoices,
  voidInvoice,
  getAging,
} from "@/server/services/invoicing";
import { recordPayment, voidPayment } from "@/server/services/payments";
import { registerIncome, voidIncome } from "@/server/services/income";
import { sendEmail, buildInvoiceEmail } from "@/server/services/email";

const orgIdInput = z.object({ organizationId: z.string() });

const EXPENSE_CATEGORIES = [
  "ELECTRICITY",
  "WATER",
  "GAS",
  "INTERNET",
  "CLEANING",
  "GARDENING",
  "SECURITY",
  "ELEVATOR",
  "STAFF_PAYROLL",
  "ADMINISTRATION",
  "INSURANCE",
  "REPAIRS",
  "RESERVE_FUND",
  "TAXES",
  "OTHER",
] as const;

const PAYMENT_METHODS = [
  "CASH_BSS",
  "CASH_USD",
  "TRANSFER_BSS",
  "TRANSFER_USD",
  "ZELLE",
  "PAGO_MOVIL",
  "CRYPTO",
  "CHECK",
  "OTHER",
] as const;

export const financeRouter = router({
  // ─── Tasas de cambio ───────────────────────────────────────────
  exchange: router({
    current: orgProcedure.input(orgIdInput).query(async () => {
      const rate = await getCurrentRate("BCV");
      return {
        date: rate.date,
        source: rate.source,
        vesPerUsd: rate.vesPerUsd.toString(),
      };
    }),
    recent: orgProcedure
      .input(orgIdInput.extend({ limit: z.number().int().min(1).max(100).default(30) }))
      .query(async ({ input }) => {
        const rates = await listRecentRates(input.limit);
        return rates.map((r) => ({
          date: r.date,
          source: r.source,
          vesPerUsd: r.vesPerUsd.toString(),
        }));
      }),
    setManual: orgProcedure
      .input(
        orgIdInput.extend({
          vesPerUsd: z.coerce.number().positive(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const r = await setManualRate(input.vesPerUsd, new Date(), input.notes);
        return { date: r.date, source: r.source, vesPerUsd: r.vesPerUsd.toString() };
      }),
    refreshBcv: orgProcedure
      .input(orgIdInput)
      .mutation(async () => {
        const r = await refreshBcvRate();
        return { date: r.date, source: r.source, vesPerUsd: r.vesPerUsd.toString() };
      }),
  }),

  // ─── Gastos ────────────────────────────────────────────────────
  expenses: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          year: z.number().int().optional(),
          month: z.number().int().min(1).max(12).optional(),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.expense.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.year ? { periodYear: input.year } : {}),
            ...(input.month ? { periodMonth: input.month } : {}),
            voidedAt: null,
          },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
        }),
      ),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          category: z.enum(EXPENSE_CATEGORIES),
          description: z.string().min(2),
          periodYear: z.number().int().min(2020).max(2100),
          periodMonth: z.number().int().min(1).max(12),
          amount: z.coerce.number().positive(),
          currencyPrimary: z.enum(["VES", "USD"]),
          supplierName: z.string().optional(),
          invoiceNumber: z.string().optional(),
          receiptDate: z.coerce.date().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        registerExpense({ ...input, createdById: ctx.user.id }),
      ),
  }),

  // ─── Facturas ──────────────────────────────────────────────────
  invoices: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          year: z.number().int().optional(),
          month: z.number().int().min(1).max(12).optional(),
          status: z.enum(["DRAFT", "ISSUED", "PARTIAL", "PAID", "OVERDUE", "VOIDED"]).optional(),
          unitId: z.string().optional(),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.invoice.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.year ? { periodYear: input.year } : {}),
            ...(input.month ? { periodMonth: input.month } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.unitId ? { unitId: input.unitId } : {}),
          },
          include: {
            unit: { select: { code: true } },
            _count: { select: { items: true } },
          },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { unit: { code: "asc" } }],
        }),
      ),
    byId: orgProcedure
      .input(orgIdInput.extend({ id: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.invoice.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
          include: {
            unit: true,
            items: { orderBy: { description: "asc" } },
            payments: { include: { payment: true } },
          },
        }),
      ),
    issueMonth: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          year: z.number().int().min(2020).max(2100),
          month: z.number().int().min(1).max(12),
          dueDate: z.coerce.date().transform((d) =>
            new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0))
          ),
          asDraft: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        issueMonthlyInvoices({ ...input, createdById: ctx.user.id }),
      ),
    voidOne: orgProcedure
      .input(orgIdInput.extend({ id: z.string(), reason: z.string().min(3) }))
      .mutation(async ({ ctx, input }) =>
        voidInvoice({
          organizationId: input.organizationId,
          invoiceId: input.id,
          reason: input.reason,
          actorId: ctx.user.id,
        }),
      ),

    /** Genera el PDF del recibo y lo devuelve como base64 para descarga en el cliente. */
    downloadPdf: orgProcedure
      .input(orgIdInput.extend({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const inv = await ctx.db.invoice.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
          include: {
            unit: true,
            items: { orderBy: { description: "asc" } },
            payments: {
              include: {
                payment: {
                  select: { paidAt: true, method: true, amountUsd: true, amountBss: true, reference: true },
                },
              },
            },
          },
        });
        const [community, ownership, bankAccounts] = await Promise.all([
          ctx.db.community.findFirstOrThrow({
            where: { id: inv.communityId },
            select: { name: true, address: true, rif: true },
          }),
          ctx.db.ownership.findFirst({
            where: { unitId: inv.unitId, endDate: null },
            include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
          }),
          ctx.db.bankAccount.findMany({
            where: { communityId: inv.communityId, active: true },
            select: { bankName: true, accountNumber: true, accountHolder: true, accountType: true, currency: true },
          }),
        ]);

        const { generateInvoicePdf } = await import("@/server/services/pdf");

        const data = {
          communityName: community.name,
          communityAddress: community.address ?? "",
          communityRif: community.rif,
          invoiceNumber: inv.invoiceNumber,
          periodYear: inv.periodYear,
          periodMonth: inv.periodMonth,
          issuedAt: inv.issuedAt,
          dueDate: inv.dueDate,
          status: inv.status,
          exchangeRate: inv.exchangeRate.toString(),
          exchangeSource: inv.exchangeSource,
          unitCode: inv.unit.code,
          unitFloor: inv.unit.floor,
          unitTower: inv.unit.tower,
          ownerName: ownership?.person
            ? `${ownership.person.firstName} ${ownership.person.lastName}`
            : "Sin propietario registrado",
          ownerIdType: ownership?.person?.idType,
          ownerIdNumber: ownership?.person?.idNumber,
          items: inv.items.map((it) => ({
            description: it.description,
            aliquot: it.aliquot?.toString(),
            amountUsd: it.amountUsd.toString(),
            amountBss: it.amountBss.toString(),
          })),
          totalUsd: inv.totalUsd.toString(),
          totalBss: inv.totalBss.toString(),
          paidUsd: inv.paidUsd.toString(),
          paidBss: inv.paidBss.toString(),
          paymentsApplied: inv.payments.map((pa) => ({
            paidAt: pa.payment.paidAt,
            method: pa.payment.method,
            amountUsd: pa.payment.amountUsd.toString(),
            amountBss: pa.payment.amountBss.toString(),
            reference: pa.payment.reference,
          })),
          bankAccounts: bankAccounts.map((b) => ({
            bankName: b.bankName,
            accountNumber: b.accountNumber,
            accountHolder: b.accountHolder,
            accountType: b.accountType,
            currency: b.currency,
          })),
        };

        const buffer = await generateInvoicePdf(data);
        const base64 = buffer.toString("base64");
        return {
          base64,
          fileName: `Recibo-${inv.invoiceNumber}.pdf`,
          mimeType: "application/pdf",
        };
      }),

    sendByEmail: orgProcedure
      .input(orgIdInput.extend({ invoiceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const inv = await ctx.db.invoice.findFirstOrThrow({
          where: { id: input.invoiceId, organizationId: input.organizationId },
          include: {
            unit: true,
            items: { orderBy: { description: "asc" } },
          },
        });
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id: inv.communityId },
          select: { name: true, address: true },
        });

        // Buscar propietario actual de la unidad
        const ownership = await ctx.db.ownership.findFirst({
          where: { unitId: inv.unitId, endDate: null },
          include: { person: { select: { firstName: true, lastName: true, email: true } } },
        });
        const person = ownership?.person;
        if (!person?.email) {
          return { success: false, error: "El propietario no tiene email registrado" };
        }

        const emailData = buildInvoiceEmail({
          communityName: community.name,
          communityAddress: community.address ?? undefined,
          personName: `${person.firstName} ${person.lastName}`,
          unitCode: inv.unit.code,
          invoiceNumber: inv.invoiceNumber,
          periodYear: inv.periodYear,
          periodMonth: inv.periodMonth,
          issuedAt: inv.issuedAt,
          dueDate: inv.dueDate,
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
          adminEmail: process.env.SMTP_FROM,
        });

        const result = await sendEmail({ to: person.email, ...emailData });
        return result;
      }),
  }),

  // ─── Pagos ─────────────────────────────────────────────────────
  payments: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string().optional(),
          includeVoided: z.boolean().default(false),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.payment.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.unitId ? { unitId: input.unitId } : {}),
            ...(input.includeVoided ? {} : { voidedAt: null }),
          },
          include: {
            unit: { select: { code: true } },
            allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
          },
          orderBy: { paidAt: "desc" },
        }),
      ),
    record: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string(),
          amount: z.coerce.number().positive(),
          currencyPrimary: z.enum(["VES", "USD"]),
          method: z.enum(PAYMENT_METHODS),
          reference: z.string().optional(),
          paidAt: z.coerce.date(),
          bankAccountId: z.string().optional(),
          notes: z.string().optional(),
          allocations: z
            .array(z.object({ invoiceId: z.string(), amount: z.coerce.number().positive() }))
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        recordPayment({ ...input, createdById: ctx.user.id }),
      ),
    voidOne: orgProcedure
      .input(orgIdInput.extend({ id: z.string(), reason: z.string().min(3) }))
      .mutation(async ({ ctx, input }) =>
        voidPayment({
          organizationId: input.organizationId,
          paymentId: input.id,
          reason: input.reason,
          actorId: ctx.user.id,
        }),
      ),
  }),

  // ─── Ingresos ──────────────────────────────────────────────────
  income: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          year: z.number().int().optional(),
          month: z.number().int().min(1).max(12).optional(),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.income.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.year ? { periodYear: input.year } : {}),
            ...(input.month ? { periodMonth: input.month } : {}),
            voidedAt: null,
          },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
        }),
      ),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          category: z.enum([
            "HALL_RENTAL", "PARKING_FEE", "GUEST_FEE", "INTEREST", "DONATION", "PENALTY", "OTHER",
          ]),
          description: z.string().min(2),
          periodYear: z.number().int().min(2020).max(2100),
          periodMonth: z.number().int().min(1).max(12),
          amount: z.coerce.number().positive(),
          currencyPrimary: z.enum(["VES", "USD"]),
          reference: z.string().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        registerIncome({
          ...input,
          exchangeSource: "MANUAL",
          createdById: ctx.user.id,
        }),
      ),
    voidOne: orgProcedure
      .input(orgIdInput.extend({ id: z.string(), reason: z.string().min(3) }))
      .mutation(async ({ input }) =>
        voidIncome({
          organizationId: input.organizationId,
          incomeId: input.id,
          reason: input.reason,
        }),
      ),
  }),

  // ─── Multas y cuotas extra ────────────────────────────────────
  fines: router({
    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string(),
          description: z.string().min(3),
          amountUsd: z.coerce.number().positive(),
          dueDate: z.coerce.date().transform((d) =>
            new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)),
          ),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, unitId, description, amountUsd, dueDate, notes } = input;
        const rate = await (await import("@/server/services/exchange")).getCurrentRate("BCV");
        const usd = new Decimal(amountUsd);
        const bss = usd.mul(rate.vesPerUsd);
        const unit = await ctx.db.unit.findFirstOrThrow({
          where: { id: unitId, communityId, organizationId, deletedAt: null },
        });
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id: communityId, organizationId, deletedAt: null },
          select: { primaryCurrency: true },
        });
        const now = new Date();
        const invoiceNumber = `MULTA-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${unit.code}-${Date.now().toString(36).toUpperCase()}`;
        return ctx.db.$transaction(async (tx) => {
          const inv = await tx.invoice.create({
            data: {
              organizationId,
              communityId,
              unitId,
              invoiceNumber,
              type: "FINE",
              periodYear: now.getFullYear(),
              periodMonth: now.getMonth() + 1,
              issuedAt: now,
              dueDate,
              totalBss: bss.toFixed(2),
              totalUsd: usd.toFixed(2),
              exchangeRate: rate.vesPerUsd.toFixed(8),
              exchangeSource: rate.source,
              currencyPrimary: community.primaryCurrency,
              status: "ISSUED",
              items: {
                create: [{
                  description,
                  amountBss: bss.toFixed(2),
                  amountUsd: usd.toFixed(2),
                  aliquot: "100.000000",
                }],
              },
            },
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: ctx.user.id,
              action: "FINE_APPLIED",
              entityType: "Invoice",
              entityId: inv.id,
              after: { unitId, description, amountUsd, notes },
            },
          });
          return inv;
        });
      }),
  }),

  // ─── Cuotas extra por unidad ───────────────────────────────────
  extraFees: router({
    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string(),
          description: z.string().min(3),
          amountUsd: z.coerce.number().positive(),
          dueDate: z.coerce.date().transform((d) =>
            new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)),
          ),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, unitId, description, amountUsd, dueDate, notes } = input;
        const rate = await (await import("@/server/services/exchange")).getCurrentRate("BCV");
        const usd = new Decimal(amountUsd);
        const bss = usd.mul(rate.vesPerUsd);
        const unit = await ctx.db.unit.findFirstOrThrow({
          where: { id: unitId, communityId, organizationId, deletedAt: null },
        });
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id: communityId, organizationId, deletedAt: null },
          select: { primaryCurrency: true },
        });
        const now = new Date();
        const invoiceNumber = `EXTRA-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${unit.code}-${Date.now().toString(36).toUpperCase()}`;
        const inv = await ctx.db.$transaction(async (tx) => {
          const created = await tx.invoice.create({
            data: {
              organizationId,
              communityId,
              unitId,
              invoiceNumber,
              type: "EXTRA_FEE",
              periodYear: now.getFullYear(),
              periodMonth: now.getMonth() + 1,
              issuedAt: now,
              dueDate,
              totalBss: bss.toFixed(2),
              totalUsd: usd.toFixed(2),
              exchangeRate: rate.vesPerUsd.toFixed(8),
              exchangeSource: rate.source,
              currencyPrimary: community.primaryCurrency,
              status: "ISSUED",
              items: {
                create: [{
                  description,
                  amountBss: bss.toFixed(2),
                  amountUsd: usd.toFixed(2),
                  aliquot: "100.000000",
                }],
              },
            },
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: ctx.user.id,
              action: "EXTRA_FEE_APPLIED",
              entityType: "Invoice",
              entityId: created.id,
              after: { unitId, description, amountUsd, notes },
            },
          });
          return created;
        });

        // Notificar al propietario activo (fire-and-forget)
        void (async () => {
          const { notifyPerson } = await import("@/server/services/notifications");
          const ownership = await ctx.db.ownership.findFirst({
            where: { unitId, endDate: null },
            select: { personId: true },
          });
          if (!ownership) return;
          await notifyPerson({
            organizationId,
            communityId,
            unitId,
            personId: ownership.personId,
            event: "INVOICE_ISSUED",
            vars: {
              monto_usd: inv.totalUsd.toString(),
              monto_bs: inv.totalBss.toString(),
              fecha_vence: dueDate.toLocaleDateString("es-VE"),
              factura: inv.invoiceNumber,
              descripcion: description,
            },
          }).catch(() => {/* ignorar errores de notificación */});
        })();

        return inv;
      }),
  }),

  // ─── Aging ─────────────────────────────────────────────────────
  aging: orgProcedure
    .input(orgIdInput.extend({ communityId: z.string() }))
    .query(({ input }) => getAging(input.communityId)),

  // ─── Saldo de una unidad ──────────────────────────────────────
  unitBalance: orgProcedure
    .input(orgIdInput.extend({ unitId: z.string() }))
    .query(async ({ ctx, input }) => {
      const invoices = await ctx.db.invoice.findMany({
        where: { unitId: input.unitId, status: { not: "VOIDED" } },
        select: { totalBss: true, totalUsd: true, paidBss: true, paidUsd: true },
      });
      const balance = invoices.reduce(
        (acc, inv) => ({
          bss: acc.bss
            .plus(inv.totalBss.toString())
            .minus(inv.paidBss.toString()),
          usd: acc.usd
            .plus(inv.totalUsd.toString())
            .minus(inv.paidUsd.toString()),
        }),
        { bss: new Decimal(0), usd: new Decimal(0) },
      );
      return { bss: balance.bss.toFixed(2), usd: balance.usd.toFixed(2) };
    }),
});
