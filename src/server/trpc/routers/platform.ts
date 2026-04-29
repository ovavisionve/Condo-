import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, platformProcedure } from "@/server/trpc/init";
import bcrypt from "bcryptjs";

const slugSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones");

export const platformRouter = router({
  // ─── Plans ─────────────────────────────────────────────────────────
  plans: router({
    list: platformProcedure.query(({ ctx }) =>
      ctx.db.plan.findMany({ orderBy: { priceUsd: "asc" } }),
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

  // ─── Organizations ─────────────────────────────────────────────────
  organizations: router({
    list: platformProcedure
      .input(
        z
          .object({ search: z.string().optional(), includeInactive: z.boolean().default(false) })
          .default({}),
      )
      .query(({ ctx, input }) =>
        ctx.db.organization.findMany({
          where: {
            deletedAt: null,
            ...(input.includeInactive ? {} : { active: true }),
            ...(input.search
              ? {
                  OR: [
                    { name: { contains: input.search, mode: "insensitive" } },
                    { slug: { contains: input.search, mode: "insensitive" } },
                    { rif: { contains: input.search, mode: "insensitive" } },
                  ],
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
      .query(({ ctx, input }) =>
        ctx.db.organization.findUniqueOrThrow({
          where: { id: input.id },
          include: { subscription: { include: { plan: true } }, communities: true },
        }),
      ),
    create: platformProcedure
      .input(
        z.object({
          slug: slugSchema,
          name: z.string().min(2),
          legalName: z.string().optional(),
          rif: z.string().optional(),
          email: z.string().email(),
          phone: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          // Suscripción inicial
          planId: z.string(),
          trialDays: z.number().int().min(0).default(30),
          // Admin inicial de la organización
          adminEmail: z.string().email(),
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
          email: z.string().email().optional(),
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
  }),
});
