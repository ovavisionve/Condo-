/**
 * Servicio de email via SMTP (nodemailer).
 * Soporta SMTP global (env vars) y SMTP por organización (campos en BD).
 * Si no hay credenciales → dry-run (solo logs).
 */

import nodemailer from "nodemailer";

export interface OrgSmtp {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure?: boolean;
}

function createTransportFromConfig(cfg: { host: string; port: number; user: string; pass: string; secure: boolean }) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

function globalSmtp(): { host: string; port: number; user: string; pass: string; secure: boolean; from: string } | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host, user, pass,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    from: process.env.SMTP_FROM ?? "noreply@condominios.app",
  };
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** SMTP de la organización (tiene prioridad sobre el global) */
  orgSmtp?: OrgSmtp | null;
}

export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  // Prioridad: SMTP de la org → SMTP global → dry-run
  const org = params.orgSmtp;

  let from: string;
  let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

  if (org?.host && org.user && org.pass) {
    from = org.from || org.user;
    transport = createTransportFromConfig({
      host: org.host,
      port: org.port ?? 587,
      user: org.user,
      pass: org.pass,
      secure: org.secure ?? false,
    });
  } else {
    const global = globalSmtp();
    if (global) {
      from = global.from;
      transport = createTransportFromConfig(global);
    } else {
      console.log(`[email:dry-run] → ${params.to} | ${params.subject}`);
      return { success: true };
    }
  }

  try {
    await transport.sendMail({ from, to: params.to, subject: params.subject, html: params.html, text: params.text });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error desconocido" };
  }
}

// ─── Invoice email template ────────────────────────────────────────────────

export interface InvoiceEmailData {
  communityName: string;
  communityAddress?: string;
  personName: string;
  unitCode: string;
  invoiceNumber: string;
  periodYear: number;
  periodMonth: number;
  issuedAt: Date;
  dueDate: Date;
  items: { description: string; amountUsd: string; amountBss: string }[];
  totalUsd: string;
  totalBss: string;
  paidUsd: string;
  exchangeRate: string;
  status: string;
  adminEmail?: string;
  adminPhone?: string;
  /** URL del portal del residente (con token mágico incluido) */
  portalUrl?: string;
}

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function buildInvoiceEmail(data: InvoiceEmailData): { subject: string; html: string; text: string } {
  const period = `${MONTHS_ES[data.periodMonth - 1]} ${data.periodYear}`;
  const pendingUsd = (Number(data.totalUsd) - Number(data.paidUsd)).toFixed(2);
  const isPaid = Number(pendingUsd) <= 0;

  const statusLabel: Record<string, string> = {
    ISSUED: "Emitida", PARTIAL: "Pago parcial", PAID: "Pagada", OVERDUE: "Vencida", VOIDED: "Anulada", DRAFT: "Borrador",
  };

  const statusColor: Record<string, string> = {
    ISSUED: "#2563eb", PARTIAL: "#d97706", PAID: "#16a34a", OVERDUE: "#dc2626", VOIDED: "#6b7280", DRAFT: "#6b7280",
  };

  const color = statusColor[data.status] ?? "#6b7280";

  const itemRows = data.items.map((item) => `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:8px 12px;font-size:13px;color:#374151;">${item.description}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:right;color:#374151;">$${Number(item.amountUsd).toFixed(2)}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:right;color:#6b7280;">${Number(item.amountBss).toFixed(2)} Bs</td>
    </tr>
  `).join("");

  const subject = isPaid
    ? `Factura ${data.invoiceNumber} — Pagada ✓`
    : `Recibo de condominio — ${period} — ${data.communityName}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">

    <!-- Header -->
    <div style="background:#1e293b;padding:24px 32px;">
      <p style="margin:0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Recibo de Condominio</p>
      <h1 style="margin:4px 0 0;color:#fff;font-size:22px;font-weight:700;">${data.communityName}</h1>
      ${data.communityAddress ? `<p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">${data.communityAddress}</p>` : ""}
    </div>

    <!-- Status bar -->
    <div style="background:${color};padding:10px 32px;display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#fff;font-size:13px;font-weight:600;">${statusLabel[data.status] ?? data.status}</span>
      <span style="color:rgba(255,255,255,.85);font-size:13px;">Período: ${period}</span>
    </div>

    <!-- Body -->
    <div style="padding:32px;">

      <!-- Recipient -->
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Para</p>
      <p style="margin:0 0 24px;color:#111827;font-size:15px;font-weight:600;">${data.personName} · Unidad ${data.unitCode}</p>

      <!-- Invoice meta -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:4px 0;color:#6b7280;font-size:13px;width:50%;">N° Factura</td>
          <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:500;">${data.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#6b7280;font-size:13px;">Fecha de emisión</td>
          <td style="padding:4px 0;color:#111827;font-size:13px;">${new Date(data.issuedAt).toLocaleDateString("es-VE")}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#6b7280;font-size:13px;">Fecha de vencimiento</td>
          <td style="padding:4px 0;color:${isPaid ? "#16a34a" : new Date(data.dueDate) < new Date() ? "#dc2626" : "#111827"};font-size:13px;font-weight:500;">
            ${new Date(data.dueDate).toLocaleDateString("es-VE")}
          </td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#6b7280;font-size:13px;">Tasa de cambio</td>
          <td style="padding:4px 0;color:#111827;font-size:13px;">1 USD = ${Number(data.exchangeRate).toFixed(2)} Bs</td>
        </tr>
      </table>

      <!-- Items table -->
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Detalle</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:24px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 12px;font-size:12px;text-align:left;color:#6b7280;font-weight:600;text-transform:uppercase;">Concepto</th>
            <th style="padding:8px 12px;font-size:12px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;">USD</th>
            <th style="padding:8px 12px;font-size:12px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;">Bs</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <!-- Totals -->
      <div style="background:#f9fafb;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="color:#6b7280;font-size:13px;">Total facturado</span>
          <span style="color:#111827;font-size:13px;">$${Number(data.totalUsd).toFixed(2)} · ${Number(data.totalBss).toFixed(2)} Bs</span>
        </div>
        ${Number(data.paidUsd) > 0 ? `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="color:#6b7280;font-size:13px;">Pagado</span>
          <span style="color:#16a34a;font-size:13px;">−$${Number(data.paidUsd).toFixed(2)}</span>
        </div>` : ""}
        <div style="display:flex;justify-content:space-between;border-top:1px solid #e5e7eb;padding-top:10px;margin-top:6px;">
          <span style="color:#111827;font-size:15px;font-weight:700;">Saldo pendiente</span>
          <span style="color:${isPaid ? "#16a34a" : "#dc2626"};font-size:15px;font-weight:700;">
            ${isPaid ? "✓ Pagado" : `$${pendingUsd}`}
          </span>
        </div>
      </div>

      ${!isPaid ? `
      <!-- Payment note -->
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0;color:#1d4ed8;font-size:13px;font-weight:600;">¿Cómo pagar?</p>
        <p style="margin:6px 0 0;color:#1e40af;font-size:13px;">Contáctenos para coordinar su pago:${data.adminEmail ? ` <a href="mailto:${data.adminEmail}" style="color:#1d4ed8;">${data.adminEmail}</a>` : ""}${data.adminPhone ? ` · ${data.adminPhone}` : ""}</p>
      </div>` : ""}

      ${data.portalUrl ? `
      <!-- Portal link -->
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${data.portalUrl}"
           style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
          🏠 Ver recibo en el portal
        </a>
        <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">
          Este enlace es personal — no lo comparta.
        </p>
      </div>` : ""}

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        Este es un correo automático del sistema de administración de ${data.communityName}.
        Por favor no responda a este mensaje.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Recibo de condominio — ${data.communityName}
Período: ${period} | Unidad: ${data.unitCode}
Factura N°: ${data.invoiceNumber}
Vence: ${new Date(data.dueDate).toLocaleDateString("es-VE")}
Total: $${Number(data.totalUsd).toFixed(2)} USD | ${Number(data.totalBss).toFixed(2)} Bs
Saldo pendiente: $${pendingUsd} USD`;

  return { subject, html, text };
}
