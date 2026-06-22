import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, platformProcedure } from "@/server/trpc/init";
import bcrypt from "bcryptjs";

const slugSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones");

// Validación de email permisiva: acepta unicode en la parte local (ej. josecastaños@gmail.com)
// z.string().email() solo acepta ASCII estricto (RFC 5321), lo que rechaza caracteres venezolanos comunes.
const emailSchema = z
  .string()
  .min(1)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), {
    message: "Formato de email inválido",
  });

export const platformRouter = router({
  // ─── Plans ─────────────────────────────────────────────────────────
  plans: router({
    list: platformProcedure.query(({ ctx }) =>
      ctx.db.plan.findMany({
        orderBy: { priceUsd: "asc" },
        include: { _count: { select: { subscriptions: true } } },
      }),
    ),
    create: platformProcedure
      .input(
        z.object({
          code: z.string().min(2).toUpperCase(),
          name: z.string().min(2),
          description: z.string().optional(),
          maxCommunities: z.number().int().positive(),
          maxUnits: z.number().int().positive(),
          priceUsd: z.coerce.number().nonnegative(),
          features: z.record(z.boolean()).default({}),
        }),
      )
      .mutation(({ ctx, input }) => ctx.db.plan.create({ data: input })),
    update: platformProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
          maxCommunities: z.number().int().positive().optional(),
          maxUnits: z.number().int().positive().optional(),
          priceUsd: z.coerce.number().nonnegative().optional(),
          active: z.boolean().optional(),
          features: z.record(z.boolean()).optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db.plan.update({ where: { id }, data }),
      ),
  }),

  // ─── Métricas de plataforma ────────────────────────────────────────
  metrics: platformProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [
      activeCount,
      trialCount,
      pastDueCount,
      suspendedCount,
      canceledCount,
      newThisMonth,
      expiringSoon,
      activeSubs,
      totalUnitsResult,
    ] = await Promise.all([
      ctx.db.subscription.count({ where: { status: "ACTIVE" } }),
      ctx.db.subscription.count({ where: { status: "TRIAL" } }),
      ctx.db.subscription.count({ where: { status: "PAST_DUE" } }),
      ctx.db.subscription.count({ where: { status: "SUSPENDED" } }),
      ctx.db.subscription.count({ where: { status: "CANCELLED" } }),
      ctx.db.organization.count({ where: { createdAt: { gte: startOfMonth }, deletedAt: null } }),
      ctx.db.subscription.count({
        where: {
          status: "TRIAL",
          trialEndsAt: { gte: now, lte: in14Days },
        },
      }),
      ctx.db.subscription.findMany({
        where: { status: { in: ["ACTIVE", "TRIAL"] } },
        include: { plan: { select: { priceUsd: true } } },
      }),
      ctx.db.unit.aggregate({ _count: { _all: true }, where: { deletedAt: null } }),
    ]);

    const mrr = activeSubs.reduce(
      (sum, s) => sum + Number(s.plan.priceUsd),
      0,
    );

    return {
      byStatus: { active: activeCount, trial: trialCount, pastDue: pastDueCount, suspended: suspendedCount, canceled: canceledCount },
      newThisMonth,
      expiringSoon,
      mrr,
      arr: mrr * 12,
      totalUnits: totalUnitsResult._count._all,
      totalOrgs: activeCount + trialCount + pastDueCount + suspendedCount,
    };
  }),

  // ─── Organizations ─────────────────────────────────────────────────
  organizations: router({
    list: platformProcedure
      .input(
        z
          .object({
            search: z.string().optional(),
            status: z.enum(["ALL", "ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED", "CANCELLED"]).default("ALL"),
            planId: z.string().optional(),
            includeInactive: z.boolean().default(false),
          })
          .default({}),
      )
      .query(({ ctx, input }) =>
        ctx.db.organization.findMany({
          where: {
            deletedAt: null,
            ...(input.includeInactive ? {} : {}),
            ...(input.search
              ? {
                  OR: [
                    { name: { contains: input.search, mode: "insensitive" } },
                    { slug: { contains: input.search, mode: "insensitive" } },
                    { rif: { contains: input.search, mode: "insensitive" } },
                    { email: { contains: input.search, mode: "insensitive" } },
                  ],
                }
              : {}),
            ...((input.status !== "ALL" || input.planId)
              ? {
                  subscription: {
                    ...(input.status !== "ALL" ? { status: input.status as "ACTIVE" | "TRIAL" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" } : {}),
                    ...(input.planId ? { planId: input.planId } : {}),
                  },
                }
              : {}),
          },
          include: {
            subscription: { include: { plan: true } },
            _count: { select: { communities: true, memberships: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
      ),

    byId: platformProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const org = await ctx.db.organization.findUniqueOrThrow({
          where: { id: input.id },
          include: {
            subscription: { include: { plan: true } },
            communities: {
              where: { deletedAt: null },
              include: { _count: { select: { units: true } } },
              orderBy: { name: "asc" },
            },
          },
        });

        // Estadísticas financieras globales de la org
        const [unitsCount, invoicedAgg, paidAgg, membersCount] = await Promise.all([
          ctx.db.unit.count({ where: { organizationId: input.id, deletedAt: null } }),
          ctx.db.invoice.aggregate({
            where: { organizationId: input.id, status: { not: "VOIDED" } },
            _sum: { totalUsd: true },
          }),
          ctx.db.payment.aggregate({
            where: { organizationId: input.id, voidedAt: null, isHistorical: false },
            _sum: { amountUsd: true },
          }),
          ctx.db.membership.count({
            where: { organizationId: input.id, active: true, revokedAt: null },
          }),
        ]);

        const communities = org.communities.map((c) => ({
          ...c,
          totalUnits: c._count.units,
        }));

        return {
          ...org,
          communities,
          stats: {
            unitsCount,
            totalInvoicedUsd: Number(invoicedAgg._sum.totalUsd ?? 0),
            totalPaidUsd: Number(paidAgg._sum.amountUsd ?? 0),
            membersCount,
          },
        };
      }),

    create: platformProcedure
      .input(
        z.object({
          slug: slugSchema,
          name: z.string().min(2),
          legalName: z.string().optional(),
          rif: z.string().optional(),
          email: emailSchema,
          phone: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          type: z.enum(["RESIDENTIAL", "COMMERCIAL"]).default("RESIDENTIAL"),
          planId: z.string(),
          trialDays: z.number().int().min(0).default(30),
          adminEmail: emailSchema,
          adminName: z.string().min(2),
          adminPassword: z.string().min(8),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db.organization.findUnique({ where: { slug: input.slug } });
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "Slug ya existe" });

        const adminEmail = input.adminEmail.toLowerCase();
        const existingUser = await ctx.db.user.findUnique({ where: { email: adminEmail } });
        if (existingUser)
          throw new TRPCError({ code: "CONFLICT", message: "Email del admin ya está registrado" });

        const trialEnds = new Date();
        trialEnds.setDate(trialEnds.getDate() + input.trialDays);
        const passwordHash = await bcrypt.hash(input.adminPassword, 12);

        return ctx.db.$transaction(async (tx) => {
          const org = await tx.organization.create({
            data: {
              slug: input.slug,
              name: input.name,
              legalName: input.legalName,
              rif: input.rif,
              email: input.email,
              phone: input.phone,
              address: input.address,
              city: input.city,
              type: input.type,
            },
          });
          await tx.subscription.create({
            data: {
              organizationId: org.id,
              planId: input.planId,
              status: "TRIAL",
              trialEndsAt: trialEnds,
              currentPeriodStart: new Date(),
              currentPeriodEnd: trialEnds,
            },
          });
          const user = await tx.user.create({
            data: {
              email: adminEmail,
              name: input.adminName,
              passwordHash,
              emailVerified: new Date(),
            },
          });
          await tx.membership.create({
            data: {
              userId: user.id,
              scope: "ORGANIZATION",
              role: "ORG_ADMIN",
              organizationId: org.id,
            },
          });
          await tx.auditLog.create({
            data: {
              organizationId: org.id,
              actorId: ctx.user.id,
              action: "CREATE",
              entityType: "Organization",
              entityId: org.id,
              after: { slug: org.slug, name: org.name },
            },
          });
          return org;
        });
      }),

    update: platformProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          legalName: z.string().optional(),
          rif: z.string().optional(),
          email: emailSchema.optional(),
          phone: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const before = await ctx.db.organization.findUniqueOrThrow({ where: { id } });
        const after = await ctx.db.organization.update({ where: { id }, data });
        await ctx.db.auditLog.create({
          data: {
            organizationId: id,
            actorId: ctx.user.id,
            action: "UPDATE",
            entityType: "Organization",
            entityId: id,
            before: { ...before } as object,
            after: { ...after } as object,
          },
        });
        return after;
      }),

    softDelete: platformProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db.organization.update({
          where: { id: input.id },
          data: { active: false, deletedAt: new Date() },
        }),
      ),

    /** Gestión de suscripción: cambiar plan, cambiar estado, extender trial */
    updateSubscription: platformProcedure
      .input(
        z.object({
          organizationId: z.string(),
          planId: z.string().optional(),
          status: z.enum(["ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED", "CANCELLED"]).optional(),
          extendTrialDays: z.number().int().min(1).max(365).optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const sub = await ctx.db.subscription.findFirstOrThrow({
          where: { organizationId: input.organizationId },
        });

        const updates: Record<string, unknown> = {};
        if (input.planId) updates.planId = input.planId;
        if (input.status) updates.status = input.status;
        if (input.notes !== undefined) updates.notes = input.notes;
        if (input.extendTrialDays) {
          const base = sub.trialEndsAt && sub.trialEndsAt > new Date()
            ? sub.trialEndsAt
            : new Date();
          const newEnd = new Date(base.getTime() + input.extendTrialDays * 24 * 60 * 60 * 1000);
          updates.trialEndsAt = newEnd;
          updates.currentPeriodEnd = newEnd;
          updates.status = "TRIAL";
        }
        if (input.status === "ACTIVE") {
          const periodEnd = new Date();
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          updates.currentPeriodStart = new Date();
          updates.currentPeriodEnd = periodEnd;
        }

        const updated = await ctx.db.subscription.update({
          where: { id: sub.id },
          data: updates,
          include: { plan: true },
        });

        await ctx.db.auditLog.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: "UPDATE",
            entityType: "Subscription",
            entityId: sub.id,
            after: updates as object,
          },
        });

        return updated;
      }),

    // ─── Admins de la organización ──────────────────────────────
    listAdmins: platformProcedure
      .input(z.object({ organizationId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.membership.findMany({
          where: {
            organizationId: input.organizationId,
            role: { in: ["ORG_ADMIN", "COMMUNITY_ADMIN"] },
            revokedAt: null,
            active: true,
          },
          include: { user: { select: { id: true, email: true, name: true, active: true } } },
          orderBy: { createdAt: "asc" },
        }),
      ),

    createAdmin: platformProcedure
      .input(z.object({
        organizationId: z.string(),
        email: emailSchema,
        name: z.string().min(2),
        password: z.string().min(8),
        role: z.enum(["ORG_ADMIN", "COMMUNITY_ADMIN"]).default("ORG_ADMIN"),
      }))
      .mutation(async ({ ctx, input }) => {
        const email = input.email.toLowerCase();
        let user = await ctx.db.user.findUnique({ where: { email } });
        if (!user) {
          const hash = await bcrypt.hash(input.password, 12);
          user = await ctx.db.user.create({
            data: { email, name: input.name, passwordHash: hash, emailVerified: new Date(), active: true },
          });
        }
        const existing = await ctx.db.membership.findFirst({
          where: { userId: user.id, organizationId: input.organizationId, active: true, revokedAt: null },
        });
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "Este usuario ya tiene acceso a esta organización" });
        }
        const membership = await ctx.db.membership.create({
          data: {
            userId: user.id,
            scope: "ORGANIZATION",
            role: input.role,
            organizationId: input.organizationId,
            active: true,
          },
          include: { user: { select: { id: true, email: true, name: true, active: true } } },
        });
        await ctx.db.auditLog.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: "ROLE_GRANTED",
            entityType: "Membership",
            entityId: membership.id,
            after: { email, role: input.role },
          },
        });
        return membership;
      }),

    removeAdmin: platformProcedure
      .input(z.object({ membershipId: z.string(), organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const mem = await ctx.db.membership.findFirstOrThrow({
          where: { id: input.membershipId, organizationId: input.organizationId },
        });
        await ctx.db.membership.update({
          where: { id: mem.id },
          data: { active: false, revokedAt: new Date() },
        });
        await ctx.db.auditLog.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: "ROLE_REVOKED",
            entityType: "Membership",
            entityId: mem.id,
          },
        });
        return { ok: true };
      }),

    /** Últimas acciones de auditoría de la organización */
    auditLog: platformProcedure
      .input(z.object({ organizationId: z.string(), take: z.number().default(20) }))
      .query(({ ctx, input }) =>
        ctx.db.auditLog.findMany({
          where: { organizationId: input.organizationId },
          orderBy: { createdAt: "desc" },
          take: input.take,
          include: { actor: { select: { name: true, email: true } } },
        }),
      ),
  }),
});
