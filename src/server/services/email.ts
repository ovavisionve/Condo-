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
  /** PDF adjunto opcional (ej. el recibo). */
  attachments?: { filename: string; content: Buffer }[];
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
      // Redactar email para no leakear PII a logs/observabilidad
      const redacted = params.to.replace(/^(.{2}).*@(.*)$/, "$1***@$2");
      console.log(`[email:dry-run] → ${redacted} | ${params.subject}`);
      return { success: true };
    }
  }

  try {
    await transport.sendMail({ from, to: params.to, subject: params.subject, html: params.html, text: params.text, attachments: params.attachments });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error desconocido" };
  }
}

// ─── Envío MASIVO robusto ───────────────────────────────────────────────────
// El envío masivo antes creaba UNA conexión SMTP nueva (con login) por CADA email
// → Gmail bloquea tras ~130 logins seguidos → fallaban los últimos ~50. Este helper:
//   1. Usa UNA sola conexión reutilizada (pool) → un solo login.
//   2. Reintenta automáticamente cada email que falle (hasta `retries` veces, con backoff).
//   3. Limita la concurrencia para no saturar el servidor.
//   4. Devuelve la lista exacta de los que fallaron (para reintentar solo esos).

function resolveSmtpConfig(orgSmtp?: OrgSmtp | null): { host: string; port: number; user: string; pass: string; secure: boolean; from: string } | null {
  if (orgSmtp?.host && orgSmtp.user && orgSmtp.pass) {
    return {
      host: orgSmtp.host, port: orgSmtp.port ?? 587, user: orgSmtp.user, pass: orgSmtp.pass,
      secure: orgSmtp.secure ?? false, from: orgSmtp.from || orgSmtp.user,
    };
  }
  return globalSmtp();
}

export interface BulkEmailItem {
  to: string; subject: string; html: string; text?: string;
  /** PDF adjunto opcional (ej. el recibo), para que llegue listo para abrir/guardar. */
  attachments?: { filename: string; content: Buffer }[];
}
export interface BulkEmailResult {
  sent: number;
  failed: { to: string; error: string }[];
  dryRun?: boolean;
}

export async function sendBulkEmails(
  items: BulkEmailItem[],
  opts?: { orgSmtp?: OrgSmtp | null; retries?: number; concurrency?: number },
): Promise<BulkEmailResult> {
  if (items.length === 0) return { sent: 0, failed: [] };

  const cfg = resolveSmtpConfig(opts?.orgSmtp);
  if (!cfg) {
    // Sin SMTP configurado → dry-run (no bloquear en dev)
    for (const it of items) {
      const redacted = it.to.replace(/^(.{2}).*@(.*)$/, "$1***@$2");
      console.log(`[email:dry-run] → ${redacted} | ${it.subject}`);
    }
    return { sent: items.length, failed: [], dryRun: true };
  }

  // Transporte POOL: reutiliza conexiones (un solo login), con rate limit suave.
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  const retries = opts?.retries ?? 3;
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, 6));
  const failed: { to: string; error: string }[] = [];
  let sent = 0;
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const it = items[idx++]!;
      let ok = false;
      let lastErr = "";
      for (let attempt = 0; attempt <= retries && !ok; attempt++) {
        try {
          await transport.sendMail({ from: cfg!.from, to: it.to, subject: it.subject, html: it.html, text: it.text, attachments: it.attachments });
          ok = true;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : "error";
          // Backoff creciente antes de reintentar (700ms, 1.4s, 2.1s…)
          if (attempt < retries) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
      if (ok) sent++;
      else failed.push({ to: it.to, error: lastErr });
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  } finally {
    transport.close();
  }
  return { sent, failed };
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
          <td style="padding:4px 0;color:#111827;font-size:13px;">1 USD = ${Number(data.exchangeRate).toFixed(4)} Bs</td>
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

      <div style="text-align:center;margin-bottom:8px;">
        <p style="margin:0 0 12px;color:#374151;font-size:13px;">
          📎 Tu recibo en PDF está adjunto a este correo.
        </p>
      </div>

      ${data.portalUrl ? `
      <!-- Portal link -->
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${data.portalUrl}"
           style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
          ⬇️ Ver y descargar recibo en el portal
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

// ─── CC Invoice email template ────────────────────────────────────────────────

export interface CcInvoiceEmailData {
  mallName: string;
  mallAddress?: string;
  mallPhone?: string;
  mallEmail?: string;
  tenantName: string;
  localCode: string;
  localName?: string | null;
  invoiceNumber: string;
  periodYear: number;
  periodMonth: number;
  issuedAt: Date;
  dueDate: Date;
  type: string;
  items: { description: string; amountUsd: string; amountBss: string }[];
  totalUsd: string;
  totalBss: string;
  paidUsd: string;
  exchangeRate: string;
  status: string;
  notes?: string | null;
}

const TYPE_LABEL_CC_EMAIL: Record<string, string> = {
  CANON: "Canon de Arrendamiento", CANON_SALES: "Canon sobre Ventas",
  ALIQUOT: "Alícuota de Gastos Comunes", EXTRA_FEE: "Cargo Extraordinario",
  FINE: "Multa", OTHER: "Otro",
};

export function buildCcInvoiceEmail(data: CcInvoiceEmailData): { subject: string; html: string; text: string } {
  const period = `${MONTHS_ES[data.periodMonth - 1]} ${data.periodYear}`;
  const pendingUsd = (Number(data.totalUsd) - Number(data.paidUsd)).toFixed(2);
  const isPaid = Number(pendingUsd) <= 0;
  const typeLabel = TYPE_LABEL_CC_EMAIL[data.type] ?? data.type;

  const itemRows = data.items.map((item) => `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:8px 12px;font-size:13px;color:#374151;">${item.description}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:right;color:#374151;">$${Number(item.amountUsd).toFixed(2)}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:right;color:#6b7280;">${Number(item.amountBss).toFixed(2)} Bs</td>
    </tr>
  `).join("");

  const subject = isPaid
    ? `Factura ${data.invoiceNumber} — Cancelada ✓ — ${data.mallName}`
    : `Factura de arrendamiento — ${period} — ${data.mallName}`;

  const statusColor = isPaid ? "#16a34a" : data.status === "OVERDUE" ? "#dc2626" : "#2563eb";
  const statusLabel = isPaid ? "CANCELADA" : data.status === "OVERDUE" ? "VENCIDA" : "EMITIDA";

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">

    <!-- Header -->
    <div style="background:#1e293b;padding:24px 32px;">
      <p style="margin:0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Factura de Arrendamiento Comercial</p>
      <h1 style="margin:4px 0 0;color:#fff;font-size:22px;font-weight:700;">${data.mallName}</h1>
      ${data.mallAddress ? `<p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">${data.mallAddress}</p>` : ""}
    </div>

    <!-- Status bar -->
    <div style="background:${statusColor};padding:10px 32px;display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#fff;font-size:13px;font-weight:600;">${statusLabel} — ${typeLabel}</span>
      <span style="color:rgba(255,255,255,.85);font-size:13px;">Período: ${period}</span>
    </div>

    <!-- Body -->
    <div style="padding:32px;">

      <!-- Recipient -->
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Arrendatario</p>
      <p style="margin:0 0 24px;color:#111827;font-size:15px;font-weight:600;">${data.tenantName} · Local ${data.localCode}${data.localName ? ` — ${data.localName}` : ""}</p>

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
          <td style="padding:4px 0;color:#111827;font-size:13px;">1 USD = ${Number(data.exchangeRate).toFixed(4)} Bs</td>
        </tr>
      </table>

      <!-- Items table -->
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Conceptos facturados</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:24px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 12px;font-size:12px;text-align:left;color:#6b7280;font-weight:600;text-transform:uppercase;">Concepto</th>
            <th style="padding:8px 12px;font-size:12px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;">USD</th>
            <th style="padding:8px 12px;font-size:12px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;">Bs</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <!-- Totals -->
      <div style="background:#f9fafb;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="color:#6b7280;font-size:13px;">Total facturado</span>
          <span style="color:#111827;font-size:13px;">$${Number(data.totalUsd).toFixed(2)} USD</span>
        </div>
        ${Number(data.paidUsd) > 0 ? `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="color:#6b7280;font-size:13px;">Abonado</span>
          <span style="color:#16a34a;font-size:13px;">−$${Number(data.paidUsd).toFixed(2)}</span>
        </div>` : ""}
        <div style="display:flex;justify-content:space-between;border-top:1px solid #e5e7eb;padding-top:10px;margin-top:6px;">
          <span style="color:#111827;font-size:15px;font-weight:700;">Saldo pendiente</span>
          <span style="color:${isPaid ? "#16a34a" : "#dc2626"};font-size:15px;font-weight:700;">
            ${isPaid ? "✓ Cancelado" : `$${pendingUsd} USD`}
          </span>
        </div>
      </div>

      ${!isPaid && (data.mallPhone || data.mallEmail) ? `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0;color:#1d4ed8;font-size:13px;font-weight:600;">¿Cómo pagar?</p>
        <p style="margin:6px 0 0;color:#1e40af;font-size:13px;">Contáctenos para coordinar su pago:${data.mallEmail ? ` <a href="mailto:${data.mallEmail}" style="color:#1d4ed8;">${data.mallEmail}</a>` : ""}${data.mallPhone ? ` · ${data.mallPhone}` : ""}</p>
      </div>` : ""}

      ${data.notes ? `
      <div style="background:#fefce8;border:1px solid #fef08a;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
        <p style="margin:0;color:#854d0e;font-size:13px;"><strong>Nota:</strong> ${data.notes}</p>
      </div>` : ""}

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        Este es un correo automático del sistema de administración de ${data.mallName}.
        Conforme al Decreto-Ley de Arrendamiento Inmobiliario para Uso Comercial (Venezuela).
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Factura de arrendamiento — ${data.mallName}
Período: ${period} | Local: ${data.localCode}
Arrendatario: ${data.tenantName}
Factura N°: ${data.invoiceNumber}
Vence: ${new Date(data.dueDate).toLocaleDateString("es-VE")}
Total: $${Number(data.totalUsd).toFixed(2)} USD
Saldo pendiente: $${pendingUsd} USD`;

  return { subject, html, text };
}
