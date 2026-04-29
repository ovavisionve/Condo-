/**
 * Servicio de notificaciones multi-canal.
 *
 * Guarda cada intento en Notification para auditoría,
 * y despacha por WhatsApp si el destinatario tiene número registrado.
 */

import { db } from "@/server/db/client";
import { sendWhatsAppMessage, renderTemplate } from "@/server/services/whatsapp";
import type { NotificationEvent } from "@prisma/client";

interface NotifyParams {
  organizationId: string;
  communityId?: string;
  unitId?: string;
  personId: string;
  event: NotificationEvent;
  vars: Record<string, string>; // variables para el template
}

/** Envía una notificación a una persona según los templates configurados. */
export async function notifyPerson(params: NotifyParams): Promise<void> {
  const person = await db.person.findUnique({
    where: { id: params.personId },
    select: { firstName: true, lastName: true, whatsapp: true, email: true },
  });
  if (!person) return;

  const template = await db.whatsAppTemplate.findUnique({
    where: { organizationId_event: { organizationId: params.organizationId, event: params.event } },
  });

  const vars = { nombre: `${person.firstName} ${person.lastName}`, ...params.vars };
  const body = template ? renderTemplate(template.body, vars) : buildDefaultBody(params.event, vars);

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
