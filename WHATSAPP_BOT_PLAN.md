# Bot WhatsApp ResidIA — Plan de implementación

> Stack: Next.js 14 App Router + tRPC + Prisma + Supabase Postgres + Vercel.
> NO usamos Supabase Edge Functions ni Deno — toda la lógica vive en
> `src/app/api/whatsapp/*` como API Routes. Adaptado del blueprint
> `BLUEPRINT_BOT_WHATSAPP.md` (que asumía Supabase Edge).

---

## 1. Arquitectura adaptada al stack

```
   Meta WhatsApp Cloud API
            │
            │ webhook  (GET handshake / POST mensajes)
            ▼
   /api/whatsapp/webhook       ← Next.js Route (App Router)
        │  - dedup por wamId
        │  - upsert WhatsAppConversation
        │  - identifica residente por Person.whatsapp
        │  - enruta: handoff → menu → FAQ → bot-ai
        │
        │  fetch interno (header x-internal-secret)
        ▼
   /api/whatsapp/bot-ai        ← cerebro Gemini 2.5 Flash
        │  - construye FACTS del residente (recibos, deuda, BCV)
        │  - responseSchema JSON: { reply, action, documentType?, refId? }
        │  - action ∈ {answer, clarify, handoff, send_document}
        │
        │  resultado
        ▼
   /api/whatsapp/send          ← outbound (Meta Cloud API v22)
        │  - text | document | interactive
        │  - persiste WhatsAppMessage (direction=out)
        │  - llamable desde panel admin (handoff humano)
```

### Tablas creadas (Prisma)

| Modelo | Para qué |
|---|---|
| `WhatsAppConversation` | Estado por usuario (waId+channel). Mode bot/agent, currentMenu, track |
| `WhatsAppMessage` | Historial in/out con dedup por `wamId` |
| `WhatsAppBotConfig` | Config editable: welcome, menú, horarios, IA on/off, persona, prompt |
| `WhatsAppMenuOption` | Árbol de menú interactivo (parentId) |
| `WhatsAppFaq` | FAQ con keywords array para matching |
| `WhatsAppTicket` | Casos escalados a humano |
| `WhatsAppEvent` | Telemetría (faq_hit, ai_answer, handoff, document_sent…) |
| `WhatsAppFeedback` | Resultados CSAT |
| `AppSecret` | Almacén editable de tokens (Meta, gemini, internal_secret…) |

Todas las tablas tenant tienen `organizationId`. La conversation es única por
`(waId, channel)` para reusar la familia para Instagram en el futuro.

---

## 2. Identificación del residente

El webhook usa **`Person.whatsapp`** (y `Person.phone` como fallback) para
identificar al residente por el `from` del payload Meta. Si matchea:

- Se vincula `personId`, `unitId`, `communityId` a la `WhatsAppConversation`.
- El bot-ai accede a SUS recibos, pagos y deuda (filtros por `unitId`).
- Nunca menciona datos de otra unidad.

Si NO matchea (número no registrado): el bot pide que confirme apartamento +
nombre completo, sin dar ningún dato sensible.

---

## 3. Flujo conversacional (resumen)

```
inbound msg
  ├─ dedup por wamId  (Meta reintenta)
  ├─ resolver Organization (por persona.whatsapp; sino bot habilitado)
  ├─ identificar Person + Unit por número
  ├─ upsert WhatsAppConversation
  ├─ persistir WhatsAppMessage (in)
  │
  ├─ mode == "agent"? → no responder (humano atiende)
  ├─ "agente|humano|reclamo|disputa"? → handoff + ticket
  ├─ saludo / "menú" / sin welcomedAt? → mensaje de bienvenida personalizado
  ├─ sin Person? → pedir identificación
  ├─ FAQ match (keywords)? → responder con FAQ
  └─ /api/whatsapp/bot-ai → IA con FACTS
        ├─ action="answer"        → enviar reply
        ├─ action="clarify"       → repreguntar
        ├─ action="handoff"       → cambiar mode=agent + crear ticket
        └─ action="send_document" → enviar PDF de recibo (refId=invoiceId)
```

---

## 4. Reglas críticas implementadas

1. **No inventa.** El system prompt del bot-ai incluye los FACTS de la BD; si la
   info no está en FACTS, debe responder "no tengo ese dato".
2. **Recibos solo a petición.** El bot NO envía PDFs no solicitados. Solo si el
   residente lo pide expresamente y el LLM determina `action="send_document"`.
3. **Dinero / disputa → handoff.** El prompt obliga a escalar cualquier reclamo
   de cobro, pago no reconocido o pregunta legal.
4. **Privacidad multi-residente.** Solo se exponen datos del Person identificado
   por el número del remitente.
5. **Webhook 200 siempre.** Para que Meta no reintente; los errores se loguean.
6. **Multi-tenant.** Toda tabla tiene `organizationId`. La conversación se
   asocia al Organization correspondiente al residente.
7. **Modo "dry-run" automático.** Si no están los secretos de Meta, los `sendText`
   loguean en consola sin llamar a la API (útil para dev local).

---

## 5. Secretos que el dueño debe pegar

Pegarlos en la tabla `AppSecret` desde el panel admin (cuando exista) o vía SQL
directo en Supabase SQL Editor. Como fallback se leen de variables de entorno
en MAYÚSCULAS.

| key (AppSecret) | env fallback | qué es |
|---|---|---|
| `whatsapp_token` | `WHATSAPP_TOKEN` | System User token permanente de Meta (no expira) |
| `whatsapp_phone_number_id` | `WHATSAPP_PHONE_NUMBER_ID` | ID del número en Meta |
| `whatsapp_verify_token` | `WHATSAPP_VERIFY_TOKEN` | Token que tú inventas para el handshake GET |
| `edge_internal_secret` | `EDGE_INTERNAL_SECRET` | Compartido webhook ↔ bot-ai ↔ send |
| `gemini_token` | `GEMINI_API_KEY` | API key Gemini 2.5 Flash |

**Pegado via SQL (ejemplo):**
```sql
INSERT INTO "AppSecret"(key, value, "updatedAt") VALUES
 ('whatsapp_token', '"EAAxxxxxxxxxxxx"'::jsonb, NOW()),
 ('whatsapp_phone_number_id', '"123456789012345"'::jsonb, NOW()),
 ('whatsapp_verify_token', '"mi_verify_secreto_2026"'::jsonb, NOW()),
 ('edge_internal_secret', '"un_secreto_largo_y_aleatorio"'::jsonb, NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW();
```

---

## 6. Setup en Meta (alta del webhook)

1. **Meta for Developers** → crear app de tipo Business → producto WhatsApp.
2. Sección **WhatsApp → API Setup**:
   - Tomar el `Phone Number ID` (lo pegas como `whatsapp_phone_number_id`).
   - Generar **token permanente** vía **System User** (Business Manager →
     Users → System Users → crear → asignar app y permisos
     `whatsapp_business_messaging` + `whatsapp_business_management`).
3. Sección **Configuration → Webhooks**:
   - Callback URL: `https://condominios-theta.vercel.app/api/whatsapp/webhook`
   - Verify Token: el mismo string que pegaste como `whatsapp_verify_token`.
   - Suscribir el campo **`messages`**.
4. **Business Verification** para pasar de modo prueba (solo testers) a público.
   ⏳ Trámite con Meta, puede tardar días.
5. Probar con un número de prueba que Meta da gratis.

---

## 7. FACTS específicos para ResidIA

El system prompt del bot-ai en `bot-ai/route.ts` inyecta automáticamente para
cada residente identificado:

- Nombre + cédula
- Unidad (código, piso, torre, alícuota)
- Comunidad + cuota mensual fija
- Días de vencimiento del recibo
- Porcentaje de Fondo de Reserva configurado
- Tasa BCV vigente (USD/VES + fecha + source)
- **Saldo deudor actual** (totalInvoiced - totalPaid)
- Últimos 6 recibos: número, período, total, pagado, pendiente, estado, vence, **invoiceId**
- Últimos 4 pagos: monto, método, referencia, fecha, paymentId

Cuando el residente pide "el recibo de junio", el LLM busca el `invoiceId` del
período correspondiente en la lista y devuelve
`{ action: "send_document", documentType: "invoice", refId: invoiceId }`.

---

## 8. Roadmap por fases

### Fase 0 — Infraestructura base (este commit)
- [x] Modelos Prisma (9 tablas: 8 whatsapp_* + AppSecret)
- [x] Migración SQL one-shot `/api/admin/apply-migration-whatsapp`
- [x] Servicio `whatsapp-meta.ts` (Cloud API v22, dry-run automático)
- [x] Webhook `GET` handshake + `POST` inbound con dedup
- [x] Identificación del residente por `Person.whatsapp`
- [x] Endpoint `bot-ai` con FACTS reales + `responseSchema` JSON
- [x] Endpoint `send` (text / document / interactive) protegido por internal secret
- [x] Routing: handoff → saludo → FAQ → bot-ai
- [x] Persistencia de mensajes y eventos
- [x] Tickets automáticos en handoff

### Fase 1 — MVP texto (próxima sesión)
- [ ] Crear app Meta + System User + token permanente
- [ ] Pegar secretos en `AppSecret`
- [ ] Aplicar migración SQL en Supabase (Editor o vía endpoint admin)
- [ ] Seed inicial: `WhatsAppBotConfig` para Los Arrayanes con persona "Resi"
- [ ] Seed inicial FAQ: tasa BCV, horarios oficina, cómo pagar, contacto
- [ ] Probar handshake del webhook desde Meta
- [ ] Probar pregunta "¿cuánto debo?" desde un número registrado

### Fase 2 — PDF de recibo a petición
- [ ] Endpoint público firmado `/api/whatsapp/invoice-pdf/{id}?token=...`
  - Token corto-vivo (5 min) firmado con `edge_internal_secret`
  - Valida que el invoice corresponda al residente del waId
- [ ] Implementar `getInvoicePdfUrl` en `webhook/route.ts`
- [ ] Probar `action="send_document"` con un recibo real

### Fase 3 — Menú interactivo
- [ ] Seed de `WhatsAppMenuOption` (root: facturas, pagos, BCV, mantenimiento, agente)
- [ ] Handler de mensajes `interactive` (button_reply / list_reply) en webhook
- [ ] Enviar menú con `sendInteractiveButtons` en el saludo de bienvenida

### Fase 4 — Envío masivo mensual
- [ ] Cron `/api/cron/whatsapp-monthly-receipts` (día 1 cada mes, post-emisión)
- [ ] Para cada unidad con Person.whatsapp: enviar template aprobado de Meta
  ("Hola {nombre}, ya está disponible tu recibo de {mes}. Saldo: ${monto}. Responde 'recibo' para recibir el PDF.")
- [ ] Aprovecha la ventana de 24h: cuando el residente responde "recibo", el bot
  responde gratis con el PDF.

### Fase 5 — Panel admin
- [ ] tRPC router `botRouter` para CRUD de `WhatsAppBotConfig`, `WhatsAppMenuOption`, `WhatsAppFaq`
- [ ] Bandeja de soporte: tomar conversación (mode=agent), responder
- [ ] Tickets: lista, prioridad, marcar resuelto
- [ ] KPIs: lectura de `WhatsAppEvent` (CSAT, % escalado, tasa de resolución)

### Fase 6 — CSAT + janitor
- [ ] Cron `/api/cron/whatsapp-janitor` (cada 5 min)
- [ ] Por cada conversación con `answeredAt` y sin `csatSent`:
  - Pasados `idleWarnMinutes` → enviar aviso "¿algo más?"
  - Pasados `idleCloseMinutes` → cerrar + enviar CSAT (botones de estrellas)

### Fase 7 — Multi-canal (Instagram)
- [ ] `/api/instagram/webhook` reusando `bot-ai` con `channel="instagram"`
- [ ] Misma familia de tablas — solo cambia el campo `channel`

---

## 9. Cómo testear localmente sin Meta

El sistema entra automáticamente en modo **dry-run** si no hay
`whatsapp_token` ni `whatsapp_phone_number_id` configurados. Los mensajes
salientes loguean en consola pero persisten en la BD.

### Test del webhook inbound (simulación)

```bash
# Aplicar la migración primero (solo una vez)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://condominios-theta.vercel.app/api/admin/apply-migration-whatsapp

# Configurar al menos el internal secret y opcionalmente Gemini en .env.local
# para correr local:
#   EDGE_INTERNAL_SECRET=test-internal
#   GEMINI_API_KEY=tu-key

# Simular un inbound de Meta:
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "test-org",
      "changes": [{
        "field": "messages",
        "value": {
          "messaging_product": "whatsapp",
          "metadata": { "phone_number_id": "123" },
          "messages": [{
            "id": "wamid.test.001",
            "from": "584141234567",
            "type": "text",
            "text": { "body": "Hola, ¿cuánto debo?" }
          }]
        }
      }]
    }]
  }'
```

### Test del handshake GET

```bash
# Antes setea AppSecret['whatsapp_verify_token']='mi_token'
curl "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=mi_token&hub.challenge=hola"
# → debe imprimir "hola"
```

### Test directo del bot-ai

```bash
curl -X POST http://localhost:3000/api/whatsapp/bot-ai \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: test-internal" \
  -d '{
    "organizationId": "cmxxxx",
    "personId": "cmyyyy",
    "unitId": "cmzzzz",
    "question": "¿cuál es mi saldo?",
    "persona": "Resi",
    "track": "support"
  }'
```

---

## 10. Próximos pasos pendientes

1. **Aplicar la migración** vía `/api/admin/apply-migration-whatsapp` (una vez).
2. **Pegar secretos** en `AppSecret` (5 keys).
3. **Configurar webhook en Meta** apuntando a la URL de Vercel + verify token.
4. **Pasar Business Verification** de Meta.
5. **Crear WhatsAppBotConfig** para la org Los Arrayanes con persona "Resi" y
   prompt personalizado.
6. **Seed FAQ inicial** (tasa BCV, horarios, contactos).
7. **Implementar URL firmada** para el PDF del recibo (Fase 2).
8. **Tests E2E** con un número real registrado en Persons.

---

## 11. Archivos creados/modificados

```
prisma/schema.prisma                                       (modificado)
src/app/api/admin/apply-migration-whatsapp/route.ts        (nuevo)
src/app/api/whatsapp/webhook/route.ts                      (nuevo)
src/app/api/whatsapp/bot-ai/route.ts                       (nuevo)
src/app/api/whatsapp/send/route.ts                         (nuevo)
src/server/services/whatsapp-meta.ts                       (nuevo)
WHATSAPP_BOT_PLAN.md                                       (este doc)
```

El servicio `src/server/services/whatsapp.ts` (legacy con Wati/Twilio) queda
intacto — sigue siendo usado por `notifications.ts` para recordatorios
salientes. El nuevo bot conversacional vive aparte.
