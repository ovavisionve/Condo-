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
            select: { bankName: true, accountNumber: true, accountHolder: true, accountType: true, currency: true, notes: true },
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
        const [expenses, units, existing] = await Promise.all([
          ctx.db.expense.findMany({
            where: {
              communityId: input.communityId,
              periodYear: input.year,
              periodMonth: input.month,
            },
            select: { id: true, description: true, category: true, customCategory: true, amountUsd: true, amountBss: true },
          }),
          ctx.db.unit.findMany({
            where: { communityId: input.communityId, active: true, deletedAt: null },
            select: { id: true, code: true, aliquot: true },
          }),
          ctx.db.invoice.count({
            where: {
              communityId: input.communityId,
              periodYear: input.year,
              periodMonth: input.month,
              status: { not: "VOIDED" },
            },
          }),
        ]);

        const totalExpensesUsd = expenses.reduce((s, e) => s + Number(e.amountUsd), 0);
        const totalExpensesBss = expenses.reduce((s, e) => s + Number(e.amountBss), 0);

        // Muestra solo una distribución simple (alícuota × total)
        const unitPreviews = units.slice(0, 20).map((u) => ({
          unitCode: u.code,
          aliquot: Number(u.aliquot).toFixed(4),
          estimatedUsd: (totalExpensesUsd * Number(u.aliquot) / 100).toFixed(2),
        }));

        return {
          expenses: expenses.map(e => ({
            description: e.customCategory ?? e.description,
            amountUsd: Number(e.amountUsd).toFixed(2),
            amountBss: Number(e.amountBss).toFixed(2),
          })),
          totalExpensesUsd: totalExpensesUsd.toFixed(2),
          totalExpensesBss: totalExpensesBss.toFixed(2),
          unitCount: units.length,
          unitPreviews,
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
            period: `${a.invoice.periodMonth}/${a.invoice.periodYear}`,
            amountUsd: a.amountUsd.toString(),
          })),
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
      const rate = await getCurrentRate("BCV");
      const rateVal = new Decimal(rate?.vesPerUsd ?? "1");
      const src = (rate?.source ?? "MANUAL") as import("@prisma/client").ExchangeSource;

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i]!;
        try {
          const amountUsd = new Decimal(row.amountUsd);
          const effectiveRate = row.exchangeRate ? new Decimal(row.exchangeRate) : rateVal;
          const amountBss = row.amountBss != null
            ? new Decimal(row.amountBss)
            : amountUsd.mul(effectiveRate);
          const effectiveSrc: import("@prisma/client").ExchangeSource = row.exchangeRate ? "MANUAL" : src;

          let receiptDate: Date | null = null;
          if (row.receiptDate) {
            const d = new Date(row.receiptDate);
            if (!isNaN(d.getTime())) receiptDate = d;
          }

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
      const rate = await getCurrentRate("BCV");
      const rateVal = new Decimal(rate?.vesPerUsd ?? "1");
      const src = (rate?.source ?? "MANUAL") as import("@prisma/client").ExchangeSource;

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
          const effectiveRate = row.exchangeRate ? new Decimal(row.exchangeRate) : rateVal;
          const effectiveSrc: import("@prisma/client").ExchangeSource = row.exchangeRate ? "MANUAL" : src;
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
      const rate = await getCurrentRate("BCV");
      const rateVal = new Decimal(rate?.vesPerUsd ?? "1");
      const src = (rate?.source ?? "MANUAL") as import("@prisma/client").ExchangeSource;

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
          const effectiveRate = row.exchangeRate ? new Decimal(row.exchangeRate) : rateVal;
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
              exchangeSource: (row.exchangeRate ? "MANUAL" : src) as import("@prisma/client").ExchangeSource,
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
      const rate = await getCurrentRate("BCV");
      const rateVal = new Decimal(rate?.vesPerUsd ?? "1");
      const src = (rate?.source ?? "MANUAL") as import("@prisma/client").ExchangeSource;

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
            const effectiveRate = row.tasa ? new Decimal(row.tasa) : rateVal;
            const effectiveSrc: import("@prisma/client").ExchangeSource = row.tasa ? "MANUAL" : src;
            const totalBss = row.deudaBs != null
              ? new Decimal(row.deudaBs)
              : totalUsd.mul(effectiveRate);
            const paidBss  = paidUsd.mul(effectiveRate);

            // Fecha de vencimiento: la indicada o hace 1 mes (ya vencida por ser histórica)
            const dueDate = row.fechaVence
              ? new Date(row.fechaVence)
              : (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d; })();

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
          amountUsd: z.coerce.number().positive(),
          towerScope: z.string().max(20).optional().nullable(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db.recurringExpenseTemplate.create({
          data: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            category: input.category,
            customCategory: input.customCategory ?? null,
            description: input.description,
            supplierName: input.supplierName ?? null,
            amountUsd: input.amountUsd.toFixed(2),
            towerScope: input.towerScope ?? null,
            notes: input.notes ?? null,
            active: true,
          },
        }),
      ),

    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          description: z.string().min(2).optional(),
          supplierName: z.string().optional(),
          amountUsd: z.coerce.number().positive().optional(),
          towerScope: z.string().max(20).optional().nullable(),
          notes: z.string().optional(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, organizationId, ...data } = input;
        return ctx.db.recurringExpenseTemplate.update({
          where: { id },
          data: {
            ...data,
            amountUsd: data.amountUsd != null ? data.amountUsd.toFixed(2) : undefined,
          },
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
        if (templates.length === 0) return { created: 0 };

        const rate = await getCurrentRate("BCV");
        const usdRate = new Decimal(rate.vesPerUsd.toString());

        let created = 0;
        for (const tpl of templates) {
          // Verificar si ya existe un gasto con la misma descripción en este período
          const exists = await ctx.db.expense.findFirst({
            where: { communityId, periodYear: year, periodMonth: month, description: tpl.description, voidedAt: null },
          });
          if (exists) continue;

          const amountUsd = new Decimal(tpl.amountUsd.toString());
          const amountBss = amountUsd.mul(usdRate);

          await ctx.db.expense.create({
            data: {
              organizationId,
              communityId,
              category: tpl.category,
              customCategory: tpl.customCategory ?? null,
              description: tpl.description,
              supplierName: tpl.supplierName ?? null,
              periodYear: year,
              periodMonth: month,
              amountUsd: amountUsd.toFixed(2),
              amountBss: amountBss.toFixed(2),
              exchangeRate: usdRate.toFixed(8),
              exchangeSource: rate.source,
              currencyPrimary: "USD",
              towerScope: tpl.towerScope ?? null,
              isIndividual: false,
              createdById: ctx.user.id,
            },
          });
          created++;
        }
        return { created };
      }),
  }),
});
