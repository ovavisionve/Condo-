/**
 * Servicio de WhatsApp Business API
 *
 * Soporta dos proveedores: Wati y Twilio (elegido vía WHATSAPP_PROVIDER env var).
 * Si no hay credenciales configuradas, opera en modo "dry-run" (solo logs).
 *
 * Variables de entorno:
 *   WHATSAPP_PROVIDER = WATI | TWILIO
 *   WATI_ENDPOINT     = https://live-mt-server.wati.io/xxxxx
 *   WATI_TOKEN        = Bearer token de Wati
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 */

const PROVIDER = process.env.WHATSAPP_PROVIDER as "WATI" | "TWILIO" | undefined;

export interface WaSendResult {
  externalId?: string;
  success: boolean;
  error?: string;
}

/**
 * Envía un mensaje de WhatsApp a un número.
 * @param to Número con código país sin + ni espacios: "584141234567"
 * @param body Texto del mensaje
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<WaSendResult> {
  if (!PROVIDER || !isConfigured()) {
    console.log(`[whatsapp:dry-run] → ${to}: ${body.slice(0, 80)}...`);
    return { success: true, externalId: `dry-run-${Date.now()}` };
  }

  if (PROVIDER === "WATI") return sendViaWati(to, body);
  if (PROVIDER === "TWILIO") return sendViaTwilio(to, body);
  return { success: false, error: `Proveedor desconocido: ${PROVIDER}` };
}

function isConfigured(): boolean {
  if (PROVIDER === "WATI") return Boolean(process.env.WATI_ENDPOINT && process.env.WATI_TOKEN);
  if (PROVIDER === "TWILIO") return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  return false;
}

async function sendViaWati(to: string, body: string): Promise<WaSendResult> {
  try {
    const endpoint = process.env.WATI_ENDPOINT!.replace(/\/$/, "");
    const res = await fetch(`${endpoint}/api/v1/sendSessionMessage/${to}`, {
      method: "POST",
      headers: {
        Authorization: process.env.WATI_TOKEN!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageText: body }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { id?: string; result?: boolean; error?: string };
    if (res.ok && data.result !== false) {
      return { success: true, externalId: data.id };
    }
    return { success: false, error: data.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error desconocido" };
  }
}

async function sendViaTwilio(to: string, body: string): Promise<WaSendResult> {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";
    const credentials = Buffer.from(`${sid}:${token}`).toString("base64");

    const params = new URLSearchParams({
      From: from,
      To: `whatsapp:+${to}`,
      Body: body,
    });

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { sid?: string; error_message?: string; status?: string };
    if (res.ok) {
      return { success: true, externalId: data.sid };
    }
    return { success: false, error: data.error_message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error desconocido" };
  }
}

/**
 * Renderiza un template reemplazando variables {clave} con los valores dados.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}
