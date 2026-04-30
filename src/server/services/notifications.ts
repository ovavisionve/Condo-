/**
 * Servicio de notificaciones multi-canal.
 *
 * Guarda cada intento en Notification para auditoría,
 * y despacha por WhatsApp si el destinatario tiene número registrado.
 */

import { db } from "@/server/db/client";
import { sendWhatsAppMessage, renderTemplate } from "@/server/services/whatsapp";
import { sendEmail } from "@/server/services/email";
import type { NotificationEvent } from "@prisma/client";

interface NotifyParams {
  organizationId: string;
  communityId?: string;
  unitId?: string;
  personId: string;
  event: NotificationEvent;
  vars: Record<string, string>; // variables para el template
}

/**
 * Obtiene o crea un PortalToken válido para una persona (30 días).
 * Se usa para incluir el link del portal en emails automáticos.
 */
async function getOrCreatePortalToken(personId: string): Promise<string | null> {
  try {
    // Buscar token válido existente
    const existing = await db.portalToken.findFirst({
      where: { personId, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: "desc" },
    });
    if (existing) return existing.token;

    // Crear uno nuevo (30 días)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const created = await db.portalToken.create({
      data: { personId, expiresAt },
    });
    return created.token;
  } catch {
    return null; // no bloquear el envío si falla
  }
}

/** Envía una notificación a una persona según los templates configurados. */
export async function notifyPerson(params: NotifyParams): Promise<void> {
  const [person, org] = await Promise.all([
    db.person.findUnique({
      where: { id: params.personId },
      select: { firstName: true, lastName: true, whatsapp: true, email: true },
    }),
    db.organization.findUnique({
      where: { id: params.organizationId },
      select: {
        name: true,
        smtpHost: true, smtpPort: true, smtpUser: true,
        smtpPass: true, smtpFrom: true, smtpSecure: true,
      },
    }),
  ]);
  if (!person) return;

  // SMTP de la organización (tiene prioridad sobre el global)
  const orgSmtp = org?.smtpHost && org.smtpUser && org.smtpPass
    ? {
        host: org.smtpHost,
        port: org.smtpPort ?? 587,
        user: org.smtpUser,
        pass: org.smtpPass,
        from: org.smtpFrom ?? org.smtpUser,
        secure: org.smtpSecure,
      }
    : null;

  const orgName = org?.name ?? "Administración del Condominio";

  const [waTemplate, emailTemplate] = await Promise.all([
    db.whatsAppTemplate.findUnique({
      where: { organizationId_event: { organizationId: params.organizationId, event: params.event } },
    }),
    db.emailTemplate.findUnique({
      where: { organizationId_event: { organizationId: params.organizationId, event: params.event } },
    }),
  ]);

  const vars = { nombre: `${person.firstName} ${person.lastName}`, ...params.vars };
  const body = waTemplate ? renderTemplate(waTemplate.body, vars) : buildDefaultBody(params.event, vars);

  // Portal token para incluir en el email
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://condominios-theta.vercel.app";
  const portalToken = await getOrCreatePortalToken(params.personId);
  const portalUrl = portalToken ? `${baseUrl}/portal?t=${portalToken}` : `${baseUrl}/portal`;

  // WhatsApp
  if (person.whatsapp) {
    const clean = person.whatsapp.replace(/\D/g, "");
    const result = await sendWhatsAppMessage(clean, body);
    await db.notification.create({
      data: {
        organizationId: params.organizationId,
        communityId: params.communityId,
        unitId: params.unitId,
        personId: params.personId,
        channel: "WHATSAPP",
        event: params.event,
        status: result.success ? "SENT" : "FAILED",
        recipientPhone: clean,
        body,
        externalId: result.externalId,
        errorMessage: result.error,
        sentAt: result.success ? new Date() : undefined,
      },
    });
  }

  // Email
  if (person.email) {
    const emailSubject = emailTemplate
      ? renderTemplate(emailTemplate.subject, vars)
      : buildDefaultEmailSubject(params.event, vars);
    const emailBody = emailTemplate
      ? renderTemplate(emailTemplate.body, vars)
      : buildDefaultBody(params.event, vars);

    // Botón de portal según el tipo de evento
    const portalButtonLabel =
      params.event === "PAYMENT_RECEIVED"  ? "📄 Ver comprobante en el portal"
      : params.event === "INVOICE_ISSUED"  ? "🧾 Ver factura en el portal"
      : params.event === "PAYMENT_REMINDER" ? "💳 Pagar en el portal"
      : "🏠 Ver en el portal";

    const result = await sendEmail({
      to: person.email,
      subject: emailSubject,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0;">
          <p style="margin:0;color:#fff;font-size:18px;font-weight:700;">${orgName}</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
          ${emailBody.replace(/\n/g, "<br>")}
          <div style="margin-top:24px;text-align:center;">
            <a href="${portalUrl}"
               style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
              ${portalButtonLabel}
            </a>
            <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">Este enlace es personal — no lo comparta.</p>
          </div>
        </div>
        <p style="margin-top:16px;color:#9ca3af;font-size:11px;text-align:center;">Correo automático — No responder</p>
      </div>`,
      text: `${emailBody}\n\nVer en el portal: ${portalUrl}`,
      orgSmtp,
    });

    await db.notification.create({
      data: {
        organizationId: params.organizationId,
        communityId: params.communityId,
        unitId: params.unitId,
        personId: params.personId,
        channel: "EMAIL",
        event: params.event,
        status: result.success ? "SENT" : "FAILED",
        recipientEmail: person.email,
        body: emailBody,
        errorMessage: result.error,
        sentAt: result.success ? new Date() : undefined,
      },
    });
  }

  // In-app siempre
  await db.notification.create({
    data: {
      organizationId: params.organizationId,
      communityId: params.communityId,
      unitId: params.unitId,
      personId: params.personId,
      channel: "IN_APP",
      event: params.event,
      status: "SENT",
      body,
      sentAt: new Date(),
    },
  });
}

/** Notifica a todos los propietarios/inquilinos activos de una comunidad. */
export async function notifyCommunity(params: {
  organizationId: string;
  communityId: string;
  event: NotificationEvent;
  vars: Record<string, string>;
}): Promise<number> {
  const units = await db.unit.findMany({
    where: { communityId: params.communityId, active: true, deletedAt: null },
    select: {
      id: true,
      ownerships: { where: { endDate: null }, select: { personId: true } },
      tenancies: { where: { endDate: null }, select: { personId: true } },
    },
  });

  const personIds = new Set<string>();
  for (const u of units) {
    for (const o of u.ownerships) personIds.add(o.personId);
    for (const t of u.tenancies) personIds.add(t.personId);
  }

  let count = 0;
  for (const personId of personIds) {
    await notifyPerson({ ...params, personId });
    count++;
  }
  return count;
}

function buildDefaultEmailSubject(event: NotificationEvent, vars: Record<string, string>): string {
  switch (event) {
    case "INVOICE_ISSUED":     return `Recibo de condominio - ${vars.periodo ?? ""} - ${vars.factura ?? ""}`;
    case "PAYMENT_RECEIVED":   return `Confirmación de pago recibido`;
    case "PAYMENT_REMINDER":   return `Recordatorio de pago pendiente`;
    case "OVERDUE_ALERT":      return `Aviso de mora - Residencias Hugo Chávez Frías`;
    case "MAINTENANCE_ASSIGNED": return `Orden de mantenimiento asignada: ${vars.titulo ?? ""}`;
    case "MAINTENANCE_DONE":   return `Orden de mantenimiento completada: ${vars.titulo ?? ""}`;
    case "ANNOUNCEMENT":       return `Aviso: ${vars.titulo ?? ""}`;
    case "ASSEMBLY_INVITE":    return `Convocatoria a asamblea - ${vars.fecha ?? ""}`;
    default:                   return `Notificación - Residencias Hugo Chávez Frías`;
  }
}

function buildDefaultBody(event: NotificationEvent, vars: Record<string, string>): string {
  const n = vars.nombre ?? "Residente";
  switch (event) {
    case "INVOICE_ISSUED":
      return `Hola ${n}, se ha emitido su recibo de condominio por $${vars.monto_usd ?? "—"} (Bs ${vars.monto_bs ?? "—"}). Vence el ${vars.fecha_vence ?? "—"}. Factura: ${vars.factura ?? "—"}.`;
    case "PAYMENT_RECEIVED":
      return `Hola ${n}, hemos recibido su pago de $${vars.monto_usd ?? "—"}. Gracias.`;
    case "PAYMENT_REMINDER":
      return `Hola ${n}, le recordamos que tiene facturas pendientes por $${vars.monto_usd ?? "—"}. Por favor realice su pago a la brevedad.`;
    case "OVERDUE_ALERT":
      return `Hola ${n}, su cuenta tiene facturas vencidas por $${vars.monto_usd ?? "—"}. Por favor contacte la administración.`;
    case "MAINTENANCE_ASSIGNED":
      return `Hola ${n}, su solicitud de mantenimiento "${vars.titulo ?? ""}" ha sido asignada. Le informaremos cuando esté resuelta.`;
    case "MAINTENANCE_DONE":
      return `Hola ${n}, su solicitud de mantenimiento "${vars.titulo ?? ""}" ha sido completada.`;
    case "ANNOUNCEMENT":
      return `📢 *${vars.titulo ?? "Aviso"}*\n\n${vars.cuerpo ?? ""}`;
    case "ASSEMBLY_INVITE":
      return `Hola ${n}, está convocado a una asamblea de copropietarios el ${vars.fecha ?? "—"}. ${vars.lugar ? `Lugar: ${vars.lugar}` : ""}`;
    default:
      return `Notificación del condominio para ${n}.`;
  }
}
