/**
 * POST /api/whatsapp/send
 *
 * Envía un mensaje saliente vía Meta Cloud API. Soporta texto, documento (PDF de
 * recibo) y botones interactivos. Protegido con header `x-internal-secret` que
 * matchea AppSecret["edge_internal_secret"] — pensado para llamadas desde el
 * webhook, bot-ai, panel admin y jobs internos.
 *
 * Body:
 *   { to: "584141234567", body?: string, type?: "text"|"document"|"interactive",
 *     mediaUrl?: string, filename?: string, caption?: string,
 *     buttons?: [{id,title}], header?: string, footer?: string,
 *     organizationId?: string, conversationId?: string }
 *
 * Persiste el mensaje en WhatsAppMessage (direction=out) al enviar.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import {
  getSecret,
  sendText,
  sendDocument,
  sendInteractiveButtons,
} from "@/server/services/whatsapp-meta";

interface SendBody {
  to: string;
  body?: string;
  type?: "text" | "document" | "interactive";
  mediaUrl?: string;
  filename?: string;
  caption?: string;
  buttons?: Array<{ id: string; title: string }>;
  header?: string;
  footer?: string;
  organizationId?: string;
  conversationId?: string;
}

export async function POST(req: Request) {
  // ─── Auth interna ──────────────────────────────────────────────────────────
  const providedSecret = req.headers.get("x-internal-secret");
  const expectedSecret = await getSecret("edge_internal_secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.to) return NextResponse.json({ error: "Falta 'to'" }, { status: 400 });

  const type = body.type ?? "text";
  let result;
  let storedBody = body.body ?? "";

  if (type === "document") {
    if (!body.mediaUrl) return NextResponse.json({ error: "Falta mediaUrl" }, { status: 400 });
    result = await sendDocument({
      to: body.to,
      mediaUrl: body.mediaUrl,
      filename: body.filename,
      caption: body.caption,
    });
    storedBody = body.caption
      ? `[document:${body.filename ?? "doc"}] ${body.caption}`
      : `[document:${body.filename ?? "doc"}] ${body.mediaUrl}`;
  } else if (type === "interactive") {
    if (!body.body || !body.buttons?.length) {
      return NextResponse.json({ error: "Falta body o buttons" }, { status: 400 });
    }
    result = await sendInteractiveButtons({
      to: body.to,
      body: body.body,
      buttons: body.buttons,
      header: body.header,
      footer: body.footer,
    });
    storedBody = `[interactive] ${body.body}`;
  } else {
    if (!body.body) return NextResponse.json({ error: "Falta body" }, { status: 400 });
    result = await sendText({ to: body.to, body: body.body });
  }

  // ─── Persistir mensaje saliente ────────────────────────────────────────────
  if (result.success && body.conversationId) {
    try {
      await db.whatsAppMessage.create({
        data: {
          conversationId: body.conversationId,
          direction: "out",
          body: storedBody,
          msgType: type,
          wamId: result.externalId ?? null,
          status: "sent",
          channel: "whatsapp",
        },
      });
    } catch (err) {
      console.error("[whatsapp/send] persist error:", err);
    }
  }

  return NextResponse.json(result, { status: result.success ? 200 : 502 });
}
