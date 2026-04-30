import { z } from "zod";
import { Decimal } from "decimal.js";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { router, orgProcedure, protectedProcedure } from "@/server/trpc/init";
import { isPlatform, canManageOrganization } from "@/server/auth/permissions";
import type { SessionMembership } from "@/server/auth/config";

const orgIdInput = z.object({ organizationId: z.string() });

export const orgRouter = router({
  /** Lista organizaciones a las que el usuario tiene acceso (para selector). */
  myOrganizations: protectedProcedure.query(async ({ ctx }) => {
    const memberships = (ctx.user.memberships ?? []) as SessionMembership[];
    if (memberships.some((m: SessionMembership) => isPlatform(m.role))) {
      return ctx.db.organization.findMany({
        where: { deletedAt: null, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true },
      });
    }
    const orgIds = memberships
      .filter((m: SessionMembership) => canManageOrganization(m.role) && m.organizationId)
      .map((m: SessionMembership) => m.organizationId!);
    if (orgIds.length === 0) return [];
    return ctx.db.organization.findMany({
      where: { id: { in: orgIds }, deletedAt: null, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    });
  }),

  // ─── Communities ──────────────────────────────────────────────
  communities: router({
    list: orgProcedure.input(orgIdInput).query(({ ctx, input }) =>
      ctx.db.community.findMany({
        where: { organizationId: input.organizationId, deletedAt: null },
        include: { _count: { select: { units: true } } },
        orderBy: { name: "asc" },
      }),
    ),
    byId: orgProcedure
      .input(orgIdInput.extend({ id: z.string() }))
      .query(({ ctx, input }) => {
        const memberships = (ctx.user.memberships ?? []) as SessionMembership[];
        const isPlat = memberships.some((m: SessionMembership) => isPlatform(m.role));
        return ctx.db.community.findFirstOrThrow({
          where: { id: input.id, ...(isPlat ? {} : { organizationId: input.organizationId }), deletedAt: null },
          include: { _count: { select: { units: true } } },
        });
      }),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          name: z.string().min(2),
          rif: z.string().optional(),
          address: z.string().min(2),
          city: z.string().min(2),
          state: z.string().optional(),
          primaryCurrency: z.enum(["VES", "USD"]).default("USD"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, ...data } = input;
        return ctx.db.community.create({ data: { organizationId, ...data } });
      }),
    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          name: z.string().optional(),
          rif: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          primaryCurrency: z.enum(["VES", "USD"]).optional(),
          floorsCount: z.coerce.number().int().positive().nullable().optional(),
          towersCount: z.coerce.number().int().positive().optional(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, organizationId, ...data } = input;
        const memberships = (ctx.user.memberships ?? []) as SessionMembership[];
        const isPlat = memberships.some((m: SessionMembership) => isPlatform(m.role));
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id, ...(isPlat ? {} : { organizationId }), deletedAt: null },
        });
        return ctx.db.community.update({ where: { id: community.id }, data });
      }),
    setMonthlyFee: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          monthlyFeeUsd: z.coerce.number().min(0),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, monthlyFeeUsd } = input;
        const memberships = (ctx.user.memberships ?? []) as SessionMembership[];
        const isPlat = memberships.some((m: SessionMembership) => isPlatform(m.role));
        await ctx.db.community.findFirstOrThrow({
          where: { id: communityId, ...(isPlat ? {} : { organizationId }), deletedAt: null },
        });
        const updated = await ctx.db.community.update({
          where: { id: communityId },
          data: {
            monthlyFeeUsd: new (await import("decimal.js")).Decimal(monthlyFeeUsd).toFixed(2),
            monthlyFeeSetAt: new Date(),
          },
        });
        await ctx.db.auditLog.create({
          data: {
            organizationId,
            actorId: ctx.user.id,
            action: "MONTHLY_FEE_UPDATED",
            entityType: "Community",
            entityId: communityId,
            after: { monthlyFeeUsd },
          },
        });
        return updated;
      }),
  }),

  // ─── Units ─────────────────────────────────────────────────────
  units: router({
    list: orgProcedure
      .input(orgIdInput.extend({ communityId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.unit.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            deletedAt: null,
          },
          include: {
            ownerships: {
              where: { endDate: null },
              include: { person: { select: { firstName: true, lastName: true, idNumber: true } } },
            },
          },
          orderBy: { code: "asc" },
        }),
      ),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          code: z.string().min(1).max(20),
          type: z.enum(["APARTMENT", "HOUSE", "COMMERCIAL", "PARKING", "STORAGE", "OTHER"]).default("APARTMENT"),
          aliquot: z.coerce.number().positive().max(100),
          floor: z.coerce.number().int().nonnegative().optional(),
          tower: z.string().max(10).optional(),
          areaM2: z.coerce.number().positive().optional(),
          bedrooms: z.coerce.number().int().nonnegative().optional(),
          bathrooms: z.coerce.number().int().nonnegative().optional(),
          parkingSpots: z.coerce.number().int().nonnegative().default(0),
          storageUnits: z.coerce.number().int().nonnegative().default(0),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, ...data } = input;
        const community = await ctx.db.community.findFirstOrThrow({
          where: { id: data.communityId, organizationId, deletedAt: null },
        });
        return ctx.db.$transaction(async (tx) => {
          const unit = await tx.unit.create({
            data: {
              organizationId,
              communityId: community.id,
              code: data.code,
              type: data.type,
              aliquot: new Decimal(data.aliquot).toFixed(6),
              floor: data.floor,
              tower: data.tower,
              areaM2: data.areaM2?.toString(),
              bedrooms: data.bedrooms,
              bathrooms: data.bathrooms,
              parkingSpots: data.parkingSpots,
              storageUnits: data.storageUnits,
            } as never,
          });
          await tx.community.update({
            where: { id: community.id },
            data: { totalUnits: { increment: 1 } },
          });
          return unit;
        });
      }),
    bulkCreate: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          units: z
            .array(
              z.object({
                code: z.string().min(1),
                aliquot: z.coerce.number().positive().max(100),
                type: z.enum(["APARTMENT", "HOUSE", "COMMERCIAL", "PARKING", "STORAGE", "OTHER"]).default("APARTMENT"),
              }),
            )
            .min(1)
            .max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const community = await ctx.db.community.findFirstOrThrow({
          where: {
            id: input.communityId,
            organizationId: input.organizationId,
            deletedAt: null,
          },
        });
        const sumAliquot = input.units.reduce((s, u) => s + u.aliquot, 0);
        if (sumAliquot > 100.0001) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `La suma de alícuotas no puede exceder 100% (recibido: ${sumAliquot.toFixed(4)}%)`,
          });
        }
        return ctx.db.$transaction(async (tx) => {
          const created = await Promise.all(
            input.units.map((u) =>
              tx.unit.create({
                data: {
                  organizationId: input.organizationId,
                  communityId: community.id,
                  code: u.code,
                  type: u.type,
                  aliquot: new Decimal(u.aliquot).toFixed(6),
                } as never,
              }),
            ),
          );
          await tx.community.update({
            where: { id: community.id },
            data: { totalUnits: { increment: created.length } },
          });
          return { count: created.length };
        });
      }),
    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          code: z.string().min(1).optional(),
          aliquot: z.coerce.number().positive().max(100).optional(),
          floor: z.coerce.number().int().nonnegative().nullable().optional(),
          tower: z.string().max(10).nullable().optional(),
          areaM2: z.coerce.number().positive().optional(),
          bedrooms: z.coerce.number().int().nonnegative().optional(),
          bathrooms: z.coerce.number().int().nonnegative().optional(),
          parkingSpots: z.coerce.number().int().nonnegative().optional(),
          storageUnits: z.coerce.number().int().nonnegative().optional(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, organizationId, ...rest } = input;
        const unit = await ctx.db.unit.findFirstOrThrow({
          where: { id, organizationId, deletedAt: null },
        });
        const data: Record<string, unknown> = { ...rest };
        if (rest.aliquot !== undefined) data.aliquot = new Decimal(rest.aliquot).toFixed(6);
        if (rest.areaM2 !== undefined) data.areaM2 = new Decimal(rest.areaM2).toFixed(2);
        return ctx.db.unit.update({ where: { id: unit.id }, data: data as never });
      }),
    /** Detalle completo de una unidad: propietario actual, inquilino, vehículos, facturas, pagos. */
    detail: orgProcedure
      .input(orgIdInput.extend({ unitId: z.string() }))
      .query(async ({ ctx, input }) => {
        const unit = await ctx.db.unit.findFirstOrThrow({
          where: { id: input.unitId, organizationId: input.organizationId, deletedAt: null },
          include: {
            ownerships: {
              where: { endDate: null },
              include: {
                person: {
                  include: { vehicles: { where: { active: true } } },
                },
              },
              orderBy: { startDate: "desc" },
            },
            tenancies: {
              where: { endDate: null },
              include: {
                person: {
                  include: { vehicles: { where: { active: true } } },
                },
              },
              orderBy: { startDate: "desc" },
            },
            invoices: {
              where: { status: { not: "VOIDED" } },
              orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
              take: 24,
            },
            payments: {
              where: { voidedAt: null },
              include: {
                allocations: { include: { invoice: { select: { invoiceNumber: true } } } },
              },
              orderBy: { paidAt: "desc" },
              take: 24,
            },
          },
        });
        return unit;
      }),
  }),

  // ─── Personas ──────────────────────────────────────────────────
  persons: router({
    /** Personas registradas en la organización, con opción de filtrar por communityId. */
    list: orgProcedure
      .input(orgIdInput.extend({ communityId: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        if (input.communityId) {
          // Personas que tienen ownership o tenancy activa en esa comunidad
          const units = await ctx.db.unit.findMany({
            where: { communityId: input.communityId, organizationId: input.organizationId, deletedAt: null },
            select: { id: true },
          });
          const unitIds = units.map((u) => u.id);
          const [ownerships, tenancies] = await Promise.all([
            ctx.db.ownership.findMany({
              where: { unitId: { in: unitIds }, endDate: null },
              include: {
                person: { include: { vehicles: { where: { active: true } } } },
                unit: { select: { id: true, code: true, floor: true, tower: true } },
              },
            }),
            ctx.db.tenancy.findMany({
              where: { unitId: { in: unitIds }, endDate: null },
              include: {
                person: { include: { vehicles: { where: { active: true } } } },
                unit: { select: { id: true, code: true, floor: true, tower: true } },
              },
            }),
          ]);
          return { ownerships, tenancies };
        }
        return ctx.db.person.findMany({
          where: { organizationId: input.organizationId, deletedAt: null },
          include: { vehicles: { where: { active: true } } },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        });
      }),

    create: orgProcedure
      .input(
        orgIdInput.extend({
          firstName: z.string().min(1),
          lastName: z.string().min(1),
          idType: z.enum(["CEDULA_V", "CEDULA_E", "RIF", "PASSPORT", "OTHER"]).default("CEDULA_V"),
          idNumber: z.string().min(1),
          email: z.string().email().optional(),
          phone: z.string().optional(),
          whatsapp: z.string().optional(),
          address: z.string().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { organizationId, ...data } = input;
        return ctx.db.person.create({ data: { organizationId, ...data } });
      }),

    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          firstName: z.string().min(1).optional(),
          lastName: z.string().min(1).optional(),
          email: z.string().email().optional(),
          phone: z.string().optional(),
          whatsapp: z.string().optional(),
          address: z.string().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, organizationId, ...data } = input;
        return ctx.db.person.update({ where: { id }, data });
      }),

    /** Asignar propietario a una unidad (crea Ownership). */
    assignOwner: orgProcedure
      .input(
        orgIdInput.extend({
          unitId: z.string(),
          personId: z.string(),
          sharePercent: z.number().positive().max(100).default(100),
          startDate: z.coerce.date().default(() => new Date()),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Cerrar ownership activo previo si existe (mismo porcentaje no aplica)
        await ctx.db.ownership.updateMany({
          where: { unitId: input.unitId, personId: input.personId, endDate: null },
          data: { endDate: input.startDate },
        });
        return ctx.db.ownership.create({
          data: {
            unitId: input.unitId,
            personId: input.personId,
            sharePercent: input.sharePercent.toString(),
            startDate: input.startDate,
            notes: input.notes,
          },
        });
      }),

    /** Asignar inquilino a una unidad (crea Tenancy). */
    assignTenant: orgProcedure
      .input(
        orgIdInput.extend({
          unitId: z.string(),
          personId: z.string(),
          startDate: z.coerce.date().default(() => new Date()),
          monthlyRentUsd: z.number().positive().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ctx.db.tenancy.updateMany({
          where: { unitId: input.unitId, endDate: null },
          data: { endDate: input.startDate },
        });
        return ctx.db.tenancy.create({
          data: {
            unitId: input.unitId,
            personId: input.personId,
            startDate: input.startDate,
            monthlyRentUsd: input.monthlyRentUsd?.toString(),
            notes: input.notes,
          },
        });
      }),

    /** Importar residentes desde CSV (bulk create Person + Ownership). */
    bulkImport: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          rows: z.array(
            z.object({
              unitCode: z.string(),
              firstName: z.string().min(1),
              lastName: z.string().min(1),
              idType: z.enum(["CEDULA_V", "CEDULA_E", "RIF", "PASSPORT", "OTHER"]).default("CEDULA_V"),
              idNumber: z.string().min(1),
              email: z.string().email().optional(),
              phone: z.string().optional(),
              whatsapp: z.string().optional(),
              role: z.enum(["OWNER", "TENANT"]).default("OWNER"),
            }),
          ).min(1).max(500),
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

        for (const row of input.rows) {
          const unitId = unitMap.get(row.unitCode.toLowerCase());
          if (!unitId) {
            errors.push(`Unidad "${row.unitCode}" no encontrada`);
            skipped++;
            continue;
          }
          try {
            // Upsert person
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
                lastName: row.lastName,
                email: row.email,
                phone: row.phone,
                whatsapp: row.whatsapp,
              },
              create: {
                organizationId: input.organizationId,
                firstName: row.firstName,
                lastName: row.lastName,
                idType: row.idType,
                idNumber: row.idNumber,
                email: row.email,
                phone: row.phone,
                whatsapp: row.whatsapp,
              },
            });

            if (row.role === "OWNER") {
              const existing = await ctx.db.ownership.findFirst({
                where: { unitId, personId: person.id, endDate: null },
              });
              if (!existing) {
                await ctx.db.ownership.create({
                  data: { unitId, personId: person.id, sharePercent: "100", startDate: new Date() },
                });
              }
            } else {
              const existing = await ctx.db.tenancy.findFirst({
                where: { unitId, personId: person.id, endDate: null },
              });
              if (!existing) {
                await ctx.db.tenancy.create({
                  data: { unitId, personId: person.id, startDate: new Date() },
                });
              }
            }
            created++;
          } catch {
            errors.push(`Error en fila ${row.unitCode} / ${row.idNumber}`);
            skipped++;
          }
        }
        return { created, skipped, errors };
      }),
  }),

  // ─── Personal / Staff de la organización ──────────────────────
  members: router({
    /** Lista de personal activo (excluye residentes). */
    list: orgProcedure.input(orgIdInput).query(({ ctx, input }) =>
      ctx.db.membership.findMany({
        where: {
          organizationId: input.organizationId,
          role: { in: ["ORG_ADMIN", "COMMUNITY_ADMIN"] },
          active: true,
          revokedAt: null,
        },
        include: {
          user: { select: { id: true, email: true, name: true, lastLoginAt: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ),

    /** Crea un usuario de personal con cargo y permisos específicos. */
    create: orgProcedure
      .input(
        orgIdInput.extend({
          email: z.string().email(),
          name: z.string().min(2),
          password: z.string().min(8),
          cargo: z.string().min(2),
          permissions: z.array(z.string()),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const email = input.email.toLowerCase();
        // Solo ORG_ADMIN puede crear personal
        const memberships = (ctx.user.memberships ?? []) as SessionMembership[];
        const isPlat = memberships.some((m: SessionMembership) => isPlatform(m.role));
        const isOrgAdmin = memberships.some(
          (m: SessionMembership) => m.organizationId === input.organizationId && m.role === "ORG_ADMIN",
        );
        if (!isPlat && !isOrgAdmin) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Solo un ORG_ADMIN puede crear personal" });
        }

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
            role: "COMMUNITY_ADMIN",
            organizationId: input.organizationId,
            active: true,
            cargo: input.cargo,
            permissions: input.permissions,
          } as never, // permite los campos nuevos aunque prisma client no los conozca aún
          include: { user: { select: { id: true, email: true, name: true } } },
        });

        await ctx.db.auditLog.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: "ROLE_GRANTED",
            entityType: "Membership",
            entityId: membership.id,
            after: { email, cargo: input.cargo, permissions: input.permissions },
          },
        });
        return membership;
      }),

    /** Actualiza cargo y/o permisos de un miembro del personal. */
    update: orgProcedure
      .input(
        orgIdInput.extend({
          membershipId: z.string(),
          cargo: z.string().min(2).optional(),
          permissions: z.array(z.string()).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const mem = await ctx.db.membership.findFirstOrThrow({
          where: { id: input.membershipId, organizationId: input.organizationId, active: true },
        });
        return ctx.db.membership.update({
          where: { id: mem.id },
          data: {
            ...(input.cargo !== undefined ? { cargo: input.cargo } : {}),
            ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
          } as never,
          include: { user: { select: { id: true, email: true, name: true } } },
        });
      }),

    /** Revoca el acceso de un miembro del personal. */
    revoke: orgProcedure
      .input(orgIdInput.extend({ membershipId: z.string() }))
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
  }),

  // ─── Vehículos ─────────────────────────────────────────────────
  vehicles: router({
    list: orgProcedure
      .input(orgIdInput.extend({ personId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.vehicle.findMany({
          where: { organizationId: input.organizationId, personId: input.personId },
          orderBy: { createdAt: "asc" },
        }),
      ),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          personId: z.string(),
          type: z.enum(["CAR", "MOTORCYCLE", "TRUCK", "VAN", "OTHER"]).default("CAR"),
          brand: z.string().optional(),
          model: z.string().optional(),
          year: z.number().int().min(1950).max(2100).optional(),
          color: z.string().optional(),
          plate: z.string().optional(),
          parkingSpot: z.string().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { organizationId, ...data } = input;
        return ctx.db.vehicle.create({ data: { organizationId, ...data } });
      }),
    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          type: z.enum(["CAR", "MOTORCYCLE", "TRUCK", "VAN", "OTHER"]).optional(),
          brand: z.string().optional(),
          model: z.string().optional(),
          year: z.number().int().optional(),
          color: z.string().optional(),
          plate: z.string().optional(),
          parkingSpot: z.string().optional(),
          active: z.boolean().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { id, organizationId: _org, ...data } = input;
        return ctx.db.vehicle.update({ where: { id }, data });
      }),
  }),
});
