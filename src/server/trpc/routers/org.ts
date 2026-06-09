import { z } from "zod";
import { Decimal } from "decimal.js";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { router, orgProcedure, protectedProcedure } from "@/server/trpc/init";
import { isPlatform, canManageOrganization } from "@/server/auth/permissions";
import type { SessionMembership } from "@/server/auth/config";

const orgIdInput = z.object({ organizationId: z.string() });

// Email permisivo: acepta unicode en la parte local (ej. josecastaños@gmail.com)
const emailSchema = z
  .string()
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), {
    message: "Formato de email inválido",
  });

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
          phone: z.string().optional(),
          email: emailSchema.optional(),
          website: z.string().optional(),
          primaryCurrency: z.enum(["VES", "USD"]).optional(),
          floorsCount: z.coerce.number().int().positive().nullable().optional(),
          towersCount: z.coerce.number().int().positive().optional(),
          active: z.boolean().optional(),
          dueDaysAfterIssue: z.coerce.number().int().min(1).max(365).optional(),
          logoUrl: z.string().max(2048).nullable().optional(),
          invoicePeriodShift: z.coerce.number().int().min(0).max(3).optional(),
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
    /** Guarda/actualiza la config SMTP de la organización. Verifica antes de guardar. */
    setSmtp: orgProcedure
      .input(
        orgIdInput.extend({
          smtpHost: z.string().min(3),
          smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
          smtpUser: z.string().email(),
          smtpPass: z.string().optional(), // vacío = mantener la contraseña actual
          smtpFrom: z.string().optional(),
          smtpSecure: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, smtpHost, smtpPort, smtpUser, smtpFrom, smtpSecure } = input;
        const memberships = (ctx.user.memberships ?? []) as SessionMembership[];
        const isPlat = memberships.some((m: SessionMembership) => isPlatform(m.role));
        const isOrgAdmin = memberships.some(
          (m: SessionMembership) => m.organizationId === organizationId && m.role === "ORG_ADMIN",
        );
        if (!isPlat && !isOrgAdmin) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Solo un ORG_ADMIN puede configurar el email" });
        }

        // Si no se envía nueva contraseña, usar la existente en BD
        let smtpPass = input.smtpPass?.trim() ?? "";
        if (!smtpPass) {
          const existing = await ctx.db.organization.findUnique({
            where: { id: organizationId },
            select: { smtpPass: true },
          });
          smtpPass = existing?.smtpPass ?? "";
        }
        if (!smtpPass) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ingresa la App Password para guardar la configuración." });
        }

        const fromValue = smtpFrom?.trim() || smtpUser;

        // Verificar SMTP enviando un email de prueba
        const { sendEmail } = await import("@/server/services/email");
        const testResult = await sendEmail({
          to: smtpUser,
          subject: "✓ Test de configuración SMTP — Condominios",
          html: `<div style="font-family:sans-serif;max-width:480px"><h2 style="color:#1e3a5f">Configuración correcta</h2><p>El servidor de correo de tu organización está funcionando correctamente. Ya puedes enviar notificaciones a los residentes.</p></div>`,
          text: "Tu configuración de email está funcionando.",
          orgSmtp: { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass, from: fromValue, secure: smtpSecure },
        });
        if (!testResult.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No se pudo conectar: ${testResult.error ?? "error SMTP"}`,
          });
        }

        return ctx.db.organization.update({
          where: { id: organizationId },
          data: { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom: fromValue, smtpSecure },
        });
      }),

    /** Config SMTP de la org (sin exponer la contraseña). */
    getSmtp: orgProcedure
      .input(orgIdInput)
      .query(async ({ ctx, input }) => {
        const org = await ctx.db.organization.findFirstOrThrow({
          where: { id: input.organizationId },
          select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpFrom: true, smtpSecure: true, smtpPass: true },
        });
        return {
          smtpHost: org.smtpHost,
          smtpPort: org.smtpPort,
          smtpUser: org.smtpUser,
          smtpFrom: org.smtpFrom,
          smtpSecure: org.smtpSecure,
          configured: !!(org.smtpHost && org.smtpUser && org.smtpPass),
          hasPass: !!org.smtpPass,
        };
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

    /**
     * Listado paginado con búsqueda. Para vistas con 188+ unidades que necesitan
     * scroll/paginación. Devuelve { items, total, hasMore }.
     */
    listPaginated: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(200).default(50),
        search: z.string().max(100).optional(),
        tower: z.string().max(10).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const where = {
          organizationId: input.organizationId,
          communityId: input.communityId,
          deletedAt: null,
          ...(input.tower ? { tower: input.tower } : {}),
          ...(input.search
            ? {
                OR: [
                  { code: { contains: input.search, mode: "insensitive" as const } },
                  { ownerships: {
                      some: {
                        endDate: null,
                        person: {
                          OR: [
                            { firstName: { contains: input.search, mode: "insensitive" as const } },
                            { lastName: { contains: input.search, mode: "insensitive" as const } },
                          ],
                        },
                      },
                    },
                  },
                ],
              }
            : {}),
        };
        const [total, items] = await Promise.all([
          ctx.db.unit.count({ where }),
          ctx.db.unit.findMany({
            where,
            include: {
              ownerships: {
                where: { endDate: null },
                include: { person: { select: { firstName: true, lastName: true, idNumber: true } } },
              },
            },
            orderBy: { code: "asc" },
            skip: (input.page - 1) * input.pageSize,
            take: input.pageSize,
          }),
        ]);
        return {
          items,
          total,
          page: input.page,
          pageSize: input.pageSize,
          hasMore: input.page * input.pageSize < total,
        };
      }),
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
                floor: z.coerce.number().int().nonnegative().optional(),
                tower: z.string().max(10).optional(),
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
        return ctx.db.$transaction(async (tx) => {
          // createMany con skipDuplicates para no fallar si la unidad ya existe
          const result = await (tx.unit as { createMany: Function }).createMany({
            data: input.units.map((u) => ({
              organizationId: input.organizationId,
              communityId: community.id,
              code: u.code,
              type: u.type,
              aliquot: new Decimal(u.aliquot).toFixed(6),
              ...(u.floor != null ? { floor: u.floor } : {}),
              ...(u.tower ? { tower: u.tower } : {}),
            })),
            skipDuplicates: true,
          });
          if (result.count > 0) {
            await tx.community.update({
              where: { id: community.id },
              data: { totalUnits: { increment: result.count } },
            });
          }
          return { count: result.count, skipped: input.units.length - result.count };
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
    /** Envía aviso de cobro (PAYMENT_REMINDER) al propietario activo de la unidad. */
    sendPaymentNotice: orgProcedure
      .input(orgIdInput.extend({ unitId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { notifyPerson } = await import("@/server/services/notifications");

        const [ownership, unit, pendingAgg] = await Promise.all([
          ctx.db.ownership.findFirst({
            where: { unitId: input.unitId, endDate: null },
            select: { personId: true },
          }),
          ctx.db.unit.findFirstOrThrow({
            where: { id: input.unitId, organizationId: input.organizationId },
            select: { code: true, communityId: true },
          }),
          ctx.db.invoice.aggregate({
            where: { unitId: input.unitId, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
            _sum: { totalUsd: true, paidUsd: true },
          }),
        ]);

        if (!ownership) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No hay propietario activo para esta unidad" });
        }

        const pendingUsd = (
          Number(pendingAgg._sum.totalUsd ?? 0) - Number(pendingAgg._sum.paidUsd ?? 0)
        ).toFixed(2);

        await notifyPerson({
          organizationId: input.organizationId,
          communityId: unit.communityId,
          unitId: input.unitId,
          personId: ownership.personId,
          event: "PAYMENT_REMINDER",
          vars: { monto_usd: pendingUsd },
        });

        return { ok: true, pendingUsd };
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

          const [ownerships, tenancies, pendingInvoices, lastPayments] = await Promise.all([
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
            // Facturas pendientes agrupadas por unidad (ISSUED, PARTIAL, OVERDUE)
            ctx.db.invoice.findMany({
              where: {
                unitId: { in: unitIds },
                status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
              },
              select: {
                unitId: true,
                totalUsd: true,
                paidUsd: true,
                status: true,
                dueDate: true,
              },
            }),
            // Último pago por unidad
            ctx.db.payment.findMany({
              where: {
                unitId: { in: unitIds },
                voidedAt: null,
              },
              select: { unitId: true, paidAt: true },
              orderBy: { paidAt: "desc" },
              distinct: ["unitId"],
            }),
          ]);

          // Construir mapa de deuda por unidad
          const debtByUnit = new Map<string, {
            pendingUsd: number;
            overdueCount: number;
            pendingCount: number;
            lastPaymentAt: Date | null;
          }>();
          for (const inv of pendingInvoices) {
            const uid = inv.unitId;
            const existing = debtByUnit.get(uid) ?? { pendingUsd: 0, overdueCount: 0, pendingCount: 0, lastPaymentAt: null };
            existing.pendingUsd += Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString());
            existing.pendingCount += 1;
            if (inv.status === "OVERDUE") existing.overdueCount += 1;
            debtByUnit.set(uid, existing);
          }
          for (const pay of lastPayments) {
            const uid = pay.unitId;
            const existing = debtByUnit.get(uid) ?? { pendingUsd: 0, overdueCount: 0, pendingCount: 0, lastPaymentAt: null };
            existing.lastPaymentAt = pay.paidAt;
            debtByUnit.set(uid, existing);
          }

          const toDebtInfo = (unitId: string) => {
            const d = debtByUnit.get(unitId);
            return {
              pendingUsd: d?.pendingUsd?.toString() ?? "0",
              overdueCount: d?.overdueCount ?? 0,
              pendingCount: d?.pendingCount ?? 0,
              lastPaymentAt: d?.lastPaymentAt ?? null,
            };
          };

          return {
            ownerships: ownerships.map((o) => ({ ...o, debt: toDebtInfo(o.unitId) })),
            tenancies:  tenancies.map((t)  => ({ ...t, debt: toDebtInfo(t.unitId) })),
          };
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
          email: emailSchema.optional(),
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
          email: emailSchema.optional(),
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
              email: emailSchema.optional(),
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

    /**
     * Crea (o actualiza) una cuenta de usuario para el residente y le envía
     * sus credenciales por email para que pueda entrar siempre al portal.
     */
    sendPortalCredentials: orgProcedure
      .input(orgIdInput.extend({ personId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const person = await ctx.db.person.findFirstOrThrow({
          where: { id: input.personId, organizationId: input.organizationId, deletedAt: null },
        });

        if (!person.email) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El residente no tiene email registrado. Agrégalo antes de enviar acceso.",
          });
        }

        // Generar contraseña aleatoria de 10 caracteres
        const chars = "abcdefghjkmnpqrstuvwxyz23456789";
        let rawPassword = "";
        for (let i = 0; i < 10; i++) {
          rawPassword += chars[Math.floor(Math.random() * chars.length)];
        }
        const passwordHash = await bcrypt.hash(rawPassword, 12);

        // Crear o actualizar el User vinculado a la Person
        let user = person.userId
          ? await ctx.db.user.findUnique({ where: { id: person.userId } })
          : await ctx.db.user.findUnique({ where: { email: person.email } });

        // CRÍTICO: si hay otro Person YA vinculado a ese User (mismo email compartido),
        // tenemos un conflicto en Person.userId @unique. En el demo del cliente, varios
        // residentes de prueba compartían email → al enviar credenciales a uno de ellos,
        // el sistema tiraba "Ya existe un registro con el mismo valor en: userId".
        //
        // Fix: si el User existe y está vinculado a OTRA Person, desvinculamos a esa otra
        // Person primero (es lo que el admin querría: el último que solicita credenciales
        // toma el control del email). Auditamos el cambio.
        if (user) {
          const otherPerson = await ctx.db.person.findFirst({
            where: {
              userId: user.id,
              id: { not: person.id },
              organizationId: input.organizationId,
            },
            select: { id: true, firstName: true, lastName: true },
          });
          if (otherPerson) {
            await ctx.db.person.update({
              where: { id: otherPerson.id },
              data: { userId: null },
            });
            await ctx.db.auditLog.create({
              data: {
                organizationId: input.organizationId,
                actorId: ctx.user.id,
                action: "UPDATE",
                entityType: "Person",
                entityId: otherPerson.id,
                after: {
                  reason: "Email reasignado a otro residente — userId desvinculado",
                  reassignedTo: person.id,
                },
              },
            });
          }
        }

        if (user) {
          // Actualizar hash y activar
          user = await ctx.db.user.update({
            where: { id: user.id },
            data: { passwordHash, active: true, emailVerified: new Date() },
          });
        } else {
          user = await ctx.db.user.create({
            data: {
              email: person.email,
              name: `${person.firstName} ${person.lastName}`,
              passwordHash,
              emailVerified: new Date(),
              active: true,
            },
          });
        }

        // Vincular Person → User si no estaba vinculado
        if (person.userId !== user.id) {
          await ctx.db.person.update({
            where: { id: person.id },
            data: { userId: user.id },
          });
        }

        const portalUrl = `${process.env.NEXTAUTH_URL ?? "https://condominios-theta.vercel.app"}/portal`;
        const { sendEmail } = await import("@/server/services/email");

        // Usar SMTP de la organización si está configurado
        const org = await ctx.db.organization.findUnique({
          where: { id: input.organizationId },
          select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true },
        });
        const orgSmtp = org?.smtpHost && org.smtpUser && org.smtpPass
          ? { host: org.smtpHost, port: org.smtpPort ?? 587, user: org.smtpUser, pass: org.smtpPass, from: org.smtpFrom ?? org.smtpUser, secure: org.smtpSecure }
          : null;

        const emailResult = await sendEmail({
          to: person.email,
          subject: "Tu acceso al Portal del Residente",
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;color:#111">
              <div style="background:#1e3a5f;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0">
                <h2 style="margin:0;font-size:20px">Portal del Residente</h2>
              </div>
              <div style="border:1px solid #e5e7eb;border-top:0;padding:24px 28px;border-radius:0 0 8px 8px">
                <p>Hola <strong>${person.firstName} ${person.lastName}</strong>,</p>
                <p>La administración te ha creado un acceso permanente al portal. Puedes entrar cuando quieras usando estas credenciales:</p>
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px 20px;margin:20px 0">
                  <p style="margin:0 0 8px;font-size:13px;color:#6b7280">USUARIO (email)</p>
                  <p style="margin:0 0 16px;font-size:16px;font-weight:600">${person.email}</p>
                  <p style="margin:0 0 8px;font-size:13px;color:#6b7280">CONTRASEÑA</p>
                  <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:2px;font-family:monospace">${rawPassword}</p>
                </div>
                <p style="text-align:center;margin:28px 0">
                  <a href="${portalUrl}" style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
                    Entrar al Portal
                  </a>
                </p>
                <p style="font-size:13px;color:#6b7280">Una vez dentro, puedes ver tus facturas, pagos y saldo en tiempo real.</p>
                <p style="font-size:12px;color:#9ca3af;margin-top:24px">Si no solicitaste este acceso, ignora este correo o comunícate con la administración.</p>
              </div>
            </div>
          `,
          text: `Hola ${person.firstName}, tu acceso al portal: ${portalUrl} — Usuario: ${person.email} — Contraseña: ${rawPassword}`,
          orgSmtp,
        });

        if (!emailResult.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Cuenta creada pero no se pudo enviar el email: ${emailResult.error ?? "error SMTP"}. Verifica las credenciales del servidor de correo.`,
          });
        }

        await ctx.db.auditLog.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: "UPDATE",
            entityType: "Person",
            entityId: person.id,
            after: { email: person.email, userId: user.id },
          },
        });

        return { ok: true, email: person.email };
      }),

    /**
     * Setea una contraseña MANUAL para un residente sin depender del email.
     * Útil cuando el residente no tiene email registrado, o cuando el SMTP no funciona.
     * Devuelve la contraseña en claro para que el admin se la dé verbalmente al residente.
     *
     * Si el residente no tiene User, lo crea con email auto-generado del tipo
     * `residente-{personId}@arrayanes.local` (que después se puede actualizar al email real).
     */
    setPortalPasswordManual: orgProcedure
      .input(orgIdInput.extend({
        personId: z.string(),
        password: z.string().min(6).max(50).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const person = await ctx.db.person.findFirstOrThrow({
          where: { id: input.personId, organizationId: input.organizationId, deletedAt: null },
        });

        // Generar password si no se pasó
        const chars = "abcdefghjkmnpqrstuvwxyz23456789";
        const rawPassword = input.password ?? Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
        const passwordHash = await bcrypt.hash(rawPassword, 12);

        // Email para login: usar el real si existe, si no auto-generar
        const loginEmail = person.email ?? `residente-${person.id.slice(-8)}@residente.local`;

        // Buscar User existente
        let user = person.userId
          ? await ctx.db.user.findUnique({ where: { id: person.userId } })
          : await ctx.db.user.findUnique({ where: { email: loginEmail } });

        // Desvincular otros Person si conflictan con userId @unique
        if (user) {
          const otherPerson = await ctx.db.person.findFirst({
            where: {
              userId: user.id,
              id: { not: person.id },
              organizationId: input.organizationId,
            },
            select: { id: true },
          });
          if (otherPerson) {
            await ctx.db.person.update({
              where: { id: otherPerson.id },
              data: { userId: null },
            });
          }
        }

        if (user) {
          user = await ctx.db.user.update({
            where: { id: user.id },
            data: { passwordHash, active: true, emailVerified: new Date() },
          });
        } else {
          user = await ctx.db.user.create({
            data: {
              email: loginEmail,
              name: `${person.firstName} ${person.lastName}`,
              passwordHash,
              emailVerified: new Date(),
              active: true,
            },
          });
        }

        if (person.userId !== user.id) {
          await ctx.db.person.update({
            where: { id: person.id },
            data: { userId: user.id },
          });
        }

        await ctx.db.auditLog.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: "UPDATE",
            entityType: "Person",
            entityId: person.id,
            after: { passwordResetManual: true, loginEmail },
          },
        });

        return { ok: true, email: loginEmail, password: rawPassword };
      }),

    /**
     * Envía un recordatorio de pago a un residente específico (WhatsApp + Email).
     * Incluye link al portal con su deuda actual.
     */
    sendReminder: orgProcedure
      .input(orgIdInput.extend({
        personId: z.string(),
        unitId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const person = await ctx.db.person.findFirstOrThrow({
          where: { id: input.personId, organizationId: input.organizationId, deletedAt: null },
        });
        if (!person.email && !person.whatsapp) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El residente no tiene email ni WhatsApp registrado." });
        }
        // Calcular deuda total
        const pendingInvoices = await ctx.db.invoice.findMany({
          where: { unitId: input.unitId, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
          select: { totalUsd: true, paidUsd: true },
        });
        const pendingUsd = pendingInvoices.reduce(
          (s, inv) => s + Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString()), 0
        );
        const { notifyPerson } = await import("@/server/services/notifications");
        await notifyPerson({
          organizationId: input.organizationId,
          personId: input.personId,
          unitId: input.unitId,
          event: "PAYMENT_REMINDER",
          vars: { monto_usd: pendingUsd.toFixed(2) },
        });
        return { ok: true };
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
          email: emailSchema,
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

    /** Importar vehículos en lote. Se busca el dueño por cédula o por unidad (propietario activo). */
    bulkImport: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          rows: z.array(z.object({
            // Identificación del dueño — cedula tiene prioridad; si no, usa unitCode
            cedula:      z.string().optional(),
            unitCode:    z.string().optional(),
            // Datos del vehículo
            type:        z.enum(["CAR", "MOTORCYCLE", "TRUCK", "VAN", "OTHER"]).default("CAR"),
            brand:       z.string().optional(),
            model:       z.string().optional(),
            year:        z.coerce.number().int().min(1950).max(2100).optional(),
            color:       z.string().optional(),
            plate:       z.string().optional(),
            parkingSpot: z.string().optional(),
            notes:       z.string().optional(),
          })).min(1).max(1000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Cargar unidades de la comunidad (para lookup por código)
        const units = await ctx.db.unit.findMany({
          where: { communityId: input.communityId, organizationId: input.organizationId, deletedAt: null },
          select: { id: true, code: true },
        });
        const unitMap = new Map(units.map((u) => [u.code.toLowerCase(), u.id]));

        let created = 0, skipped = 0;
        const errors: string[] = [];

        for (let i = 0; i < input.rows.length; i++) {
          const row = input.rows[i]!;
          try {
            let personId: string | null = null;

            // 1. Buscar por cédula si viene
            if (row.cedula?.trim()) {
              const person = await ctx.db.person.findFirst({
                where: { organizationId: input.organizationId, idNumber: row.cedula.trim() },
                select: { id: true },
              });
              if (person) personId = person.id;
            }

            // 2. Fallback: buscar propietario activo de la unidad
            if (!personId && row.unitCode?.trim()) {
              const unitId = unitMap.get(row.unitCode.trim().toLowerCase());
              if (unitId) {
                const ownership = await ctx.db.ownership.findFirst({
                  where: { unitId, endDate: null },
                  select: { personId: true },
                  orderBy: { startDate: "desc" },
                });
                if (ownership) personId = ownership.personId;
              }
            }

            if (!personId) {
              errors.push(`Fila ${i + 2}: no se encontró residente (cedula="${row.cedula ?? ""}" unidad="${row.unitCode ?? ""}")`);
              skipped++;
              continue;
            }

            // Evitar duplicar placa para la misma persona
            if (row.plate?.trim()) {
              const dup = await ctx.db.vehicle.findFirst({
                where: { organizationId: input.organizationId, personId, plate: row.plate.trim() },
              });
              if (dup) {
                errors.push(`Fila ${i + 2}: placa "${row.plate}" ya registrada para este residente (omitida)`);
                skipped++;
                continue;
              }
            }

            await ctx.db.vehicle.create({
              data: {
                organizationId: input.organizationId,
                personId,
                type:        row.type,
                brand:       row.brand?.trim()       || null,
                model:       row.model?.trim()       || null,
                year:        row.year                ?? null,
                color:       row.color?.trim()       || null,
                plate:       row.plate?.trim()       || null,
                parkingSpot: row.parkingSpot?.trim() || null,
                notes:       row.notes?.trim()       || null,
              },
            });
            created++;
          } catch (e) {
            errors.push(`Fila ${i + 2}: ${e instanceof Error ? e.message : "error"}`);
            skipped++;
          }
        }
        return { created, skipped, errors };
      }),
  }),

  /** Cambiar la contraseña del usuario autenticado. */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: { passwordHash: true },
      });
      if (!user.passwordHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta cuenta no tiene contraseña local. Usa el método de inicio de sesión configurado." });
      }
      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "La contraseña actual no es correcta." });
      }
      const hash = await bcrypt.hash(input.newPassword, 12);
      await ctx.db.user.update({
        where: { id: ctx.user.id },
        data: { passwordHash: hash },
      });
      return { ok: true };
    }),
});
