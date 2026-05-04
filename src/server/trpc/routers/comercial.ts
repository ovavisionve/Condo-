/**
 * Router tRPC — Centro Comercial (Cc* models)
 * Completamente separado del sistema residencial.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "@/server/trpc/init";

const orgIdInput = z.object({ organizationId: z.string() });

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
  }),

  // ── Locales ─────────────────────────────────────────────────────────────
  locales: router({
    list: orgProcedure
      .input(orgIdInput.extend({ mallId: z.string(), includeInactive: z.boolean().default(false) }))
      .query(({ ctx, input }) =>
        ctx.db.ccLocal.findMany({
          where: {
            mallId: input.mallId,
            organizationId: input.organizationId,
            deletedAt: null,
            ...(input.includeInactive ? {} : { active: true }),
          },
          include: {
            tenancies: { where: { endDate: null }, take: 1, orderBy: { startDate: "desc" } },
          },
          orderBy: [{ floor: "asc" }, { code: "asc" }],
        }),
      ),

    byId: orgProcedure
      .input(orgIdInput.extend({ localId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.ccLocal.findUniqueOrThrow({
          where: { id: input.localId },
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
        }),
      ),

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
          customCategory: z.string().optional(),
          description: z.string().min(2),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
          amountUsd: z.coerce.number().positive(),
          amountBss: z.coerce.number().positive(),
          exchangeRate: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          supplierName: z.string().optional(),
          invoiceNumber: z.string().optional(),
          receiptDate: z.coerce.date().optional(),
          notes: z.string().optional(),
          isIndividual: z.boolean().default(false),
          targetLocalId: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { organizationId, ...data } = input;
        return ctx.db.ccExpense.create({ data: { ...data, organizationId } });
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
          customCategory: z.string().optional(),
          description: z.string().min(2),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
          amountUsd: z.coerce.number().positive(),
          amountBss: z.coerce.number().positive(),
          exchangeRate: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          reference: z.string().optional(),
          affectsInvoice: z.boolean().default(false),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { organizationId, ...data } = input;
        return ctx.db.ccIncome.create({ data: { ...data, organizationId } });
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
          amountUsd: z.coerce.number().positive(),
          amountBss: z.coerce.number().positive(),
          exchangeRate: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          type: z.enum(["CANON", "CANON_SALES", "ALIQUOT", "EXTRA_FEE", "FINE", "OTHER"]).default("CANON"),
          description: z.string().default("Canon de arrendamiento"),
          dueDaysAfterIssue: z.number().int().min(1).default(5),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const dueDate = new Date(now.getTime() + input.dueDaysAfterIssue * 24 * 60 * 60 * 1000);
        const count = await ctx.db.ccInvoice.count({ where: { mallId: input.mallId } });
        const invoiceNumber = `${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}-${String(count + 1).padStart(4, "0")}`;

        return ctx.db.ccInvoice.create({
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
            totalBss: input.amountBss,
            totalUsd: input.amountUsd,
            exchangeRate: input.exchangeRate,
            exchangeSource: input.exchangeSource,
            currencyPrimary: input.currencyPrimary,
            notes: input.notes,
            items: {
              create: {
                description: input.description,
                amountBss: input.amountBss,
                amountUsd: input.amountUsd,
              },
            },
          },
          include: { items: true, local: { select: { code: true, name: true } } },
        });
      }),

    // Emitir canon a TODOS los locales activos del mall de un período
    bulkIssueCanon: orgProcedure
      .input(
        orgIdInput.extend({
          mallId: z.string(),
          periodYear: z.number().int(),
          periodMonth: z.number().int().min(1).max(12),
          exchangeRate: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          dueDaysAfterIssue: z.number().int().min(1).default(5),
        }),
      )
      .mutation(async ({ ctx, input }) => {
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

        const now = new Date();
        const dueDate = new Date(now.getTime() + input.dueDaysAfterIssue * 24 * 60 * 60 * 1000);
        const results = { issued: 0, skipped: 0, errors: 0 };

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
            const amountBss = amountUsd * input.exchangeRate;

            await ctx.db.ccInvoice.create({
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
                exchangeRate: input.exchangeRate,
                exchangeSource: input.exchangeSource,
                currencyPrimary: "USD",
                items: {
                  create: {
                    description: `Canon de arrendamiento — ${new Date(input.periodYear, input.periodMonth - 1).toLocaleDateString("es-VE", { month: "long", year: "numeric" })}`,
                    amountBss,
                    amountUsd,
                  },
                },
              },
            });
            results.issued++;
          } catch {
            results.errors++;
          }
        }

        return results;
      }),

    void: orgProcedure
      .input(orgIdInput.extend({ invoiceId: z.string(), voidReason: z.string().optional() }))
      .mutation(({ ctx, input }) =>
        ctx.db.ccInvoice.update({
          where: { id: input.invoiceId },
          data: { status: "VOIDED", voidedAt: new Date(), voidReason: input.voidReason },
        }),
      ),

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
          select: { name: true, address: true, rif: true, phone: true, email: true, city: true },
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
          amountUsd: z.coerce.number().positive(),
          amountBss: z.coerce.number().positive(),
          exchangeRate: z.coerce.number().positive(),
          exchangeSource: z.enum(["BCV", "BINANCE_P2P", "MANUAL"]).default("BCV"),
          currencyPrimary: z.enum(["USD", "VES"]).default("USD"),
          method: z.enum(["CASH_BSS", "CASH_USD", "TRANSFER_BSS", "TRANSFER_USD", "ZELLE", "PAGO_MOVIL", "CRYPTO", "CHECK", "OTHER"]),
          reference: z.string().optional(),
          paidAt: z.coerce.date(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, ...data } = input;

        const pendingInvoices = await ctx.db.ccInvoice.findMany({
          where: {
            localId: input.localId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
          },
          orderBy: { dueDate: "asc" },
        });

        let remaining = input.amountUsd;
        const allocations: Array<{ invoiceId: string; localId: string; amountBss: number; amountUsd: number }> = [];

        for (const inv of pendingInvoices) {
          if (remaining <= 0) break;
          const pendingUsd = Number(inv.totalUsd) - Number(inv.paidUsd);
          if (pendingUsd <= 0) continue;
          const apply = Math.min(remaining, pendingUsd);
          allocations.push({ invoiceId: inv.id, localId: input.localId, amountBss: apply * input.exchangeRate, amountUsd: apply });
          remaining -= apply;
        }

        const payment = await ctx.db.ccPayment.create({
          data: { ...data, organizationId, allocations: { create: allocations } },
          include: { local: { select: { code: true, name: true } } },
        });

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
  }),
});
