import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "@/server/trpc/init";
import { Decimal } from "decimal.js";

const orgIdInput = z.object({ organizationId: z.string() });

export const securityRouter = router({
  // ─── Visitantes ────────────────────────────────────────────────
  visitors: router({
    list: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        status: z.enum(["PENDING", "CHECKED_IN", "CHECKED_OUT", "DENIED", "EXPIRED"]).optional(),
        unitId: z.string().optional(),
        date: z.coerce.date().optional(),
      }))
      .query(({ ctx, input }) => {
        const { organizationId, communityId, status, unitId, date } = input;
        const dateFilter = date
          ? { validFrom: { lte: date }, validUntil: { gte: date } }
          : {};
        return ctx.db.visitor.findMany({
          where: {
            organizationId,
            communityId,
            ...(status ? { status } : {}),
            ...(unitId ? { unitId } : {}),
            ...dateFilter,
          },
          include: {
            unit: { select: { code: true, floor: true, tower: true } },
            authorizedBy: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
      }),

    preAuthorize: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        unitId: z.string(),
        firstName: z.string().min(2),
        lastName: z.string().min(2),
        idNumber: z.string().optional(),
        idType: z.string().default("V"),
        phone: z.string().optional(),
        vehiclePlate: z.string().optional(),
        validFrom: z.coerce.date(),
        validUntil: z.coerce.date(),
        purpose: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, unitId, ...data } = input;
        await ctx.db.unit.findFirstOrThrow({
          where: { id: unitId, communityId, organizationId, deletedAt: null },
        });
        return ctx.db.visitor.create({
          data: {
            organizationId,
            communityId,
            unitId,
            authorizedById: ctx.user.id,
            ...data,
            status: "PENDING",
          },
        });
      }),

    checkIn: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        visitorId: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, visitorId } = input;
        const visitor = await ctx.db.visitor.findFirstOrThrow({
          where: { id: visitorId, organizationId, communityId },
        });
        if (visitor.status === "CHECKED_IN") {
          throw new TRPCError({ code: "CONFLICT", message: "El visitante ya ingresó" });
        }
        const now = new Date();
        if (visitor.validUntil < now) {
          await ctx.db.visitor.update({ where: { id: visitorId }, data: { status: "EXPIRED" } });
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La autorización ha vencido" });
        }
        const [updated] = await ctx.db.$transaction([
          ctx.db.visitor.update({
            where: { id: visitorId },
            data: { status: "CHECKED_IN", checkInAt: now, checkedInById: ctx.user.id },
          }),
          ctx.db.accessLog.create({
            data: {
              organizationId,
              communityId,
              unitId: visitor.unitId,
              visitorId,
              personName: `${visitor.firstName} ${visitor.lastName}`,
              personId_doc: visitor.idNumber ?? null,
              vehiclePlate: visitor.vehiclePlate ?? null,
              purpose: visitor.purpose ?? null,
              direction: "IN",
              registeredById: ctx.user.id,
            },
          }),
        ]);
        return updated;
      }),

    checkOut: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        visitorId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, visitorId } = input;
        const visitor = await ctx.db.visitor.findFirstOrThrow({
          where: { id: visitorId, organizationId, communityId },
        });
        if (visitor.status !== "CHECKED_IN") {
          throw new TRPCError({ code: "CONFLICT", message: "El visitante no está registrado como dentro" });
        }
        const now = new Date();
        const [updated] = await ctx.db.$transaction([
          ctx.db.visitor.update({
            where: { id: visitorId },
            data: { status: "CHECKED_OUT", checkOutAt: now },
          }),
          ctx.db.accessLog.create({
            data: {
              organizationId,
              communityId,
              unitId: visitor.unitId,
              visitorId,
              personName: `${visitor.firstName} ${visitor.lastName}`,
              personId_doc: visitor.idNumber ?? null,
              vehiclePlate: visitor.vehiclePlate ?? null,
              direction: "OUT",
              registeredById: ctx.user.id,
            },
          }),
        ]);
        return updated;
      }),

    deny: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        visitorId: z.string(),
        reason: z.string().min(3),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, visitorId, reason } = input;
        const visitor = await ctx.db.visitor.findFirstOrThrow({
          where: { id: visitorId, organizationId, communityId },
        });
        const [updated] = await ctx.db.$transaction([
          ctx.db.visitor.update({
            where: { id: visitorId },
            data: { status: "DENIED" },
          }),
          ctx.db.accessLog.create({
            data: {
              organizationId,
              communityId,
              unitId: visitor.unitId,
              visitorId,
              personName: `${visitor.firstName} ${visitor.lastName}`,
              personId_doc: visitor.idNumber ?? null,
              direction: "IN",
              deniedReason: reason,
              registeredById: ctx.user.id,
            },
          }),
        ]);
        return updated;
      }),
  }),

  // ─── Log de accesos ────────────────────────────────────────────
  accessLog: router({
    list: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        unitId: z.string().optional(),
        direction: z.enum(["IN", "OUT"]).optional(),
        date: z.coerce.date().optional(),
        take: z.number().int().min(1).max(200).default(50),
      }))
      .query(({ ctx, input }) => {
        const { organizationId, communityId, unitId, direction, date, take } = input;
        const dateFilter = date
          ? {
              createdAt: {
                gte: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
                lt:  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)),
              },
            }
          : {};
        return ctx.db.accessLog.findMany({
          where: {
            organizationId,
            communityId,
            ...(unitId    ? { unitId }    : {}),
            ...(direction ? { direction } : {}),
            ...dateFilter,
          },
          include: {
            unit: { select: { code: true } },
            visitor: { select: { firstName: true, lastName: true } },
            registeredBy: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take,
        });
      }),

    registerWalkIn: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        unitId: z.string().optional(),
        personName: z.string().min(2),
        personId_doc: z.string().optional(),
        vehiclePlate: z.string().optional(),
        purpose: z.string().optional(),
        direction: z.enum(["IN", "OUT"]).default("IN"),
      }))
      .mutation(({ ctx, input }) => {
        const { organizationId, communityId, ...data } = input;
        return ctx.db.accessLog.create({
          data: {
            organizationId,
            communityId,
            ...data,
            registeredById: ctx.user.id,
          },
        });
      }),
  }),

  // ─── Violaciones al reglamento ─────────────────────────────────
  violations: router({
    list: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        unitId: z.string().optional(),
        type: z.enum(["NOISE", "PARKING", "PETS", "COMMON_AREAS", "ELEVATOR_MISUSE", "GARBAGE", "OTHER"]).optional(),
        resolved: z.boolean().optional(),
      }))
      .query(({ ctx, input }) => {
        const { organizationId, communityId, unitId, type, resolved } = input;
        return ctx.db.violation.findMany({
          where: {
            organizationId,
            communityId,
            ...(unitId ? { unitId } : {}),
            ...(type   ? { type }   : {}),
            ...(resolved !== undefined
              ? resolved ? { resolvedAt: { not: null } } : { resolvedAt: null }
              : {}),
          },
          include: {
            unit: { select: { code: true, floor: true, tower: true } },
            reportedBy: { select: { name: true } },
            fineInvoice: { select: { invoiceNumber: true, status: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
      }),

    report: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        unitId: z.string(),
        type: z.enum(["NOISE", "PARKING", "PETS", "COMMON_AREAS", "ELEVATOR_MISUSE", "GARBAGE", "OTHER"]),
        description: z.string().min(5),
        evidenceUrls: z.array(z.string().url()).default([]),
      }))
      .mutation(({ ctx, input }) => {
        const { organizationId, communityId, ...data } = input;
        return ctx.db.violation.create({
          data: {
            organizationId,
            communityId,
            ...data,
            reportedById: ctx.user.id,
          },
        });
      }),

    applyFineToViolation: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        violationId: z.string(),
        amountUsd: z.coerce.number().positive(),
        dueDate: z.coerce.date(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, violationId, amountUsd, dueDate } = input;
        const violation = await ctx.db.violation.findFirstOrThrow({
          where: { id: violationId, organizationId, communityId },
          include: { unit: { select: { code: true } } },
        });
        if (violation.fineInvoiceId) {
          throw new TRPCError({ code: "CONFLICT", message: "Esta violación ya tiene una multa aplicada" });
        }
        const { getCurrentRate } = await import("@/server/services/exchange");
        const rate = await getCurrentRate("BCV");
        const usd = new Decimal(amountUsd);
        const bss = usd.mul(rate.vesPerUsd);
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id: communityId }, select: { primaryCurrency: true },
        });
        const now = new Date();
        const invoiceNumber = `MULTA-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${violation.unit.code}-${Date.now().toString(36).toUpperCase()}`;

        return ctx.db.$transaction(async (tx) => {
          const inv = await tx.invoice.create({
            data: {
              organizationId,
              communityId,
              unitId: violation.unitId,
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
                  description: `Multa: ${violation.type} — ${violation.description}`,
                  amountBss: bss.toFixed(2),
                  amountUsd: usd.toFixed(2),
                  aliquot: "100.000000",
                }],
              },
            },
          });
          await tx.violation.update({
            where: { id: violationId },
            data: { fineInvoiceId: inv.id, fineAmountUsd: usd },
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: ctx.user.id,
              action: "FINE_APPLIED",
              entityType: "Violation",
              entityId: violationId,
              after: { invoiceId: inv.id, amountUsd },
            },
          });
          return inv;
        });
      }),

    resolve: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        violationId: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { organizationId, communityId, violationId, notes } = input;
        return ctx.db.violation.update({
          where: { id: violationId },
          data: { resolvedAt: new Date(), resolvedNotes: notes },
        });
      }),
  }),

  // ─── Verificar código QR de visitante ─────────────────────────
  verifyAccessCode: orgProcedure
    .input(z.object({
      organizationId: z.string(),
      communityId: z.string(),
      accessCode: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const visitor = await ctx.db.visitor.findFirst({
        where: {
          communityId: input.communityId,
          accessCode: input.accessCode,
        },
        include: {
          unit: { select: { code: true } },
        },
      });
      if (!visitor) return { found: false, valid: false, visitor: null };
      const now = new Date();
      const valid = visitor.status !== "DENIED" &&
                    now >= new Date(visitor.validFrom) &&
                    now <= new Date(visitor.validUntil);
      return { found: true, valid, visitor: {
        id: visitor.id,
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        purpose: visitor.purpose,
        unitCode: visitor.unit.code,
        validFrom: visitor.validFrom.toISOString(),
        validUntil: visitor.validUntil.toISOString(),
        status: visitor.status,
        checkInAt: visitor.checkInAt?.toISOString() ?? null,
      }};
    }),
});
