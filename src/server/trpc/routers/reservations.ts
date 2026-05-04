import { z } from "zod";
import { router, orgProcedure } from "@/server/trpc/init";
import { TRPCError } from "@trpc/server";

const areaInput = z.object({
  communityId: z.string(),
  organizationId: z.string(),
});

export const reservationsRouter = router({
  // ── Áreas comunes ────────────────────────────────────────────────────────
  areas: router({
    list: orgProcedure
      .input(areaInput)
      .query(async ({ ctx, input }) => {
        return ctx.db.commonArea.findMany({
          where: { communityId: input.communityId, organizationId: input.organizationId },
          orderBy: { name: "asc" },
        });
      }),

    create: orgProcedure
      .input(areaInput.extend({
        name: z.string().min(1),
        description: z.string().optional(),
        capacity: z.number().int().positive().optional(),
        requiresApproval: z.boolean().default(true),
        rules: z.string().optional(),
        openTime: z.string().default("08:00"),
        closeTime: z.string().default("22:00"),
        slotDurationMin: z.number().int().default(120),
        maxAdvanceDays: z.number().int().default(30),
        maxSimultaneous: z.number().int().default(1),
        costUsd: z.number().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return ctx.db.commonArea.create({
          data: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            name: input.name,
            description: input.description,
            capacity: input.capacity,
            requiresApproval: input.requiresApproval,
            rules: input.rules,
            openTime: input.openTime,
            closeTime: input.closeTime,
            slotDurationMin: input.slotDurationMin,
            maxAdvanceDays: input.maxAdvanceDays,
            maxSimultaneous: input.maxSimultaneous,
            costUsd: input.costUsd,
          },
        });
      }),

    update: orgProcedure
      .input(z.object({
        areaId: z.string(),
        organizationId: z.string(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        capacity: z.number().nullable().optional(),
        requiresApproval: z.boolean().optional(),
        rules: z.string().nullable().optional(),
        openTime: z.string().optional(),
        closeTime: z.string().optional(),
        slotDurationMin: z.number().optional(),
        maxAdvanceDays: z.number().optional(),
        maxSimultaneous: z.number().optional(),
        costUsd: z.number().nullable().optional(),
        active: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { areaId, organizationId, ...data } = input;
        return ctx.db.commonArea.update({
          where: { id: areaId },
          data,
        });
      }),
  }),

  // ── Reservas ─────────────────────────────────────────────────────────────
  list: orgProcedure
    .input(areaInput.extend({
      areaId: z.string().optional(),
      status: z.enum(["PENDING", "APPROVED", "CANCELLED", "COMPLETED"]).optional(),
      dateFrom: z.string().optional(),  // ISO date string
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.reservation.findMany({
        where: {
          communityId: input.communityId,
          organizationId: input.organizationId,
          ...(input.areaId ? { areaId: input.areaId } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.dateFrom || input.dateTo ? {
            date: {
              ...(input.dateFrom ? { gte: new Date(input.dateFrom) } : {}),
              ...(input.dateTo ? { lte: new Date(input.dateTo) } : {}),
            },
          } : {}),
        },
        include: {
          area: { select: { id: true, name: true } },
          unit: { select: { id: true, code: true } },
          requestedBy: { select: { id: true, name: true, email: true } },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ date: "desc" }, { startTime: "asc" }],
        take: 100,
      });
    }),

  create: orgProcedure
    .input(areaInput.extend({
      areaId: z.string(),
      unitId: z.string(),
      date: z.string(),        // "2025-07-15"
      startTime: z.string(),   // "10:00"
      endTime: z.string(),     // "14:00"
      guestCount: z.number().int().optional(),
      purpose: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const area = await ctx.db.commonArea.findUnique({
        where: { id: input.areaId },
      });
      if (!area || !area.active) throw new TRPCError({ code: "NOT_FOUND", message: "Área no disponible" });

      // Verificar conflictos de horario
      const dateObj = new Date(input.date);
      const conflicts = await ctx.db.reservation.findMany({
        where: {
          areaId: input.areaId,
          date: dateObj,
          status: { in: ["PENDING", "APPROVED"] },
        },
      });
      // Verificar solapamiento simple de horario
      for (const c of conflicts) {
        const overlap = input.startTime < c.endTime && input.endTime > c.startTime;
        if (overlap) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe una reserva en ese horario (${c.startTime}–${c.endTime})`,
          });
        }
      }
      // Verificar límite simultáneo
      if (conflicts.length >= area.maxSimultaneous) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "El área ya alcanzó el máximo de reservas simultáneas para ese día",
        });
      }

      return ctx.db.reservation.create({
        data: {
          organizationId: input.organizationId,
          communityId: input.communityId,
          areaId: input.areaId,
          unitId: input.unitId,
          requestedById: ctx.session?.user?.id,
          date: dateObj,
          startTime: input.startTime,
          endTime: input.endTime,
          guestCount: input.guestCount,
          purpose: input.purpose,
          notes: input.notes,
          status: area.requiresApproval ? "PENDING" : "APPROVED",
        },
      });
    }),

  approve: orgProcedure
    .input(z.object({ reservationId: z.string(), organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.reservation.update({
        where: { id: input.reservationId },
        data: {
          status: "APPROVED",
          approvedById: ctx.session?.user?.id,
          approvedAt: new Date(),
        },
      });
    }),

  cancel: orgProcedure
    .input(z.object({
      reservationId: z.string(),
      organizationId: z.string(),
      cancelReason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.reservation.update({
        where: { id: input.reservationId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: input.cancelReason,
        },
      });
    }),

  // Disponibilidad de un área para una fecha
  availability: orgProcedure
    .input(z.object({
      communityId: z.string(),
      organizationId: z.string(),
      areaId: z.string(),
      date: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const [area, reservations] = await Promise.all([
        ctx.db.commonArea.findUnique({ where: { id: input.areaId } }),
        ctx.db.reservation.findMany({
          where: {
            areaId: input.areaId,
            date: new Date(input.date),
            status: { in: ["PENDING", "APPROVED"] },
          },
          orderBy: { startTime: "asc" },
        }),
      ]);
      return { area, reservations };
    }),
});
