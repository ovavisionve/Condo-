import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
    /** Tasa BCV para una fecha específica (busca cache exacto o más cercano anterior). */
    byDate: orgProcedure
      .input(orgIdInput.extend({ date: z.coerce.date() }))
      .query(async ({ input }) => {
        const rate = await getCurrentRate("BCV", input.date);
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

  // ─── Canales de pago / Cuentas bancarias ──────────────────────
  bankAccounts: router({
    list: orgProcedure
      .input(orgIdInput.extend({ communityId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.bankAccount.findMany({
          where: { organizationId: input.organizationId, communityId: input.communityId },
          orderBy: { createdAt: "asc" },
        }),
      ),

    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId:   z.string(),
          bankName:      z.string().min(2),
          accountType:   z.string().min(2),   // CORRIENTE | AHORRO | PAGO_MOVIL | ZELLE | USD | OTRO
          accountNumber: z.string().min(1),
          accountHolder: z.string().min(2),
          currency:      z.enum(["VES", "USD"]),
          notes:         z.string().optional(), // teléfono PM, email Zelle, RIF, etc.
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db.bankAccount.create({
          data: {
            organizationId: input.organizationId,
            communityId:    input.communityId,
            bankName:       input.bankName,
            accountType:    input.accountType,
            accountNumber:  input.accountNumber,
            accountHolder:  input.accountHolder,
            currency:       input.currency as import("@prisma/client").Currency,
            notes:          input.notes ?? null,
            active:         true,
          },
        }),
      ),

    update: orgProcedure
      .input(
        orgIdInput.extend({
          id:            z.string(),
          bankName:      z.string().min(2).optional(),
          accountType:   z.string().min(2).optional(),
          accountNumber: z.string().min(1).optional(),
          accountHolder: z.string().min(2).optional(),
          currency:      z.enum(["VES", "USD"]).optional(),
          notes:         z.string().optional(),
          active:        z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, organizationId, ...data } = input;
        return ctx.db.bankAccount.update({
          where: { id },
          data: { ...data, currency: data.currency as import("@prisma/client").Currency | undefined },
        });
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
          category: z.enum(EXPENSE_CATEGORIES).optional(),
          towerScope: z.string().optional(),           // "A" | "B" | "__general__"
          status: z.enum(["pending", "invoiced", "voided"]).optional(),
        }),
      )
      .query(({ ctx, input }) => {
        const where: Record<string, unknown> = {
          organizationId: input.organizationId,
          communityId: input.communityId,
          ...(input.year ? { periodYear: input.year } : {}),
          ...(input.month ? { periodMonth: input.month } : {}),
          ...(input.category ? { category: input.category } : {}),
        };
        if (input.towerScope === "__general__") {
          where.towerScope = null;
        } else if (input.towerScope) {
          where.towerScope = input.towerScope;
        }
        if (input.status === "pending") {
          where.invoicedAt = null;
          where.voidedAt = null;
        } else if (input.status === "invoiced") {
          where.invoicedAt = { not: null };
          where.voidedAt = null;
        } else if (input.status === "voided") {
          where.voidedAt = { not: null };
        } else {
          where.voidedAt = null;
        }
        return ctx.db.expense.findMany({
          where: where as import("@prisma/client").Prisma.ExpenseWhereInput,
          include: { targetUnit: { select: { code: true } } },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
        });
      }),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          category: z.enum(EXPENSE_CATEGORIES),
          customCategory: z.string().max(80).optional(),
          description: z.string().min(2),
          periodYear: z.number().int().min(2020).max(2100),
          periodMonth: z.number().int().min(1).max(12),
          amount: z.coerce.number().positive(),
          currencyPrimary: z.enum(["VES", "USD"]),
          supplierName: z.string().optional(),
          invoiceNumber: z.string().optional(),
          receiptDate: z.coerce.date().optional(),
          notes: z.string().optional(),
          towerScope: z.string().max(20).optional().nullable(),
          isIndividual: z.boolean().default(false),
          targetUnitId: z.string().optional().nullable(),
          /** Plantilla recurrente asociada (para agrupar en el recibo). */
          recurringTemplateId: z.string().optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        registerExpense({ ...input, createdById: ctx.user.id }),
      ),

    /** Emite un cargo directo (EXTRA_FEE) para un gasto individual ya registrado
     *  pero cuyo período tiene facturas emitidas (no se puede re-emitir el mes). */
    issueDirectCharge: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          expenseId: z.string(),
          dueDate: z.coerce.date().transform((d) =>
            new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, expenseId, dueDate } = input;

        // 1. Validar el gasto
        const expense = await ctx.db.expense.findFirstOrThrow({
          where: { id: expenseId, organizationId, communityId },
        });
        if (!expense.isIndividual || !expense.targetUnitId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El gasto no es individual" });
        }
        if (expense.invoicedAt) {
          throw new TRPCError({ code: "CONFLICT", message: "El gasto ya está facturado" });
        }
        if (expense.voidedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El gasto está anulado" });
        }

        // 2. Datos de la unidad y comunidad
        const [unit, community] = await Promise.all([
          ctx.db.unit.findFirstOrThrow({
            where: { id: expense.targetUnitId, communityId, organizationId, deletedAt: null },
          }),
          ctx.db.community.findFirstOrThrow({
            where: { id: communityId, organizationId, deletedAt: null },
            select: { primaryCurrency: true },
          }),
        ]);

        // 3. Tasa actual
        const rate = await (await import("@/server/services/exchange")).getCurrentRate("BCV");
        const usd = new Decimal(expense.amountUsd.toString());
        const bss = new Decimal(expense.amountBss.toString());

        const now = new Date();
        const invoiceNumber = `IND-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${unit.code}-${Date.now().toString(36).toUpperCase()}`;

        const label = expense.customCategory?.trim()
          ? expense.customCategory.trim()
          : (expense.description ?? "Cargo individual");

        // 4. Crear la factura EXTRA_FEE y marcar el gasto como facturado
        const inv = await ctx.db.$transaction(async (tx) => {
          const created = await tx.invoice.create({
            data: {
              organizationId,
              communityId,
              unitId: unit.id,
              invoiceNumber,
              type: "EXTRA_FEE",
              periodYear: expense.periodYear,
              periodMonth: expense.periodMonth,
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
                  expenseId: expense.id,
                  description: label,
                  amountBss: bss.toFixed(2),
                  amountUsd: usd.toFixed(2),
                  aliquot: "100.000000",
                }],
              },
            },
          });
          // Marcar el gasto como facturado
          await tx.expense.update({
            where: { id: expenseId },
            data: { invoicedAt: now },
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: ctx.user.id,
              action: "EXTRA_FEE_APPLIED",
              entityType: "Invoice",
              entityId: created.id,
              after: { expenseId, unitId: unit.id, label, amountUsd: usd.toFixed(2) },
            },
          });
          return created;
        });

        // 5. Notificar al propietario (fire-and-forget)
        void (async () => {
          try {
            const { notifyPerson } = await import("@/server/services/notifications");
            const ownership = await ctx.db.ownership.findFirst({
              where: { unitId: unit.id, endDate: null },
              select: { personId: true },
            });
            if (!ownership) return;
            await notifyPerson({
              organizationId,
              communityId,
              unitId: unit.id,
              personId: ownership.personId,
              event: "INVOICE_ISSUED",
              vars: {
                invoiceNumber: inv.invoiceNumber,
                totalUsd: usd.toFixed(2),
                totalBss: bss.toFixed(2),
                dueDate: dueDate.toLocaleDateString("es-VE"),
              },
            });
          } catch { /* notif opcional */ }
        })();

        return inv;
      }),
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
            items: {
              orderBy: { description: "asc" },
              include: {
                // Incluir expense para mostrar total del gasto y alícuota aplicada
                expense: {
                  select: {
                    id: true,
                    description: true,
                    amountUsd: true,
                    amountBss: true,
                    category: true,
                    customCategory: true,
                    supplierName: true,
                  },
                },
              },
            },
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
            items: {
              orderBy: { description: "asc" },
              include: {
                expense: {
                  select: {
                    id: true, category: true, amountBss: true, amountUsd: true,
                    towerScope: true, isIndividual: true, kind: true,
                    recurringTemplateId: true,
                  },
                },
              },
            },
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
            select: { bankName: true, accountNumber: true, accountHolder: true, accountType: true, currency: true, notes: true },
          }),
        ]);

        const { generateInvoicePdf } = await import("@/server/services/pdf");

        // ── Construir secciones agrupadas (estilo Arrayanes) ───────────────────
        type SectionItem = {
          description: string;
          baseBss: string;
          cuotaUsd: string;
          cuotaBss: string;
        };
        const aliquotPct = inv.unit.aliquot.toString();
        const sectionMap = new Map<string, { title: string; items: SectionItem[] }>();
        const ensureSection = (key: string, title: string) => {
          if (!sectionMap.has(key)) sectionMap.set(key, { title, items: [] });
          return sectionMap.get(key)!;
        };
        for (const it of inv.items) {
          const exp = it.expense;
          let sectionKey: string;
          let sectionTitle: string;
          if (exp?.isIndividual) {
            sectionKey = "individual";
            sectionTitle = "CARGOS INDIVIDUALES";
          } else if (exp?.towerScope) {
            sectionKey = `tower-${exp.towerScope}`;
            sectionTitle = `GASTOS TORRE ${exp.towerScope}`;
          } else {
            sectionKey = "common";
            sectionTitle = "GASTOS COMUNES";
          }
          const section = ensureSection(sectionKey, sectionTitle);
          section.items.push({
            description: it.description,
            baseBss: exp ? exp.amountBss.toString() : it.amountBss.toString(),
            cuotaUsd: it.amountUsd.toString(),
            cuotaBss: it.amountBss.toString(),
          });
        }
        // Ordenar secciones: common, tower-A, tower-B, individual
        const sortKey = (k: string) => k === "common" ? 0 : k.startsWith("tower") ? 1 : 2;
        const sections = Array.from(sectionMap.entries())
          .sort(([a], [b]) => sortKey(a) - sortKey(b))
          .map(([, s]) => {
            const subtotalUsd = s.items.reduce((sum, i) => sum + Number(i.cuotaUsd), 0);
            const subtotalBss = s.items.reduce((sum, i) => sum + Number(i.cuotaBss), 0);
            const baseTotalBss = s.items.reduce((sum, i) => sum + Number(i.baseBss), 0);
            return {
              title: s.title,
              aliquotPercent: aliquotPct,
              baseTotalBss: baseTotalBss.toFixed(2),
              items: s.items,
              subtotalUsd: subtotalUsd.toFixed(2),
              subtotalBss: subtotalBss.toFixed(2),
            };
          });

        // ── Fondo de Reserva (saldo acumulado por unidad) ─────────────────────
        // Sumar TODOS los InvoiceItem con categoría RESERVE_FUND de esta unidad
        // hasta el mes anterior, y aportar del mes corriente por separado.
        const reserveItems = await ctx.db.invoiceItem.findMany({
          where: {
            invoice: {
              unitId: inv.unitId,
              status: { not: "VOIDED" },
            },
            expense: { category: "RESERVE_FUND" },
          },
          include: {
            invoice: { select: { id: true, periodYear: true, periodMonth: true } },
          },
        });
        let prevUsd = 0, prevBss = 0, currUsd = 0, currBss = 0;
        for (const ri of reserveItems) {
          const isCurrent = ri.invoice.periodYear === inv.periodYear && ri.invoice.periodMonth === inv.periodMonth;
          if (isCurrent) {
            currUsd += Number(ri.amountUsd);
            currBss += Number(ri.amountBss);
          } else if (
            ri.invoice.periodYear < inv.periodYear ||
            (ri.invoice.periodYear === inv.periodYear && ri.invoice.periodMonth < inv.periodMonth)
          ) {
            prevUsd += Number(ri.amountUsd);
            prevBss += Number(ri.amountBss);
          }
        }
        const reserveFund = (prevUsd > 0 || currUsd > 0)
          ? {
              previousBalanceUsd: prevUsd.toFixed(2),
              previousBalanceBss: prevBss.toFixed(2),
              contributionUsd: currUsd.toFixed(2),
              contributionBss: currBss.toFixed(2),
              period: `${String(inv.periodMonth).padStart(2, "0")}/${inv.periodYear}`,
              totalUsd: (prevUsd + currUsd).toFixed(2),
              totalBss: (prevBss + currBss).toFixed(2),
            }
          : undefined;

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
          sections,
          reserveFund,
          totalUsd: inv.totalUsd.toString(),
          totalBss: inv.totalBss.toString(),
          paidUsd: inv.paidUsd.toString(),
          paidBss: inv.paidBss.toString(),
          paymentsApplied: inv.payments.map((pa) => ({
            paidAt: pa.payment.paidAt,
            method: pa.payment.method,
            // Importante: el monto de la asignación (lo aplicado a ESTE recibo),
            // no el monto total del pago. Si un pago de $100 se reparte como
            // $30 a abril y $70 a mayo, en cada recibo aparece su porción.
            amountUsd: pa.amountUsd.toString(),
            amountBss: pa.amountBss.toString(),
            reference: pa.payment.reference,
          })),
          bankAccounts: bankAccounts.map((b) => ({
            bankName: b.bankName,
            accountNumber: b.accountNumber,
            accountHolder: b.accountHolder,
            accountType: b.accountType,
            currency: b.currency,
            notes: b.notes,
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

    /**
     * Genera un PDF preview de cómo se verá el recibo del mes para UNA unidad,
     * SIN persistir nada. Usa exactamente el mismo render que el recibo real
     * (generateInvoicePdf). Pedido del cliente: "previsualizar el recibo que
     * se emitirá... como lo verán los residentes".
     */
    previewReceiptPdf: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          year: z.number().int().min(2020).max(2100),
          month: z.number().int().min(1).max(12),
          /** Si no se especifica, toma la primera unidad activa del condominio. */
          unitId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { prorate } = await import("@/lib/proration");
        const { generateInvoicePdf } = await import("@/server/services/pdf");

        // ── Cargar datos ────────────────────────────────────────────────
        const [community, units, expensesAll, deductibleIncomes, bankAccounts] = await Promise.all([
          ctx.db.community.findFirstOrThrow({
            where: { id: input.communityId, organizationId: input.organizationId },
            select: { name: true, address: true, rif: true, phone: true, monthlyFeeUsd: true },
          }),
          ctx.db.unit.findMany({
            where: { communityId: input.communityId, active: true, deletedAt: null },
            select: { id: true, code: true, aliquot: true, tower: true, floor: true },
            orderBy: { code: "asc" },
          }),
          ctx.db.expense.findMany({
            where: {
              communityId: input.communityId,
              periodYear: input.year,
              periodMonth: input.month,
              invoicedAt: null,
              voidedAt: null,
            },
            include: { recurringTemplate: { select: { description: true, isProvision: true } } },
          }),
          ctx.db.income.findMany({
            where: {
              communityId: input.communityId,
              periodYear: input.year,
              periodMonth: input.month,
              affectsInvoice: true,
              voidedAt: null,
            },
          }),
          ctx.db.bankAccount.findMany({
            where: { communityId: input.communityId, active: true },
            select: { bankName: true, accountNumber: true, accountHolder: true, accountType: true, currency: true, notes: true },
          }),
        ]);

        if (units.length === 0) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No hay unidades activas" });
        }
        const targetUnit = input.unitId
          ? units.find((u) => u.id === input.unitId)
          : units[0];
        if (!targetUnit) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Unidad no encontrada" });
        }

        // Excluir REGULAR de plantilla isProvision (igual que issueMonthlyInvoices)
        const expenses = expensesAll.filter(
          (e) => !(e.kind === "REGULAR" && e.recurringTemplate?.isProvision === true),
        );

        const ownership = await ctx.db.ownership.findFirst({
          where: { unitId: targetUnit.id, endDate: null },
          include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
        });

        const rateRecord = await getCurrentRate("BCV", new Date(input.year, input.month, 0));
        const usdRate = new Decimal(rateRecord.vesPerUsd);

        // ── Calcular líneas para la unidad target ───────────────────────
        type Line = { description: string; baseBss: Decimal; cuotaUsd: Decimal; cuotaBss: Decimal; section: "common" | "tower" | "individual" };
        const lines: Line[] = [];

        const individualExpenses = expenses.filter((e) => e.isIndividual && e.targetUnitId === targetUnit.id);
        const towerExpenses = expenses.filter((e) => !e.isIndividual && e.towerScope === targetUnit.tower);
        const generalExpenses = expenses.filter((e) => !e.isIndividual && !e.towerScope);

        const totalIncomeDeductionUsd = deductibleIncomes.reduce((s, i) => s.plus(i.amountUsd.toString()), new Decimal(0));
        const generalUsdSum = generalExpenses.reduce((s, e) => s.plus(e.amountUsd.toString()), new Decimal(0));
        const deductionFactor = generalUsdSum.gt(0)
          ? Decimal.min(totalIncomeDeductionUsd.div(generalUsdSum), new Decimal(1))
          : new Decimal(0);

        // 1. Individuales
        for (const e of individualExpenses) {
          lines.push({
            description: e.customCategory ?? e.description,
            baseBss: new Decimal(e.amountBss.toString()),
            cuotaUsd: new Decimal(e.amountUsd.toString()),
            cuotaBss: new Decimal(e.amountBss.toString()),
            section: "individual",
          });
        }
        // 2. Torre
        const towerUnits = units.filter((u) => u.tower === targetUnit.tower);
        if (towerUnits.length > 0) {
          const participants = towerUnits.map((u) => ({ key: u.id, aliquot: u.aliquot.toString() }));
          for (const e of towerExpenses) {
            const usdDist = prorate(e.amountUsd.toString(), participants);
            const bssDist = prorate(e.amountBss.toString(), participants);
            const cuotaUsd = new Decimal(usdDist.get(targetUnit.id)?.toString() ?? 0);
            const cuotaBss = new Decimal(bssDist.get(targetUnit.id)?.toString() ?? 0);
            if (cuotaUsd.eq(0) && cuotaBss.eq(0)) continue;
            lines.push({
              description: `${e.customCategory ?? e.description} (Torre ${e.towerScope})`,
              baseBss: new Decimal(e.amountBss.toString()),
              cuotaUsd, cuotaBss,
              section: "tower",
            });
          }
        }
        // 3. Generales (con descuento)
        const allParticipants = units.map((u) => ({ key: u.id, aliquot: u.aliquot.toString() }));
        // Agrupar por (category|customCategory) para evitar 10 líneas del mismo sector
        const grouped = new Map<string, { description: string; sumUsd: Decimal; sumBss: Decimal; kind: string }>();
        for (const e of generalExpenses) {
          const key = e.recurringTemplateId
            ? `tpl-${e.recurringTemplateId}`
            : (e.kind === "PROVISION_BASE" || e.kind === "PROVISION_ADJUSTMENT")
              ? `iso-${e.id}`  // cada provisión su propia línea
              : `cat-${e.category}|${e.customCategory ?? ""}`;
          const desc = e.recurringTemplate?.description
            ? (e.kind === "PROVISION_BASE" ? `Provisión ${e.recurringTemplate.description}`
              : e.kind === "PROVISION_ADJUSTMENT" ? `Ajuste Provisión ${e.recurringTemplate.description} — mes anterior`
              : e.recurringTemplate.description)
            : (e.customCategory ?? e.description);
          const existing = grouped.get(key);
          if (existing) {
            existing.sumUsd = existing.sumUsd.plus(e.amountUsd.toString());
            existing.sumBss = existing.sumBss.plus(e.amountBss.toString());
          } else {
            grouped.set(key, {
              description: desc,
              sumUsd: new Decimal(e.amountUsd.toString()),
              sumBss: new Decimal(e.amountBss.toString()),
              kind: e.kind,
            });
          }
        }
        for (const g of grouped.values()) {
          const adjUsd = g.sumUsd.mul(new Decimal(1).minus(deductionFactor));
          const adjBss = g.sumBss.mul(new Decimal(1).minus(deductionFactor));
          const usdDist = prorate(adjUsd.toFixed(2), allParticipants);
          const bssDist = prorate(adjBss.toFixed(2), allParticipants);
          const cuotaUsd = new Decimal(usdDist.get(targetUnit.id)?.toString() ?? 0);
          const cuotaBss = new Decimal(bssDist.get(targetUnit.id)?.toString() ?? 0);
          if (cuotaUsd.eq(0) && cuotaBss.eq(0)) continue;
          lines.push({
            description: g.description,
            baseBss: g.sumBss,
            cuotaUsd, cuotaBss,
            section: "common",
          });
        }
        // 4. Cuota mensual
        if (community.monthlyFeeUsd && Number(community.monthlyFeeUsd) > 0) {
          const feeUsd = new Decimal(community.monthlyFeeUsd.toString());
          const feeBss = feeUsd.mul(usdRate);
          lines.push({
            description: "Cuota de condominio mensual",
            baseBss: feeBss.mul(units.length),  // total que aporta toda la comunidad
            cuotaUsd: feeUsd,
            cuotaBss: feeBss,
            section: "common",
          });
        }

        // ── Armar sections para el PDF ──────────────────────────────────
        const aliquotPct = targetUnit.aliquot.toString();
        const sectionsMap = new Map<"common" | "tower" | "individual", { title: string; items: Line[] }>();
        for (const ln of lines) {
          if (!sectionsMap.has(ln.section)) {
            const title = ln.section === "common"
              ? "GASTOS COMUNES"
              : ln.section === "tower"
                ? `GASTOS TORRE ${targetUnit.tower ?? ""}`
                : "CARGOS INDIVIDUALES";
            sectionsMap.set(ln.section, { title, items: [] });
          }
          sectionsMap.get(ln.section)!.items.push(ln);
        }
        const order: Array<"common" | "tower" | "individual"> = ["common", "tower", "individual"];
        const sections = order
          .filter((k) => sectionsMap.has(k))
          .map((k) => {
            const s = sectionsMap.get(k)!;
            const subtotalUsd = s.items.reduce((sum, i) => sum.plus(i.cuotaUsd), new Decimal(0));
            const subtotalBss = s.items.reduce((sum, i) => sum.plus(i.cuotaBss), new Decimal(0));
            const baseTotalBss = s.items.reduce((sum, i) => sum.plus(i.baseBss), new Decimal(0));
            return {
              title: s.title,
              aliquotPercent: aliquotPct,
              baseTotalBss: baseTotalBss.toFixed(2),
              items: s.items.map((i) => ({
                description: i.description,
                baseBss: i.baseBss.toFixed(2),
                cuotaUsd: i.cuotaUsd.toFixed(2),
                cuotaBss: i.cuotaBss.toFixed(2),
              })),
              subtotalUsd: subtotalUsd.toFixed(2),
              subtotalBss: subtotalBss.toFixed(2),
            };
          });

        const totalUsd = sections.reduce((s, sec) => s + Number(sec.subtotalUsd), 0);
        const totalBss = sections.reduce((s, sec) => s + Number(sec.subtotalBss), 0);

        const now = new Date();
        const buffer = await generateInvoicePdf({
          communityName: community.name,
          communityAddress: community.address ?? "",
          communityRif: community.rif,
          communityPhone: community.phone,
          invoiceNumber: `PREVIEW-${input.year}${String(input.month).padStart(2, "0")}-${targetUnit.code}`,
          periodYear: input.year,
          periodMonth: input.month,
          issuedAt: now,
          dueDate: now,
          status: "DRAFT",
          exchangeRate: usdRate.toFixed(8),
          exchangeSource: rateRecord.source,
          unitCode: targetUnit.code,
          unitFloor: targetUnit.floor,
          unitTower: targetUnit.tower,
          ownerName: ownership?.person
            ? `${ownership.person.firstName} ${ownership.person.lastName}`
            : "(Sin propietario registrado)",
          ownerIdType: ownership?.person?.idType,
          ownerIdNumber: ownership?.person?.idNumber,
          items: lines.map((l) => ({
            description: l.description,
            amountUsd: l.cuotaUsd.toFixed(2),
            amountBss: l.cuotaBss.toFixed(2),
          })),
          sections,
          totalUsd: totalUsd.toFixed(2),
          totalBss: totalBss.toFixed(2),
          paidUsd: "0",
          paidBss: "0",
          bankAccounts: bankAccounts.map((b) => ({
            bankName: b.bankName,
            accountNumber: b.accountNumber,
            accountHolder: b.accountHolder,
            accountType: b.accountType,
            currency: b.currency,
            notes: b.notes,
          })),
        });

        return {
          base64: buffer.toString("base64"),
          mimeType: "application/pdf",
          fileName: `Preview-Recibo-${targetUnit.code}-${input.year}-${String(input.month).padStart(2, "0")}.pdf`,
          unitCode: targetUnit.code,
          totalUsd: totalUsd.toFixed(2),
          totalBss: totalBss.toFixed(2),
        };
      }),

    /**
     * Genera una carta de cobro extrajudicial (Art. 14 LPH) para una unidad
     * con facturas en mora. Devuelve el PDF en base64 para descarga.
     */
    generateLegalNotice: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string(),
          reason: z.enum(["OVERDUE_90", "OVERDUE_180", "OTHER"]).default("OVERDUE_90"),
          customMessage: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, unitId, reason, customMessage } = input;

        // 1. Cargar unidad, propietario, comunidad
        const [unit, community, ownership, pendingInvoices, rate] = await Promise.all([
          ctx.db.unit.findFirstOrThrow({
            where: { id: unitId, communityId, organizationId, deletedAt: null },
          }),
          ctx.db.community.findFirstOrThrow({
            where: { id: communityId, organizationId, deletedAt: null },
            select: {
              name: true, address: true, rif: true, phone: true, city: true,
            },
          }),
          ctx.db.ownership.findFirst({
            where: { unitId, endDate: null },
            include: {
              person: {
                select: { firstName: true, lastName: true, idType: true, idNumber: true, address: true },
              },
            },
          }),
          ctx.db.invoice.findMany({
            where: {
              unitId,
              communityId,
              organizationId,
              status: { notIn: ["VOIDED", "PAID"] },
            },
            orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
          }),
          (await import("@/server/services/exchange")).getCurrentRate("BCV"),
        ]);

        // 2. Filtrar facturas con monto pendiente real (> 0)
        const today = new Date();
        const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                          "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
        const items = pendingInvoices
          .map((inv) => {
            const pendingUsd = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
            const pendingBss = new Decimal(inv.totalBss.toString()).minus(inv.paidBss.toString());
            const dueDate = new Date(inv.dueDate);
            const diffMs = today.getTime() - dueDate.getTime();
            const daysOverdue = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
            return {
              invoiceNumber: inv.invoiceNumber,
              periodLabel: `${MESES_ES[inv.periodMonth - 1] ?? ""} ${inv.periodYear}`,
              dueDate,
              daysOverdue,
              pendingUsd,
              pendingBss,
            };
          })
          .filter((it) => it.pendingUsd.gt(0.005));

        if (items.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La unidad no tiene deudas pendientes",
          });
        }

        const totalUsd = items.reduce((acc, it) => acc.plus(it.pendingUsd), new Decimal(0));
        const totalBss = items.reduce((acc, it) => acc.plus(it.pendingBss), new Decimal(0));

        // 3. Generar correlativo de aviso
        const noticeNumber = `AVISO-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${unit.code}-${Date.now().toString(36).toUpperCase()}`;

        // 4. Construir datos del PDF
        const ownerName = ownership?.person
          ? `${ownership.person.firstName} ${ownership.person.lastName}`
          : "Propietario / Ocupante de la unidad";

        const { generateLegalNoticePdf } = await import("@/server/services/pdf");
        const buffer = await generateLegalNoticePdf({
          communityName: community.name,
          communityAddress: community.address ?? "",
          communityRif: community.rif,
          communityCity: community.city,
          communityPhone: community.phone,
          noticeNumber,
          noticeDate: today,
          reason,
          customMessage: customMessage ?? null,
          ownerName,
          ownerIdType: ownership?.person?.idType ?? null,
          ownerIdNumber: ownership?.person?.idNumber ?? null,
          unitCode: unit.code,
          unitTower: unit.tower,
          unitFloor: unit.floor,
          invoices: items.map((it) => ({
            invoiceNumber: it.invoiceNumber,
            periodLabel: it.periodLabel,
            dueDate: it.dueDate,
            daysOverdue: it.daysOverdue,
            pendingUsd: it.pendingUsd.toFixed(2),
            pendingBss: it.pendingBss.toFixed(2),
          })),
          totalPendingUsd: totalUsd.toFixed(2),
          totalPendingBss: totalBss.toFixed(2),
          exchangeRate: rate.vesPerUsd.toString(),
          exchangeSource: rate.source,
          graceDays: 15,
          signerName: null,
          signerRole: null,
        });

        // 5. Audit log
        await ctx.db.auditLog.create({
          data: {
            organizationId,
            actorId: ctx.user.id,
            action: "EXPORT",
            entityType: "Unit",
            entityId: unitId,
            after: {
              noticeNumber,
              reason,
              invoicesCount: items.length,
              totalPendingUsd: totalUsd.toFixed(2),
            },
          },
        });

        return {
          base64: buffer.toString("base64"),
          fileName: `Aviso-Cobro-${unit.code}-${noticeNumber}.pdf`,
          mimeType: "application/pdf",
          noticeNumber,
          invoicesCount: items.length,
          totalPendingUsd: totalUsd.toFixed(2),
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
          include: { person: { select: { id: true, firstName: true, lastName: true, email: true } } },
        });
        const person = ownership?.person;
        if (!person?.email) {
          return { success: false, error: "El propietario no tiene email registrado" };
        }

        // Generar / reusar portal token para incluir link directo en el email
        const baseUrl = process.env.NEXTAUTH_URL ?? "https://condominios-theta.vercel.app";
        let portalUrl: string | undefined;
        try {
          const existingToken = await ctx.db.portalToken.findFirst({
            where: { personId: person.id, expiresAt: { gt: new Date() } },
            orderBy: { expiresAt: "desc" },
          });
          const tokenRecord = existingToken ?? await ctx.db.portalToken.create({
            data: { personId: person.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
          });
          portalUrl = `${baseUrl}/portal?t=${tokenRecord.token}`;
        } catch { /* no bloquear */ }

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
          portalUrl,
        });

        const result = await sendEmail({ to: person.email, ...emailData });
        return result;
      }),

    /** Progreso de envío masivo de emails del período (para el panel de estado en UI). */
    emailProgress: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          year:  z.number().int(),
          month: z.number().int().min(1).max(12),
        }),
      )
      .query(async ({ ctx, input }) => {
        const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
        const monthEnd   = new Date(Date.UTC(input.year, input.month, 1));

        const [totalInvoices, sentCount, failedCount, todayCount] = await Promise.all([
          // Total de facturas ISSUED+ para el período
          ctx.db.invoice.count({
            where: {
              organizationId: input.organizationId,
              communityId:    input.communityId,
              periodYear:     input.year,
              periodMonth:    input.month,
              status: { in: ["ISSUED", "PARTIAL", "PAID", "OVERDUE"] },
            },
          }),
          // Emails enviados exitosamente este período
          ctx.db.notification.count({
            where: {
              organizationId: input.organizationId,
              communityId:    input.communityId,
              event:   "INVOICE_ISSUED",
              channel: "EMAIL",
              status:  "SENT",
              sentAt:  { gte: monthStart, lt: monthEnd },
            },
          }),
          // Emails fallidos este período
          ctx.db.notification.count({
            where: {
              organizationId: input.organizationId,
              communityId:    input.communityId,
              event:   "INVOICE_ISSUED",
              channel: "EMAIL",
              status:  "FAILED",
              sentAt:  { gte: monthStart, lt: monthEnd },
            },
          }),
          // Emails enviados hoy (para mostrar el cap diario)
          ctx.db.notification.count({
            where: {
              organizationId: input.organizationId,
              communityId:    input.communityId,
              event:   "INVOICE_ISSUED",
              channel: "EMAIL",
              status:  "SENT",
              sentAt:  { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
            },
          }),
        ]);

        return {
          total:   totalInvoices,
          sent:    sentCount,
          failed:  failedCount,
          pending: Math.max(0, totalInvoices - sentCount - failedCount),
          todaySent: todayCount,
          dailyCap:  40,
          complete: sentCount + failedCount >= totalInvoices && totalInvoices > 0,
        };
      }),

    /** Publica todos los borradores (DRAFT → ISSUED) de un período dado. */
    publishDrafts: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        year:  z.number().int(),
        month: z.number().int().min(1).max(12),
      }))
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const drafts = await ctx.db.invoice.findMany({
          where: {
            organizationId: input.organizationId,
            communityId:    input.communityId,
            periodYear:     input.year,
            periodMonth:    input.month,
            status: "DRAFT",
          },
          select: { id: true, unitId: true },
        });
        if (drafts.length === 0) return { published: 0 };

        await ctx.db.invoice.updateMany({
          where: { id: { in: drafts.map(d => d.id) } },
          data:  { status: "ISSUED", issuedAt: now },
        });

        // Crear notificaciones IN_APP para cada propietario
        for (const draft of drafts) {
          const ownership = await ctx.db.ownership.findFirst({
            where: { unitId: draft.unitId, endDate: null },
            select: { personId: true },
          });
          if (!ownership) continue;
          await ctx.db.notification.create({
            data: {
              organizationId: input.organizationId,
              communityId:    input.communityId,
              unitId:         draft.unitId,
              personId:       ownership.personId,
              channel: "IN_APP",
              event:   "INVOICE_ISSUED",
              status:  "SENT",
              sentAt:  now,
              body:    `Tu recibo de condominio ${input.month}/${input.year} ha sido emitido.`,
            },
          }).catch(() => {/* ignore */});
        }

        return { published: drafts.length };
      }),

    /**
     * Envía emails a las unidades que aún no recibieron su recibo del período,
     * hasta un máximo de `batchSize` por llamada. Sin delays — ideal para disparo manual.
     */
    sendEmailBatch: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        year:  z.number().int(),
        month: z.number().int().min(1).max(12),
        batchSize: z.number().int().min(1).max(40).default(40),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, year, month, batchSize } = input;
        const monthStart = new Date(Date.UTC(year, month - 1, 1));
        const monthEnd   = new Date(Date.UTC(year, month, 1));

        // Unidades que ya recibieron email este período (SENT o FAILED = ya intentado)
        const alreadySent = await ctx.db.notification.findMany({
          where: {
            organizationId, communityId,
            event: "INVOICE_ISSUED", channel: "EMAIL",
            status: { in: ["SENT", "FAILED"] },
            sentAt: { gte: monthStart, lt: monthEnd },
          },
          select: { unitId: true },
        });
        const sentUnitIds = new Set(alreadySent.map(n => n.unitId).filter(Boolean) as string[]);

        // Facturas ISSUED sin email enviado aún
        const pending = await ctx.db.invoice.findMany({
          where: {
            organizationId, communityId,
            periodYear: year, periodMonth: month,
            status: { in: ["ISSUED", "PARTIAL", "PAID", "OVERDUE"] },
            unitId: { notIn: [...sentUnitIds] },
          },
          include: {
            unit: {
              select: {
                id: true, code: true,
                ownerships: {
                  where: { endDate: null }, take: 1,
                  include: { person: { select: { id: true, firstName: true, lastName: true, email: true } } },
                },
              },
            },
            items: {
              select: { description: true, amountUsd: true, amountBss: true },
            },
          },
          take: batchSize,
          orderBy: { invoiceNumber: "asc" },
        });

        if (pending.length === 0) return { sent: 0, failed: 0, message: "Sin pendientes" };

        // Importar helpers de email (ambos están en el mismo módulo)
        const { sendEmail, buildInvoiceEmail } = await import("@/server/services/email");
        const now = new Date();
        const portalBase = process.env.NEXTAUTH_URL ?? "https://condominios-theta.vercel.app";

        // Datos de la comunidad (nombre, dirección) para el email
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id: communityId, organizationId },
          select: { name: true, address: true },
        });

        let sent = 0, failed = 0;
        for (const inv of pending) {
          const person = inv.unit.ownerships[0]?.person;
          const notifData = {
            organizationId, communityId,
            unitId:   inv.unit.id,
            personId: person?.id ?? null,
            channel:  "EMAIL" as const,
            event:    "INVOICE_ISSUED" as const,
            sentAt:   now,
          };

          if (!person?.email) {
            await ctx.db.notification.create({ data: { ...notifData, status: "FAILED", body: "Sin email" } }).catch(() => {/**/});
            failed++;
            continue;
          }

          try {
            // PortalToken es por persona, no por unidad
            const portalToken = await ctx.db.portalToken.findFirst({
              where: { personId: person.id, expiresAt: { gt: now } },
              orderBy: { expiresAt: "desc" },
            });
            const portalUrl = portalToken
              ? `${portalBase}/portal?token=${portalToken.token}`
              : portalBase;

            const emailData = buildInvoiceEmail({
              communityName:    community.name,
              communityAddress: community.address ?? undefined,
              personName:       `${person.firstName} ${person.lastName}`,
              unitCode:         inv.unit.code,
              invoiceNumber:    inv.invoiceNumber,
              periodYear:       inv.periodYear,
              periodMonth:      inv.periodMonth,
              issuedAt:         inv.issuedAt,
              dueDate:          inv.dueDate,
              items:            inv.items.map((item) => ({
                description: item.description,
                amountUsd:   item.amountUsd.toString(),
                amountBss:   item.amountBss.toString(),
              })),
              totalUsd:     inv.totalUsd.toString(),
              totalBss:     inv.totalBss.toString(),
              paidUsd:      inv.paidUsd.toString(),
              exchangeRate: inv.exchangeRate.toString(),
              status:       inv.status,
              portalUrl,
            });

            const result = await sendEmail({ to: person.email, ...emailData });
            await ctx.db.notification.create({
              data: { ...notifData, status: result.success ? "SENT" : "FAILED", body: emailData.text ?? "" },
            }).catch(() => {/**/});
            if (result.success) sent++; else failed++;
          } catch {
            await ctx.db.notification.create({ data: { ...notifData, status: "FAILED", body: "Error al enviar" } }).catch(() => {/**/});
            failed++;
          }
        }

        return { sent, failed, remaining: pending.length - sent - failed };
      }),

    /** Preview de lo que se facturaría este mes (sin guardar nada). */
    previewMonth: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
      }))
      .query(async ({ ctx, input }) => {
        const { prorate } = await import("@/lib/proration");

        const [expenses, units, existing, community, deductibleIncomes] = await Promise.all([
          ctx.db.expense.findMany({
            where: {
              communityId: input.communityId,
              periodYear: input.year,
              periodMonth: input.month,
              invoicedAt: null,
              voidedAt: null,
            },
            select: {
              id: true, description: true, category: true, customCategory: true,
              amountUsd: true, amountBss: true,
              isIndividual: true, targetUnitId: true, towerScope: true,
            },
          }),
          ctx.db.unit.findMany({
            where: { communityId: input.communityId, active: true, deletedAt: null },
            select: { id: true, code: true, aliquot: true, tower: true },
            orderBy: { code: "asc" },
          }),
          ctx.db.invoice.count({
            where: {
              communityId: input.communityId,
              periodYear: input.year,
              periodMonth: input.month,
              status: { not: "VOIDED" },
            },
          }),
          ctx.db.community.findFirstOrThrow({
            where: { id: input.communityId, organizationId: input.organizationId },
            select: { monthlyFeeUsd: true },
          }),
          ctx.db.income.findMany({
            where: {
              communityId: input.communityId,
              periodYear: input.year,
              periodMonth: input.month,
              affectsInvoice: true,
              voidedAt: null,
            },
            select: { amountUsd: true, amountBss: true, description: true, customCategory: true, category: true },
          }),
        ]);

        const totalExpensesUsd = expenses.reduce((s, e) => s + Number(e.amountUsd), 0);
        const totalExpensesBss = expenses.reduce((s, e) => s + Number(e.amountBss), 0);
        const totalIncomeDeductionUsd = deductibleIncomes.reduce((s, i) => s + Number(i.amountUsd), 0);

        // Replicar el cálculo real de issueMonthlyInvoices para que el preview
        // coincida exactamente con lo que se va a emitir.
        const individualExpenses = expenses.filter((e) => e.isIndividual && e.targetUnitId);
        const towerExpenses = expenses.filter((e) => !e.isIndividual && e.towerScope);
        const generalExpenses = expenses.filter((e) => !e.isIndividual && !e.towerScope);
        const generalUsd = generalExpenses.reduce((s, e) => s + Number(e.amountUsd), 0);
        const deductionFactor = generalUsd > 0
          ? Math.min(totalIncomeDeductionUsd / generalUsd, 1)
          : 0;

        const feeUsd = community.monthlyFeeUsd ? Number(community.monthlyFeeUsd) : 0;

        const unitTotals = new Map<string, { usd: number; bss: number; lines: { desc: string; usd: number }[] }>();
        for (const u of units) unitTotals.set(u.id, { usd: 0, bss: 0, lines: [] });

        // 1. Individuales
        for (const exp of individualExpenses) {
          if (!exp.targetUnitId) continue;
          const t = unitTotals.get(exp.targetUnitId);
          if (!t) continue;
          const u = Number(exp.amountUsd);
          const b = Number(exp.amountBss);
          t.usd += u; t.bss += b;
          t.lines.push({ desc: `${exp.customCategory ?? exp.description} (individual)`, usd: u });
        }

        // 2. Por torre
        for (const exp of towerExpenses) {
          const towerUnits = units.filter((u) => u.tower === exp.towerScope);
          if (towerUnits.length === 0) continue;
          const participants = towerUnits.map((u) => ({ key: u.id, aliquot: u.aliquot.toString() }));
          const usdDist = prorate(Number(exp.amountUsd).toFixed(2), participants);
          const bssDist = prorate(Number(exp.amountBss).toFixed(2), participants);
          for (const u of towerUnits) {
            const t = unitTotals.get(u.id)!;
            const uu = Number(usdDist.get(u.id)?.toString() ?? 0);
            const bb = Number(bssDist.get(u.id)?.toString() ?? 0);
            t.usd += uu; t.bss += bb;
            t.lines.push({ desc: `${exp.customCategory ?? exp.description} (Torre ${exp.towerScope})`, usd: uu });
          }
        }

        // 3. Generales (con descuento por ingresos)
        const participants = units.map((u) => ({ key: u.id, aliquot: u.aliquot.toString() }));
        for (const exp of generalExpenses) {
          const adjUsd = Number(exp.amountUsd) * (1 - deductionFactor);
          const adjBss = Number(exp.amountBss) * (1 - deductionFactor);
          const usdDist = prorate(adjUsd.toFixed(2), participants);
          const bssDist = prorate(adjBss.toFixed(2), participants);
          for (const u of units) {
            const t = unitTotals.get(u.id)!;
            const uu = Number(usdDist.get(u.id)?.toString() ?? 0);
            const bb = Number(bssDist.get(u.id)?.toString() ?? 0);
            t.usd += uu; t.bss += bb;
            if (uu > 0) t.lines.push({ desc: exp.customCategory ?? exp.description, usd: uu });
          }
        }

        // 4. Cuota mensual
        if (feeUsd > 0) {
          for (const u of units) {
            const t = unitTotals.get(u.id)!;
            t.usd += feeUsd;
            t.lines.push({ desc: "Cuota de condominio mensual", usd: feeUsd });
          }
        }

        const unitPreviews = units.map((u) => {
          const t = unitTotals.get(u.id)!;
          return {
            unitCode: u.code,
            tower: u.tower,
            aliquot: Number(u.aliquot).toFixed(4),
            totalUsd: t.usd.toFixed(2),
            totalBss: t.bss.toFixed(2),
            lineCount: t.lines.length,
          };
        });

        const grandTotalUsd = unitPreviews.reduce((s, u) => s + Number(u.totalUsd), 0);

        return {
          expenses: expenses.map(e => ({
            description: e.customCategory ?? e.description,
            amountUsd: Number(e.amountUsd).toFixed(2),
            amountBss: Number(e.amountBss).toFixed(2),
            scope: e.isIndividual ? "individual" : e.towerScope ? `torre ${e.towerScope}` : "general",
          })),
          totalExpensesUsd: totalExpensesUsd.toFixed(2),
          totalExpensesBss: totalExpensesBss.toFixed(2),
          incomeDeduction: {
            totalUsd: totalIncomeDeductionUsd.toFixed(2),
            count: deductibleIncomes.length,
          },
          monthlyFeeUsd: feeUsd.toFixed(2),
          unitCount: units.length,
          unitPreviews,
          grandTotalUsd: grandTotalUsd.toFixed(2),
          alreadyIssued: existing > 0,
        };
      }),
  }),

  // ─── Cierre de mes ─────────────────────────────────────────────
  monthClose: router({
    list: orgProcedure
      .input(orgIdInput.extend({ communityId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.monthClose.findMany({
          where: { communityId: input.communityId },
          include: { closedBy: { select: { name: true, email: true } } },
          orderBy: [{ year: "desc" }, { month: "desc" }],
        }),
      ),

    isOpen: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
      }))
      .query(async ({ ctx, input }) => {
        const close = await ctx.db.monthClose.findUnique({
          where: { communityId_year_month: { communityId: input.communityId, year: input.year, month: input.month } },
        });
        return { closed: !!close, closedAt: close?.closedAt ?? null };
      }),

    close: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db.monthClose.findUnique({
          where: { communityId_year_month: { communityId: input.communityId, year: input.year, month: input.month } },
        });
        if (existing) throw new Error("Este mes ya fue cerrado");

        const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
        const monthEnd   = new Date(Date.UTC(input.year, input.month, 1));

        const [expAgg, invAgg, payAgg] = await Promise.all([
          ctx.db.expense.aggregate({
            where: { communityId: input.communityId, periodYear: input.year, periodMonth: input.month },
            _sum: { amountUsd: true }, _count: true,
          }),
          ctx.db.invoice.aggregate({
            where: { communityId: input.communityId, periodYear: input.year, periodMonth: input.month, status: { not: "VOIDED" } },
            _sum: { totalUsd: true, paidUsd: true }, _count: true,
          }),
          ctx.db.payment.aggregate({
            where: { communityId: input.communityId, voidedAt: null, paidAt: { gte: monthStart, lt: monthEnd } },
            _sum: { amountUsd: true }, _count: true,
          }),
        ]);

        const expSumUsd  = Number(expAgg._sum?.amountUsd ?? 0);
        const invTotalUsd = Number(invAgg._sum?.totalUsd ?? 0);
        const invPaidUsd  = Number(invAgg._sum?.paidUsd ?? 0);
        const payTotalUsd = Number(payAgg._sum?.amountUsd ?? 0);
        const summary = {
          totalExpensesUsd:  expSumUsd.toFixed(2),
          expenseCount:      expAgg._count,
          totalInvoicedUsd:  invTotalUsd.toFixed(2),
          totalCollectedUsd: invPaidUsd.toFixed(2),
          invoiceCount:      invAgg._count,
          totalPaymentsUsd:  payTotalUsd.toFixed(2),
          paymentCount:      payAgg._count,
          collectionRate:    invTotalUsd > 0 ? Math.round((invPaidUsd / invTotalUsd) * 100) : 0,
        };

        return ctx.db.monthClose.create({
          data: {
            organizationId: input.organizationId,
            communityId:    input.communityId,
            year:           input.year,
            month:          input.month,
            closedById:     ctx.user.id,
            summary,
            notes:          input.notes,
          },
        });
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
    listForReconciliation: orgProcedure
      .input(orgIdInput.extend({ communityId: z.string() }))
      .query(async ({ ctx, input }) => {
        const payments = await ctx.db.payment.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            voidedAt: null,
          },
          include: {
            unit: {
              select: {
                code: true,
                ownerships: {
                  where: { endDate: null },
                  take: 1,
                  include: { person: { select: { firstName: true, lastName: true } } },
                },
              },
            },
          },
          orderBy: { paidAt: "desc" },
        });
        return payments.map(p => ({
          id: p.id,
          reference: p.reference,
          amountUsd: p.amountUsd.toString(),
          // Bs reales que movió el pago en su momento (tasa histórica), para
          // conciliar contra el extracto bancario sin distorsión por movimientos
          // posteriores del dólar.
          amountBss: p.amountBss.toString(),
          exchangeRate: p.exchangeRate.toString(),
          currencyPrimary: p.currencyPrimary,
          paidAt: p.paidAt.toISOString(),
          unitLabel: p.unit.code,
          ownerName: p.unit.ownerships[0]
            ? `${p.unit.ownerships[0].person.firstName} ${p.unit.ownerships[0].person.lastName}`
            : "Sin propietario",
        }));
      }),
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
          // Feature 7: también crear entrada de ingreso con la misma referencia
          alsoCreateIncome: z.boolean().default(false),
          incomeCategory: z.enum([
            "HALL_RENTAL", "PARKING_FEE", "GUEST_FEE", "INTEREST", "DONATION", "PENALTY", "OTHER",
          ]).optional(),
          incomeDescription: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const payment = await recordPayment({ ...input, createdById: ctx.user.id });

        // Feature 7: Si se pidió también registrar como ingreso, crearlo con la misma referencia
        if (input.alsoCreateIncome) {
          const paidAt = new Date(input.paidAt);
          await registerIncome({
            organizationId:  input.organizationId,
            communityId:     input.communityId,
            category:        input.incomeCategory ?? "OTHER",
            description:     input.incomeDescription ?? `Ingreso vinculado a pago — ref ${input.reference ?? payment.id}`,
            periodYear:      paidAt.getFullYear(),
            periodMonth:     paidAt.getMonth() + 1,
            amount:          input.amount,
            currencyPrimary: input.currencyPrimary,
            reference:       input.reference,
            affectsInvoice:  false,
            exchangeSource:  "MANUAL",
            createdById:     ctx.user.id,
          });
        }

        return payment;
      }),

    /**
     * Aprueba un pago reportado por un residente desde el portal.
     * Auto-asigna el monto a las facturas ISSUED/PARTIAL de la unidad
     * ordenadas por fecha de vencimiento (las más antiguas primero).
     * Si sobra monto tras cubrir todas las facturas, queda como anticipo.
     */
    approve: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string(),
          notificationId: z.string(), // ID de la Notification a marcar como verificada
          amount: z.coerce.number().positive(),
          currencyPrimary: z.enum(["USD", "VES"]),
          method: z.string(),
          reference: z.string().optional(),
          paidAt: z.coerce.date(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // CRÍTICO: incluir OVERDUE. Las facturas SALDO ANTERIOR del reset están en
        // status OVERDUE; antes el filtro solo aceptaba ISSUED/PARTIAL → allocations
        // quedaban vacías → pago caía como anticipo (bug "no descuenta la deuda").
        const pendingInvoices = await ctx.db.invoice.findMany({
          where: {
            organizationId: input.organizationId,
            unitId: input.unitId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
          },
          orderBy: { dueDate: "asc" },
          select: {
            id: true,
            totalUsd: true,
            totalBss: true,
            paidUsd: true,
            paidBss: true,
            currencyPrimary: true,
          },
        });

        // Tasa de la fecha del pago (para convertir facturas con totalBss=0
        // cuando se paga en VES, p.ej. SALDO ANTERIOR del reset).
        const rateRecord = await getCurrentRate("BCV", input.paidAt);
        const rate = new (await import("decimal.js")).Decimal(rateRecord.vesPerUsd);

        // Construir allocations automáticas
        const { Decimal } = await import("decimal.js");
        let remaining = new Decimal(input.amount);
        const allocations: { invoiceId: string; amount: Decimal.Value }[] = [];

        for (const inv of pendingInvoices) {
          if (remaining.lte(0)) break;

          // Calcular saldo pendiente de esta factura en moneda primaria del pago.
          // Si la factura tiene totalBss=0 pero pagás en VES, convertimos via tasa.
          const isPrimaryUsd = input.currencyPrimary === "USD";
          const totalUsdInv = new Decimal(inv.totalUsd.toString());
          const totalBssInv = new Decimal(inv.totalBss.toString());
          const paidUsdInv = new Decimal(inv.paidUsd.toString());
          const paidBssInv = new Decimal(inv.paidBss.toString());

          let total: Decimal;
          let paid: Decimal;
          if (isPrimaryUsd) {
            total = totalUsdInv;
            paid = paidUsdInv;
          } else {
            // Si totalBss está en 0 (caso reset), derivamos desde USD × tasa
            total = totalBssInv.gt(0) ? totalBssInv : totalUsdInv.mul(rate);
            paid = paidBssInv.gt(0) ? paidBssInv : paidUsdInv.mul(rate);
          }
          const balance = total.minus(paid);

          if (balance.lte(0)) continue;

          const toApply = Decimal.min(remaining, balance);
          allocations.push({ invoiceId: inv.id, amount: toApply.toFixed(2) });
          remaining = remaining.minus(toApply);
        }

        const payment = await recordPayment({
          organizationId: input.organizationId,
          communityId: input.communityId,
          unitId: input.unitId,
          amount: input.amount,
          currencyPrimary: input.currencyPrimary as "USD" | "VES",
          method: input.method as Parameters<typeof recordPayment>[0]["method"],
          reference: input.reference,
          paidAt: input.paidAt,
          notes: input.notes,
          allocations,
          createdById: ctx.user.id,
        });

        // Marcar la notificación como verificada cambiando el prefijo
        // para que no vuelva a aparecer en listPaymentReports
        const notif = await ctx.db.notification.findFirst({
          where: { id: input.notificationId, organizationId: input.organizationId },
          select: { id: true, body: true },
        });
        if (notif?.body.startsWith("PAGO_POR_VERIFICAR:")) {
          await ctx.db.notification.update({
            where: { id: notif.id },
            data: { body: notif.body.replace("PAGO_POR_VERIFICAR:", "PAGO_VERIFICADO:") },
          });
        }

        return payment;
      }),

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

    // ── Pagos no identificados (Feature 3: flujo aparcar → asignar) ──────────

    /** Lista los pagos no identificados de la comunidad, sin asignar primero. */
    listUnidentified: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        includeAssigned: z.boolean().default(false),
      }))
      .query(({ ctx, input }) =>
        ctx.db.unidentifiedPayment.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.includeAssigned ? {} : { assignedAt: null }),
          },
          include: { assignedUnit: { select: { code: true } } },
          orderBy: { createdAt: "desc" },
        }),
      ),

    /**
     * Guarda un movimiento bancario no identificado para revisión posterior.
     * Llamado desde la UI de conciliación cuando un row del banco no tiene match.
     */
    parkUnidentified: orgProcedure
      .input(orgIdInput.extend({
        communityId:     z.string(),
        bankDate:        z.string(),
        bankRef:         z.string().optional(),
        bankAmountUsd:   z.coerce.number().positive(),
        bankDescription: z.string().optional(),
        notes:           z.string().optional(),
      }))
      .mutation(({ ctx, input }) =>
        ctx.db.unidentifiedPayment.create({
          data: {
            organizationId:  input.organizationId,
            communityId:     input.communityId,
            bankDate:        input.bankDate,
            bankRef:         input.bankRef ?? null,
            bankAmountUsd:   input.bankAmountUsd.toFixed(2),
            bankDescription: input.bankDescription ?? null,
            notes:           input.notes ?? null,
            createdById:     ctx.user.id,
          },
        }),
      ),

    /**
     * Asigna un pago no identificado a una unidad: crea el Payment y marca el
     * UnidentifiedPayment como asignado.
     */
    assignUnidentified: orgProcedure
      .input(orgIdInput.extend({
        unidentifiedId:  z.string(),
        communityId:     z.string(),
        unitId:          z.string(),
        method:          z.enum(PAYMENT_METHODS),
        bankAccountId:   z.string().optional(),
        allocations:     z.array(z.object({
          invoiceId: z.string(),
          amount:    z.coerce.number().positive(),
        })).optional(),
        notes:           z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const unid = await ctx.db.unidentifiedPayment.findFirstOrThrow({
          where: { id: input.unidentifiedId, organizationId: input.organizationId },
        });
        if (unid.assignedAt) throw new Error("Este pago ya fue asignado");

        const payment = await recordPayment({
          organizationId:  input.organizationId,
          communityId:     input.communityId,
          unitId:          input.unitId,
          amount:          Number(unid.bankAmountUsd),
          currencyPrimary: "USD",
          method:          input.method,
          reference:       unid.bankRef ?? undefined,
          paidAt:          new Date(), // fecha de procesamiento; podría mejorarse
          bankAccountId:   input.bankAccountId,
          notes:           input.notes ?? unid.bankDescription ?? undefined,
          allocations:     input.allocations,
          createdById:     ctx.user.id,
        });

        await ctx.db.unidentifiedPayment.update({
          where: { id: unid.id },
          data: {
            assignedAt:       new Date(),
            assignedUnitId:   input.unitId,
            assignedPaymentId: payment.id,
          },
        });

        return payment;
      }),

    /** Genera el PDF de bauche de pago y lo devuelve como base64. */
    getVoucherPdf: orgProcedure
      .input(orgIdInput.extend({ paymentId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const payment = await ctx.db.payment.findFirstOrThrow({
          where: { id: input.paymentId, organizationId: input.organizationId },
          include: {
            unit: { select: { code: true, floor: true, tower: true } },
            allocations: {
              include: {
                invoice: { select: { invoiceNumber: true, periodYear: true, periodMonth: true } },
              },
            },
          },
        });
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id: payment.communityId },
          select: { name: true, address: true, city: true, state: true, rif: true, phone: true, email: true },
        });
        // Propietario o inquilino activo de la unidad
        const ownership = await ctx.db.ownership.findFirst({
          where: { unitId: payment.unitId, endDate: null },
          include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
        });
        const tenancy = !ownership
          ? await ctx.db.tenancy.findFirst({
              where: { unitId: payment.unitId, endDate: null },
              include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
            })
          : null;
        const person = ownership?.person ?? tenancy?.person ?? null;

        // Saldo a favor: monto total del pago - suma de allocations a facturas.
        // Si el cliente pagó 60 y solo se aplicó 50 a facturas, quedan 10 como crédito.
        const totalUsd = new Decimal(payment.amountUsd.toString());
        const totalBss = new Decimal(payment.amountBss.toString());
        const allocUsd = payment.allocations.reduce(
          (s, a) => s.plus(a.amountUsd.toString()),
          new Decimal(0),
        );
        const allocBss = payment.allocations.reduce(
          (s, a) => s.plus(a.amountBss.toString()),
          new Decimal(0),
        );
        const creditUsd = Decimal.max(0, totalUsd.minus(allocUsd));
        const creditBss = Decimal.max(0, totalBss.minus(allocBss));

        // Formato de período "Mar 2026" (más legible que "3/2026" — pedido del cliente)
        const MONTHS_PDF = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

        const { generatePaymentVoucherPdf } = await import("@/server/services/pdf");
        const buffer = await generatePaymentVoucherPdf({
          communityName: community.name,
          communityAddress: `${community.address}, ${community.city}${community.state ? `, ${community.state}` : ""}`,
          communityRif: community.rif ?? undefined,
          communityPhone: community.phone ?? undefined,
          communityEmail: community.email ?? undefined,
          paymentId: payment.id,
          unitCode: payment.unit.code,
          personName: person ? `${person.firstName} ${person.lastName}` : "—",
          personId: person ? `${person.idType}: ${person.idNumber}` : undefined,
          amountUsd: payment.amountUsd.toString(),
          amountBss: payment.amountBss.toString(),
          exchangeRate: payment.exchangeRate.toString(),
          method: payment.method,
          reference: payment.reference ?? undefined,
          paidAt: payment.paidAt,
          invoices: payment.allocations.map((a) => ({
            number: a.invoice.invoiceNumber,
            period: `${MONTHS_PDF[a.invoice.periodMonth - 1]} ${a.invoice.periodYear}`,
            amountUsd: a.amountUsd.toString(),
          })),
          creditUsd: creditUsd.gt(0.005) ? creditUsd.toFixed(2) : undefined,
          creditBss: creditBss.gt(0.005) ? creditBss.toFixed(2) : undefined,
        });
        return { base64: buffer.toString("base64") };
      }),
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
          customCategory: z.string().max(80).optional(),
          description: z.string().min(2),
          periodYear: z.number().int().min(2020).max(2100),
          periodMonth: z.number().int().min(1).max(12),
          amount: z.coerce.number().positive(),
          currencyPrimary: z.enum(["VES", "USD"]),
          reference: z.string().optional(),
          notes: z.string().optional(),
          affectsInvoice: z.boolean().default(false),
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

  // ─── Planes de pago (con morosos) ─────────────────────────────
  paymentPlans: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string().optional(),
          status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED", "DEFAULTED"]).optional(),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.paymentPlan.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.unitId ? { unitId: input.unitId } : {}),
            ...(input.status ? { status: input.status } : {}),
          },
          include: {
            unit: { select: { id: true, code: true, tower: true, floor: true } },
          },
          orderBy: [{ createdAt: "desc" }],
        }),
      ),

    /**
     * Detalle de un plan con las facturas (cuotas) generadas y su estado de pago.
     */
    byId: orgProcedure
      .input(orgIdInput.extend({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const plan = await ctx.db.paymentPlan.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
          include: {
            unit: { select: { id: true, code: true, tower: true, floor: true } },
          },
        });

        // Las cuotas se materializan como Invoice tipo EXTRA_FEE cuya descripción
        // empieza con `Plan de pago — cuota X de Y` y cuyo número arranca con `PLAN-<planId>-`.
        const invoices = await ctx.db.invoice.findMany({
          where: {
            communityId: plan.communityId,
            unitId: plan.unitId,
            invoiceNumber: { startsWith: `PLAN-${plan.id}-` },
          },
          orderBy: { dueDate: "asc" },
        });

        return { plan, invoices };
      }),

    /**
     * Crea un plan de pago para una unidad con deuda. Genera N facturas EXTRA_FEE
     * con vencimientos mensuales a partir de startDate.
     */
    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string(),
          totalUsd: z.coerce.number().positive(),
          installments: z.number().int().min(2).max(36),
          startDate: z.coerce.date(),
          notes: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, unitId, totalUsd, installments, startDate, notes } = input;

        // 1. Validar entidades y que no exista otro plan ACTIVO para la unidad
        const [unit, community, existingActive] = await Promise.all([
          ctx.db.unit.findFirstOrThrow({
            where: { id: unitId, communityId, organizationId, deletedAt: null },
          }),
          ctx.db.community.findFirstOrThrow({
            where: { id: communityId, organizationId, deletedAt: null },
            select: { primaryCurrency: true },
          }),
          ctx.db.paymentPlan.findFirst({
            where: { unitId, communityId, organizationId, status: "ACTIVE" },
          }),
        ]);
        if (existingActive) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "La unidad ya tiene un plan de pago activo. Cancele el plan vigente antes de crear uno nuevo.",
          });
        }

        // 2. Calcular cuota: reparto exacto con ajuste del último para cuadrar el total
        const total = new Decimal(totalUsd).toDecimalPlaces(2);
        const baseInst = total.div(installments).toDecimalPlaces(2);
        const installAmounts: Decimal[] = [];
        let sumSoFar = new Decimal(0);
        for (let i = 0; i < installments; i++) {
          if (i < installments - 1) {
            installAmounts.push(baseInst);
            sumSoFar = sumSoFar.plus(baseInst);
          } else {
            installAmounts.push(total.minus(sumSoFar));
          }
        }

        // 3. Tasa BCV actual (snapshot a cada factura)
        const rate = await (await import("@/server/services/exchange")).getCurrentRate("BCV");
        const ratesDec = new Decimal(rate.vesPerUsd.toString());

        // 4. Crear el plan + las facturas en transacción
        const startUTC = new Date(Date.UTC(
          startDate.getUTCFullYear(),
          startDate.getUTCMonth(),
          startDate.getUTCDate(),
          12, 0, 0,
        ));

        const result = await ctx.db.$transaction(async (tx) => {
          const plan = await tx.paymentPlan.create({
            data: {
              organizationId,
              communityId,
              unitId,
              totalUsd: total.toFixed(2),
              installments,
              installmentUsd: baseInst.toFixed(2),
              startDate: startUTC,
              status: "ACTIVE",
              notes: notes ?? null,
              createdById: ctx.user.id,
            },
          });

          const nowYear = new Date().getFullYear();
          const stamp = Date.now().toString(36).toUpperCase();
          for (let i = 0; i < installments; i++) {
            const amount = installAmounts[i]!;
            const bss = amount.mul(ratesDec).toDecimalPlaces(2);
            const due = new Date(Date.UTC(
              startUTC.getUTCFullYear(),
              startUTC.getUTCMonth() + i,
              startUTC.getUTCDate(),
              12, 0, 0,
            ));
            const invoiceNumber = `PLAN-${plan.id}-${String(i + 1).padStart(2, "0")}-${stamp}`;
            const description = `Plan de pago — cuota ${i + 1} de ${installments}`;

            await tx.invoice.create({
              data: {
                organizationId,
                communityId,
                unitId,
                invoiceNumber,
                type: "EXTRA_FEE",
                periodYear: due.getUTCFullYear(),
                periodMonth: due.getUTCMonth() + 1,
                issuedAt: new Date(),
                dueDate: due,
                totalUsd: amount.toFixed(2),
                totalBss: bss.toFixed(2),
                exchangeRate: ratesDec.toFixed(8),
                exchangeSource: rate.source,
                currencyPrimary: community.primaryCurrency,
                status: "ISSUED",
                items: {
                  create: [{
                    description,
                    amountUsd: amount.toFixed(2),
                    amountBss: bss.toFixed(2),
                    aliquot: "100.000000",
                  }],
                },
              },
            });
          }

          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: ctx.user.id,
              action: "CREATE",
              entityType: "PaymentPlan",
              entityId: plan.id,
              after: {
                unitId,
                totalUsd: total.toFixed(2),
                installments,
                installmentUsd: baseInst.toFixed(2),
                startDate: startUTC.toISOString(),
              },
            },
          });

          // Suppress unused-var lint for `unit`
          void unit;

          return plan;
        });

        return result;
      }),

    /**
     * Cancela un plan activo. Las facturas ya emitidas permanecen
     * (se pueden anular individualmente desde el módulo de facturas).
     */
    cancel: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          reason: z.string().min(3).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const plan = await ctx.db.paymentPlan.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
        });
        if (plan.status !== "ACTIVE") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Solo se pueden cancelar planes ACTIVOS",
          });
        }

        const updated = await ctx.db.paymentPlan.update({
          where: { id: plan.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelReason: input.reason,
          },
        });

        await ctx.db.auditLog.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: "UPDATE",
            entityType: "PaymentPlan",
            entityId: plan.id,
            before: { status: plan.status },
            after: { status: "CANCELLED", cancelReason: input.reason },
            reason: input.reason,
          },
        });

        return updated;
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

      // Saldo a favor (anticipo): sumas de pagos no asignados a ninguna factura.
      // Para cada pago no anulado: amount - sum(allocations) = porción no aplicada.
      const payments = await ctx.db.payment.findMany({
        where: { unitId: input.unitId, voidedAt: null },
        select: {
          amountBss: true, amountUsd: true,
          allocations: { select: { amountBss: true, amountUsd: true } },
        },
      });
      const credit = payments.reduce(
        (acc, p) => {
          const allocBss = p.allocations.reduce((s, a) => s.plus(a.amountBss.toString()), new Decimal(0));
          const allocUsd = p.allocations.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
          const remBss = new Decimal(p.amountBss.toString()).minus(allocBss);
          const remUsd = new Decimal(p.amountUsd.toString()).minus(allocUsd);
          return {
            bss: acc.bss.plus(Decimal.max(remBss, 0)),
            usd: acc.usd.plus(Decimal.max(remUsd, 0)),
          };
        },
        { bss: new Decimal(0), usd: new Decimal(0) },
      );

      return {
        bss: balance.bss.toFixed(2),
        usd: balance.usd.toFixed(2),
        creditBss: credit.bss.toFixed(2),
        creditUsd: credit.usd.toFixed(2),
      };
    }),

  /**
   * Aplica el saldo a favor de una unidad a sus facturas pendientes
   * más antiguas (FIFO por dueDate). Genera un PaymentAllocation por
   * cada factura cubierta. No mueve dinero — solo asigna el anticipo
   * existente. Retorna el detalle de lo aplicado.
   */
  applyUnitCredit: orgProcedure
    .input(orgIdInput.extend({ unitId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        // 1. Encontrar pagos con porción no asignada (anticipo)
        const payments = await tx.payment.findMany({
          where: { unitId: input.unitId, voidedAt: null, organizationId: input.organizationId },
          include: { allocations: { select: { amountBss: true, amountUsd: true } } },
          orderBy: { paidAt: "asc" },
        });

        const creditByPayment: { id: string; remBss: Decimal; remUsd: Decimal; currencyPrimary: "USD" | "VES" }[] = [];
        for (const p of payments) {
          const allocBss = p.allocations.reduce((s, a) => s.plus(a.amountBss.toString()), new Decimal(0));
          const allocUsd = p.allocations.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
          const remBss = new Decimal(p.amountBss.toString()).minus(allocBss);
          const remUsd = new Decimal(p.amountUsd.toString()).minus(allocUsd);
          if (remUsd.gt(0.005)) {
            creditByPayment.push({ id: p.id, remBss, remUsd, currencyPrimary: p.currencyPrimary as "USD" | "VES" });
          }
        }

        if (creditByPayment.length === 0) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Esta unidad no tiene saldo a favor." });
        }

        // 2. Encontrar facturas pendientes ordenadas por dueDate ASC (FIFO)
        const pending = await tx.invoice.findMany({
          where: {
            unitId: input.unitId,
            organizationId: input.organizationId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
          },
          orderBy: { dueDate: "asc" },
          select: { id: true, invoiceNumber: true, currencyPrimary: true, totalBss: true, totalUsd: true, paidBss: true, paidUsd: true },
        });

        const applied: { invoiceNumber: string; usd: string; bss: string }[] = [];

        for (const inv of pending) {
          const invIsUsd = inv.currencyPrimary === "USD";
          const totalPrim = new Decimal((invIsUsd ? inv.totalUsd : inv.totalBss).toString());
          const paidPrim = new Decimal((invIsUsd ? inv.paidUsd : inv.paidBss).toString());
          let invBalance = totalPrim.minus(paidPrim);
          if (invBalance.lte(0)) continue;

          // Consumir crédito por orden
          for (const c of creditByPayment) {
            if (invBalance.lte(0)) break;
            const cAmount = invIsUsd ? c.remUsd : c.remBss;
            if (cAmount.lte(0.005)) continue;
            const toApply = Decimal.min(cAmount, invBalance);
            // Calcular bss/usd a partir del que estamos consumiendo (proporcional)
            const ratio = toApply.div(cAmount);
            const allocUsd = c.remUsd.mul(ratio);
            const allocBss = c.remBss.mul(ratio);

            await tx.paymentAllocation.create({
              data: {
                paymentId: c.id,
                invoiceId: inv.id,
                amountBss: allocBss.toFixed(2),
                amountUsd: allocUsd.toFixed(2),
              },
            });

            c.remUsd = c.remUsd.minus(allocUsd);
            c.remBss = c.remBss.minus(allocBss);
            invBalance = invBalance.minus(toApply);
          }

          // Recalcular paid del invoice y status
          const updatedAllocs = await tx.paymentAllocation.findMany({
            where: { invoiceId: inv.id }, select: { amountBss: true, amountUsd: true },
          });
          const newPaidBss = updatedAllocs.reduce((s, a) => s.plus(a.amountBss.toString()), new Decimal(0));
          const newPaidUsd = updatedAllocs.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
          const newPaidPrim = invIsUsd ? newPaidUsd : newPaidBss;
          const status = newPaidPrim.gte(totalPrim) ? "PAID" : newPaidPrim.gt(0) ? "PARTIAL" : "ISSUED";

          await tx.invoice.update({
            where: { id: inv.id },
            data: {
              paidBss: newPaidBss.toFixed(2),
              paidUsd: newPaidUsd.toFixed(2),
              status,
            },
          });

          const appliedAmount = totalPrim.minus(paidPrim).minus(invBalance);
          applied.push({
            invoiceNumber: inv.invoiceNumber,
            usd: invIsUsd ? appliedAmount.toFixed(2) : "—",
            bss: invIsUsd ? "—" : appliedAmount.toFixed(2),
          });
        }

        if (applied.length === 0) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No hay facturas pendientes a las que aplicar el saldo." });
        }

        await tx.auditLog.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: "UPDATE",
            entityType: "Unit",
            entityId: input.unitId,
            after: { event: "CREDIT_APPLIED", invoicesAffected: applied.length, applied },
          },
        });

        return { applied };
      });
    }),

  // ─── Importación masiva ────────────────────────────────────────────────────

  /** Importar gastos históricos en lote */
  bulkImportExpenses: orgProcedure
    .input(
      orgIdInput.extend({
        communityId: z.string(),
        rows: z.array(z.object({
          periodYear: z.coerce.number().int().min(2000).max(2100),
          periodMonth: z.coerce.number().int().min(1).max(12),
          description: z.string().min(1),
          category: z.enum(EXPENSE_CATEGORIES).default("OTHER"),
          amountUsd: z.coerce.number().nonnegative(),
          amountBss: z.coerce.number().nonnegative().optional(),
          exchangeRate: z.coerce.number().positive().optional(),
          supplierName: z.string().optional(),
          invoiceNumber: z.string().optional(),
          receiptDate: z.string().optional(), // YYYY-MM-DD
        })).min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        try {
          const amountUsd = new Decimal(row.amountUsd);

          let receiptDate: Date | null = null;
          if (row.receiptDate) {
            const d = new Date(row.receiptDate);
            if (!isNaN(d.getTime())) receiptDate = d;
          }

          // #2 — Tasa según la fecha del comprobante de cada fila, no la de hoy.
          // Si la fila trae exchangeRate explícito (override manual), usar ése.
          let effectiveRate: Decimal;
          let effectiveSrc: import("@prisma/client").ExchangeSource;
          if (row.exchangeRate) {
            effectiveRate = new Decimal(row.exchangeRate);
            effectiveSrc = "MANUAL";
          } else {
            const r = await getCurrentRate("BCV", receiptDate ?? new Date());
            effectiveRate = new Decimal(r?.vesPerUsd ?? "1");
            effectiveSrc = (r?.source ?? "MANUAL") as import("@prisma/client").ExchangeSource;
          }

          const amountBss = row.amountBss != null
            ? new Decimal(row.amountBss)
            : amountUsd.mul(effectiveRate);

          await ctx.db.expense.create({
            data: {
              organizationId: input.organizationId,
              communityId: input.communityId,
              description: row.description,
              category: row.category,
              periodYear: row.periodYear,
              periodMonth: row.periodMonth,
              amountUsd: amountUsd.toFixed(2),
              amountBss: amountBss.toFixed(2),
              exchangeRate: effectiveRate.toFixed(8),
              exchangeSource: effectiveSrc,
              currencyPrimary: "USD",
              supplierName: row.supplierName ?? null,
              invoiceNumber: row.invoiceNumber ?? null,
              receiptDate,
            },
          });
          created++;
        } catch (e) {
          errors.push(`Fila ${i + 2}: ${e instanceof Error ? e.message : "error desconocido"}`);
          skipped++;
        }
      }
      return { created, skipped, errors };
    }),

  /** Importar deudas históricas como facturas (migración de sistema anterior) */
  bulkImportInvoices: orgProcedure
    .input(
      orgIdInput.extend({
        communityId: z.string(),
        rows: z.array(z.object({
          unitCode: z.string().min(1),
          description: z.string().min(1),
          totalUsd: z.coerce.number().positive(),
          totalBss: z.coerce.number().nonnegative().optional(),
          exchangeRate: z.coerce.number().positive().optional(),
          issuedAt: z.string(), // YYYY-MM-DD
          dueDate: z.string(),  // YYYY-MM-DD
          paidUsd: z.coerce.number().nonnegative().optional(),
          notes: z.string().optional(),
        })).min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const units = await ctx.db.unit.findMany({
        where: { communityId: input.communityId, organizationId: input.organizationId, deletedAt: null },
        select: { id: true, code: true },
      });
      const unitMap = new Map(units.map((u) => [u.code.toLowerCase(), u.id]));

      // Obtener base para número de factura correlativo
      const lastInv = await ctx.db.invoice.findFirst({
        where: { organizationId: input.organizationId },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      });
      let seqBase = lastInv
        ? (parseInt(lastInv.invoiceNumber.replace(/\D/g, ""), 10) || 0)
        : 0;

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        try {
          const unitId = unitMap.get(row.unitCode.toLowerCase());
          if (!unitId) {
            errors.push(`Fila ${i + 2}: unidad "${row.unitCode}" no encontrada`);
            skipped++;
            continue;
          }
          const issuedAt = new Date(row.issuedAt);
          const dueDate = new Date(row.dueDate);
          if (isNaN(issuedAt.getTime()) || isNaN(dueDate.getTime())) {
            errors.push(`Fila ${i + 2}: fecha inválida`);
            skipped++;
            continue;
          }

          seqBase++;
          const invoiceNumber = `IMP-${String(seqBase).padStart(6, "0")}`;
          const totalUsd = new Decimal(row.totalUsd);

          // #2 — Tasa según fecha de emisión de cada factura, no la de hoy.
          let effectiveRate: Decimal;
          let effectiveSrc: import("@prisma/client").ExchangeSource;
          if (row.exchangeRate) {
            effectiveRate = new Decimal(row.exchangeRate);
            effectiveSrc = "MANUAL";
          } else {
            const r = await getCurrentRate("BCV", issuedAt);
            effectiveRate = new Decimal(r?.vesPerUsd ?? "1");
            effectiveSrc = (r?.source ?? "MANUAL") as import("@prisma/client").ExchangeSource;
          }
          const totalBss = row.totalBss != null
            ? new Decimal(row.totalBss)
            : totalUsd.mul(effectiveRate);
          const paidUsd = new Decimal(row.paidUsd ?? 0);
          const paidBss = paidUsd.mul(effectiveRate);

          const pendingUsd = totalUsd.minus(paidUsd);
          const status: import("@prisma/client").InvoiceStatus = pendingUsd.lte(0)
            ? "PAID"
            : paidUsd.gt(0)
            ? "PARTIAL"
            : dueDate < new Date()
            ? "OVERDUE"
            : "ISSUED";

          await ctx.db.invoice.create({
            data: {
              organizationId: input.organizationId,
              communityId: input.communityId,
              unitId,
              invoiceNumber,
              periodYear: issuedAt.getFullYear(),
              periodMonth: issuedAt.getMonth() + 1,
              issuedAt,
              dueDate,
              totalUsd: totalUsd.toFixed(2),
              totalBss: totalBss.toFixed(2),
              paidUsd: paidUsd.toFixed(2),
              paidBss: paidBss.toFixed(2),
              exchangeRate: effectiveRate.toFixed(8),
              exchangeSource: effectiveSrc,
              currencyPrimary: "USD",
              status,
              notes: row.notes ?? `Importado: ${row.description}`,
              items: {
                create: [{
                  description: row.description,
                  amountUsd: totalUsd.toFixed(2),
                  amountBss: totalBss.toFixed(2),
                  aliquot: "0",
                }],
              },
            },
          });
          created++;
        } catch (e) {
          errors.push(`Fila ${i + 2}: ${e instanceof Error ? e.message : "error desconocido"}`);
          skipped++;
        }
      }
      return { created, skipped, errors };
    }),

  /** Importar pagos históricos en lote */
  bulkImportPayments: orgProcedure
    .input(
      orgIdInput.extend({
        communityId: z.string(),
        rows: z.array(z.object({
          unitCode: z.string().min(1),
          amountUsd: z.coerce.number().positive(),
          amountBss: z.coerce.number().nonnegative().optional(),
          exchangeRate: z.coerce.number().positive().optional(),
          method: z.enum(PAYMENT_METHODS).default("OTHER"),
          paidAt: z.string(), // YYYY-MM-DD
          reference: z.string().optional(),
          notes: z.string().optional(),
        })).min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const units = await ctx.db.unit.findMany({
        where: { communityId: input.communityId, organizationId: input.organizationId, deletedAt: null },
        select: { id: true, code: true },
      });
      const unitMap = new Map(units.map((u) => [u.code.toLowerCase(), u.id]));

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        try {
          const unitId = unitMap.get(row.unitCode.toLowerCase());
          if (!unitId) {
            errors.push(`Fila ${i + 2}: unidad "${row.unitCode}" no encontrada`);
            skipped++;
            continue;
          }
          const paidAt = new Date(row.paidAt);
          if (isNaN(paidAt.getTime())) {
            errors.push(`Fila ${i + 2}: fecha inválida "${row.paidAt}"`);
            skipped++;
            continue;
          }

          const amountUsd = new Decimal(row.amountUsd);

          // #2 — Tasa según paidAt de cada fila, no la de hoy.
          let effectiveRate: Decimal;
          let effectiveSrc: import("@prisma/client").ExchangeSource;
          if (row.exchangeRate) {
            effectiveRate = new Decimal(row.exchangeRate);
            effectiveSrc = "MANUAL";
          } else {
            const r = await getCurrentRate("BCV", paidAt);
            effectiveRate = new Decimal(r?.vesPerUsd ?? "1");
            effectiveSrc = (r?.source ?? "MANUAL") as import("@prisma/client").ExchangeSource;
          }
          const amountBss = row.amountBss != null ? new Decimal(row.amountBss) : amountUsd.mul(effectiveRate);

          // Inserción directa (importación histórica — sin notificaciones)
          await ctx.db.payment.create({
            data: {
              organizationId: input.organizationId,
              communityId: input.communityId,
              unitId,
              amountUsd: amountUsd.toFixed(2),
              amountBss: amountBss.toFixed(2),
              exchangeRate: effectiveRate.toFixed(8),
              exchangeSource: effectiveSrc,
              currencyPrimary: "USD",
              method: row.method,
              reference: row.reference ?? null,
              paidAt,
              notes: row.notes ?? null,
            },
          });
          created++;
        } catch (e) {
          errors.push(`Fila ${i + 2}: ${e instanceof Error ? e.message : "error desconocido"}`);
          skipped++;
        }
      }
      return { created, skipped, errors };
    }),

  /**
   * Migración completa: residente + deuda en un solo Excel.
   * Por cada fila: upsert person → asignar unidad → crear factura si hay deuda.
   */
  bulkImportMigration: orgProcedure
    .input(
      orgIdInput.extend({
        communityId: z.string(),
        rows: z.array(z.object({
          // Unidad
          unitCode:    z.string().min(1),
          // Persona
          firstName:   z.string().min(1),
          lastName:    z.string().min(1),
          idType:      z.enum(["CEDULA_V", "CEDULA_E", "RIF", "PASSPORT", "OTHER"]).default("CEDULA_V"),
          idNumber:    z.string().min(1),
          email:       z.string().email().optional().or(z.literal("")),
          phone:       z.string().optional(),
          whatsapp:    z.string().optional(),
          role:        z.enum(["OWNER", "TENANT"]).default("OWNER"),
          sharePercent: z.coerce.number().min(1).max(100).default(100), // % de copropiedad
          fechaInicio: z.string().optional(), // YYYY-MM-DD — fecha real de inicio de propiedad
          // Deuda (opcional — si deudaUsd > 0 se crea una factura)
          deudaUsd:    z.coerce.number().nonnegative().default(0),
          deudaBs:     z.coerce.number().nonnegative().optional(),
          tasa:        z.coerce.number().positive().optional(),
          descripcion: z.string().optional(),
          fechaVence:  z.string().optional(), // YYYY-MM-DD
          pagadoUsd:   z.coerce.number().nonnegative().default(0),
          notas:       z.string().optional(),
        })).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Cargar mapa de unidades
      const units = await ctx.db.unit.findMany({
        where: { communityId: input.communityId, organizationId: input.organizationId, deletedAt: null },
        select: { id: true, code: true },
      });
      const unitMap = new Map(units.map((u) => [u.code.toLowerCase(), u.id]));

      // Base para número de factura
      const lastInv = await ctx.db.invoice.findFirst({
        where: { organizationId: input.organizationId, invoiceNumber: { startsWith: "IMP-" } },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      });
      let seqBase = lastInv
        ? (parseInt(lastInv.invoiceNumber.replace(/\D/g, ""), 10) || 0)
        : 0;

      let residents = 0;
      let invoices  = 0;
      let skipped   = 0;
      const errors: string[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        try {
          // 1. Encontrar unidad
          const unitId = unitMap.get(row.unitCode.toLowerCase());
          if (!unitId) {
            errors.push(`Fila ${i + 2}: unidad "${row.unitCode}" no encontrada`);
            skipped++;
            continue;
          }

          // 2. Upsert persona
          const person = await ctx.db.person.upsert({
            where: {
              organizationId_idType_idNumber: {
                organizationId: input.organizationId,
                idType: row.idType,
                idNumber: row.idNumber,
              },
            },
            update: {
              firstName: row.firstName,
              lastName:  row.lastName,
              email:     row.email || null,
              phone:     row.phone || null,
              whatsapp:  row.whatsapp || null,
            },
            create: {
              organizationId: input.organizationId,
              firstName: row.firstName,
              lastName:  row.lastName,
              idType:    row.idType,
              idNumber:  row.idNumber,
              email:     row.email || null,
              phone:     row.phone || null,
              whatsapp:  row.whatsapp || null,
            },
          });

          // 3. Asignar a unidad (ownership o tenancy) con fecha y porcentaje reales
          const startDate = row.fechaInicio
            ? (() => { const d = new Date(row.fechaInicio!); return isNaN(d.getTime()) ? new Date() : d; })()
            : new Date();

          if (row.role === "OWNER") {
            const exists = await ctx.db.ownership.findFirst({
              where: { unitId, personId: person.id, endDate: null },
            });
            if (!exists) {
              await ctx.db.ownership.create({
                data: {
                  unitId,
                  personId: person.id,
                  sharePercent: String(row.sharePercent ?? 100),
                  startDate,
                },
              });
            } else {
              // Actualizar porcentaje y fecha si ya existía
              await ctx.db.ownership.update({
                where: { id: exists.id },
                data: { sharePercent: String(row.sharePercent ?? 100), startDate },
              });
            }
          } else {
            const exists = await ctx.db.tenancy.findFirst({
              where: { unitId, personId: person.id, endDate: null },
            });
            if (!exists) {
              await ctx.db.tenancy.create({
                data: { unitId, personId: person.id, startDate },
              });
            }
          }
          residents++;

          // 4. Crear factura de deuda si aplica
          if (row.deudaUsd > 0) {
            const totalUsd = new Decimal(row.deudaUsd);
            const paidUsd  = new Decimal(row.pagadoUsd);

            // Fecha de vencimiento: la indicada o hace 1 mes (ya vencida por ser histórica)
            const dueDate = row.fechaVence
              ? new Date(row.fechaVence)
              : (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d; })();

            // #2 — Tasa según fecha de la deuda (dueDate), no la de hoy.
            let effectiveRate: Decimal;
            let effectiveSrc: import("@prisma/client").ExchangeSource;
            if (row.tasa) {
              effectiveRate = new Decimal(row.tasa);
              effectiveSrc = "MANUAL";
            } else {
              const r = await getCurrentRate("BCV", dueDate);
              effectiveRate = new Decimal(r?.vesPerUsd ?? "1");
              effectiveSrc = (r?.source ?? "MANUAL") as import("@prisma/client").ExchangeSource;
            }

            const totalBss = row.deudaBs != null
              ? new Decimal(row.deudaBs)
              : totalUsd.mul(effectiveRate);
            const paidBss  = paidUsd.mul(effectiveRate);

            const pending = totalUsd.minus(paidUsd);
            const status: import("@prisma/client").InvoiceStatus =
              pending.lte(0)   ? "PAID" :
              paidUsd.gt(0)    ? "PARTIAL" :
              dueDate < new Date() ? "OVERDUE" :
              "ISSUED";

            seqBase++;
            await ctx.db.invoice.create({
              data: {
                organizationId: input.organizationId,
                communityId:    input.communityId,
                unitId,
                invoiceNumber:  `IMP-${String(seqBase).padStart(6, "0")}`,
                periodYear:     new Date().getFullYear(),
                periodMonth:    new Date().getMonth() + 1,
                issuedAt:       new Date(),
                dueDate,
                totalUsd: totalUsd.toFixed(2),
                totalBss: totalBss.toFixed(2),
                paidUsd:  paidUsd.toFixed(2),
                paidBss:  paidBss.toFixed(2),
                exchangeRate:   effectiveRate.toFixed(8),
                exchangeSource: effectiveSrc,
                currencyPrimary: "USD",
                status,
                notes: row.notas ?? `Migrado desde sistema anterior — ${row.firstName} ${row.lastName}`,
                items: {
                  create: [{
                    description: row.descripcion ?? `Deuda pendiente — ${row.firstName} ${row.lastName}`,
                    amountUsd:   totalUsd.toFixed(2),
                    amountBss:   totalBss.toFixed(2),
                    aliquot:     "0",
                  }],
                },
              },
            });
            invoices++;
          }
        } catch (e) {
          errors.push(`Fila ${i + 2} (${row.unitCode} / ${row.idNumber}): ${e instanceof Error ? e.message : "error"}`);
          skipped++;
        }
      }
      return { residents, invoices, skipped, errors };
    }),

  /** Importar presupuesto anual en lote (crea o reemplaza el presupuesto del año) */
  bulkImportBudget: orgProcedure
    .input(
      orgIdInput.extend({
        communityId: z.string(),
        year: z.number().int().min(2000).max(2100),
        rows: z.array(z.object({
          category:  z.enum(EXPENSE_CATEGORIES),
          amountUsd: z.coerce.number().positive(),
          notes:     z.string().optional(),
        })).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Upsert del presupuesto para el año
      const budget = await ctx.db.budget.upsert({
        where: { communityId_year: { communityId: input.communityId, year: input.year } },
        update: { status: "DRAFT", notes: `Importado — ${input.rows.length} partidas` },
        create: {
          organizationId: input.organizationId,
          communityId:    input.communityId,
          year:           input.year,
          status:         "DRAFT",
          notes:          `Importado — ${input.rows.length} partidas`,
        },
      });

      // Borrar items existentes y recrear
      await ctx.db.budgetItem.deleteMany({ where: { budgetId: budget.id } });

      const { Decimal: D } = await import("decimal.js");
      let totalUsd = new D(0);

      const items = input.rows.map((r) => {
        totalUsd = totalUsd.plus(r.amountUsd);
        return {
          budgetId:  budget.id,
          category:  r.category,
          amountUsd: new D(r.amountUsd).toFixed(2),
          notes:     r.notes?.trim() || null,
        };
      });

      await ctx.db.budgetItem.createMany({ data: items });

      // Actualizar total
      await ctx.db.budget.update({
        where: { id: budget.id },
        data: { totalUsd: totalUsd.toFixed(2) },
      });

      return { budgetId: budget.id, year: input.year, items: items.length, totalUsd: totalUsd.toFixed(2) };
    }),

  // ─── Plantillas de gastos recurrentes ─────────────────────────────────────
  recurringTemplates: router({
    list: orgProcedure
      .input(orgIdInput.extend({ communityId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.recurringExpenseTemplate.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
          },
          orderBy: [{ active: "desc" }, { category: "asc" }, { description: "asc" }],
        }),
      ),

    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          category: z.enum(EXPENSE_CATEGORIES),
          customCategory: z.string().max(80).optional(),
          description: z.string().min(2),
          supplierName: z.string().optional(),
          /** Monto en la moneda primaria de la plantilla. Si VES → almacenamos en amountBss
           *  (autoritativo). Si USD → almacenamos en amountUsd (autoritativo). */
          amount: z.coerce.number().positive(),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          towerScope: z.string().max(20).optional().nullable(),
          notes: z.string().optional(),
          /** Si true, es provisión: agrupa gastos reales y calcula AJUSTE PROVISION mes anterior. */
          isProvision: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Cuando primary=USD: amountUsd autoritativo, amountBss=null (se deriva en apply).
        // Cuando primary=VES: amountBss autoritativo, amountUsd se guarda como referencia
        // (calculado con tasa actual; al aplicar la plantilla la conversión se rehace).
        let amountUsd: number;
        let amountBss: number | null;
        if (input.currencyPrimary === "VES") {
          const rate = await getCurrentRate("BCV");
          const rateNum = Number(rate.vesPerUsd);
          amountBss = input.amount;
          amountUsd = rateNum > 0 ? input.amount / rateNum : 0;
        } else {
          amountUsd = input.amount;
          amountBss = null;
        }
        return ctx.db.recurringExpenseTemplate.create({
          data: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            category: input.category,
            customCategory: input.customCategory ?? null,
            description: input.description,
            supplierName: input.supplierName ?? null,
            amountUsd: amountUsd.toFixed(2),
            amountBss: amountBss !== null ? amountBss.toFixed(2) : null,
            currencyPrimary: input.currencyPrimary,
            towerScope: input.towerScope ?? null,
            notes: input.notes ?? null,
            isProvision: input.isProvision,
            active: true,
          },
        });
      }),

    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          description: z.string().min(2).optional(),
          supplierName: z.string().optional(),
          amount: z.coerce.number().positive().optional(),
          currencyPrimary: z.enum(["USD", "VES"]).optional(),
          towerScope: z.string().max(20).optional().nullable(),
          notes: z.string().optional(),
          active: z.boolean().optional(),
          isProvision: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, organizationId, amount, currencyPrimary, ...rest } = input;
        let amountUpdate: { amountUsd?: string; amountBss?: string | null; currencyPrimary?: "USD" | "VES" } = {};
        if (amount != null) {
          const cp = currencyPrimary ?? "USD";
          if (cp === "VES") {
            const rate = await getCurrentRate("BCV");
            const rateNum = Number(rate.vesPerUsd);
            amountUpdate = {
              amountBss: amount.toFixed(2),
              amountUsd: (rateNum > 0 ? amount / rateNum : 0).toFixed(2),
              currencyPrimary: "VES",
            };
          } else {
            amountUpdate = {
              amountUsd: amount.toFixed(2),
              amountBss: null,
              currencyPrimary: "USD",
            };
          }
        } else if (currencyPrimary) {
          amountUpdate.currencyPrimary = currencyPrimary;
        }
        return ctx.db.recurringExpenseTemplate.update({
          where: { id },
          data: { ...rest, ...amountUpdate },
        });
      }),

    delete: orgProcedure
      .input(orgIdInput.extend({ id: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db.recurringExpenseTemplate.delete({ where: { id: input.id } }),
      ),

    /**
     * Aplica las plantillas activas del mes: crea gastos en el período dado
     * usando los datos de cada plantilla. Si ya existe un gasto con la misma
     * descripción y período, lo omite (idempotente).
     */
    applyToMonth: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          year: z.number().int().min(2020).max(2100),
          month: z.number().int().min(1).max(12),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, year, month } = input;
        const templates = await ctx.db.recurringExpenseTemplate.findMany({
          where: { organizationId, communityId, active: true },
        });
        if (templates.length === 0) return { created: 0, adjustments: 0 };

        // #2 — Tasa según el mes del período (último día del mes), no la de hoy.
        const periodEnd = new Date(year, month, 0);
        const rate = await getCurrentRate("BCV", periodEnd);
        const usdRate = new Decimal(rate.vesPerUsd.toString());

        // Período anterior
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;

        let created = 0;
        let adjustments = 0;

        for (const tpl of templates) {
          // Verificar si ya existe un gasto generado por esta plantilla en este período.
          // - Plantilla isProvision=true → buscar PROVISION_BASE
          // - Plantilla isProvision=false → buscar REGULAR
          // Esto evita duplicados al re-aplicar applyToMonth (bug encontrado el 11/may/2026
          // donde plantillas regulares creaban duplicados porque solo se chequeaba PROVISION_BASE).
          const expectedKind = tpl.isProvision ? "PROVISION_BASE" : "REGULAR";
          const existsBase = await ctx.db.expense.findFirst({
            where: {
              communityId, periodYear: year, periodMonth: month,
              recurringTemplateId: tpl.id,
              kind: expectedKind,
              voidedAt: null,
            },
          });
          if (existsBase) continue;

          // Calcular monto del gasto según la moneda primaria de la plantilla.
          // Si la plantilla es VES (monto fijo en Bs), usar amountBss como autoritativo
          // y derivar USD con la tasa del período. Si es USD, mantener el monto USD fijo
          // y derivar Bs con la tasa.
          const tplIsVes = tpl.currencyPrimary === "VES" && tpl.amountBss != null;
          const tplAmountUsd = tplIsVes
            ? new Decimal(tpl.amountBss!.toString()).div(usdRate)
            : new Decimal(tpl.amountUsd.toString());
          const tplAmountBss = tplIsVes
            ? new Decimal(tpl.amountBss!.toString())
            : new Decimal(tpl.amountUsd.toString()).mul(usdRate);

          // — AJUSTE PROVISIÓN MES ANTERIOR (solo si tpl.isProvision) —
          if (tpl.isProvision) {
            // 1. Provisión base del mes anterior
            const prevBase = await ctx.db.expense.findFirst({
              where: {
                communityId, periodYear: prevYear, periodMonth: prevMonth,
                recurringTemplateId: tpl.id,
                kind: "PROVISION_BASE",
                voidedAt: null,
              },
              select: { amountUsd: true, amountBss: true },
            });
            // 2. Gastos reales del mes anterior con esta plantilla
            const prevReal = await ctx.db.expense.findMany({
              where: {
                communityId, periodYear: prevYear, periodMonth: prevMonth,
                recurringTemplateId: tpl.id,
                kind: "REGULAR",
                voidedAt: null,
              },
              select: { amountUsd: true, amountBss: true },
            });
            if (prevBase) {
              const realSumUsd = prevReal.reduce((s, e) => s.plus(e.amountUsd.toString()), new Decimal(0));
              const realSumBss = prevReal.reduce((s, e) => s.plus(e.amountBss.toString()), new Decimal(0));
              const baseUsd = new Decimal(prevBase.amountUsd.toString());
              const baseBss = new Decimal(prevBase.amountBss.toString());
              const adjUsd = realSumUsd.minus(baseUsd);
              const adjBss = realSumBss.minus(baseBss);
              // Solo crear ajuste si != 0 (>$0.01 de diferencia)
              if (adjUsd.abs().gt("0.01")) {
                await ctx.db.expense.create({
                  data: {
                    organizationId,
                    communityId,
                    category: tpl.category,
                    customCategory: tpl.customCategory ?? null,
                    description: `Ajuste Provisión ${tpl.description} — mes anterior`,
                    supplierName: tpl.supplierName ?? null,
                    periodYear: year,
                    periodMonth: month,
                    amountUsd: adjUsd.toFixed(2),
                    amountBss: adjBss.toFixed(2),
                    exchangeRate: usdRate.toFixed(8),
                    exchangeSource: rate.source,
                    currencyPrimary: "USD",
                    towerScope: tpl.towerScope ?? null,
                    isIndividual: false,
                    recurringTemplateId: tpl.id,
                    kind: "PROVISION_ADJUSTMENT",
                    createdById: ctx.user.id,
                  },
                });
                adjustments++;
              }
            }
          }

          // — Provisión / Plantilla del mes corriente —
          await ctx.db.expense.create({
            data: {
              organizationId,
              communityId,
              category: tpl.category,
              customCategory: tpl.customCategory ?? null,
              description: tpl.isProvision ? `Provisión ${tpl.description}` : tpl.description,
              supplierName: tpl.supplierName ?? null,
              periodYear: year,
              periodMonth: month,
              amountUsd: tplAmountUsd.toFixed(2),
              amountBss: tplAmountBss.toFixed(2),
              exchangeRate: usdRate.toFixed(8),
              exchangeSource: rate.source,
              // Preserva la moneda primaria de la plantilla en el gasto generado.
              currencyPrimary: tpl.currencyPrimary,
              towerScope: tpl.towerScope ?? null,
              isIndividual: false,
              recurringTemplateId: tpl.id,
              kind: tpl.isProvision ? "PROVISION_BASE" : "REGULAR",
              createdById: ctx.user.id,
            },
          });
          created++;
        }
        return { created, adjustments };
      }),
  }),

  inpc: router({
    list: orgProcedure
      .input(z.object({ organizationId: z.string(), limit: z.number().default(24) }))
      .query(async ({ ctx, input }) => {
        return ctx.db.inpcRate.findMany({
          orderBy: [{ year: "desc" }, { month: "desc" }],
          take: input.limit,
        });
      }),

    set: orgProcedure
      .input(z.object({
        organizationId: z.string(),
        year: z.number().int().min(2000).max(2030),
        month: z.number().int().min(1).max(12),
        indexValue: z.number().positive(),
        source: z.string().default("MANUAL"),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return ctx.db.inpcRate.upsert({
          where: { year_month: { year: input.year, month: input.month } },
          create: {
            year: input.year,
            month: input.month,
            indexValue: input.indexValue,
            source: input.source,
            notes: input.notes,
          },
          update: {
            indexValue: input.indexValue,
            source: input.source,
            notes: input.notes,
          },
        });
      }),

    // Calcula factor de indexación entre dos períodos
    // Factor = (índice_final / índice_inicial) - 1 → % de aumento
    calcFactor: orgProcedure
      .input(z.object({
        organizationId: z.string(),
        fromYear: z.number().int(),
        fromMonth: z.number().int(),
        toYear: z.number().int(),
        toMonth: z.number().int(),
      }))
      .query(async ({ ctx, input }) => {
        const [from, to] = await Promise.all([
          ctx.db.inpcRate.findUnique({
            where: { year_month: { year: input.fromYear, month: input.fromMonth } },
          }),
          ctx.db.inpcRate.findUnique({
            where: { year_month: { year: input.toYear, month: input.toMonth } },
          }),
        ]);
        if (!from || !to) return null;
        const factor = Number(to.indexValue) / Number(from.indexValue);
        return {
          factor,
          percentageIncrease: ((factor - 1) * 100).toFixed(2),
          fromIndex: Number(from.indexValue),
          toIndex: Number(to.indexValue),
        };
      }),
  }),
});
