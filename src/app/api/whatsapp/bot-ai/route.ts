/**
 * POST /api/whatsapp/bot-ai
 *
 * Cerebro IA del bot. Recibe el contexto del residente y la pregunta, consulta
 * FACTS reales del sistema (no inventa) y responde con { reply, action }.
 *
 * Auth: header `x-internal-secret` que matchea AppSecret["edge_internal_secret"].
 *
 * Acciones posibles:
 *   - answer        → responder normal
 *   - clarify       → repreguntar (no entendí)
 *   - handoff       → escalar a humano (dinero/disputa/legal/sensible)
 *   - send_document → enviar PDF del recibo (incluye documentType y refId)
 *
 * Modelo: Gemini 2.5 Flash con function calling (reusa patrón de gemini.ts).
 */
import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import type { Content } from "@google/genai";
import { db } from "@/server/db/client";
import { getSecret } from "@/server/services/whatsapp-meta";

interface BotAiInput {
  track?: "support" | "sales";
  question: string;
  history?: Array<{ role: "user" | "model"; content: string }>;
  persona?: string;
  personId?: string | null;
  unitId?: string | null;
  communityId?: string | null;
  organizationId: string;
  firstName?: string;
}

type BotAction = "answer" | "clarify" | "handoff" | "send_document";

interface BotAiOutput {
  reply: string;
  action: BotAction;
  documentType?: "invoice" | "voucher";
  refId?: string;
}

// ─── FACTS del residente ────────────────────────────────────────────────────

async function buildResidentFacts(params: {
  organizationId: string;
  personId?: string | null;
  unitId?: string | null;
}): Promise<string> {
  const { organizationId, personId, unitId } = params;

  if (!personId && !unitId) {
    return "(No identificado — no hay datos del residente disponibles.)";
  }

  const person = personId
    ? await db.person.findFirst({
        where: { id: personId, organizationId },
        select: {
          firstName: true, lastName: true, idType: true, idNumber: true,
          whatsapp: true, email: true,
          ownerships: {
            where: { endDate: null },
            select: {
              unit: {
                select: {
                  id: true, code: true, floor: true, tower: true,
                  aliquot: true,
                  community: { select: { id: true, name: true, monthlyFeeUsd: true } },
                },
              },
            },
            take: 1,
          },
          tenancies: {
            where: { endDate: null },
            select: {
              unit: {
                select: {
                  id: true, code: true, floor: true, tower: true,
                  community: { select: { id: true, name: true, monthlyFeeUsd: true } },
                },
              },
            },
            take: 1,
          },
        },
      })
    : null;

  const actualUnitId = unitId ?? person?.ownerships[0]?.unit.id ?? person?.tenancies[0]?.unit.id;
  if (!actualUnitId) {
    return person
      ? `Identificado: ${person.firstName} ${person.lastName} (sin unidad asignada).`
      : "(No identificado.)";
  }

  // Últimas 6 facturas no anuladas
  const invoices = await db.invoice.findMany({
    where: { unitId: actualUnitId, status: { not: "VOIDED" } },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
    take: 6,
    select: {
      id: true, invoiceNumber: true, periodYear: true, periodMonth: true,
      totalUsd: true, totalBss: true, paidUsd: true, paidBss: true,
      status: true, issuedAt: true, dueDate: true, type: true,
    },
  });

  // Últimos 4 pagos válidos
  const payments = await db.payment.findMany({
    where: { unitId: actualUnitId, voidedAt: null },
    orderBy: { paidAt: "desc" },
    take: 4,
    select: {
      id: true, amountUsd: true, amountBss: true, method: true,
      reference: true, paidAt: true,
    },
  });

  // Saldo total
  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
  const totalPaid = invoices.reduce((s, i) => s + Number(i.paidUsd), 0);
  const debtUsd = Math.max(0, totalInvoiced - totalPaid);

  // Tasa BCV vigente
  const rate = await db.exchangeRate.findFirst({
    orderBy: { date: "desc" },
    select: { vesPerUsd: true, date: true, source: true },
  });

  // Unidad + comunidad
  const unit = await db.unit.findUnique({
    where: { id: actualUnitId },
    select: {
      code: true, floor: true, tower: true, aliquot: true,
      community: { select: { name: true, monthlyFeeUsd: true, dueDaysAfterIssue: true, reserveFundPct: true } },
    },
  });

  const personName = person ? `${person.firstName} ${person.lastName}` : "Residente";

  const lines: string[] = [
    `RESIDENTE: ${personName}`,
    unit ? `UNIDAD: ${unit.code} (Piso ${unit.floor ?? "—"}, Torre ${unit.tower ?? "—"})` : "",
    unit ? `EDIFICIO: ${unit.community.name}` : "",
    unit ? `ALÍCUOTA: ${Number(unit.aliquot).toFixed(4)}%` : "",
    unit?.community.monthlyFeeUsd
      ? `CUOTA MENSUAL FIJA: $${Number(unit.community.monthlyFeeUsd).toFixed(2)}`
      : "",
    unit ? `DÍAS DE VENCIMIENTO: ${unit.community.dueDaysAfterIssue}` : "",
    unit ? `FONDO DE RESERVA: ${(Number(unit.community.reserveFundPct) * 100).toFixed(1)}%` : "",
    rate ? `TASA BCV (${rate.date.toISOString().slice(0, 10)}, ${rate.source}): Bs ${Number(rate.vesPerUsd).toFixed(2)} por USD` : "",
    `SALDO DEUDOR ACTUAL: $${debtUsd.toFixed(2)} USD`,
    "",
    "ÚLTIMOS RECIBOS:",
    invoices.length === 0
      ? "  (sin recibos emitidos)"
      : invoices.map((i) => {
          const pend = Number(i.totalUsd) - Number(i.paidUsd);
          return `  • ${i.invoiceNumber} | ${i.periodYear}-${String(i.periodMonth).padStart(2, "0")} | Total $${Number(i.totalUsd).toFixed(2)} | Pagado $${Number(i.paidUsd).toFixed(2)} | Pendiente $${pend.toFixed(2)} | Estado ${i.status} | Vence ${i.dueDate.toISOString().slice(0, 10)} | invoiceId=${i.id}`;
        }).join("\n"),
    "",
    "ÚLTIMOS PAGOS:",
    payments.length === 0
      ? "  (sin pagos registrados)"
      : payments.map((p) => `  • $${Number(p.amountUsd).toFixed(2)} | ${p.method} | ref:${p.reference ?? "—"} | ${p.paidAt.toISOString().slice(0, 10)} | paymentId=${p.id}`).join("\n"),
  ];

  return lines.filter(Boolean).join("\n");
}

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(persona: string, facts: string, track: string): string {
  return `Eres ${persona || "Resi"}, el asistente de WhatsApp del condominio.
Tu rol: ayudar al residente identificado a entender SU recibo, SU deuda, SU pago.

REGLAS CRÍTICAS — NO INVENTAR:
- Responde SOLO con los FACTS que te paso a continuación. No inventes montos, fechas ni números.
- Si el residente pregunta algo que no está en los FACTS, di que no tienes ese dato y ofrece pasar a un humano.
- Datos sensibles de OTRO residente (nombre, cédula, deuda ajena): NUNCA mencionar. action="handoff".
- Cualquier disputa de cobro, reclamo de dinero, pago no reconocido: action="handoff".
- Si el residente PIDE expresamente "el recibo", "el PDF", "el comprobante" de un mes específico:
    → action="send_document"
    → documentType="invoice"
    → refId = el invoiceId exacto del recibo del mes pedido (de la lista ÚLTIMOS RECIBOS).
    → reply = mensaje corto "Te envío el recibo de [mes] ahora mismo".
- NO envíes documentos no solicitados. Solo a petición explícita.
- Si la pregunta es confusa o ambigua → action="clarify" con un ejemplo.
- Para todo lo demás respondible con FACTS → action="answer".

ESTILO:
- Español venezolano, cálido, conciso. WhatsApp ≠ email: máximo 4-5 líneas.
- Usa $ para USD y Bs para bolívares.
- Llama al residente por su nombre cuando esté disponible.

TRACK ACTUAL: ${track}

═══════════════════════════════════════
FACTS DEL RESIDENTE (verificados de la BD):
═══════════════════════════════════════
${facts}
═══════════════════════════════════════

Responde SIEMPRE en JSON estructurado con el schema { reply, action, documentType?, refId? }.`;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth interna
  const provided = req.headers.get("x-internal-secret");
  const expected = await getSecret("edge_internal_secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: BotAiInput;
  try {
    input = (await req.json()) as BotAiInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!input.organizationId) {
    return NextResponse.json({ error: "Falta organizationId" }, { status: 400 });
  }
  if (!input.question) {
    return NextResponse.json({ error: "Falta question" }, { status: 400 });
  }

  // API key Gemini (puede estar en AppSecret o env)
  const apiKey = (await getSecret("gemini_token")) ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Fallback determinístico si no hay LLM disponible
    return NextResponse.json({
      reply: "Por ahora solo puedo recibir tu mensaje. Un agente humano te contactará pronto.",
      action: "handoff" as BotAction,
    } satisfies BotAiOutput);
  }

  const facts = await buildResidentFacts({
    organizationId: input.organizationId,
    personId: input.personId,
    unitId: input.unitId,
  });

  const persona = input.persona ?? "Resi";
  const track = input.track ?? "support";
  const systemInstruction = buildSystemPrompt(persona, facts, track);

  const client = new GoogleGenAI({ apiKey });

  const history: Content[] = (input.history ?? []).slice(-8).map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
  history.push({ role: "user", parts: [{ text: input.question }] });

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: history,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["reply", "action"],
          properties: {
            reply: { type: Type.STRING },
            action: {
              type: Type.STRING,
              enum: ["answer", "clarify", "handoff", "send_document"],
            },
            documentType: { type: Type.STRING, enum: ["invoice", "voucher"] },
            refId: { type: Type.STRING },
          },
        },
      },
    });

    const text = response.text ?? "";
    let parsed: BotAiOutput;
    try {
      parsed = JSON.parse(text) as BotAiOutput;
    } catch {
      parsed = {
        reply: text || "No pude procesar tu mensaje, ¿podrías reformularlo?",
        action: "clarify",
      };
    }
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[bot-ai] error:", err);
    return NextResponse.json({
      reply: "Disculpa, tuve un problema al procesar tu mensaje. Un agente te contactará.",
      action: "handoff" as BotAction,
    } satisfies BotAiOutput);
  }
}
