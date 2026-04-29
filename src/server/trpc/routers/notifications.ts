import { z } from "zod";
import { router, orgProcedure, protectedProcedure } from "@/server/trpc/init";
import { db } from "@/server/db/client";
import { notifyCommunity } from "@/server/services/notifications";

export const notificationsRouter = router({
  /** Notificaciones IN_APP del usuario actual (no leídas primero). */
  myInbox: protectedProcedure
    .input(z.object({ organizationId: z.string(), take: z.number().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const person = await db.person.findFirst({
        where: { userId: ctx.user.id, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!person) return [];

      return db.notification.findMany({
        where: { personId: person.id, channel: "IN_APP" },
        orderBy: [{ readAt: "asc" }, { sentAt: "desc" }],
        take: input.take,
        select: {
          id: true,
          event: true,
          body: true,
          sentAt: true,
          readAt: true,
          unitId: true,
        },
      });
    }),

  /** Cuenta de notificaciones no leídas. */
  unreadCount: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const person = await db.person.findFirst({
        where: { userId: ctx.user.id, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!person) return 0;
      return db.notification.count({
        where: { personId: person.id, channel: "IN_APP", readAt: null },
      });
    }),

  /** Marca una notificación como leída. */
  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string() }))
    .mutation(async ({ input }) => {
      await db.notification.updateMany({
        where: { id: input.notificationId, readAt: null },
        data: { readAt: new Date() },
      });
    }),

  /** Marca todas las notificaciones del usuario como leídas. */
  markAllRead: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const person = await db.person.findFirst({
        where: { userId: ctx.user.id, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!person) return;
      await db.notification.updateMany({
        where: { personId: person.id, channel: "IN_APP", readAt: null },
        data: { readAt: new Date() },
      });
    }),

  /** Lista notificaciones enviadas en la comunidad (historial de administración). */
  communityHistory: orgProcedure
    .input(
      z.object({
        organizationId: z.string(),
        communityId: z.string(),
        take: z.number().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      return db.notification.findMany({
        where: { organizationId: input.organizationId, communityId: input.communityId },
        orderBy: { sentAt: "desc" },
        take: input.take,
        select: {
          id: true,
          channel: true,
          event: true,
          status: true,
          body: true,
          sentAt: true,
          recipientPhone: true,
          errorMessage: true,
          person: { select: { firstName: true, lastName: true } },
        },
      });
    }),

  /** Envía recordatorio de pago a cada unidad con saldo pendiente. */
  sendPaymentReminders: orgProcedure
    .input(z.object({ organizationId: z.string(), communityId: z.string() }))
    .mutation(async ({ input }) => {
      const { notifyPerson } = await import("@/server/services/notifications");

      const pendingUnits = await db.invoice.groupBy({
        by: ["unitId"],
        where: {
          communityId: input.communityId,
          status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
        },
        _sum: { totalUsd: true },
      });

      const results = await Promise.allSettled(
        pendingUnits.map(async (row) => {
          const ownership = await db.ownership.findFirst({
            where: { unitId: row.unitId, endDate: null },
            select: { personId: true },
          });
          if (!ownership) return;
          await notifyPerson({
            organizationId: input.organizationId,
            communityId: input.communityId,
            unitId: row.unitId,
            personId: ownership.personId,
            event: "PAYMENT_REMINDER",
            vars: { monto_usd: row._sum.totalUsd?.toString() ?? "0" },
          });
        }),
      );

      return { sent: results.filter((r) => r.status === "fulfilled").length };
    }),

  /** CRUD de templates de WhatsApp por organización. */
  templates: router({
    list: orgProcedure
      .input(z.object({ organizationId: z.string() }))
      .query(async ({ input }) => {
        return db.whatsAppTemplate.findMany({
          where: { organizationId: input.organizationId },
          orderBy: { event: "asc" },
        });
      }),

    upsert: orgProcedure
      .input(
        z.object({
          organizationId: z.string(),
          event: z.enum([
            "INVOICE_ISSUED",
            "PAYMENT_RECEIVED",
            "PAYMENT_REMINDER",
            "OVERDUE_ALERT",
            "MAINTENANCE_ASSIGNED",
            "MAINTENANCE_DONE",
            "ANNOUNCEMENT",
            "ASSEMBLY_INVITE",
          ]),
          body: z.string().min(1).max(1600),
        }),
      )
      .mutation(async ({ input }) => {
        return db.whatsAppTemplate.upsert({
          where: { organizationId_event: { organizationId: input.organizationId, event: input.event } },
          create: { organizationId: input.organizationId, event: input.event, body: input.body },
          update: { body: input.body },
        });
      }),
  }),

  /** CRUD de anuncios de la comunidad. */
  announcements: router({
    list: orgProcedure
      .input(z.object({ organizationId: z.string(), communityId: z.string() }))
      .query(async ({ input }) => {
        return db.announcement.findMany({
          where: { organizationId: input.organizationId, communityId: input.communityId },
          orderBy: { publishedAt: "desc" },
          take: 50,
        });
      }),

    create: orgProcedure
      .input(
        z.object({
          organizationId: z.string(),
          communityId: z.string(),
          title: z.string().min(1).max(200),
          body: z.string().min(1).max(4000),
          sendWhatsApp: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const ann = await db.announcement.create({
          data: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            title: input.title,
            body: input.body,
            publishedAt: new Date(),
            createdById: ctx.user.id,
          },
        });

        if (input.sendWhatsApp) {
          void notifyCommunity({
            organizationId: input.organizationId,
            communityId: input.communityId,
            event: "ANNOUNCEMENT",
            vars: { titulo: input.title, cuerpo: input.body },
          }).catch(() => {});
        }

        return ann;
      }),

    delete: orgProcedure
      .input(z.object({ organizationId: z.string(), announcementId: z.string() }))
      .mutation(async ({ input }) => {
        await db.announcement.delete({
          where: { id: input.announcementId, organizationId: input.organizationId },
        });
      }),
  }),
});
