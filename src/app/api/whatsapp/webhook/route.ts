/**
 * Webhook de WhatsApp Cloud API (Meta).
 *
 *   GET  → handshake de verificación (hub.mode, hub.verify_token, hub.challenge)
 *   POST → recibe mensajes inbound. Dedup por wamId, identifica al residente
 *          por Person.whatsapp, persiste mensaje, enruta a menú/FAQ/bot-ai.
 *
 * Diseño:
 *   - Responde 200 SIEMPRE (incluso en errores) para que Meta no reintente.
 *   - Una sola Organization activa por número de WhatsApp por ahora — multi-tenant
 *     real cuando haya muchos clientes (entonces el phone_number_id discrimina).
 *   - "No inventa": el bot solo responde con FACTS del residente identificado.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import {
  getSecret,
  sendText,
  sendDocument,
} from "@/server/services/whatsapp-meta";

// ─── GET: handshake de Meta ─────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = await getSecret("whatsapp_verify_token");

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

// ─── Tipos del payload Meta ─────────────────────────────────────────────────

interface MetaPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        messages?: Array<MetaIncomingMessage>;
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        statuses?: Array<{ id?: string; status?: string; recipient_id?: string }>;
      };
    }>;
  }>;
}

interface MetaIncomingMessage {
  id?: string; // wamid
  from?: string; // número del remitente
  timestamp?: string;
  type?: string; // text | interactive | document | image | button | ...
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  button?: { text?: string; payload?: string };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normaliza un número eliminando todo lo que no sea dígito. */
function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

/** Busca al residente por su whatsapp (matching laxo: igual número con o sin 58). */
async function findPersonByPhone(organizationId: string, waId: string) {
  const norm = normalizePhone(waId);
  const variants = new Set([norm, `+${norm}`, norm.replace(/^58/, ""), `58${norm.replace(/^58/, "")}`]);
  return db.person.findFirst({
    where: {
      organizationId,
      OR: [
        { whatsapp: { in: Array.from(variants) } },
        { phone: { in: Array.from(variants) } },
      ],
    },
    select: {
      id: true, firstName: true, lastName: true,
      ownerships: { where: { endDate: null }, select: { unit: { select: { id: true, communityId: true } } }, take: 1 },
      tenancies: { where: { endDate: null }, select: { unit: { select: { id: true, communityId: true } } }, take: 1 },
    },
  });
}

/**
 * Resuelve la organización activa. Por ahora una sola organización con bot
 * habilitado — si hay varias, se prioriza por la que tiene matching del residente
 * o, en su defecto, la primera con WhatsAppBotConfig.enabled=true.
 */
async function resolveOrganization(waId: string): Promise<{ organizationId: string } | null> {
  // 1. Si el número del remitente está vinculado a un Person, esa org gana.
  const norm = normalizePhone(waId);
  const variants = [norm, `+${norm}`, norm.replace(/^58/, ""), `58${norm.replace(/^58/, "")}`];
  const person = await db.person.findFirst({
    where: { OR: [{ whatsapp: { in: variants } }, { phone: { in: variants } }] },
    select: { organizationId: true },
  });
  if (person) return { organizationId: person.organizationId };

  // 2. Fallback: primera org con bot habilitado.
  const cfg = await db.whatsAppBotConfig.findFirst({
    where: { enabled: true },
    select: { organizationId: true },
  });
  if (cfg) return { organizationId: cfg.organizationId };

  // 3. Última opción: primera org activa.
  const org = await db.organization.findFirst({
    where: { active: true, deletedAt: null },
    select: { id: true },
  });
  return org ? { organizationId: org.id } : null;
}

/** Envia texto y persiste el mensaje saliente. */
async function reply(conversationId: string, to: string, body: string): Promise<void> {
  const result = await sendText({ to, body });
  await db.whatsAppMessage.create({
    data: {
      conversationId,
      direction: "out",
      body,
      msgType: "text",
      wamId: result.externalId ?? null,
      status: result.success ? "sent" : "failed",
      channel: "whatsapp",
    },
  }).catch((e) => console.error("[webhook] persist out error:", e));
}

async function logEvent(organizationId: string, conversationId: string, type: string, detail?: unknown) {
  try {
    await db.whatsAppEvent.create({
      data: {
        organizationId,
        conversationId,
        type,
        detail: detail ? (detail as object) : undefined,
        channel: "whatsapp",
      },
    });
  } catch (err) {
    console.error("[webhook] event log error:", err);
  }
}

/** Matchea palabras clave de la pregunta contra FAQ. Devuelve la mejor respuesta o null. */
async function matchFaq(organizationId: string, question: string): Promise<{ answer: string; faqId: string } | null> {
  const faqs = await db.whatsAppFaq.findMany({
    where: { organizationId, enabled: true },
    orderBy: { priority: "desc" },
  });
  const q = question.toLowerCase();
  let best: { score: number; answer: string; faqId: string } | null = null;
  for (const f of faqs) {
    let score = 0;
    for (const kw of f.keywords) {
      if (!kw) continue;
      if (q.includes(kw.toLowerCase())) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { score, answer: f.answer, faqId: f.id };
    }
  }
  return best ? { answer: best.answer, faqId: best.faqId } : null;
}

/** Detección simple de palabras de handoff. */
function isHandoffRequest(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(agente|humano|persona real|hablar con alguien|reclamo|disputa)\b/.test(t);
}

/** Detección de saludos para reset de menú. */
function isGreeting(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /^(hola|buenas|buen día|buenos días|buenas tardes|buenas noches|menu|menú|inicio|start|hi|hey)\b/.test(t);
}

/** Llama internamente a /api/whatsapp/bot-ai. */
async function callBotAi(input: {
  organizationId: string;
  personId?: string | null;
  unitId?: string | null;
  communityId?: string | null;
  question: string;
  history?: Array<{ role: "user" | "model"; content: string }>;
  persona?: string;
  track?: "support" | "sales";
}): Promise<{ reply: string; action: string; documentType?: string; refId?: string }> {
  const internalSecret = await getSecret("edge_internal_secret");
  if (!internalSecret) {
    return { reply: "El asistente de IA no está configurado.", action: "handoff" };
  }
  const baseUrl =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  try {
    const res = await fetch(`${baseUrl}/api/whatsapp/bot-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(25_000),
    });
    return (await res.json()) as { reply: string; action: string; documentType?: string; refId?: string };
  } catch (err) {
    console.error("[webhook] bot-ai error:", err);
    return { reply: "Tuvimos un problema procesando tu mensaje. Un agente te contactará pronto.", action: "handoff" };
  }
}

/** Construye la URL pública del recibo PDF (vía endpoint público sin auth: usa firma). */
async function getInvoicePdfUrl(invoiceId: string): Promise<string | null> {
  // El sistema actual no expone PDF por URL pública firmada todavía. Para el MVP,
  // devolvemos null y el bot enviará un mensaje de texto al residente con el link
  // al portal. Cuando se implemente, devolver: `${baseUrl}/api/whatsapp/invoice-pdf/${invoiceId}?token=...`
  return null;
}

// ─── POST: mensajes inbound ─────────────────────────────────────────────────

export async function POST(req: Request) {
  let payload: MetaPayload;
  try {
    payload = (await req.json()) as MetaPayload;
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 }); // siempre 200
  }

  try {
    const entries = payload.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages?.length) continue;

        for (const msg of value.messages) {
          await handleIncoming(msg).catch((err) => {
            console.error("[webhook] handleIncoming error:", err);
          });
        }
      }
    }
  } catch (err) {
    console.error("[webhook] top-level error:", err);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

async function handleIncoming(msg: MetaIncomingMessage): Promise<void> {
  const wamId = msg.id;
  const from = msg.from;
  if (!from || !wamId) return;

  // Dedup
  const dup = await db.whatsAppMessage.findUnique({ where: { wamId } }).catch(() => null);
  if (dup) return;

  // Extraer texto/payload del mensaje
  let body = "";
  let msgType: string = msg.type ?? "text";
  if (msg.type === "text") {
    body = msg.text?.body ?? "";
  } else if (msg.type === "interactive") {
    const ir = msg.interactive;
    body = ir?.button_reply?.id ?? ir?.list_reply?.id ?? ir?.button_reply?.title ?? ir?.list_reply?.title ?? "";
    msgType = "interactive";
  } else if (msg.type === "button") {
    body = msg.button?.payload ?? msg.button?.text ?? "";
    msgType = "button";
  } else {
    body = `[${msg.type}]`;
  }

  // Resolver organización
  const org = await resolveOrganization(from);
  if (!org) {
    console.warn(`[webhook] no organization resolved for ${from}`);
    return;
  }

  // Identificar residente
  const person = await findPersonByPhone(org.organizationId, from);
  const unit = person?.ownerships[0]?.unit ?? person?.tenancies[0]?.unit ?? null;
  const personId = person?.id ?? null;
  const unitId = unit?.id ?? null;
  const communityId = unit?.communityId ?? null;

  // Find/create conversation
  const conv = await db.whatsAppConversation.upsert({
    where: { waId_channel: { waId: from, channel: "whatsapp" } },
    create: {
      waId: from,
      channel: "whatsapp",
      organizationId: org.organizationId,
      communityId,
      personId,
      unitId,
      mode: "bot",
      track: "support",
    },
    update: {
      organizationId: org.organizationId,
      ...(personId ? { personId } : {}),
      ...(unitId ? { unitId } : {}),
      ...(communityId ? { communityId } : {}),
    },
  });

  // Persistir mensaje inbound
  await db.whatsAppMessage.create({
    data: {
      conversationId: conv.id,
      direction: "in",
      body,
      msgType,
      wamId,
      status: "received",
      channel: "whatsapp",
    },
  });

  // Si está en modo agente, no responder con el bot
  if (conv.mode === "agent") return;

  // ─── Routing ─────────────────────────────────────────────────────────────
  const cfg = await db.whatsAppBotConfig.findUnique({ where: { organizationId: org.organizationId } });

  // 1. Handoff explícito
  if (isHandoffRequest(body)) {
    await db.whatsAppConversation.update({ where: { id: conv.id }, data: { mode: "agent" } });
    await db.whatsAppTicket.create({
      data: {
        organizationId: org.organizationId,
        communityId,
        conversationId: conv.id,
        category: "handoff_request",
        summary: body.slice(0, 500),
        priority: "normal",
        contact: from,
        personId,
        channel: "whatsapp",
        source: "user_request",
      },
    });
    await logEvent(org.organizationId, conv.id, "handoff", { reason: "user_request" });
    await reply(conv.id, from, cfg?.agentHandoffMessage ?? "Te paso con un agente. En breve te responde un humano.");
    return;
  }

  // 2. Saludo / reset
  if (isGreeting(body) || !conv.welcomedAt) {
    const greetingName = person ? person.firstName : "";
    const welcome = cfg?.welcomeMessage
      ? cfg.welcomeMessage.replace("{nombre}", greetingName)
      : person
      ? `Hola ${greetingName}, soy ${cfg?.aiPersonaName ?? "Resi"}, el asistente del condominio. Puedo ayudarte con tu recibo, deuda, BCV o el comprobante de pago. ¿Qué necesitas?`
      : `Hola, soy ${cfg?.aiPersonaName ?? "Resi"}. Para ayudarte necesito ubicarte en el sistema. Por favor confirma tu apartamento o tu nombre completo.`;
    await db.whatsAppConversation.update({
      where: { id: conv.id },
      data: { welcomedAt: new Date(), answeredAt: new Date() },
    });
    await reply(conv.id, from, welcome);
    return;
  }

  // 3. Si no se identificó, no podemos dar datos sensibles
  if (!person) {
    await reply(
      conv.id,
      from,
      "No encontré tu número en el sistema. ¿Podrías indicarme tu apartamento (ej. 11A) y tu nombre completo? Así te ubico.",
    );
    return;
  }

  // 4. FAQ matching
  const faq = await matchFaq(org.organizationId, body);
  if (faq) {
    await logEvent(org.organizationId, conv.id, "faq_hit", { faqId: faq.faqId });
    await reply(conv.id, from, faq.answer);
    return;
  }

  // 5. Bot AI (cerebro)
  if (cfg?.aiEnabled !== false) {
    // Construir historial de últimos mensajes
    const recentMsgs = await db.whatsAppMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { direction: true, body: true },
    });
    const history = recentMsgs
      .reverse()
      .slice(0, -1) // omitir el mensaje actual (ya está en `body`)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("model" as const),
        content: m.body,
      }));

    const aiResult = await callBotAi({
      organizationId: org.organizationId,
      personId,
      unitId,
      communityId,
      question: body,
      history,
      persona: cfg?.aiPersonaName ?? "Resi",
      track: "support",
    });

    if (aiResult.action === "send_document" && aiResult.refId && aiResult.documentType === "invoice") {
      // Intentar enviar PDF (futuro): si no hay URL pública disponible, contestar texto con la indicación
      const pdfUrl = await getInvoicePdfUrl(aiResult.refId);
      if (pdfUrl) {
        const invoice = await db.invoice.findUnique({ where: { id: aiResult.refId }, select: { invoiceNumber: true } });
        const result = await sendDocument({
          to: from,
          mediaUrl: pdfUrl,
          filename: `Recibo-${invoice?.invoiceNumber ?? aiResult.refId}.pdf`,
          caption: aiResult.reply,
        });
        await db.whatsAppMessage.create({
          data: {
            conversationId: conv.id,
            direction: "out",
            body: `[document] ${aiResult.reply}`,
            msgType: "document",
            wamId: result.externalId ?? null,
            status: result.success ? "sent" : "failed",
            channel: "whatsapp",
          },
        });
        await logEvent(org.organizationId, conv.id, "document_sent", { invoiceId: aiResult.refId });
      } else {
        // Sin URL pública aún: respondemos con texto y avisamos
        await reply(
          conv.id,
          from,
          `${aiResult.reply}\n\n(El envío de PDFs por WhatsApp se habilitará en breve. Mientras tanto, puedes descargarlo desde el portal.)`,
        );
        await logEvent(org.organizationId, conv.id, "document_pending", { invoiceId: aiResult.refId });
      }
      return;
    }

    if (aiResult.action === "handoff") {
      await db.whatsAppConversation.update({ where: { id: conv.id }, data: { mode: "agent" } });
      await db.whatsAppTicket.create({
        data: {
          organizationId: org.organizationId,
          communityId,
          conversationId: conv.id,
          category: "ai_handoff",
          summary: body.slice(0, 500),
          priority: "normal",
          contact: from,
          personId,
          channel: "whatsapp",
          source: "bot_ai",
        },
      });
      await logEvent(org.organizationId, conv.id, "handoff", { reason: "ai_decision" });
      await reply(conv.id, from, aiResult.reply);
      return;
    }

    await logEvent(org.organizationId, conv.id, aiResult.action === "clarify" ? "ai_clarify" : "ai_answer");
    await reply(conv.id, from, aiResult.reply);
    return;
  }

  // 6. Fallback final
  const fallback = cfg?.fallbackMessage
    ?? "No entendí tu mensaje. Puedes preguntarme por tu deuda, recibo del mes o tasa BCV. O escribe 'agente' para hablar con un humano.";
  await reply(conv.id, from, fallback);
}
