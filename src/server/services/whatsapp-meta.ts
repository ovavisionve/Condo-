/**
 * Servicio de integración con WhatsApp Business Cloud API (Meta v22).
 *
 * Lee secretos de la tabla `AppSecret`:
 *   - whatsapp_token            → System User token permanente
 *   - whatsapp_phone_number_id  → id del número de WhatsApp en Meta
 *   - whatsapp_verify_token     → token para handshake del webhook (GET)
 *   - edge_internal_secret      → secret compartido para auth interna
 *
 * Si los secretos no están configurados, opera en modo "dry-run" (logs).
 * Lógica de mensajería distinta a `whatsapp.ts` (legacy Wati/Twilio) — éste es
 * para el bot conversacional bidireccional.
 */
import { db } from "@/server/db/client";

export type MetaSecretKey =
  | "whatsapp_token"
  | "whatsapp_phone_number_id"
  | "whatsapp_verify_token"
  | "edge_internal_secret"
  | "gemini_token"
  | "notify_email_to";

/**
 * Lee un secreto de la tabla AppSecret. Si no existe, intenta variable de entorno
 * homónima en MAYÚSCULAS como fallback (útil en dev).
 */
export async function getSecret(key: MetaSecretKey): Promise<string | null> {
  try {
    const row = await db.appSecret.findUnique({ where: { key } });
    if (row?.value !== undefined && row?.value !== null) {
      const v = row.value;
      if (typeof v === "string") return v;
      // jsonb puede llegar como objeto { value: "..." } o string envuelto
      if (typeof v === "object" && v !== null && "value" in v) {
        const inner = (v as { value: unknown }).value;
        if (typeof inner === "string") return inner;
      }
      return JSON.stringify(v);
    }
  } catch {
    // Tabla aún no existe → caer a env vars
  }
  const envKey = key.toUpperCase();
  return process.env[envKey] ?? null;
}

/**
 * Guarda/actualiza un secreto en AppSecret. Pensado para que el dueño los pegue
 * desde el panel admin (NUNCA el asistente IA).
 */
export async function setSecret(
  key: MetaSecretKey,
  value: string,
  organizationId?: string | null,
): Promise<void> {
  await db.appSecret.upsert({
    where: { key },
    create: { key, value, organizationId: organizationId ?? null },
    update: { value, organizationId: organizationId ?? null },
  });
}

const META_API_VERSION = "v22.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface SendTextOptions {
  to: string; // número con código país sin +, ej: 584141234567
  body: string;
  previewUrl?: boolean;
}

export interface SendDocumentOptions {
  to: string;
  mediaUrl?: string; // URL pública del documento
  mediaId?: string;  // o id pre-subido a Meta /media
  filename?: string;
  caption?: string;
}

export interface SendInteractiveButtonOptions {
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>; // máx 3
  header?: string;
  footer?: string;
}

export interface SendResult {
  success: boolean;
  externalId?: string; // wamid devuelto por Meta
  error?: string;
  raw?: unknown;
}

async function metaPost(path: string, body: unknown): Promise<SendResult> {
  const token = await getSecret("whatsapp_token");
  const phoneNumberId = await getSecret("whatsapp_phone_number_id");
  if (!token || !phoneNumberId) {
    console.log(`[whatsapp-meta:dry-run] POST ${path} →`, JSON.stringify(body).slice(0, 200));
    return { success: true, externalId: `dry-run-${Date.now()}` };
  }
  try {
    const url = `${META_BASE}/${phoneNumberId}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      return { success: false, error: data.error?.message ?? `HTTP ${res.status}`, raw: data };
    }
    return { success: true, externalId: data.messages?.[0]?.id, raw: data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error desconocido" };
  }
}

export async function sendText(opts: SendTextOptions): Promise<SendResult> {
  return metaPost("/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: opts.to,
    type: "text",
    text: { preview_url: !!opts.previewUrl, body: opts.body },
  });
}

export async function sendDocument(opts: SendDocumentOptions): Promise<SendResult> {
  if (!opts.mediaUrl && !opts.mediaId) {
    return { success: false, error: "Falta mediaUrl o mediaId" };
  }
  const document: Record<string, unknown> = {};
  if (opts.mediaId) document.id = opts.mediaId;
  else if (opts.mediaUrl) document.link = opts.mediaUrl;
  if (opts.filename) document.filename = opts.filename;
  if (opts.caption) document.caption = opts.caption;
  return metaPost("/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: opts.to,
    type: "document",
    document,
  });
}

export async function sendInteractiveButtons(opts: SendInteractiveButtonOptions): Promise<SendResult> {
  return metaPost("/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: opts.to,
    type: "interactive",
    interactive: {
      type: "button",
      ...(opts.header ? { header: { type: "text", text: opts.header } } : {}),
      body: { text: opts.body },
      ...(opts.footer ? { footer: { text: opts.footer } } : {}),
      action: {
        buttons: opts.buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

/**
 * Sube un PDF (base64 buffer) a Meta /media para obtener un mediaId reutilizable.
 * Alternativa: hostear el PDF en una URL pública y usar `mediaUrl`.
 */
export async function uploadMedia(buffer: Buffer, mimeType = "application/pdf", filename = "documento.pdf"): Promise<SendResult> {
  const token = await getSecret("whatsapp_token");
  const phoneNumberId = await getSecret("whatsapp_phone_number_id");
  if (!token || !phoneNumberId) {
    console.log(`[whatsapp-meta:dry-run] uploadMedia ${filename} (${buffer.length}b)`);
    return { success: true, externalId: `dry-run-media-${Date.now()}` };
  }
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    // Convertir Buffer a Uint8Array para compatibilidad con tipos de Blob estrictos
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
    const res = await fetch(`${META_BASE}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok) return { success: false, error: data.error?.message ?? `HTTP ${res.status}` };
    return { success: true, externalId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error desconocido" };
  }
}
