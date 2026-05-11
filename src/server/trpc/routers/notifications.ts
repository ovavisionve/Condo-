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
        orderBy: { createdAt: "desc" },
        take: input.take,
        select: {
          id: true,
          channel: true,
          event: true,
          status: true,
          body: true,
          sentAt: true,
          createdAt: true,
          recipientPhone: true,
          recipientEmail: true,
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

  /** CRUD de templates de Email por organización. */
  emailTemplates: router({
    list: orgProcedure
      .input(z.object({ organizationId: z.string() }))
      .query(async ({ input }) => {
        return db.emailTemplate.findMany({
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
          subject: z.string().min(1).max(200),
          body: z.string().min(1).max(5000),
        }),
      )
      .mutation(async ({ input }) => {
        return db.emailTemplate.upsert({
          where: { organizationId_event: { organizationId: input.organizationId, event: input.event } },
          create: { organizationId: input.organizationId, event: input.event, subject: input.subject, body: input.body },
          update: { subject: input.subject, body: input.body },
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

  /**
   * Envía un email personalizado (o basado en plantilla) a una lista de
   * personas de la comunidad. Registra cada envío en Notification para auditoría.
   */
  /**
   * Lista las notificaciones de pago enviadas por residentes desde el portal.
   * Filtra por body que comience con "PAGO_POR_VERIFICAR:" y parsea el JSON.
   */
  listPaymentReports: orgProcedure
    .input(z.object({ organizationId: z.string(), communityId: z.string() }))
    .query(async ({ input }) => {
      const notifications = await db.notification.findMany({
        where: {
          organizationId: input.organizationId,
          communityId: input.communityId,
          body: { startsWith: "PAGO_POR_VERIFICAR:" },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, body: true, createdAt: true },
      });

      type PaymentReportPayload = {
        unitId: string; unitCode: string; communityId: string; communityName: string;
        personId: string; personName: string; banco: string; referencia: string;
        monto: number; moneda: string; fechaPago: string; notas: string | null;
        estado: string; createdAt: string;
        tipoPago: string; tipoPagoLabel: string; invoiceId: string | null;
        screenshot?: string | null;
      };

      return notifications.map((n) => {
        try {
          const raw = n.body.replace(/^PAGO_POR_VERIFICAR:/, "");
          const data = JSON.parse(raw) as PaymentReportPayload;
          return { id: n.id, ...data, notifiedAt: n.createdAt };
        } catch {
          return null;
        }
      }).filter(Boolean);
    }),

  sendDirectEmail: orgProcedure
    .input(
      z.object({
        organizationId: z.string(),
        communityId: z.string(),
        personIds: z.array(z.string()).min(1).max(200),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(8000),
      }),
    )
    .mutation(async ({ input }) => {
      const { sendEmail } = await import("@/server/services/email");

      const [persons, org] = await Promise.all([
        db.person.findMany({
          where: { id: { in: input.personIds }, organizationId: input.organizationId },
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
        db.organization.findUnique({
          where: { id: input.organizationId },
          select: {
            name: true,
            smtpHost: true, smtpPort: true, smtpUser: true,
            smtpPass: true, smtpFrom: true, smtpSecure: true,
          },
        }),
      ]);

      const orgSmtp =
        org?.smtpHost && org.smtpUser && org.smtpPass
          ? {
              host: org.smtpHost,
              port: org.smtpPort ?? 587,
              user: org.smtpUser,
              pass: org.smtpPass,
              from: org.smtpFrom ?? org.smtpUser,
              secure: org.smtpSecure ?? false,
            }
          : null;

      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const person of persons) {
        if (!person.email) {
          errors.push(`${person.firstName} ${person.lastName}: sin email registrado`);
          failed++;
          continue;
        }

        // Construir HTML preservando saltos de línea del cuerpo
        const safeBody = input.body
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");

        const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:#1e293b;padding:20px 32px;">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">${input.subject}</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">${org?.name ?? ""}</p>
    </div>
    <div style="padding:28px 32px;color:#374151;font-size:14px;line-height:1.7;">
      ${safeBody}
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">Mensaje enviado desde el sistema de administración de ${org?.name ?? ""}. Por favor no responda a este correo.</p>
    </div>
  </div>
</body>
</html>`;

        const result = await sendEmail({
          to: person.email,
          subject: input.subject,
          html,
          text: input.body,
          orgSmtp,
        });

        // Registrar en historial de notificaciones
        await db.notification.create({
          data: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            personId: person.id,
            channel: "EMAIL",
            event: "ANNOUNCEMENT",
            body: input.body.slice(0, 500),
            recipientEmail: person.email,
            status: result.success ? "SENT" : "FAILED",
            errorMessage: result.error ?? null,
            sentAt: new Date(),
          },
        });

        if (result.success) sent++;
        else {
          failed++;
          errors.push(`${person.firstName} ${person.lastName}: ${result.error ?? "error"}`);
        }
      }

      return { sent, failed, errors };
    }),
});
