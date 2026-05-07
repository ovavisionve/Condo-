/**
 * Cron: publica recibos de condominio y los envía por email en lotes.
 *
 * Schedule: 0 8 1-5 * *  →  08:00 UTC, días 1–5 de cada mes.
 *
 * Flujo:
 *   Día 1:  Publica todos los borradores (DRAFT → ISSUED) del mes actual.
 *           Crea notificación IN_APP por cada unidad.
 *           Luego corre la fase de email igual que los demás días.
 *
 *   Días 1–5: Envía hasta DAILY_EMAIL_CAP emails, 1 por unidad, en orden
 *             ascendente de número de recibo. Registra cada intento en
 *             Notification (channel=EMAIL, event=INVOICE_ISSUED).
 *             Las unidades sin email o sin propietario quedan marcadas como
 *             SKIPPED para no repetir en runs siguientes.
 *
 * Tolerancia a re-ejecución: idempotente — si el cron corre dos veces el
 * mismo día, el cap impide re-envíos.
 */

import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { sendEmail } from "@/server/services/email";
import { renderTemplate } from "@/server/services/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min (necesario para el lote de 40 emails)

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const DAILY_EMAIL_CAP = 40;
const EMAIL_DELAY_MS  = 5_000; // 5 s entre envíos para no saturar el SMTP

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function getOrCreatePortalToken(personId: string, now: Date): Promise<string> {
  const existing = await db.portalToken.findFirst({
    where: { personId, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });
  if (existing) return existing.token;

  const created = await db.portalToken.create({
    data: {
      personId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return created.token;
}

// ─── Route handler ──────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Seguridad: solo Vercel Cron puede llamar esta ruta (timing-safe compare)
  const { verifyBearerToken } = await import("@/lib/auth-utils");
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const day   = now.getUTCDate();
  const year  = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const periodo  = `${MONTHS_ES[month - 1]} ${year}`;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));

  const result: Record<string, unknown> = { ok: true, year, month, day };

  // ══════════════════════════════════════════════════════════════════════════
  // FASE 1 — Publicar borradores (cualquier día 1–5, por si se prepararon tarde)
  // ══════════════════════════════════════════════════════════════════════════
  if (day >= 1 && day <= 5) {
    const drafts = await db.invoice.findMany({
      where: { status: "DRAFT", periodYear: year, periodMonth: month },
      include: {
        unit: {
          include: {
            ownerships: {
              where: { endDate: null },
              select: { personId: true },
              take: 1,
            },
          },
        },
      },
    });

    let published = 0;
    const pubErrors: string[] = [];

    for (const inv of drafts) {
      try {
        await db.invoice.update({
          where: { id: inv.id },
          data: { status: "ISSUED", issuedAt: now },
        });
        published++;

        // Notificación in-app inmediata (el email llegará en los próximos días)
        const personId = inv.unit.ownerships[0]?.personId;
        if (personId) {
          await db.notification.create({
            data: {
              organizationId: inv.organizationId,
              communityId:    inv.communityId,
              unitId:         inv.unitId,
              personId,
              channel: "IN_APP",
              event:   "INVOICE_ISSUED",
              status:  "SENT",
              body: `Se emitió su Recibo de Condominio ${inv.invoiceNumber} — ${periodo}. Recibirá el detalle por correo en los próximos días.`,
              sentAt: now,
            },
          });
        }
      } catch (err) {
        pubErrors.push(
          `${inv.invoiceNumber}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    result.published    = published;
    result.publishErrors = pubErrors;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FASE 2 — Enviar emails en lote (días 1–5)
  // ══════════════════════════════════════════════════════════════════════════
  if (day >= 1 && day <= 5) {
    // ── Cuántos emails ya salieron hoy ──────────────────────────────────────
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayCount = await db.notification.count({
      where: {
        event:   "INVOICE_ISSUED",
        channel: "EMAIL",
        status:  "SENT",
        sentAt:  { gte: todayStart },
      },
    });

    if (todayCount >= DAILY_EMAIL_CAP) {
      result.emailSent    = 0;
      result.emailSkipped = `cap diario alcanzado (${todayCount}/${DAILY_EMAIL_CAP})`;
      return NextResponse.json(result);
    }

    const remaining = DAILY_EMAIL_CAP - todayCount;

    // ── Unidades que ya tienen email enviado o marcado como SKIPPED este período
    const processed = await db.notification.findMany({
      where: {
        event:   "INVOICE_ISSUED",
        channel: "EMAIL",
        sentAt:  { gte: monthStart },
        unitId:  { not: null },
      },
      select: { unitId: true },
    });
    const processedUnitIds = [...new Set(
      processed.map((n) => n.unitId).filter(Boolean) as string[],
    )];

    // ── Facturas pendientes de email ─────────────────────────────────────────
    const pending = await db.invoice.findMany({
      where: {
        status:      { in: ["ISSUED", "PAID", "OVERDUE"] },
        periodYear:  year,
        periodMonth: month,
        ...(processedUnitIds.length > 0
          ? { unitId: { notIn: processedUnitIds } }
          : {}),
        unit: {
          ownerships: {
            some: { endDate: null },
          },
        },
      },
      include: {
        unit: {
          include: {
            ownerships: {
              where: { endDate: null },
              select: { personId: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { invoiceNumber: "asc" },
      take: remaining,
    });

    if (pending.length === 0) {
      result.emailSent    = 0;
      result.emailSkipped = "todos los emails del período ya fueron enviados";
      return NextResponse.json(result);
    }

    // ── Datos de la organización (se busca una vez) ─────────────────────────
    const orgId = pending[0]!.organizationId;
    const org   = await db.organization.findUnique({
      where: { id: orgId },
      select: {
        name: true,
        smtpHost: true, smtpPort: true, smtpUser: true,
        smtpPass: true, smtpFrom: true, smtpSecure: true,
      },
    });
    const orgName = org?.name ?? "Junta de Condominio";
    const orgSmtp = org?.smtpHost && org.smtpUser && org.smtpPass
      ? {
          host:   org.smtpHost,
          port:   org.smtpPort ?? 587,
          user:   org.smtpUser,
          pass:   org.smtpPass,
          from:   org.smtpFrom ?? org.smtpUser,
          secure: org.smtpSecure,
        }
      : null;

    // Template personalizado de la org (si existe)
    const emailTemplate = await db.emailTemplate.findUnique({
      where: {
        organizationId_event: { organizationId: orgId, event: "INVOICE_ISSUED" },
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL ?? "https://condominios-theta.vercel.app";

    let emailSent   = 0;
    let emailFailed = 0;
    let emailSkipNoEmail = 0;
    const emailErrors: string[] = [];

    // ── Enviar un email por factura, con pausa entre envíos ─────────────────
    for (const inv of pending) {
      const personId = inv.unit.ownerships[0]?.personId;
      if (!personId) continue; // no debería llegar aquí por el where, pero por seguridad

      const person = await db.person.findUnique({
        where: { id: personId },
        select: { firstName: true, lastName: true, email: true },
      });

      // Sin email: marcar como SKIPPED para excluir en próximas ejecuciones
      if (!person?.email) {
        await db.notification.create({
          data: {
            organizationId: inv.organizationId,
            communityId:    inv.communityId,
            unitId:         inv.unitId,
            personId,
            channel:      "EMAIL",
            event:        "INVOICE_ISSUED",
            status:       "FAILED",
            body:         "Sin dirección de email registrada",
            errorMessage: "No email address",
            sentAt:       now,
          },
        });
        emailSkipNoEmail++;
        continue;
      }

      // Preparar contenido
      const nombre    = `${person.firstName} ${person.lastName}`;
      const montoUsd  = Number(inv.totalUsd.toString()).toFixed(2);
      const montoBs   = Number(inv.totalBss.toString()).toFixed(2);
      const fechaVence = inv.dueDate.toLocaleDateString("es-VE");

      const vars = {
        nombre,
        monto_usd:  montoUsd,
        monto_bs:   montoBs,
        fecha_vence: fechaVence,
        factura:    inv.invoiceNumber,
        periodo,
      };

      const subject = emailTemplate
        ? renderTemplate(emailTemplate.subject, vars)
        : `Recibo de Condominio — ${periodo} — ${inv.invoiceNumber}`;

      const bodyText = emailTemplate
        ? renderTemplate(emailTemplate.body, vars)
        : `Hola ${nombre}, se ha emitido su Recibo de Condominio correspondiente a ${periodo} por un monto de $${montoUsd} (Bs ${montoBs}). Fecha de vencimiento: ${fechaVence}. # Recibo: ${inv.invoiceNumber}.`;

      // Portal token personal
      let portalUrl = `${baseUrl}/portal`;
      try {
        const token = await getOrCreatePortalToken(personId, now);
        portalUrl = `${baseUrl}/portal?t=${token}`;
      } catch {
        // no bloquea el envío
      }

      // Enviar
      const emailResult = await sendEmail({
        to: person.email,
        subject,
        html: `
<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:#1a1a1a;padding:20px 24px;border-radius:4px 4px 0 0;border-bottom:3px solid #000;">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:1px;">${orgName}</p>
    <p style="margin:4px 0 0;color:#999;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Recibo de Condominio</p>
  </div>
  <div style="border:1px solid #d1d5db;border-top:none;padding:28px 24px;border-radius:0 0 4px 4px;background:#fff;">
    ${bodyText.replace(/\n/g, "<br>")}
    <div style="margin-top:28px;padding:16px;background:#f5f5f5;border:1px solid #d1d5db;border-radius:4px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:11px;color:#6b7280;padding:2px 0;">Período</td>
          <td style="font-size:11px;color:#111;font-weight:600;text-align:right;">${periodo}</td>
        </tr>
        <tr>
          <td style="font-size:11px;color:#6b7280;padding:2px 0;"># Recibo</td>
          <td style="font-size:11px;color:#111;font-weight:600;text-align:right;">${inv.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="font-size:11px;color:#6b7280;padding:2px 0;">Monto USD</td>
          <td style="font-size:11px;color:#111;font-weight:700;text-align:right;">$${montoUsd}</td>
        </tr>
        <tr>
          <td style="font-size:11px;color:#6b7280;padding:2px 0;">Vence</td>
          <td style="font-size:11px;color:#111;text-align:right;">${fechaVence}</td>
        </tr>
      </table>
    </div>
    <div style="margin-top:24px;text-align:center;">
      <a href="${portalUrl}"
         style="display:inline-block;background:#000;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.5px;">
        Ver Recibo en el Portal
      </a>
      <p style="margin:10px 0 0;color:#9ca3af;font-size:11px;">Este enlace es personal — no lo comparta.</p>
    </div>
  </div>
  <p style="margin-top:16px;color:#9ca3af;font-size:10px;text-align:center;">Correo automático — No responder</p>
</div>`,
        text: `${bodyText}\n\nVer en el portal: ${portalUrl}`,
        orgSmtp,
      });

      await db.notification.create({
        data: {
          organizationId: inv.organizationId,
          communityId:    inv.communityId,
          unitId:         inv.unitId,
          personId,
          channel:        "EMAIL",
          event:          "INVOICE_ISSUED",
          status:         emailResult.success ? "SENT" : "FAILED",
          recipientEmail: person.email,
          body:           bodyText,
          errorMessage:   emailResult.error,
          sentAt:         emailResult.success ? now : undefined,
        },
      });

      if (emailResult.success) {
        emailSent++;
      } else {
        emailFailed++;
        emailErrors.push(`${inv.invoiceNumber} → ${person.email}: ${emailResult.error}`);
      }

      // Pausa entre envíos para no saturar el SMTP
      if (emailSent + emailFailed < pending.length) {
        await sleep(EMAIL_DELAY_MS);
      }
    }

    result.emailSent        = emailSent;
    result.emailFailed      = emailFailed;
    result.emailSkipNoEmail = emailSkipNoEmail;
    result.emailPendingTotal = pending.length;
    if (emailErrors.length > 0) result.emailErrors = emailErrors;
  }

  return NextResponse.json(result);
}
