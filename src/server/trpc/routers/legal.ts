import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "@/server/trpc/init";
import { Decimal } from "decimal.js";

const orgIdInput = z.object({ organizationId: z.string() });

/**
 * Módulo legal: directorio de abogados + casos de cobranza por unidad, con
 * honorario cobrado aparte de la cuota normal. Mismo patrón que
 * security.violations + applyFineToViolation (multas), pero para honorarios.
 * Pedido cliente 10-jul-2026: "asignar abogados y honorarios a los residentes
 * que apliquen" — distinto de ExpenseCategory.LEGAL (gasto interno general).
 */
export const legalRouter = router({
  lawyers: router({
    list: orgProcedure
      .input(orgIdInput.extend({ includeInactive: z.boolean().default(false) }))
      .query(({ ctx, input }) =>
        ctx.db.lawyer.findMany({
          where: {
            organizationId: input.organizationId,
            ...(input.includeInactive ? {} : { active: true }),
          },
          orderBy: { name: "asc" },
        }),
      ),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          name: z.string().min(2),
          specialty: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db.lawyer.create({
          data: {
            organizationId: input.organizationId,
            name: input.name,
            specialty: input.specialty,
            phone: input.phone,
            email: input.email,
            notes: input.notes,
          },
        }),
      ),
    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          name: z.string().min(2).optional(),
          specialty: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional(),
          active: z.boolean().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db.lawyer.update({
          where: { id: input.id },
          data: {
            name: input.name,
            specialty: input.specialty,
            phone: input.phone,
            email: input.email,
            active: input.active,
            notes: input.notes,
          },
        }),
      ),
  }),

  cases: router({
    list: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        unitId: z.string().optional(),
        status: z.enum(["OPEN", "RESOLVED"]).optional(),
      }))
      .query(({ ctx, input }) =>
        ctx.db.legalCase.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.unitId ? { unitId: input.unitId } : {}),
            ...(input.status ? { status: input.status } : {}),
          },
          include: {
            unit: {
              select: {
                code: true,
                ownerships: {
                  where: { endDate: null },
                  select: { person: { select: { firstName: true, lastName: true } } },
                },
              },
            },
            lawyer: { select: { id: true, name: true } },
            feeInvoice: { select: { invoiceNumber: true, status: true, totalUsd: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      ),

    create: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        unitId: z.string(),
        lawyerId: z.string().optional(),
        description: z.string().min(5),
      }))
      .mutation(({ ctx, input }) =>
        ctx.db.legalCase.create({
          data: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            unitId: input.unitId,
            lawyerId: input.lawyerId,
            description: input.description,
            createdById: ctx.user.id,
          },
        }),
      ),

    assignLawyer: orgProcedure
      .input(orgIdInput.extend({ caseId: z.string(), lawyerId: z.string().nullable() }))
      .mutation(({ ctx, input }) =>
        ctx.db.legalCase.update({
          where: { id: input.caseId },
          data: { lawyerId: input.lawyerId },
        }),
      ),

    /** Cobra el honorario legal a la unidad del caso — mismo patrón que applyFineToViolation. */
    chargeFee: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        caseId: z.string(),
        amountUsd: z.coerce.number().positive(),
        dueDate: z.coerce.date(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, caseId, amountUsd, dueDate } = input;
        const legalCase = await ctx.db.legalCase.findFirstOrThrow({
          where: { id: caseId, organizationId, communityId },
          include: { unit: { select: { code: true } }, lawyer: { select: { name: true } } },
        });
        if (legalCase.feeInvoiceId) {
          throw new TRPCError({ code: "CONFLICT", message: "Este caso ya tiene un honorario cobrado" });
        }
        const { getCurrentRate } = await import("@/server/services/exchange");
        const rate = await getCurrentRate("BCV");
        const usd = new Decimal(amountUsd);
        const bss = usd.mul(rate.vesPerUsd);
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id: communityId }, select: { primaryCurrency: true },
        });
        const now = new Date();
        const invoiceNumber = `LEGAL-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${legalCase.unit.code}-${Date.now().toString(36).toUpperCase()}`;
        const lawyerLabel = legalCase.lawyer?.name ? ` — ${legalCase.lawyer.name}` : "";

        return ctx.db.$transaction(async (tx) => {
          const inv = await tx.invoice.create({
            data: {
              organizationId,
              communityId,
              unitId: legalCase.unitId,
              invoiceNumber,
              type: "LEGAL_FEE",
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
                  description: `Honorarios legales${lawyerLabel}: ${legalCase.description}`,
                  amountBss: bss.toFixed(2),
                  amountUsd: usd.toFixed(2),
                  aliquot: "100.000000",
                }],
              },
            },
          });
          await tx.legalCase.update({
            where: { id: caseId },
            data: { feeInvoiceId: inv.id, feeAmountUsd: usd },
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: ctx.user.id,
              action: "LEGAL_FEE_APPLIED",
              entityType: "LegalCase",
              entityId: caseId,
              after: { invoiceId: inv.id, amountUsd },
            },
          });
          return inv;
        });
      }),

    resolve: orgProcedure
      .input(orgIdInput.extend({
        caseId: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) =>
        ctx.db.legalCase.update({
          where: { id: input.caseId },
          data: { status: "RESOLVED", resolvedAt: new Date(), resolvedNotes: input.notes },
        }),
      ),
  }),
});
