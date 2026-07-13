# Sistema de Gestión de Condominios — Venezuela

> Plataforma SaaS multi-tenant para administración de condominios en Venezuela.
> Vendible a múltiples organizaciones administradoras o juntas de condominio.

---

## 1. Visión del producto

**Modelo de negocio:** SaaS B2B. El dueño de la plataforma (super-admin) vende acceso a organizaciones (empresas administradoras o juntas directivas), cada una con uno o varios edificios.

**Diferenciadores para Venezuela:**
- Bimonetarismo nativo (BsS y USD en cada transacción)
- WhatsApp Business API como canal principal de comunicación
- PWA offline-first (resistente a cortes de luz e internet)
- Cumplimiento con Ley de Propiedad Horizontal venezolana

---

## 2. Jerarquía de tenancy

```
Platform                    (1)  ← dueño del SaaS (yo)
  └─ Organization           (N)  ← cliente que paga (admin company / junta)
      └─ Community          (N)  ← edificio/condominio
          └─ Unit           (N)  ← apartamento
              ├─ Ownership  (M)  ← propietario actual + histórico
              └─ Tenancy    (M)  ← inquilino actual + histórico
```

**Aislamiento de datos:** row-level security via `organizationId` + `communityId` en todas las tablas tenant. Middleware Prisma inyecta filtros automáticamente según sesión.

---

## 3. Stack tecnológico

| Capa | Tecnología | Razón |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript | SSR + PWA + un solo proyecto |
| UI | Tailwind CSS + shadcn/ui | Productividad y customizable |
| API | tRPC sobre Next.js | Type-safety end-to-end sin OpenAPI |
| ORM | Prisma 5 | Migraciones, type-safety, ya conocido en el entorno |
| DB | PostgreSQL 16 | ACID crítico para finanzas |
| Cache/Queue | Redis 7 + BullMQ | Tasas de cambio, sesiones, jobs async |
| Auth | NextAuth v5 (Auth.js) | Magic links + 2FA + multi-rol |
| Storage | MinIO (S3-compat) local / S3 prod | Documentos, fotos de tickets |
| Notif | WhatsApp Business API (Wati o Twilio) | Canal principal Venezuela |
| Tests | Vitest + Playwright | Unit + E2E |
| Deploy | Docker Compose → VPS | Sin lock-in cloud |

**Postgres en port 5435** (5434 está ocupado por proyecto comanda según memoria de usuario).
**Redis en port 6380.**

---

## 4. Roles del sistema

| Rol | Scope | Capacidades |
|---|---|---|
| `PLATFORM_OWNER` | Plataforma | Todo. Gestiona organizaciones y suscripciones |
| `PLATFORM_ADMIN` | Plataforma | Soporte. Lectura global, no facturación |
| `ORG_ADMIN` | Organization | Gestiona sus edificios, usuarios, facturación |
| `COMMUNITY_ADMIN` | Community | Administrador del edificio: alícuotas, gastos, residentes |
| `BOARD_MEMBER` | Community | Junta: aprueba gastos, ve reportes, convoca asambleas |
| `OWNER` | Unit(s) | Ve sus facturas, paga, abre tickets, reserva amenities |
| `TENANT` | Unit | Igual que OWNER pero sin propiedad |
| `SECURITY` | Community | Registra visitantes y accesos |

---

## 5. Roadmap por fases

### ✅ Fase 0 — Bootstrap (en curso)
- Estructura del repo, CLAUDE.md, docker-compose, Prisma init
- Schema multi-tenant base

### Fase 1 — Core multi-tenant + Auth (Opus)
- Modelos: Platform, Organization, Subscription, Community, Unit, User, Person, Ownership, Tenancy
- Auth con NextAuth (magic links + 2FA)
- Middleware de aislamiento por tenant
- Panel super-admin (CRUD de organizaciones y suscripciones)
- Panel admin de organización (CRUD de edificios y usuarios)
- Audit log global

### Fase 2 — Finanzas (Opus — crítico)
- Configuración de alícuotas por unidad
- Registro de gastos comunes con prorrateo
- Generación masiva de facturas mensuales
- API de tasa de cambio (BCV oficial + paralelo Binance P2P)
- Doble moneda en todas las transacciones (BsS + USD + tasa aplicada)
- Registro de pagos multi-método (transferencia, efectivo USD, Zelle, Pago Móvil, criptomonedas)
- Conciliación bancaria
- Aging de cartera (0-30, 31-90, 90+)
- Presupuesto anual vs ejecución
- Fondo de reserva

### Fase 3 — Mantenimiento (Sonnet)
- Work orders: residente abre ticket con foto
- Estados: OPEN → ASSIGNED → IN_PROGRESS → COMPLETED
- SLA por prioridad
- Base de contratistas con calificaciones
- Mantenimiento preventivo programado

### Fase 4 — Comunicación (Sonnet)
- WhatsApp Business API integration
- Templates editables (recordatorio cobro, aviso, confirmación pago)
- Email de respaldo
- Tablero de anuncios in-app
- Centro de notificaciones por usuario

### Fase 5 — Seguridad y acceso (Sonnet)
- Pre-autorización de visitantes por residente
- Log de accesos con código temporal
- Reporte de violaciones del reglamento
- Multas integradas a la facturación

### Fase 6 — Gobernanza (Sonnet)
- Junta directiva con períodos
- Convocatoria a asambleas
- Votación electrónica con quórum
- Generación PDF de actas y certificados de no-adeudo
- Repositorio documental versionado

### Fase 7 — Reportes y BI (Sonnet/Opus según complejidad)
- Dashboards por rol
- Exportación PDF/Excel
- Estados financieros
- KPIs de cobranza, mantenimiento, ocupación

---

## 6. Decisiones arquitectónicas clave

### 6.1 Doble moneda en cada transacción
Toda tabla con monto guarda **5 campos**:
```
amountBss        Decimal(18, 2)
amountUsd        Decimal(18, 2)
exchangeRate     Decimal(18, 8)   ← tasa al momento
exchangeSource   Enum             ← BCV | BINANCE_P2P | MANUAL
currencyPrimary  Enum             ← VES | USD (cuál fue la primaria al registrar)
```

**Regla:** nunca calcular conversiones al vuelo en lecturas. Siempre guardar ambos al escribir.

### 6.2 Aislamiento multi-tenant
- Toda tabla tenant tiene `organizationId` y opcionalmente `communityId` (no-null en tablas comunitarias)
- Prisma middleware (`src/server/db/tenant-middleware.ts`) inyecta filtros según sesión
- `PLATFORM_OWNER` puede pasar contexto vacío para ver todo
- Tests obligatorios de aislamiento antes de mergear cualquier feature

### 6.3 Auditoría
- Tabla `AuditLog` global con `actorId`, `action`, `entityType`, `entityId`, `before` (JSONB), `after` (JSONB), `ip`, `userAgent`, `createdAt`
- Toda escritura financiera genera audit log automático
- Pagos nunca se eliminan, solo se marcan `voidedAt` con razón

### 6.4 Soft delete
- `deletedAt` en entidades importantes (Unit, User, Community)
- Nunca eliminar Invoice, Payment, Expense, AuditLog (legal)

### 6.5 Decimales
- **Siempre** `Decimal` de Prisma, nunca `Float`. Precisión `(18, 2)` para montos, `(18, 8)` para tasas.

---

## 7. Estructura del repositorio

```
condominios/
├── CLAUDE.md                    ← este archivo
├── README.md                    ← cómo arrancar
├── docker-compose.yml           ← Postgres + Redis + MinIO
├── package.json
├── tsconfig.json
├── next.config.mjs
├── .env.example
├── prisma/
│   ├── schema.prisma            ← modelo de datos
│   ├── migrations/
│   └── seed.ts                  ← datos demo
├── docs/
│   └── decisions/               ← ADRs
├── src/
│   ├── app/                     ← Next.js App Router
│   │   ├── (auth)/              ← login, registro
│   │   ├── (platform)/          ← super admin
│   │   ├── (org)/               ← admin de organización
│   │   ├── (community)/         ← admin de edificio + portales residente
│   │   └── api/                 ← API routes (auth, webhooks, trpc)
│   ├── server/
│   │   ├── auth/                ← NextAuth config
│   │   ├── db/                  ← Prisma client + tenant middleware
│   │   ├── services/            ← lógica de negocio (extraíble a backend separado)
│   │   │   ├── billing/
│   │   │   ├── exchange/
│   │   │   ├── communication/
│   │   │   └── ...
│   │   └── trpc/                ← routers tRPC
│   ├── lib/                     ← utilidades cliente y servidor
│   ├── components/              ← UI (shadcn + custom)
│   └── workers/                 ← BullMQ workers (proceso aparte)
└── tests/
    ├── unit/
    └── e2e/
```

---

## 8. Convenciones

- **Idioma:** UI y mensajes a usuario en **español**. Código, identificadores, comentarios técnicos en **inglés**.
- **Money type:** crear `src/lib/money.ts` con type `Money { bss, usd, rate, source }`. Nunca pasar números pelados de monto entre capas.
- **No formatear en backend.** El backend devuelve `Decimal` como string; el frontend formatea con `Intl.NumberFormat('es-VE')`.
- **Testing:** lógica financiera y de aislamiento multi-tenant tiene cobertura obligatoria.
- **Migrations:** siempre revisar el SQL generado por Prisma antes de aplicar en prod.

---

## 9. Asignación de modelos Claude

| Tarea | Modelo |
|---|---|
| Schema BD, arquitectura multi-tenant | **Opus 4.7** |
| Lógica financiera (alícuotas, prorrateo, doble moneda, conciliación) | **Opus 4.7** |
| Auth + middleware de tenancy | **Opus 4.7** |
| CRUD genéricos, componentes UI, integraciones simples | **Sonnet 4.6** |
| Debugging complejo, refactors críticos | **Opus 4.7** |
| Investigación, documentación, scripts de setup | **Sonnet 4.6** |

---

## 10. Variables de entorno

Ver `.env.example`. Críticas:

- `DATABASE_URL` — Postgres (port 5435 local)
- `REDIS_URL` — Redis (port 6380 local)
- `NEXTAUTH_SECRET` — generar con `openssl rand -base64 32`
- `NEXTAUTH_URL` — base URL de la app
- `BCV_API_URL` — endpoint de tasa BCV (definir proveedor)
- `BINANCE_P2P_API_URL` — endpoint paralelo
- `WHATSAPP_PROVIDER` — `WATI` | `TWILIO` (Fase 4)
- `WHATSAPP_TOKEN` — token del proveedor
- `S3_*` — credenciales MinIO local o S3 prod

---

## 11. Comandos comunes

```bash
# Setup inicial
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev

# Después de cambiar schema.prisma
pnpm db:migrate

# Crear migración nueva
pnpm prisma migrate dev --name describe_change

# Reset DB (solo dev)
pnpm prisma migrate reset
```

---

## 12. Estado actual

- [x] Investigación de mercado y planificación
- [x] CLAUDE.md y estructura del repo
- [x] **Fase 1 (Opus):** schema multi-tenant + auth + panel super-admin (CRUD orgs/planes) + panel ORG_ADMIN (CRUD edificios/unidades). Verificado end-to-end.
- [x] **Fase 2 (Opus):** finanzas core
  - Schema: Expense, Invoice, InvoiceItem, Payment, PaymentAllocation, BankAccount, Budget, BudgetItem
  - Algoritmo de prorrateo (Hamilton/largest remainder) con 9 tests unitarios — suma exacta garantizada
  - Servicio de tasas: fetch BCV vía dolarapi.com + tasa manual + caché diario en DB
  - Doble moneda: cada transacción guarda BsS + USD + tasa + fuente
  - Facturación masiva mensual (transaccional, audita, marca gastos como facturados)
  - Pagos multi-método con asignación a múltiples facturas, anulación auditada
  - Aging de cartera (0-30 / 31-60 / 61-90 / 90+)
  - UI completa en `/org/communities/[id]/finance/{,expenses,invoices,payments}`
  - Test E2E: 4 unidades · 3 gastos ($333.33) · 4 facturas emitidas · 2 pagos (parcial+total) · aging exacto
- [x] **Fase 3 (Sonnet):** pisos/torres + ingresos + estado de cuenta + work orders + residentes + vehículos
  - Schema: `floor`, `tower` en Unit; `floorsCount`, `towersCount` en Community
  - Modelo `Income` con `IncomeCategory` (HALL_RENTAL, PARKING_FEE, GUEST_FEE, INTEREST, DONATION, PENALTY, OTHER)
  - Modelo `WorkOrder` + `WorkOrderActivity` + `Contractor`
  - Modelo `Vehicle` con `VehicleType` (CAR, MOTORCYCLE, TRUCK, VAN, OTHER)
  - BCV scraper: scraping directo de www.bcv.org.ve con regex (igual que comanda) — reemplaza dolarapi.com
  - Router `maintenance.*` (contractors CRUD, workOrders CRUD + notas + cambio de estado)
  - Router `org.persons.*` (list, create, update, assignOwner, assignTenant, bulkImport)
  - Router `org.vehicles.*` (list, create, update)
  - Router `org.units.detail` — detalle completo: propietarios, inquilinos, vehículos, facturas, pagos
  - UI: Residentes (tabla + importación CSV), detalle de Unidad completo, Ingresos, Estado de cuenta, Mantenimiento
  - Importación CSV/Excel: plantilla descargable, preview, bulk import con upsert
  - Filtro por piso/torre en página de Unidades; link "Ver" por unidad → detalle
- [x] **Fase 4 (Sonnet):** comunicación WhatsApp
  - Schema: WhatsAppTemplate (upsertable por evento), Notification (IN_APP + WHATSAPP), Announcement
  - Servicio whatsapp.ts: abstracción Wati/Twilio con dry-run automático sin credenciales
  - Servicio notifications.ts: notifyPerson, notifyCommunity, buildDefaultBody por evento
  - Notificaciones automáticas al emitir facturas (INVOICE_ISSUED) y registrar pagos (PAYMENT_RECEIVED)
  - Router notifications: inbox, unreadCount, markRead, markAllRead, communityHistory, sendPaymentReminders, templates CRUD, announcements CRUD
  - UI: NotificationBell en header (badge contador + dropdown), página /communication con tabs Anuncios/Recordatorios/Templates/Historial
- [x] **Fase 7 (Sonnet):** reportes y dashboard
  - Router `reports`: communitySummary, financialTrend, invoicesExport, topDebtors
  - Dashboard con KPI cards (facturado, cobrado, pendiente, % cobranza, unidades)
  - Gráfica Facturado vs Cobrado — 12 meses (recharts BarChart)
  - Aging de cartera donut (PieChart con 5 buckets)
  - Gráfica Gastos vs Ingresos extra — 12 meses
  - Work orders barras de progreso
  - Top deudores con barra visual de deuda relativa
  - Exportación Excel directa en browser (xlsx/SheetJS) con propietario, email, montos
- [x] **Fase 5 (Sonnet):** seguridad y acceso
  - Schema: `Visitor` (pre-autorización), `AccessLog` (log de todos los accesos), `Violation` (infracciones al reglamento)
  - Enums: `VisitorStatus`, `ViolationType`
  - Router `security.*`: visitors CRUD + check-in/check-out/deny, accessLog list + registerWalkIn, violations report + applyFine + resolve
  - Multas integradas a facturación (tipo FINE): desde detalle de unidad y desde módulo de violaciones
  - Cuota mensual configurable: `setMonthlyFee` en org router, panel en Finanzas → Configuración
  - Reportes mensuales/trimestrales/semestrales: selector de período + gráfica + KPIs en página Reportes
  - Edificio "Residencias Hugo Chávez Frías": 40 unidades (pisos 1–10, aptos A–D), alícuota 2.5%
  - UI: `/security` con tabs Visitantes / Log de accesos / Violaciones
- [x] **Fase 6 (Sonnet):** gobernanza
  - Schema: `BoardMember`, `Assembly`, `AssemblyAgendaItem`, `AssemblyVote`, `CommunityDocument`
  - Enums: `BoardRole`, `AssemblyStatus`, `VoteChoice`, `DocumentCategory`
  - Servicio `pdf.ts`: `generateAssemblyMinutesPdf` + `generateNonDebtCertPdf` con @react-pdf/renderer
  - Router `governance.*`: board CRUD, assemblies CRUD + votación + cierre + PDF, nonDebtCert, documents CRUD
  - UI: `/governance` con 4 tabs — Junta Directiva / Asambleas / Documentos / Certificados
  - PDF acta se descarga en base64 desde el cliente; certificado de solvencia con estado de deuda real
- [x] **Sesión prod (Sonnet):** seeding Los Arrayanes + fix auth + admin panel + cuota bug
  - Seed: 188 unidades (2 torres, 23 pisos × 4 aptos + 2 PH), 10 propietarios de prueba, cuota $20
  - Auth fix: hash bcrypt actualizado en Supabase SQL Editor (era argon2id del seed original)
  - Org isolation: PLATFORM_OWNER ve todas las orgs; ORG_ADMIN solo ve sus memberships (ya funcionaba)
  - `platform.organizations.listAdmins / createAdmin / removeAdmin`: panel para asignar admins por org
  - UI en `/platform/organizations/[id]`: card "Administradores" con form inline + revocación
  - OrgContext fix: `useEffect` → `useLayoutEffect` (evita race condition del selectedOrgId inicial)
  - org.ts fix: `byId`, `update`, `setMonthlyFee` omiten filtro `organizationId` para PLATFORM_OWNER
  - finance page: optimistic update de cuota con `utils.org.communities.byId.setData` + `new Decimal(val)`
- [x] **Sesión independencia admin (Sonnet):** todo configurable sin código
  - Importación masiva 9 tipos: unidades, residentes, migración, facturas, gastos, pagos, vehículos, contratistas, presupuesto
  - Migración: sharePercent + fechaInicio en ownership + co-propietarios
  - Sidebar: nueva navegación con sección ⬆️ Importar datos
  - Edit unit: botón ✏️ por fila → dialogo edita alícuota, torre, piso, área, habitaciones, etc.
  - Cambio de contraseña: org.changePassword (bcrypt) + UI en /org/settings
  - Community.dueDaysAfterIssue: días de vencimiento configurables (Finanzas > Configuración)
  - Expense.customCategory: etiqueta libre cuando category = OTHER (Piscina, Pintura, etc.)
  - Invoices page: usa dueDaysAfterIssue del condominio en lugar de día-5 fijo
  - Patrón migración one-shot: crear `/api/admin/apply-migration`, desplegar, llamar con curl, borrar y redesplegar
  - PDFs ya usan nombre/RIF/dirección/teléfono del condominio (editar en página del edificio)
- [x] **Sesión features cliente (Sonnet):** 16 mejoras aprobadas en reunión — migración v3 aplicada en Supabase
  - **Schema v3:** `Expense.towerScope/isIndividual/targetUnitId`, `Income.customCategory/affectsInvoice`, nuevo modelo `RecurringExpenseTemplate`
  - **issueMonthlyInvoices:** prorrateo por torre (towerScope), cargo individual a unidad (isIndividual+targetUnitId), descuento de ingresos con affectsInvoice=true
  - **Gastos page:** filtros por categoría/torre/estado, nuevo campo torre/individual en form, tab "Plantillas recurrentes" con CRUD + botón "Aplicar al mes"
  - **Ingresos page:** toggle `affectsInvoice`, `customCategory` cuando category=OTHER, banner de descuento activo
  - **Facturas page:** fila expandible muestra total del gasto origen + alícuota aplicada + parte de la unidad
  - **Estado de cuenta:** 3 vistas — Estado clásico / Deuda por mes (desglose con días de mora) / Libro contable (Debe/Haber/Saldo)
  - **BCV:** scraper directo bcv.org.ve como fuente primaria; setManualRate actualiza también entrada BCV del día
  - **Exchange.ts:** fetchBcvScrape primero, pydolarve segundo, dolarapi tercero; open.er-api.com eliminado
  - Commits: `5eab7ca` (16 features), `8551957` (migración ejecutada y cerrada)
- [x] **Sesión conciliación + exports (Sonnet):** features 2-4, 7, 8, 10 del cliente — migración v4 aplicada
  - **Feature 2:** Botón "🏭 Registrar como gasto" en filas sin conciliar → dialogo pre-rellenado (comisiones bancarias, retenciones)
  - **Feature 3:** Workflow pagos no identificados — botón "📦 Aparcar", tab "No identificados" con lista pendientes/asignados, botón "Asignar" crea Payment y marca el entry como procesado. Schema: nuevo modelo `UnidentifiedPayment` (migración v4 ejecutada en Supabase)
  - **Feature 4:** Badge de tipo de match por fila conciliada (Ref exacta / Ref parcial / Por monto) + leyenda visual. Antes solo había ✅/⚠️
  - **Feature 7:** Toggle "También registrar como ingreso" en dialogo de pago — `alsoCreateIncome` llama `registerIncome` con misma referencia. Útil para depósito que es simultáneamente pago de cuota + ingreso extra
  - **Feature 8:** Exportación por módulo (Gastos / Ingresos / Pagos) con rango personalizable desde/hasta. Router: `reports.expensesExport`, `reports.paymentsExport`, `reports.incomeExport`
  - **Feature 10:** `reports.firstRecords` devuelve primer período de cada módulo; selectores de año en Reportes parten desde el primer dato en BD; botón "⏮ Desde inicio" auto-rellena rango
  - Commits: `285b23c` (features 2-4, 7), `4ef9211` (features 8, 10)
- [x] **Sesión bugfixes portal + cargo directo (Sonnet):** dos bugs corregidos
  - **Bug NaN portal (Pendientes tab):** `portal.ts` devuelve campo `pendingUsd` pero `portal/page.tsx` declaraba `pendingAmountUsd` en el tipo → `Number(undefined) = NaN`. Fix: renombrar a `pendingUsd` en el tipo `PendingInvoiceItem` y en los 3 usos (líneas 49, 481, 544, 546).
  - **Bug gasto individual post-emisión:** `issueMonthlyInvoices` lanza CONFLICT si ya hay facturas en el período → gastos individuales añadidos DESPUÉS quedan atascados como "Pendiente". Fix: nueva mutación `expenses.issueDirectCharge` que crea un `EXTRA_FEE` directamente a la unidad target y marca el gasto como `invoicedAt=now`. En la tabla de gastos aparece botón "⚡ Emitir cargo" solo para gastos `isIndividual=true` que estén pendientes.
  - Archivos: `src/app/portal/page.tsx`, `src/server/trpc/routers/finance.ts`, `src/app/org/communities/[id]/finance/expenses/page.tsx`
- [x] **Sesión demo Castaños B + provisiones + branding (Opus, 2026-06-15):** marca = ResidIA
  - **Onboarding Castaños B (Conjunto Residencial Parque Paraíso, El Paraíso, Caracas):** 1 sola torre (Torre B). `communityId=cmoukqntu00015niqpsjlu4cw`. RIF J-31004934-3. 94 unidades reales (B-011 a B-234 + B-PH1/B-PH2), alícuota 1.06383% normal / 2.12766% PH. Cuota base ~$29.38.
  - **Selector de torre dinámico:** deriva torres reales de las unidades. Si solo hay 1 torre, oculta el selector y trata todo como General. `registerExpense` normaliza `towerScope=null` si el edificio tiene 1 sola torre. (`finance/expenses/page.tsx`, `invoicing.ts`)
  - **Re-emisión de período:** `finance.invoices.reissueMonth` anula facturas activas (si NINGUNA tiene pagos) + reabre Expenses + re-emite. Botón "🔄 Re-emitir período" en página de Recibos. Banner ámbar en Gastos cuando hay pendientes en período ya emitido.
  - **Gastos extraordinarios post-emisión:** se quitó el bloqueo CONFLICT de `registerExpense`. Ahora se permite cargar gasto común después de emitir (caso "se dañó el ascensor"); queda Pendiente y el preview lo proyecta.
  - **Provisiones — lógica REAL-FIRST (CRÍTICO, cambió 2 veces):** Modelo final: si hay gasto `REGULAR` vinculado a plantilla `isProvision` → SE COBRA el real y la `PROVISION_BASE` de esa plantilla NO se cobra (evita doble). Si no hay real → se cobra la base estimada (fallback). **`PROVISION_ADJUSTMENT` ELIMINADO** — ya no se calcula ajuste, el real es el cobro final. Aplica en `previewReceiptPdf` y `issueMonthlyInvoices`. Badge verde "🔗 Real de X (se cobra)".
  - **Shift post-mes:** `Community.invoicePeriodShift` (default 1). shift=1 → recibo de julio cobra gastos cargados en junio (práctica venezolana). `previewReceiptPdf` e `issueMonthlyInvoices` calculan `expensePeriodYear/Month = period - shift`. Toggle en config del edificio.
  - **Logo personalizable:** `Community.logoUrl` (string). `<Image>` 56×56 arriba-izq del header del recibo PDF (`pdf.ts`, fix de `logoBox` con `flex:1` por header desfasado). Input URL + preview en `/org/communities/[id]`.
  - **Privacidad deuda general portal:** la tabla "Deuda General" del portal ya NO muestra nombres, solo apartamento + monto + meses. (`portal.ts` no envía `ownerName`, `portal/page.tsx`)
  - **Envío masivo emails:** `finance.invoices.sendEmailAllAtOnce` procesa hasta 500 facturas en lotes de 10 concurrentes (~40s/188). Botón verde "🚀 Enviar TODOS" junto al lote de 40.
  - **Onboarding obligatorio portal:** modal full-screen bloqueante en primer ingreso si falta WhatsApp/email/nombre. `portal.updateOwnProfile` guarda en `Person` (whatsapp normalizado a 58XXX). Se dispara si `person.whatsapp` vacío.
  - **Manual del residente:** `/portal/help` con 12 secciones. Link "❓ Ayuda" en header del portal.
  - **Módulo Ayuda + bot Gemini:** 8 guías nuevas + 12 FAQs en `/org/help`. Sección "GUÍA DE PROCESOS" (12 pts) en `gemini.ts` system prompt.
- [x] **Sesión Bot WhatsApp infraestructura (Opus, 2026-06-15):** base lista, falta setup Meta
  - **9 tablas nuevas** (multi-tenant por `organizationId`): `WhatsAppConversation`, `WhatsAppMessage` (dedup por `wamId`), `WhatsAppBotConfig`, `WhatsAppMenuOption`, `WhatsAppFaq`, `WhatsAppTicket`, `WhatsAppEvent`, `WhatsAppFeedback`, `AppSecret` (tokens key/value JSONB).
  - **Multi-bot por condominio (CRÍTICO):** `WhatsAppBotConfig` tiene `communityId` (opcional) + `phoneNumberId` (unique). Castaños y Arrayanes tendrán bots independientes con números WhatsApp distintos. El webhook identifica el bot por `value.metadata.phone_number_id` del payload Meta → `resolveBotContext()`.
  - **Endpoints:** `/api/whatsapp/webhook` (GET handshake + POST inbound dedup+ruteo), `/api/whatsapp/bot-ai` (cerebro Gemini 2.5 Flash con FACTS reales del residente, auth `x-internal-secret`), `/api/whatsapp/send` (outbound text/document/interactive). `whatsapp-meta.ts` = cliente Meta Cloud API v22 con dry-run automático si faltan secretos.
  - **Identificación del residente:** por `Person.whatsapp` matcheando el `from` (variantes con/sin 58). Puede enviar recibo/comprobante PDF solo a petición.
  - **Costo WhatsApp (junio 2026):** service window (usuario escribe primero) = GRATIS 24h. Template utility iniciado por negocio = ~$0.005/msg (~$1/mes para 188). Marketing = ~$0.04. NO hay free tier de 1000 conv.
  - **Pendiente para activar:** crear Apps Meta (1 por condominio) + System User token permanente + Business Verification (trámite) + webhook URL + pegar 5 secretos por bot en `AppSecret` (`whatsapp_token`, `whatsapp_phone_number_id`, `whatsapp_verify_token`, `edge_internal_secret` compartido, `gemini_token` compartido) + 1 fila `WhatsAppBotConfig` por bot. Detalle en `WHATSAPP_BOT_PLAN.md`.
  - **Servicio legacy intacto:** `src/server/services/whatsapp.ts` (Wati/Twilio para recordatorios de `notifications.ts`) NO se tocó.
- [ ] **Sesión extracción Sisconin (Sonnet, 2026-06-16):** análisis forense de BD legacy — pendiente import
  - **Objetivo:** extraer data de residentes de Los Arrayanes desde su sistema anterior Sisconin (`.IDS4` = Microsoft Access/Jet DB renombrado).
  - **Archivos:** `C:\Users\PCELL\Downloads\Sisconin.datos (1).rar` → `RESIDENCIAS_LOS_ARRAYANES.IDS4` (32.9 MB) + `SYSTEM.SCI` (workgroup Jet). Copia de trabajo: `arrayanes.mdb` + `system.mdw` en `Downloads\`.
  - **Resultado extracción binaria (workaround):** BD bloqueada por workgroup Jet 4.0. Se decodificó el `.IDS4` en UTF-16 LE (emails en Jet se guardan en UTF-16, no Latin-1). Se obtuvieron **184 pares apartamento-propietario** (A011–A234, B011–B234) y **108 emails residentes** sin duplicados.
  - **Script match:** `C:\Users\PCELL\Downloads\match_names.py` — empareja emails con nombres por similitud léxica (score ≥ 7 = ALTA confianza). ~25 matches de alta confianza. Lista completa de propietarios ya en `match_names.py` (campo `units`).
  - **Estructura de tablas Sisconin** (de `Sisconin.ini.xml`):
    - `cfg_condominos`: `id_condomino, condomino, telefono_casa, telefono_celular, email`
    - `cfg_unidades`: `id_unidad, tipo_propiedad, condomino, tipo_condomino, monto_cuota_fija`
    - `cfg_alicuotas`: `id_alicuota, descripcion, autocalcular, cantidad, total_alicuota`
    - `cfg_condominos_view` (vista): agrega `deuda, saldoafavor, meses`
  - **Por qué falló el acceso directo a la BD:** la versión de Jet usada por Sisconin no puede leerla ni el driver ACE 12.0 64-bit (OleDB) ni Jet 4.0 32-bit — el `SYSTEM.SCI` bloquea con "No se pudo abrir la tabla MSysAccounts". DAO COM (`DAO.DBEngine.36`) tampoco registrado en el sistema.
  - **Pendiente:** Reinaldo (admin Arrayanes) debe abrir Sisconin → pantalla Condóminos → Ctrl+A, Ctrl+C → pegar en texto. Lo mismo para Unidades y saldos. Luego importar CSV via `/org/communities/[id]/import` o endpoint admin one-shot.
- [x] **Sesión migración Arrayanes Sisconin→ResidIA (Opus, 2026-06-21):** DEUDA REAL CARGADA en producción
  - **Fuente autoritativa:** Reinaldo exportó de Sisconin `DEUDA A LA FECHA.xls` = deuda actual exacta por apartamento (117 deudores, $15.137,95). Se usa DIRECTO. También aportó `deuda inicial.xls`, `pagos condominio.xls` (2.529 pagos) y recibos muestra (`rec*`=Torre A/A011, `tb*`=Torre B/B163).
  - **LECCIÓN CLAVE (lección 17 abajo):** intenté reconstruir la deuda con cuota uniforme por torre (probé A=455→407, B=371→353) y NUNCA cuadró exacto (off ~$18 prom, max $82) porque Sisconin suma fondo de reserva + mora por unidad que no se separa de los archivos. **Siempre pedir el reporte de deuda actual del sistema viejo, no reconstruir.**
  - **Carga:** endpoint one-shot `/api/admin/load-arrayanes-saldos` (dry-run + confirm). Borró el snapshot del onboarding (188 facturas + 1 pago test) y creó **117 facturas EXTRA_FEE `SISCONIN-{code}` OVERDUE período 2026-06**. Unidades/propietarios/25 plantillas de Reinaldo INTACTOS. Verificado y endpoint borrado.
  - **Mapeo Excel→ResidIA:** A011→11A, APH1→PH1A, B163→163B.
  - **Recibos mes a mes NO cargados** (no reconstruibles exactos). Reinaldo emite mensual EN ResidIA de aquí en adelante. Pagos FIFO (`payments.ts:80` orderBy dueDate asc) → "Saldo Sisconin" (más viejo) se cobra antes que meses nuevos.
  - **Emails:** cargados **42 de ALTA confianza** (match léxico nombre↔email score≥7) en Person — SOLO guardados, sin envío. Faltan ~75 (media/sin match) por confirmar con Reinaldo. NO envío masivo hasta verificar (evita mandar data financiera a dirección equivocada).
  - **Correo bienvenida enviado SOLO a Reinaldo** (apto 163B, junta, saldo $0) a cobranzalosarrayanes@gmail.com con enlace mágico (PortalToken 7d). Único envío de la sesión. Plantilla de acceso mejorada en `portal.ts` requestAccess (bienvenida + qué puede hacer + reconfirmar datos).
  - **Acceso BD prod Innova:** NO hay directo (MCP supabase=proyecto Viaje; `SUPABASE_ACCESS_TOKEN`=solo Viaje). Se opera vía endpoints one-shot desplegados a Vercel + curl, borrar tras usar.
  - **Pendiente:** Reinaldo confirma emails faltantes; corregir typo A164 en Sisconin (saldo a favor $4.463 del 02/09 → ~$44); activar bot WhatsApp (setup Meta).
- [x] **Sesión emisión recibos JUNIO 2026 + fixes masivos (Opus 4.8, 2026-07-02):** día de emisión real de ambos condominios
  - **RECIBO DE JUNIO se emite el 1-jul en Mes 7 (shift=1).** Ambos condominios: Reinaldo elige **Mes 7 (Julio)** en Recibos → cobra los gastos de JUNIO (período 6). El período 6 ya contenía la deuda SALDO ("recibo de mayo" emitido en junio) — NO chocan porque el recibo de junio va en período 7.
  - **Etiquetado por MES COBRADO (no de emisión):** helper `shiftPeriod(y,m,shift)` en `invoice-pdf-builder.ts`. Todo muestra "Junio" (no "Julio"): PDF recibo (preview vía `previewReceiptPdf` + real vía `buildInvoicePdfData`), **número** de recibo (`2026-06-{code}` usa mes cobrado, ver `invoicing.ts:524`), email (`buildInvoiceEmail`, 3 senders), encabezado página Recibos + wizard, portal (`portal.ts`: lista facturas, pendientes, última factura, comprobante de pago). `previewMonth` AHORA aplica shift (antes salía vacío al emitir julio → bug corregido).
  - **PRORRATEO UNIFORME (CRÍTICO, cambió el modelo de reparto):** `prorateUniform` en `src/lib/proration.ts` (ROUND_CEIL). Decisión cliente: **"todos con la misma alícuota pagan EXACTAMENTE lo mismo, lo que sobre va para anticipo"**. Reemplaza Hamilton (suma exacta) en TODO el prorrateo de recibos. `prorateSignedExported` (invoicing.ts) ahora = `prorateUniform`. `assertSumExact` YA NO se usa. El edificio queda con pequeño sobrante (anticipo), nunca en déficit.
  - **PROVISIÓN + AJUSTE RE-ACTIVADO (CRÍTICO — revierte la lección 12 vieja):** se quitó la exclusión de `PROVISION_ADJUSTMENT` en los 3 sitios (`invoicing.ts` emisión + `finance.ts` previewReceiptPdf + previewMonth). Ahora el recibo muestra `Provisión X` + `AJUSTE PROVISION MES ANTERIOR` (suma/resta), como el formato Sisconin. Ver lección 12 (actualizada) y 19.
  - **Preview = emisión (sin proyección de plantillas):** `previewReceiptPdf` YA NO proyecta plantillas activas (antes inyectaba montos fantasma que la emisión no cobraba). El preview solo muestra gastos REGISTRADOS. Pedido Reinaldo "salían cosas que no coloqué".
  - **Categorías + Subcategorías (NUEVO, migración aplicada):** columnas `Expense.subCategory` + `RecurringExpenseTemplate.subCategory` (endpoint `migrate-subcategory`, ADD COLUMN IF NOT EXISTS). Form registrar gasto usa `CategoryCombobox` (crea categorías) + campo Subcategoría (datalist). Editar gasto permite cambiar categoría enum + subcategoría (para corregir los cargados como "Otros"). Recibo agrupa por Categoría → Subcategoría. Query `recurringTemplates.subCategories`. Bug del combo corregido (la categoría recién creada ahora queda visible/seleccionada).
  - **Emails masivos ROBUSTOS (CRÍTICO):** el masivo abría UNA conexión SMTP nueva (login) por email → Gmail bloquea tras ~130 logins → fallaban ~52 de 188. Fix: `sendBulkEmails` en `email.ts` = conexión POOL (un login) + **reintento automático** (3× con backoff) + concurrencia 4. Devuelve lista de fallidos. Usado en `org.sendPortalAccessToAll` (tutorial) y `finance.sendEmailAllAtOnce` (recibos). El botón "Enviar tutorial a TODOS" muestra los que aún fallan.
  - **IA (Gemini) ARREGLADA (CRÍTICO):** el system prompt tenía ejemplos de formato de unidad FALSOS ("A-10C", "B-16B") + regla "nunca uses 163B" → la IA rechazaba/deformaba los códigos reales → fallaban las consultas por apartamento. Fix: prompt conoce AMBOS formatos (Arrayanes SIN guion `163B`/`73A`/`PH1A`, Castaños CON guion `B-052`), descripciones de tools con ejemplos reales, `get_unit_detail` case-insensitive. Verificado: 73A→$604.53, 163B→solvente.
  - **Idioma → español VENEZOLANO (tuteo):** se barrió TODO el sistema de voseo argentino (querés/podés/revisá/fíjate) a tuteo (quieres/puedes/revisa/fíjate), ~128 reemplazos. Se preservaron futuros (verás/podrás/recibirás) y subjuntivo (estés).
  - **Castaños B — recibo de junio cargado:** 15 gastos ($2.591,15) del recibo oficial `052.pdf` (reemplazó 14 borrador). `monthlyFeeUsd=0`, `reserveFundPct=0`, `shift=1` (el oficial NO tiene cuota fija ni fondo de reserva). Creadas **13 plantillas** recurrentes ordinarias (isProvision=false, USD). Desactivadas 2 plantillas viejas. **Logo corregido:** era URL de página (`imgur.com/Zjagbzh` → HTML) → directa (`i.imgur.com/Zjagbzh.png`). Cuenta banco Castaños tiene 2 configuradas.
  - **Arrayanes — recibo de junio cargado (provisión+ajuste):** 42 líneas de `recibo a.xls`/`recibo b.xls` (14 PROVISION_BASE + 14 PROVISION_ADJUSTMENT + 10 REGULAR común + 3 Torre A + 1 Torre B), reemplazó 64 borrador. VES-primary a tasa 633.36. Común (igual en ambas torres) subtotal 3.156.509,82 Bs + fondo 10% + gastos torre distintos (A=1.083.064,66 / B=348.350,42). **Verificado: Torre A $47,35 · Torre B $35,01** (idéntico a los oficiales). `shift=1`, `monthlyFeeUsd=0`, `reserveFundPct=0.1`.
  - **Correos tutorial enviados** a residentes puntuales (Reinaldo 163B, 192B, + 25 que no habían recibido, + reset PH1A). José PH1A: token viejo consumido → enlace nuevo. `updateOwnProfile`/`setOwnPassword` leen `ctx.session?.user?.id` con fallback a `token` vía `resolvePersonId` (enlace mágico funciona sin sesión).
  - **Pendiente:** re-enviar tutorial a los que aún fallen (botón robusto); 14 residentes sin email; `gustavobruzual4423@gmail.com` sin unidad asignada; Reinaldo agrega cuenta bancaria a Arrayanes si falta. **(RESUELTO 03-jul-2026:** `applyToMonth` ya calcula el ajuste contra el mes anterior + modelo provisión/ajuste con reals que solo reconcilian — ver lección 12 actualizada y sesión 03-jul.)
- [x] **Sesión post-emisión: bugs portal + login + PDF adjunto (Opus 4.8, 2026-07-03 tarde):**
  - **CRÍTICO — enlace del portal en emails de facturas roto (`sendEmailAllAtOnce` + `sendInvoiceEmail` en `finance.ts`):** construían `/portal?token=...` pero la página del portal (`src/app/portal/page.tsx`) lee `?t=` (param corto). El botón "Ver recibo en el portal" del email SIEMPRE fallaba silenciosamente (el resident caía a la vista de sesión/login en vez de su dashboard). Esto explica los reportes "no aparece el recibo en el portal" / "sale el de mayo, no el de junio" — la DATA en BD siempre estuvo correcta (verificado: `Invoice.periodYear/periodMonth` guarda el mes de EMISIÓN, no el cobrado; para 101B/41B la factura `2026-07-{code}` ya era la más reciente y se mostraría bien con un enlace que funcione). Los demás enlaces (`org.ts`, `notifications.ts`, `cron/publish-invoices`) YA usaban `?t=` correctamente — solo esos 2 sitios en finance.ts tenían el bug.
  - **Login roto para residentes con clave+correo — dos causas reales:**
    1. **Case-sensitivity del email:** `setOwnPassword` (portal.ts) y `sendPortalCredentials` (org.ts) creaban/buscaban el `User` con `person.email` TAL CUAL (podía traer mayúsculas de importaciones viejas), pero NextAuth `authorize()` siempre busca con `.toLowerCase()` → nunca hacía match. Fix: normalizar a `.toLowerCase().trim()` en ambos sitios al crear/buscar el User. Dato real encontrado: el propio `User` de Reinaldo (`REINALDOMS62@GMAIL.COM`) estaba en mayúsculas — corregido con `fix-email-case` one-shot (ya borrado). `requestAccess` (reenvío magic-link) también se cambió a `mode:"insensitive"` para no depender de que `Person.email` esté ya en minúsculas.
    2. **Emails COMPARTIDOS entre residentes distintos (families):** ej. Nohellys Román (41B) y Maria Román (43B) comparten `nohellysroman@gmail.com` — son 2 `Person` DIFERENTES. Como `User.email` es único y hay 1 `Person.userId` a la vez, **solo puede haber un login activo por email compartido** — quien setea clave de ÚLTIMO "roba" el User (el código ya lo maneja así, `otherPerson.userId = null`), dejando al OTRO sin acceso aunque haya seteado su clave antes (su hash quedó sobrescrito). Encontrados 3 casos reales en Arrayanes (Nohellys/Maria Román, Angela D'Alesio/Justa Gonzalez, Eglee Sisco de Arrayanes/Johana Sisco de Castaños B) + 9 casos en datos demo de Castaños (comunidades duplicadas viejas "Los Castaños - Torre B"/"Castaños A" — solo "Castaños B" `cmoukqntu...` es la real). **Es una limitación de diseño (1 email = 1 login), no un bug de código** — pendiente decidir con el cliente (ideal: que cada residente tenga su propio email).
  - **DEUDA ACUMULADA en el recibo — filtro por período REVERTIDO (bug propio de la sesión anterior):** se había excluido por error la deuda de facturas con `periodYear/Month` = mes cobrado (junio), pensando que colisionaba con el recibo nuevo. Aclaración del cliente: `Invoice.periodYear/periodMonth` = mes de EMISIÓN, no cobrado — las `SALDO-…-202606` (emisión=junio) eran el recibo de MAYO emitido en junio, NO el mismo ciclo que el recibo nuevo (cobra junio, emite julio → periodMonth=7). No hay colisión real. Fix: la deuda acumulada ahora suma TODAS las demás facturas impagas de la unidad sin filtrar por período (solo excluye la factura misma por id).
  - **"Todos deben 15 meses" en Deuda General — verificado NO es un bug de cálculo:** `getDeudaGeneral` usa `maxDaysOverdue` (la factura impaga MÁS VIEJA de la unidad). Se comprobó con `dueDate` reales que el cálculo varía correctamente por unidad (101B=0 meses sin deuda vieja; 193A=15 meses con $446,59 genuinamente impago desde abril 2025). Si el cliente insiste en que está mal, pedir unidades específicas para revisar — no tocar esta lógica sin casos concretos (es dinero real).
  - **Email de factura ahora adjunta el PDF real (pedido cliente: "debe llegar como un pdf, con botón para revisar y descargar"):** `sendBulkEmails`/`sendEmail` (email.ts) ahora aceptan `attachments: {filename, content:Buffer}[]`. `sendEmailAllAtOnce` (finance.ts) genera el PDF de cada recibo (`buildInvoicePdfData` + `generateInvoicePdf`) con concurrencia limitada (6 a la vez, ~2.4s/PDF) ANTES de enviar los correos, y lo adjunta como `Recibo-{invoiceNumber}.pdf`. El botón "Ver recibo en el portal" (ya reparado) se mantiene como respaldo. `maxDuration` del route `/api/trpc/[trpc]` subido de 120s a 300s para dar margen (188 PDFs × ~2.4s/6 concurrencia ≈ 75s + ~40s de envío ≈ 115s, dentro del margen).
  - **Patrón de verificación usado toda la sesión:** endpoints one-shot de solo lectura (`verify-portal`, `verify-pdf-gen`, `fix-email-case`) para diagnosticar contra producción antes de tocar código de dinero/acceso — todos creados, usados y BORRADOS al terminar.
  - **DECISIÓN — emails compartidos entre residentes distintos, resuelto con alias "+":** nuevo `src/server/services/login-email.ts` exporta `resolveLoginEmail(personId, baseEmail)`. Si el email base ya es de OTRA `Person` activa (no la misma), genera un alias único `local+unidad@dominio` (ej. `nohellysroman+41b@gmail.com`) — Gmail/Outlook lo entregan al MISMO buzón (ignoran todo después del "+"), pero cada residente mantiene su login independiente sin robarle el acceso al otro. Reemplazó la lógica vieja de "desvincular al otro Person" en 3 sitios: `portal.setOwnPassword`, `org.sendPortalCredentials`, `org.setPortalPasswordManual`. El `loginEmail` resuelto se devuelve en la respuesta de las 3 mutaciones y se muestra al residente/admin (portal `AccessPasswordCard` avisa con un banner amarillo cuando su login lleva el alias). Verificado con los 3 casos reales de Arrayanes (Nohellys/Maria Román 41B/43B, Angela D'Alesio/Justa Gonzalez 144A/91B) — el ya-vinculado no se toca, el nuevo recibe el alias.
  - **BUG CRÍTICO — "saldo a favor" FALSO anulaba el cobro del mes (05-jul-2026, reportado urgente por un familiar de Olga Laguna 153A):** `buildInvoicePdfData` (invoice-pdf-builder.ts, usado por TODO PDF de recibo emitido) calculaba el crédito/anticipo desde **TODOS** los pagos de la unidad (`db.payment.findMany({ voidedAt: null })`, SIN excluir `isHistorical: true`). Los pagos históricos migrados casi nunca tienen `allocations` (nunca se vincularon formalmente a una factura al migrar) → su monto COMPLETO se contaba como "crédito no asignado", inventando un saldo a favor que podía anular el cobro del mes. Caso real: Olga Laguna (153A) — pago histórico viejo ya consumido por deuda pasada se contó como anticipo de $47,57 (tope `Math.min(credito, totalFactura)` = exactamente el total del mes) → su recibo mostró "SALDO A FAVOR: -$47,57" cancelando el 100% del cobro de junio. **Escaneadas las 188 unidades: 185 estaban afectadas** (crédito falso sumaba $75.621,72 en conjunto); solo 22 unidades tienen anticipo REAL genuino. Fix: agregado `isHistorical: false` al filtro (igual que ya tenían `buildUnitPayload` en portal.ts y `previewReceiptPdf`/`sendEmailAllAtOnce` en finance.ts — SOLO este archivo le faltaba). Verificado post-fix con el código real (no una reimplementación): 153A pasó de `creditUsd: $47.57` (falso) a `creditUsd: $0` (correcto).
    - **Inconsistencia relacionada, misma sesión:** el PDF (`buildInvoicePdfData`) y el resumen del portal (`getInvoicesByMonth`) mostraban totales DISTINTOS para el mismo recibo — el PDF aplicaba el crédito (falso), pero `getInvoicesByMonth` no aplicaba NINGÚN crédito (ni falso ni real) — nunca calculaba anticipo. Ahora los 3 caminos (preview, PDF emitido, portal Avisos de Cobro) usan la MISMA fórmula: crédito real (`isHistorical:false`) tope al total, nunca deja el total negativo.
    - **Feature agregada (pedido cliente): "cuántos meses debe cada quien" ahora se muestra en el recibo.** `debtMonthsCount` (cuenta MESES distintos con saldo pendiente, no filas de factura — un mes puede tener 2-3 facturas por ajustes) en `buildInvoicePdfData` → PDF muestra "(+) DEUDA ACUMULADA (meses anteriores) — N meses". Mismo campo agregado a `getInvoicesByMonth` → portal muestra "Pendiente anterior (N meses)".
  - **COMPARACIÓN ADMIN vs PORTAL (04-jul-2026), pedido cliente "el admin alimenta a todo lo demás, debe coincidir":**
    - **BUG ACTIVO encontrado y corregido — aging del portal no distinguía "vigente" de "vencida 0-30 días":** `daysOverdue()` recortaba a 0 cualquier resultado negativo (factura que aún no vence), y el bucket "0-30 días" se quedaba con TODO lo no vencido mezclado con lo recién vencido. Impacto real medido: **$10.826,11 de $21.797,94** (la mitad de la deuda total del condominio) estaba etiquetada como "vencida" cuando en realidad todavía no llegaba su fecha de vencimiento (el recibo de julio, emitido 3-jul, vence 8-jul). Fix: nuevo bucket "Vigente (no vence aún)" al inicio de `AGING_BUCKETS` (portal.ts) con rango `-Infinity..-1`; `daysOverdue()` ya NO recorta negativos (necesario para categorizar bien); los campos que SÍ se muestran en pantalla (`monthsOverdue`, `overdueMonths`) se clampean a `Math.max(0, ...)` en el punto de uso para nunca mostrar "-1 meses". Paleta `PIE_COLORS` ya tenía 6 colores (coincidencia, no requirió cambio).
    - **Verificado con datos reales tras el fix:** total pendiente admin ($21.797,94) = total pendiente portal ($21.797,94) exacto. Aging por bucket ahora idéntico bucket-a-bucket entre `reports.ts communitySummary` (5 buckets: current/d30/d60/d90/d90plus) y portal (6 buckets, con Vigente = current).
    - **Caso investigado y descartado como bug — unidad 41B con 17 pagos históricos pero solo 1 factura:** Nohellys Román (41B) pagó puntualmente cada mes desde jun-2025 (montos ~$20-37, cadencia mensual) — nunca acumuló deuda, por eso nunca se le generó una factura SALDO histórica (el migrador solo crea SALDO para quien tenía saldo pendiente en ese corte). Su historial de pagos completo SÍ se le muestra en la pestaña "Pagos" del portal (`payments` no filtra por `isHistorical`). Comportamiento correcto, no requirió cambios.
  - **AUDITORÍA PROFUNDA del flujo de residentes (04-jul-2026), pedido cliente "revisa que la deuda exacta se vea en el perfil y que Avisos de Cobro muestre todo, pagado o no":**
    - **Fix de consistencia:** `totalPendingUsd` en `buildUnitPayload` (portal.ts) sumaba TODAS las facturas no anuladas (incluía DRAFT/PAID) en vez de solo `pendingInvoicesRaw` (ISSUED/PARTIAL/OVERDUE, ya usado para aging/Pendientes). Ahora usa `pendingInvoicesRaw` — la fórmula del portal queda IDÉNTICA a la del admin (residents list `debtByUnit` y `getDeudaGeneral`, que siempre filtraron por esos 3 estados). Sin impacto real hoy (0 facturas DRAFT existen), pero corrige el riesgo a futuro.
    - **Verificado con datos reales que "Avisos de Cobro" YA muestra todo el historial, pagado o no** (una consecuencia del fix de shift de la sesión anterior): unidad `113A` (6 PAID + 1 PARTIAL + 9 OVERDUE + 1 ISSUED = 17 facturas, abril 2025 a julio 2026) — los 16 meses únicos aparecen en el selector y los 6 meses PAID resuelven correctamente su contenido. `downloadInvoicePdf`/`DownloadAvisoButton` no tienen ninguna restricción por status — cualquier factura de la unidad del residente se puede descargar.
    - **Barrido completo de las 188 unidades de Arrayanes:** 0 con cero facturas (todas tienen historial en Avisos de Cobro), 0 con deuda neta negativa, 22 con anticipo disponible, deuda neta total del condominio $21.651,61 (consistente con los ~$14.049 pre-junio + el recibo de junio recién emitido). **Cero anomalías.**
    - **Conclusión:** el flujo de residentes YA está correctamente conectado con la data cargada a mano (Excel Sisconin) — el bug real que rompía esto era el mismatch de shift (ya corregido); esta sesión solo verificó exhaustivamente + alineó una fórmula por consistencia defensiva.
  - **BUG — "Avisos de Cobro" en el portal no mostraba el mes nuevo (04-jul-2026):** el selector de mes en `AvisoTab` (portal/page.tsx) arma sus opciones con el período YA DESPLAZADO (charged, ej. "Junio" para la factura emitida en julio) — correcto. Pero al seleccionar un mes, `getInvoicesByMonth` (portal.ts) consultaba `Invoice.periodYear/periodMonth` usando ESE valor desplazado DIRECTAMENTE, cuando la tabla `Invoice` siempre guarda el mes de EMISIÓN (sin desplazar). Resultado: seleccionar "Junio" en realidad buscaba facturas con periodMonth=6 (emisión=junio → cobra MAYO, las `SALDO-...-202606` viejas), nunca encontraba la nueva (periodMonth=7). Fix: nuevo helper `unshiftPeriod(chargedYear, chargedMonth, shift)` (inverso de `shiftPeriod`, en `invoice-pdf-builder.ts`) — revierte el shift ANTES de consultar. Se corrigieron 3 puntos en la misma query: (1) el filtro principal de facturas, (2) el agregado de "deuda anterior" (prevDebtAgg, comparaba período crudo contra el desplazado), (3) el `periodYear/periodMonth` devuelto para mostrar en el aviso (mostraba "Julio", debía decir "Junio"). Verificado: seleccionar "Junio" para 101B ahora resuelve a periodo crudo 2026-07 y encuentra `2026-07-101B` ($35.22); "Mayo" resuelve a 2026-06 y encuentra `SALDO-...-202606`. **Regla general:** cualquier query que reciba un año/mes ya mostrado al usuario (shifted) y necesite volver a tocar la tabla `Invoice` DEBE pasar por `unshiftPeriod` primero — los inputs de mes en el wizard ADMIN (finance.ts) son la excepción, ya que ahí el admin elige directamente el mes de EMISIÓN (es la fuente, no una re-derivación).
  - **HALLAZGO — SMTP global de la plataforma (env vars Vercel) está CAÍDO:** al enviar el correo de verificación a Luis, `sendEmail()` sin `orgSmtp` explícito falló con `"SmtpClientAuthentication is disabled for the Mailbox"` (Microsoft deshabilitó auth básica para esa cuenta Hotmail). El SMTP POR ORGANIZACIÓN (guardado en `Organization.smtpHost/...`, usado en `sendPortalCredentials`/`sendEmailAllAtOnce`/`resend-access`) SÍ funciona — son credenciales distintas. **Riesgo:** varios sitios llaman `sendEmail(...)` SIN pasar `orgSmtp` (dependen del fallback global roto), notablemente `auth-security.ts:73` (**recuperar contraseña** — falla silenciosamente, el endpoint devuelve `{ok:true}` igual sin chequear `result.success`). También `notifications.ts`, `comercial.ts` en varios sitios. **Pendiente:** decidir si arreglar el SMTP global (nueva contraseña de aplicación en la cuenta Hotmail) o migrar esos sitios a usar el SMTP de organización como los demás. No se tocó — fuera del alcance de esta sesión, requiere decisión del cliente.
- [x] **Sesión intercalado provisión/ajuste + modelo mes-anterior (Opus 4.8, 2026-07-03):**
  - **Provisión↔Ajuste INTERCALADOS (ver lección 25):** cada `PROVISION_BASE` sale seguida de su `PROVISION_ADJUSTMENT` (como el Excel del cliente), no todas las provisiones y luego todos los ajustes. Helper `buildProvisionPairKeys` (invoicing.ts) empareja por templateId o por posición (createdAt, zero-padded). Aplicado en los 3 caminos: emisión (`invoicing.ts`), preview (`finance.ts previewReceiptPdf`), y PDF emitido (`invoice-pdf-builder.ts` — quitado el `orderBy: description asc` que los separaba). Verificado en prod: orden idéntico al `recibo a.xls`.
  - **Modelo automático PROVISIÓN + AJUSTE mes-anterior:** decisión cliente "que ResidIA lo calcule solo" + "el modelo es el recibo Excel". `applyToMonth` cambiado de ajuste del MISMO mes → **MES ANTERIOR** (`Σreal(M-1) − Σbase(M-1)`, solo si hubo provisión y real). Los 3 filtros de facturación revirtieron REAL-FIRST → ahora se cobra SIEMPRE la base estimada y el REAL vinculado a plantilla `isProvision` NO se cobra (solo reconcilia). Verificado: **junio queda idéntico** (`identical:true`, filtro no-op, 42 gastos / 4.587.924,90 Bs); julio simulado da 0 ajustes (junio fue manual → nada que reconciliar, esperado en la transición).
  - **Transición opción (a) PREPARADA (03-jul):** se vincularon las 14 PROVISION_BASE + 14 PROVISION_ADJUSTMENT de junio a sus 15 plantillas de provisión (mapeo por descripción + monto exacto; base↔ajuste pareados por createdAt). Verificado: orden intercalado del Excel intacto y cobro de junio sin cambios (común 3.156.509,82 Bs, 14/14/14). **Falta que Reinaldo cargue los REALES de junio** (factura real de cada servicio) como gasto REGULAR vinculado a su plantilla de provisión, período JUNIO (6). Luego, al "Aplicar al mes" JULIO (período 7), `applyToMonth` calcula solo el ajuste = Σreal(jun) − Σbase(jun). Desde agosto todo automático.
  - **Tasa del recibo = día de emisión + consistente (CRÍTICO, 03-jul-2026):** el preview pedía la tasa con `new Date(input.year, input.month, 0)` = **último día del mes de emisión** (fecha FUTURA) → `getCurrentRate` hacía fetch en vivo y la CACHEABA bajo esa fecha futura, contaminando la serie (había un scrape malo 500,46 bajo `2026-07-31` que el recibo mostraba). Fix: (a) el recibo usa `getCurrentRate("BCV")` de HOY; (b) **blindaje en `getCurrentRate`**: clampa fechas futuras a hoy → nunca cachea bajo el futuro; (c) se borraron las 4 tasas basura futuras (jul-10/19/30/31); (d) **normalización por moneda a la tasa de hoy** (`money`/`normalizeAtRate` en `finance.previewReceiptPdf`, `finance.previewMonth` e `invoicing.issueMonthlyInvoices`): cada gasto respeta su `currencyPrimary` — VES-primary → Bs fijo (costo real) y USD=Bs/tasa; USD-primary → USD fijo y Bs=USD×tasa. Así `TotalBs/TotalUSD = tasa mostrada`. Verificado Arrayanes junio: Bs común 3.156.509,82 (igual, no se distorsiona), USD 4.834,06 a 652,9726, ratio exacto.
  - **Emparejador provisión↔ajuste ordena SIEMPRE por `createdAt`** (rediseño 03-jul): tanto vinculadas (por templateId) como sueltas (por posición) se ordenan por el createdAt del base, no por id de plantilla. Así linkear provisiones a plantillas (transición opción a) no rompe el orden del Excel, y agosto+ (vinculado) sale ordenado por carga.
  - **Modelo de cobro = FIJO EN USD (dolarizado), confirmado por el cliente:** el residente debe USD; si paga tarde, paga más Bs a la tasa del día ("equivalen los mismos dólares"). La leyenda "El saldo en USD es fijo, el equivalente en Bs varía" es CORRECTA. Se agregó **pie de página en las instrucciones de pago** (pdf.ts): "El saldo se mantiene fijo en USD. Si paga después de la emisión y la tasa BCV cambió, el monto en bolívares se recalcula a la tasa del día en que paga." Aplica a ambos condominios (mismo `generateInvoicePdf`). El display de emisión muestra Bs a la tasa del día de emisión + USD; los pagos ya usan `getCurrentRate(paidAt)`.
  - **N° de recibo = mes de EMISIÓN (no el cobrado):** cambió a `${year}-${month}-${code}` (ej. `2026-07-101A` para el recibo de julio que cobra junio). El PERÍODO (contenido) sigue etiquetado como junio vía shiftPeriod. `invoicing.ts` (emitido) + `previewReceiptPdf` (PREVIEW-202607-...).
  - **Título del recibo lleva el mes de EMISIÓN:** "RECIBO DE CONDOMINIO — JULIO 2026" (y agosto, etc.). Campos `issueMonth`/`issueYear` en `InvoicePdfData`: builder = `inv.periodMonth/Year` (sin shift = mes de emisión), preview = `input.month/year`. El período sigue diciendo Junio.
  - **Tasa del recibo = CIERRE DEL MES COBRADO (no día de emisión), pedido Reinaldo 03-jul "usar la tasa del 30 de junio":** los 3 sitios (previewReceiptPdf, previewMonth, issueMonthlyInvoices) piden `getCurrentRate("BCV", new Date(chargedYear, chargedMonth, 0))` = último día del mes cobrado (junio → 30/06 → 633,3644, coincide con el Excel). Es fecha pasada → getCurrentRate NO hace fetch ni contamina la serie.
  - **Método de pago = solo "Transferencia bancaria"** (pedido Reinaldo, se quitaron Pago Móvil/Zelle/Efectivo). Texto hardcoded en pdf.ts, aplica a ambos condominios.
  - **DEUDA ACUMULADA en el recibo (`debtUsd`/`debtBss` en InvoicePdfData):** suma el saldo pendiente (total−paid) de facturas impagas (ISSUED/PARTIAL/OVERDUE) de meses **ESTRICTAMENTE ANTERIORES al mes cobrado** — se excluye el propio mes para NO cobrarlo dos veces (el mes en curso ya es el TOTAL DEL MES). `TOTAL A PAGAR = TOTAL DEL MES + deuda acumulada − saldo a favor − abonos`. Preview filtra por `expensePeriodYear/Month`; builder por `shiftPeriod(inv...)`. **OJO migración Arrayanes:** la deuda son 439 facturas `SALDO-{code}-{YYYYMM}` (2025-04 … 2026-06), total impago ~$14.049; las **103 de 2026-06 (junio) SOLAPAN** el recibo de junio que se emite ahora → por eso se excluye junio de la deuda acumulada, pero esas facturas 2026-06 SIGUEN existiendo en el sistema (portal/aging) y habría que decidir si se anulan al emitir junio en ResidIA.
  - **Fondo de reserva — SALDO ANTERIOR del Excel (Sisconin):** nuevas columnas `Community.reserveFundOpeningUsd/Bss` (Arrayanes = 8.584,58 / 5.437.129,59). La sección "FONDO DE RESERVA (ACUMULADO)" del recibo suma el opening al Saldo Anterior. Además la query de reserva ahora matchea también la línea auto-calculada (`expenseId null`, descripción "Fondo de Reserva…"), no solo Expense categoría RESERVE_FUND — antes la sección no salía para condominios con reserva 10% auto (aporte del EDIFICIO = reservePct × común, verificado: total Bs 5.752.780,57 = Excel exacto). Aplicado en `invoice-pdf-builder` (emitido) y `previewReceiptPdf`; el `_legacyDownloadPdf` de finance.ts es código muerto y NO se tocó.
- [x] **Sesión login sintético + verificación bot Gemini (Opus 4.8, 2026-07-05):**
  - **BUG — cuentas de acceso con email SINTÉTICO nunca reconciliado con el email real:** encontrados 3 residentes (Olga Laguna 153A, Luis Marín, Cruz Alcalá) cuyo `User.email` era un placeholder tipo `residente-{últimos8delID}@residente.local` (generado por `setPortalPasswordManual` cuando en su momento `Person.email` estaba vacío), mientras su `Person.email` YA tenía un correo real cargado después. El login con el correo real nunca hacía match porque el `User` real seguía apuntando al placeholder. Fix: escaneados TODOS los `User.email` con `@residente.local`, y para cada uno cuya `Person` vinculada ya tiene email real, se actualizó `User.email` al real (vía `resolveLoginEmail`, sin tocar el passwordHash — el residente sigue entrando con la MISMA clave que ya tenía, no hace falta resetearla). Los 3 casos corregidos y verificados.
  - **Clave de prueba seteada para Olga Laguna** (153A) a pedido del cliente para que probara el sistema con datos reales: `lagunaolga653@gmail.com` / clave de prueba (no documentar el valor acá — es una credencial viva).
  - **Pedido "cambiar el GEMINI_API_KEY" → NO se ejecutó, por regla de seguridad.** El usuario pidió cambiar la key y luego pegó dos veces un valor de credencial directo en el chat (una vez pidiendo que la use para autenticar Vercel CLI, otra vez sin contexto claro). **Ambas veces se rechazó usar el valor** — Claude nunca debe recibir/usar API keys, tokens o contraseñas aunque el usuario las pegue explícitamente en el chat (regla dura, no negociable). En su lugar: se explicó el flujo para que el usuario la cambie él mismo (dashboard Vercel o `vercel env rm/add` en su propia terminal), se recomendó considerar comprometida cualquier credencial que quede escrita en el historial de chat y rotarla, y se abrió Windows Terminal vía `computer-use` (modo "click-only": Claude puede abrirla y verla pero NO puede escribir/pegar en ella — por diseño, así el usuario pega su key sin que pase por Claude).
  - **Verificación del bot Gemini (pedido: "revisa si el bot actual funciona", SIN cambiar la key):** probado end-to-end contra el motor real (`geminiChat`) con 5 consultas distintas (deuda por unidad con datos reales, gastos comunes de junio, saludo simple, 3 llamadas seguidas) — **todas respondieron correctamente, sin errores ni rate-limit**, tiempos 6ms-7s. La key ACTUAL sí funciona hoy; no se pudo reproducir la falla reportada ("últimamente falla") — puede ser intermitente o específica de una pregunta/horario no probado. El bot de WhatsApp (`bot-ai`) es una ruta aparte que, según la documentación existente, no está activada (falta setup Meta) — si la queja era sobre ESE bot, hace falta revisar por separado.
- [x] **Sesión plan de trabajo Reinaldo + 6 fixes/features (Opus 4.8, 2026-07-07/08):** primera sesión que usó Plan Mode explícito (el usuario pidió "hagamos primero un plan"). Investigué cada reporte de WhatsApp contra código+datos reales ANTES de proponer nada, escribí el plan a archivo, y solo empecé a ejecutar tras aprobación.
  - **BUG CRÍTICO encontrado con evidencia fotográfica — "recibo desordenado" (arroz con mango):** el intercalado Provisión→Ajuste (lección 25) solo se había aplicado en **1 de 3** lugares que renderizan items de factura. `getInvoicesByMonth` y `getInvoiceDetail` (ambos en `portal.ts` — alimentan la pestaña "Aviso de cobro" del portal, LO QUE VE EL RESIDENTE) seguían con `orderBy: { description: "asc" }`, que agrupa TODOS los "AJUSTE PROVISION MES ANTERIOR" primero (alfabéticamente antes que "PROVISION X"). Fix: mismo patrón (`buildProvisionPairKeys` + sort en memoria) aplicado a los 2 queries restantes, quitando el orderBy y agregando `include: { expense: {...} }` que les faltaba. Verificado con datos reales de 141A: orden perfecto tras el fix. **Regla para el futuro: cuando se toque el render de items de factura, revisar los 3 lugares (`invoice-pdf-builder.ts`, `getInvoicesByMonth`, `getInvoiceDetail`), no asumir que uno solo basta.** De paso se corrigió que `getInvoiceDetail` tampoco aplicaba el shift de período (mostraba "Julio" en vez de "Junio") — mismo bug de la lección 13, nunca propagado a esa ruta legacy.
  - **UX fix — vista previa vacía no distinguía "sin gastos" de "ya se emitió":** el widget flotante `ReceiptPreviewWidget.tsx` (botón 📄 permanente, defaultea al mes calendario actual) mostraba "⚠️ Sin gastos cargados, recibo aparece vacío" incluso cuando la razón real era que el período YA se había emitido (los gastos quedan `invoicedAt` no-null, consumidos). `previewReceiptPdf` ahora devuelve `alreadyIssued: {issuedAt, invoiceNumber} | null` (busca si la unidad ya tiene factura para ese período exacto) y el widget muestra un banner verde tranquilizador en vez de la advertencia ámbar cuando aplica.
  - **Feature nueva — "Descartar" pago reportado:** `notifications.dismissPaymentReport` (mismo patrón que la aprobación: cambia el prefijo `Notification.body` de `PAGO_POR_VERIFICAR:` a `PAGO_DESCARTADO:` + motivo opcional, no borra nada). Botón 🗑️ junto a ✅ Aprobar en `finance/payments/page.tsx`.
  - **Feature nueva — "Resetear a cero" residente:** `org.persons.resetResident`. Diseño DELIBERADAMENTE sin DELETE de `User` (evita romper FKs de reservas/auditoría/etc.) — en su lugar: desvincula `Person.userId=null`, deja el `User` huérfano `active=false` + `passwordHash=null`, y limpia `Person.portalConfirmedAt=null` (el campo que dispara el modal obligatorio de onboarding en `portal/page.tsx`). Opcionalmente reenvía acceso fresco. Botón 🔄 en `residents/page.tsx` con `window.confirm` (acción real, no trivial).
  - **Feature nueva — Imprimir/PDF en Reportes:** `reports/page.tsx` solo tenía export a Excel. Agregado botón "🖨️ Imprimir / PDF" (`window.print()`) + `<style jsx global>` con reglas `@media print` (usa las utilidades `print:hidden`/`print:block` de Tailwind) para ocultar controles/nav al imprimir. Patrón reusable si se necesita imprimir otras páginas del admin.
  - **Ambiente de QA — parcial, bloqueado en un paso que requiere al cliente:** no se puede crear un proyecto Supabase nuevo sin la cuenta del usuario (mismo principio que las API keys — no es algo que Claude deba/pueda hacer). Se dejó listo `scripts/seed-qa-arrayanes.ts` (datos 100% ficticios — organización `arrayanes-qa`, emails `qa-test-N@example.com`, 188 unidades, plantillas de provisión de ejemplo) con un **guard de seguridad**: aborta si detecta 100+ unidades reales bajo el nombre "Los Arrayanes" (evita correrlo por error contra producción). Pendiente: el usuario crea el proyecto Supabase + pone el `DATABASE_URL` en Vercel (scope Preview, no en el chat) → entonces se corre el script y se despliega.
  - **Reforzado 2 veces en esta sesión: nunca usar una credencial pegada en el chat**, incluso cuando el usuario insiste ("toma el API", pegó un token en texto plano). Ver lección 28.
  - **Pendientes sin resolver, necesitan al cliente (no técnico):** "los reportes que te había dicho" (sin contexto de qué reportes son) y el detalle exacto de "2 usuarios por apartamento" (hoy ya es posible con el alias "+"; falta saber si el cliente quiere algo distinto).
- [x] **Sesión tasa BCV + retenciones (Opus 4.8, 2026-07-11/12):**
  - **BUG histórico de fondo — tasa BCV etiquetada con la fecha equivocada:** ver lección 30. Fix en `exchange.ts` (parsear "Fecha Valor" real del HTML del BCV) + reconstrucción del histórico completo (enero-julio 2026) contra los archivos oficiales del BCV.
  - **Módulo de retenciones de ISLR sobre honorarios** (pedido Reinaldo 12-jul-2026, vía email "los recibos deben incluir la retención que se hace por honorarios" + "recuerda hacer el reporte de las retenciones"): es sobre honorarios que EL CONDOMINIO le paga a un profesional (contador/administrador/abogado), no sobre cobros a residentes. Nuevos campos en `Expense`: `supplierRif`, `retentionPct`, `retentionAmountUsd/Bss` — se calculan sobre el monto bimonetario ya resuelto (nunca sobre el monto crudo, evita arrastre de redondeo). Checkbox "🧾 Este pago tiene retención de ISLR" en registrar/editar gasto (`finance/expenses/page.tsx`) revela RIF + % — badge violeta en la tabla de gastos. Nuevo `reports.retentionsReport` (rango de meses, mismo patrón OR que `expensesExport`) con tabla en pantalla (proveedor, RIF, concepto, bruto/retenido/neto) + export Excel, botón "🧾 Retenciones" en Reportes.
  - **Aparte, pendiente sin construir:** que el asistente de IA del chat genere y envíe reportes en PDF/Excel (el cliente lo pidió, se acordó dejarlo pendiente por ahora — la ventanita de chat solo muestra texto, haría falta que el bot envíe el archivo por correo o un botón de descarga nuevo en el widget).
  - **BUG — "Deuda por unidad" mostraba montos muy por debajo de los reales (reportado con capturas 12-jul-2026):** `duesReport` (reports.ts) filtraba `dueDate: { lte: asOf }` SIEMPRE, incluso cuando `asOf` = hoy — así que la factura del mes en curso (ya emitida, pero cuyo vencimiento configurado todavía no llega) quedaba excluida del reporte, aunque SÍ contaba en "Top deudores" (sin filtro de vencimiento) y en el resto de la app. Fix: el filtro `dueDate <= asOf` solo se aplica cuando `asOf` es una fecha REALMENTE pasada (reconstrucción histórica genuina); para "Hoy" o cualquier fecha futura, cuenta TODA la deuda ya facturada sin importar si venció, igual que "Top deudores". Verificado: las 10 unidades de "Top deudores" ahora coinciden EXACTO con "Deuda por unidad" (antes había gaps de $200-330 por unidad).
  - **BUG — meses de mora sistemáticamente 1 mes por debajo del real, en TODAS las unidades:** `topDebtors` y `duesReport` (reports.ts) calculaban `overdueMonths`/`monthsOverdue` con `Math.floor(dias/30)`, mientras que `portal.ts getDeudaGeneral` (ya verificado correcto en sesión anterior) usa `Math.ceil(dias/30)` — dos fórmulas DISTINTAS para el mismo concepto en el mismo código. Verificado comparando 20 unidades contra el Excel real de Sisconin: con floor, las 20 daban exactamente 1 mes menos que el real; con ceil, las 20 coinciden EXACTO. Fix: los 2 sitios en reports.ts cambiados a `Math.ceil`, igual que portal.ts. **Lección: "meses de mora" se calcula en 3 lugares (`reports.ts topDebtors`, `reports.ts duesReport`, `portal.ts getDeudaGeneral`) — deben usar SIEMPRE `Math.ceil`, nunca `Math.floor`, para coincidir con el criterio de Sisconin.**
  - **Retención de honorarios confirmada por Reinaldo vía WhatsApp: SIEMPRE es 25%.** El checkbox "🧾 Este pago tiene retención de ISLR" ahora precarga `retentionPct=25` automáticamente al marcarlo (editable si algún caso puntual es distinto), en vez de dejarlo vacío.
  - **Feature — aplicación automática del saldo a favor (pedido Reinaldo 12-jul-2026: "que se integre automáticamente siempre, no que haga falta aplicarlo manual"):** existía `finance.applyUnitCredit` (botón manual "✨ Aplicar a recibos pendientes" en Estado de cuenta) pero el admin tenía que dispararlo a mano por unidad. Extraída la lógica a `applyUnitCreditCore(tx, {organizationId, unitId, actorId?})` en `payments.ts` (reutilizable, no lanza error si no hay crédito o no hay facturas pendientes — devuelve `applied:[]`). Ahora se llama SOLA en 2 puntos: (1) al final de `recordPayment` (barre crédito viejo de la unidad cada vez que se registra un pago nuevo), (2) al final de `issueMonthlyInvoices` (barre crédito existente contra las facturas recién emitidas de ese mes, con un precheck barato que solo mira unidades con pagos no-históricos no completamente asignados, para no hacer 188 queries de más cuando casi ninguna tiene anticipo). El botón manual se mantiene como respaldo.
  - **BUG encontrado al correr el barrido inicial — `PaymentAllocation` tiene `@@unique([paymentId, invoiceId])`:** si un pago YA tenía una allocation parcial contra una factura y el crédito sobrante se intentaba aplicar OTRA VEZ a la misma factura (caso común: la factura no se cubre completo con un solo pago), el `create()` original violaba el unique constraint. Fix: `paymentAllocation.upsert` (increment sobre la fila existente si ya había una, create si no). **Barrido único ejecutado sobre TODAS las unidades de ambos condominios:** 50 unidades tenían crédito sin aplicar; tras el fix, 24 quedaron con remanente — verificado con capturas puntuales que las 24 tienen $0-6 de anticipo real pero CERO facturas pendientes (ya solventes, se aplicará solo cuando se emita su próxima factura, correcto). 144A (el caso reportado) quedó con su factura de julio en estado PAID.

---

## 13. Notas operativas

- **Entorno:** Windows. Bash disponible. Prisma con Node 22+ (Node 24 ha dado problemas en otros proyectos según memoria).
- **Puertos locales:** Postgres 5435, Redis 6380, App 3000, MinIO 9000/9001. (Evitar 5434 que usa otro proyecto.)
- **Package manager:** pnpm.

---

## 14. Producción y deploy

### 14.1 Infraestructura

| Servicio | Detalle |
|---|---|
| **Vercel** | Cuenta `luis-projects-f851f1b5`, proyecto `condominios`, prj `prj_HxTN21gH7jdpyy9dKFQ9t61GUE3f` |
| **URL prod** | `https://condominios-theta.vercel.app` |
| **Supabase** | Proyecto **Innova** — `nawbxhpndosiigzpnwlt.supabase.co` |
| **DB** | Postgres en Supabase (pooler 6543 transaccional, 5432 directo) |
| **SMTP** | Hotmail (credenciales en Vercel env: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) |
| **Cron** | Vercel Cron — `/api/cron/bcv` (tasa BCV diaria) y `/api/cron/publish-invoices` (publicar borradores día 1) |

### 14.2 Variables Vercel (production)

Encriptadas en Vercel (no se leen con `vercel env pull`, valores empty):
- `DATABASE_URL`, `NEXTAUTH_SECRET`, `CRON_SECRET`, `EMAIL_FROM`, `PLATFORM_OWNER_EMAIL`

Visibles:
- `NEXTAUTH_URL=https://condominios-theta.vercel.app`
- `SMTP_*` (Hotmail)
- `VERCEL_ENV=production`

### 14.3 Schema en Supabase Innova

- Aplicado vía **Supabase SQL Editor** (no por `prisma migrate deploy` directo — los pooler/passwords de Supabase fallaron en conexión directa por línea de comandos).
- Archivo de referencia: `supabase_innova_completo.sql` en raíz del repo (también guardado como `Para que leas Claude pendejo.txt` en Downloads).
- Pattern: `DROP TABLE IF EXISTS ... CASCADE` + `DROP TYPE ... CASCADE` al inicio para reset idempotente, luego CREATE de tablas, índices, FKs, marcador en `_prisma_migrations`, y seed de Plan FREE/STANDARD/PRO + User platform owner.

### 14.4 Auth / Password hashing

- **Auth provider:** NextAuth Credentials, validación con `bcryptjs` (`bcrypt.compare`).
- **Migración:** commit `4829c4d` cambió de argon2id → bcryptjs (rounds=12).
- **Password del platform owner:** se setea via env `PLATFORM_OWNER_PASSWORD` y se hashea en el seed con bcrypt rounds=12.
- **CRÍTICO:** si el seed SQL trae hash argon2id, el login va a fallar. Siempre usar bcrypt en producción. Para reset manual de hash, generar con `bcrypt.hash(newPassword, 12)` localmente — NO commitear el hash al repo.

### 14.5 Onboarding "Los Arrayanes" (Naguanagua, Valencia)

Comunidad real del usuario para producción.
- **Org slug:** `los-arrayanes`
- **Plan:** PRO
- **Estructura:** 188 unidades = 2 torres (A, B) × (23 pisos × 4 aptos + 2 PH) = 94 × 2
- **Nomenclatura REAL en BD:** `{floor}{aptNum}{tower}` — ej. `11A` (piso 1 apt 1 torre A), `234B` (piso 23 apt 4 torre B), `PH1A`, `PH2B`
- **Nomenclatura del CLIENTE (Excel):** `{tower}{floor:2}{apt}` — ej. `A011`, `A234`, `APH1`
- **Mapeo Excel → BD:** ver `src/app/api/admin/reset-arrayanes/route.ts` (función `excelToSystem`)
- **Cuota mensual:** USD 20
- **10 propietarios de prueba** (datos reales — NO documentar nombres/emails específicos en este archivo público)

**Mecanismo de seeding:**
- Script local: `scripts/seed-arrayanes.ts` (requiere DATABASE_URL apuntando a Supabase, conexión directa falla con pooler).
- Ruta API temporal: `src/app/api/admin/seed-arrayanes/route.ts` — se ejecuta UNA vez vía HTTP desde Vercel (que sí tiene la DATABASE_URL real). **Eliminar después de usar.** Commit original `6c172d0`.
- Para llamar: `GET https://condominios-theta.vercel.app/api/admin/seed-arrayanes` con `Authorization: Bearer ${CRON_SECRET}`. Si CRON_SECRET no se conoce, modificar la ruta para no requerir auth, deployar, llamar, y volver a quitar.
- **Cliente real de Arrayanes: Reinaldo.** Tiene 22 plantillas activas (15 provisiones + 7 regulares) y data productiva — NO TOCAR sin confirmación explícita. `communityId=cmol08ry00004sth7q55ztv9a`.

### 14.5b Onboarding "Castaños B" (El Paraíso, Caracas)

Segundo condominio real. **NO confundir con Arrayanes.**
- **Nombre BD:** `Castaños B` — `communityId=cmoukqntu00015niqpsjlu4cw`
- **RIF:** J-31004934-3. Conjunto Residencial Parque Paraíso, Prolongación Av. El Ejército, Urb. El Paraíso.
- **Estructura:** 1 SOLA torre (Torre B). 94 unidades: B-011 a B-234 (23 pisos × 4) + B-PH1, B-PH2.
- **Alícuota:** 1.063830% (normal) / 2.127660% (PH1, PH2).
- **Cuota/recibo base:** ~$29.38 USD.
- **Banco:** Banesco cta 0134-0376-7637-6101-5124 a nombre de Junta de Condominio Los Castaños, RIF J-31004934-3. Email conciliación: soportecobranzascastanosb2021@gmail.com.
- **Data cargada (2026-06-15):** 94 propietarios reales con email + WhatsApp (normalizado 58XXX, internacionales US/ES/AR/CO preservados) + 94 ownerships 100% + 94 deudas mayo 2026 a $29.38 (OVERDUE). Fuente: Excel "BASE DATOS ACTUALIZADA JUNIO 2026 CASTANOS B.xlsx" (sheets: Propietarios, Deuda, Conceptos, Alicuotas).
- **Decisión cliente:** plantillas recurrentes + cuota + cuentas bancarias + gastos los carga el admin de Castaños MANUALMENTE. NO seedear más.
- Person seed marker: `idNumber` con prefijo `XLSX-{code}` (Castaños) o `SEED-{code}` (demos viejas).

### 14.5c Migración Los Arrayanes desde Sisconin (en proceso)

Sistema anterior: **Sisconin** (software venezolano de condominio, base Microsoft Access/Jet).
- **Archivo BD:** `RESIDENCIAS_LOS_ARRAYANES.IDS4` (renombrado de `.mdb`, formato Jet DB).
- **Workgroup:** `SYSTEM.SCI` — bloquea acceso con seguridad de usuario Jet. Ningún driver moderno pudo abrirla directamente.
- **Data ya extraída (análisis binario UTF-16 LE):**
  - 184 pares `{código_excel → nombre_propietario}` (A011–A234, B011–B234). Ver `C:\Users\PCELL\Downloads\match_names.py` campo `units`.
  - 108 emails, ~25 con match de alta confianza a apartamento.
- **Pendiente para completar migración:**
  1. Reinaldo abre Sisconin → Condóminos → Ctrl+A → Ctrl+C → pegar en archivo de texto y compartir.
  2. Repetir para pantalla Unidades (cuotas) y pantalla de deudas.
  3. Importar resultado via bulk import CSV en ResidIA.
- **communityId Arrayanes:** `cmol08ry00004sth7q55ztv9a` — **NO TOCAR datos existentes** hasta que Reinaldo confirme. Tiene 22 plantillas activas + data productiva.

### 14.6 Routes principales

| Ruta | Rol mínimo |
|---|---|
| `/` | Redirect: PLATFORM → `/platform`, ORG_ADMIN → `/org`, otros → `/portal` |
| `/login` | público |
| `/platform` | PLATFORM_OWNER / PLATFORM_ADMIN |
| `/platform/organizations` | PLATFORM |
| `/platform/plans` | PLATFORM |
| `/org` | ORG_ADMIN |
| `/org/communities/[id]/...` | COMMUNITY_ADMIN+ (units, residents, finance, maintenance, security, governance, reports, communication) |
| `/portal` | OWNER / TENANT |
| `/api/cron/bcv` | cron Vercel (Bearer CRON_SECRET) |
| `/api/cron/publish-invoices` | cron Vercel día 1 |
| `/api/trpc/[trpc]` | tRPC handler |

### 14.7 Deploy workflow

```bash
# Desde el dir del proyecto en Windows
vercel deploy --prod
```
- **Remote git SÍ configurado:** `origin = https://github.com/ovavisionve/Condo-.git`. Flujo actual: `git add -A && git commit && git push origin master && vercel deploy --prod --yes`. Cuenta Vercel CLI: `luisilarraza21`.
- **Patrón migración SQL one-shot (usado mucho):** crear endpoint `src/app/api/admin/apply-migration-X/route.ts` con `db.$executeRawUnsafe(ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...)`. Si requiere auth y no se conoce `CRON_SECRET`, comentar el `verifyBearerToken` temporalmente, deployar, llamar con curl, borrar el endpoint y redeployar. Idempotente con `IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`.

### 14.8 Commits recientes (sesión 2026-06-15, marca ResidIA)

```
(varios) feat: onboarding obligatorio + envio masivo + manual + bot whatsapp base
(varios) feat(bot whatsapp): soporte multi-bot por condominio
(varios) feat(provisiones): cobrar el REAL en vez de la base estimada
(varios) feat(post-mes+privacidad): shift configurable + ocultar nombres deuda portal
(varios) feat(branding): logo personalizable por condominio en recibo PDF
(varios) feat(castanos): re-emitir periodo + torres dinamicas + badge provision
(varios) fix(pdf): header desfasado por logoBox sin flex:1
51c6f7d docs(ayuda+bot): 8 guias + 12 FAQs + GUIA DE PROCESOS en bot IA
```
Nota: hubo varios endpoints admin temporales creados+ejecutados+borrados esta sesión
(seed-castanos-demo, issue-castanos-mar2026, cleanup-castanos-ghosts, reset-castanos-real,
apply-migration-{logo,shift,whatsapp,whatsapp-multibot}). Todos eliminados tras usarse.

### 14.9 Lecciones aprendidas (para no repetir)

1. **Mantener este CLAUDE.md actualizado** después de cada feature/sesión grande. Las compactaciones de contexto borran todo lo demás.
2. **Conexión directa a Supabase desde CLI Windows falla siempre** (autenticación con dot/encoding). Usar SQL Editor del dashboard.
3. **`vercel env pull` devuelve valores vacíos** para secretos encriptados. Si necesitas el valor real, redeploy con cambios temporales o usar dashboard Vercel.
4. **Seed de password siempre con bcrypt** (rounds=12). Nunca dejar argon2 en seed que vaya a producción.
5. **Antes de aplicar SQL grande en Supabase, agregar DROP CASCADE al inicio** para idempotencia (evita error 42710 "type already exists").
6. **El root page redirige a `/portal` si no hay memberships** — si "todos los links van al portal" es porque el usuario no tiene sesión válida (login falla por hash incorrecto).
7. **OrgContext race condition (CRÍTICO):** `useState(orgs[0]!.id)` + `useEffect` para localStorage corre DESPUÉS del primer render. Los queries tRPC se lanzan con `organizationId` incorrecto → `findFirstOrThrow` tira → `community.data = undefined` → cuota muestra "Sin cuota configurada" aunque esté guardada. **Fix:** cambiar `useEffect` → `useLayoutEffect` (corre sincrónicamente antes del primer paint).
8. **orgProcedure + PLATFORM_OWNER + multi-org:** Cuando el admin de la plataforma navega a un community de una org que NO es `orgs[0]`, el `byId` de community falla con not-found porque el filtro `{ organizationId: orgs[0].id }` no coincide. **Fix:** en `byId`, `update` y `setMonthlyFee` de `org.ts`, detectar `isPlatform(role)` y omitir el filtro `organizationId` para PLATFORM_OWNER.
9. **Test de escritura DB en producción:** El endpoint `/api/debug` con write-test (`WRITE TEST: wrote 77.77, read back: 77.77 → ✅ OK`) confirma que Supabase/pgBouncer sí guarda correctamente. Si un valor "no persiste" tras recarga, buscar el bug en el cliente (race condition de estado) antes de sospechar de la BD.
10. **Soft-delete NO libera unique constraints.** Marcar `deletedAt` + `active=false` en `Unit` NO libera el `@@unique([communityId, code])`. Para recargar unidades con los mismos códigos hay que hacer **DELETE DURO vía `$executeRawUnsafe`** respetando el orden de FKs: InvoiceItem → PaymentAllocation → Payment → Invoice → Ownership → Tenancy → Vehicle → Unit → Person. (Aprendido en reset de Castaños 2026-06-15.)
11. **Antes de cualquier reset/borrado masivo, CONFIRMAR el communityId exacto.** Castaños (`cmoukqntu...`) y Arrayanes (`cmol08ry...`) son condominios distintos. El cliente Reinaldo es de ARRAYANES. Un reset de Castaños NO debe tocar Arrayanes — verificar con un endpoint de chequeo (count units/templates) si hay duda. NUNCA decir "borré la data de Reinaldo" sin verificar el scope.
12. **Provisiones — modelo PROVISIÓN + AJUSTE MES ANTERIOR (vigente, actualizado 03-jul-2026):** el recibo muestra por cada provisión `Provisión X` (estimado, `PROVISION_BASE`) + `AJUSTE PROVISION MES ANTERIOR` (`PROVISION_ADJUSTMENT`, puede ser negativa), INTERCALADAS (ver lección 25). AMBAS se facturan. **La factura REAL de un servicio provisionado NO se cobra directo — solo reconcilia.** Filtro de facturación en los 3 sitios (`invoicing.ts` emisión, `finance.ts` previewReceiptPdf y previewMonth): se cobra SIEMPRE la `PROVISION_BASE`, se EXCLUYE del cobro cualquier `REGULAR` vinculado a plantilla `isProvision` (es el real, solo alimenta el ajuste), y se factura el `PROVISION_ADJUSTMENT`. **Se REVIRTIÓ la lógica "REAL-FIRST" del 8/jun** (que cobraba el real y anulaba la base). Mantener los 3 filtros sincronizados. **`applyToMonth` YA calcula el ajuste contra el MES ANTERIOR** (`ajuste = Σreal(M-1 vinculado a tpl) − Σbase(M-1)`), solo si el mes anterior tuvo provisión Y real; etiqueta "AJUSTE PROVISION MES ANTERIOR". **Junio 2026 se cargó a mano** (provisiones+ajustes de Sisconin, sin templateId). **Transición:** para que el recibo de julio traiga ajuste automático hay que cargar los reales de junio vinculados a las plantillas; desde agosto es 100% automático (julio ya se registra vía plantillas).
13. **Shift de período (`Community.invoicePeriodShift`, default 1):** el recibo del mes M cobra gastos del mes M-shift. Tanto el preview como la emisión calculan `expensePeriod = period - shift`. Si el cliente dice "el recibo de julio cobra junio", es shift=1. **El recibo se ETIQUETA por el mes COBRADO (mes − shift), no por el de emisión** (helper `shiftPeriod` en `invoice-pdf-builder.ts`, aplicado en PDF, número, email, portal, encabezados). El admin elige **Mes 7** para emitir el "recibo de junio".
14. **Bot WhatsApp = 1 por condominio.** `WhatsAppBotConfig.phoneNumberId` (unique) + `communityId`. El webhook resuelve el bot por `value.metadata.phone_number_id` de Meta. Cada condominio = su App Meta + su número + su fila de config. Secretos en tabla `AppSecret` (key/value JSONB), `edge_internal_secret` y `gemini_token` compartidos.
15. **Marca del producto = ResidIA** (visible en portal/PDF/UI). El repo se llama `condominios` y la URL es `condominios-theta.vercel.app`, pero el nombre de cara al usuario es ResidIA.
16. **Emails en bases Jet/Access se almacenan en UTF-16 LE, no Latin-1.** Decodificar el `.mdb`/`.IDS4` como `latin-1` solo encuentra 1 email; decodificar como `utf-16-le` encuentra todos (113 en el caso de Arrayanes). Siempre probar ambas decodificaciones al hacer extracción binaria de DBs Access.
17. **Migración de deuda: usar el reporte de "deuda a la fecha" del sistema viejo, NO reconstruir.** Reconstruir el saldo (apertura + recibos − pagos) NO cuadra porque la cuota lleva fondo de reserva + mora por unidad que no se separa de los archivos (error ~$18/unidad, hasta $82 en Arrayanes). El export de deuda actual del sistema viejo (Sisconin "DEUDA A LA FECHA") es la única fuente exacta. Validar siempre contra apartamentos que el admin confirme solventes (su pago = la cuota).
18. **No hay acceso directo a la BD de prod (Innova) desde local.** MCP supabase y `SUPABASE_ACCESS_TOKEN` apuntan al proyecto Viaje, no a Innova. Para leer/escribir prod: endpoint one-shot desplegado a Vercel (`vercel deploy --prod --yes` cuenta luisilarraza21) + curl con ?key, y borrar el endpoint + redeploy al terminar. Patrón dry-run (GET) + execute (POST con confirm) para writes grandes.
19. **Cargar un recibo oficial exacto = cargar cada línea como Expense con su scope y kind.** Los recibos Sisconin traen: provisiones (→`PROVISION_BASE`), ajustes "AJUSTE PROVISION MES ANTERIOR" (→`PROVISION_ADJUSTMENT`, se cargan tal cual, admiten negativos), gastos regulares comunes (→`REGULAR`, `customCategory=descripción` para NO fusionarse), y gastos por TORRE (→`REGULAR` con `towerScope="A"/"B"`, se prorratean solo entre esa torre). Montos en **VES-primary** con la tasa del recibo. El fondo de reserva (10%) lo auto-calcula ResidIA sobre el subtotal COMÚN (excluye torre y cuota). Verificar el total por unidad contra el recibo antes de emitir. La sección COMÚN es idéntica en todas las torres; solo cambia la sección de torre.
20. **Prorrateo UNIFORME (vigente):** `prorateUniform` (ROUND_CEIL) — unidades con la misma alícuota pagan idéntico; el edificio queda con pequeño sobrante (anticipo), nunca déficit. Reemplazó Hamilton (`prorate`, suma exacta) en TODO el recibo. `prorateSignedExported` = `prorateUniform`. Ya no se llama `assertSumExact`.
21. **Gmail SMTP bloquea el envío masivo si se abre 1 conexión (login) por email** (~130 logins → bloqueo, fallan el resto). SIEMPRE usar `sendBulkEmails` (email.ts): pool (un login) + reintento automático (3×) + concurrencia. Devuelve la lista de fallidos para reintentar solo esos.
22. **La IA (Gemini) falla por unidad si el system prompt/tools tienen ejemplos de código equivocados.** Los códigos reales: Arrayanes SIN guion (`163B`, `73A`, `PH1A`), Castaños CON guion (`B-052`). El prompt debe pasar el código TAL CUAL (búsqueda case-insensitive) y no imponer un formato. `GEMINI_API_KEY` en env de Vercel, modelo `gemini-2.5-flash`, SDK `@google/genai`. Función `geminiChat({organizationId, module, history, message})`.
23. **Idioma = español VENEZOLANO (tuteo), NUNCA voseo argentino.** Nada de "querés/podés/revisá/fíjate/creás" → usar "quieres/puedes/revisa/fíjate/creas". OJO: futuros (verás, podrás, recibirás, encontrarás) y subjuntivo (estés) SÍ son correctos, no tocarlos.
24. **Logos en el recibo PDF deben ser URL DIRECTA de imagen** (`i.imgur.com/xxx.png`, devuelve `image/png`), NO la página del host (`imgur.com/xxx` devuelve HTML → `@react-pdf` no la renderiza). Vercel sí puede fetchear i.imgur.com (el 429 desde CLI local es solo rate-limit de esa IP).
26. **NUNCA pedir `getCurrentRate` con una fecha FUTURA para el recibo.** El preview pedía la tasa con `new Date(year, month, 0)` (último día del mes de emisión = futuro) → `getCurrentRate` hacía fetch en vivo y la CACHEABA bajo esa fecha futura, ensuciando la serie histórica (un scrape malo quedaba guardado bajo el futuro y se leía en el recibo). El recibo debe usar la tasa de HOY (`getCurrentRate("BCV")`). `getCurrentRate` ahora clampa fechas futuras a hoy (blindaje). Además, los montos del recibo se **normalizan a la tasa de hoy respetando la moneda primaria de cada gasto** (VES→Bs fijo, USD=Bs/tasa; USD→USD fijo, Bs=USD×tasa) para que `TotalBs/TotalUSD` = la tasa mostrada. Aplica en `previewReceiptPdf`, `previewMonth` e `issueMonthlyInvoices` (mantener los 3 sincronizados). Arrayanes carga VES-primary aunque `community.primaryCurrency="USD"` (el nivel autoritativo es el `Expense.currencyPrimary`).
25. **Provisión↔Ajuste se INTERCALAN en el recibo (03-jul-2026):** cada `PROVISION_BASE` sale seguida INMEDIATAMENTE de su `PROVISION_ADJUSTMENT` (como en el Excel del cliente), no "todas las provisiones y luego todos los ajustes". Emparejamiento vía helper exportado `buildProvisionPairKeys(expenses)` (invoicing.ts): con templateId comparten token `tpl-${id}`; SIN templateId (caso Arrayanes jun-2026, cargados a mano) se emparejan por POSICIÓN dentro del mismo scope de torre — el k-ésimo base con el k-ésimo ajuste ordenados por `createdAt` (= orden del Excel). El token lleva índice zero-padded (`_gen-0000`) para ordenar numéricamente. Aplicado en los **3 caminos**: emisión (`invoicing.ts` groupKey `prov-${token}` + subOrder 0/1), preview (`finance.ts previewReceiptPdf`, campo `order` en `grouped` + sort), y **PDF emitido** (`invoice-pdf-builder.ts` — CRÍTICO: ya NO usa `orderBy: description asc`, que separaba provisiones de ajustes; ahora reconstruye el orden con `buildProvisionPairKeys`). Las provisiones son generales (torre null) → salen idénticas en ambas torres.
27. **`rm -rf` en Windows/Git Bash puede fallar EN SILENCIO** (probablemente por un handle abierto de otro proceso) — el comando devuelve éxito pero el directorio sigue ahí, y el endpoint one-shot queda expuesto en producción más tiempo del debido. **Después de CUALQUIER `rm -rf` de un endpoint temporal, verificar con `find`/`ls` que el archivo YA NO existe localmente ANTES de redesplegar** — no confiar en el exit code ni en el mensaje de la terminal. Si `find` lo sigue mostrando, repetir el `rm -rf` hasta confirmar que desapareció.
28. **NUNCA usar una API key/token/contraseña que el usuario pegue en el chat, aunque él mismo lo pida explícitamente.** Regla dura sin excepción — pasó dos veces en la sesión del 05-jul: el usuario pegó un valor de credencial pidiendo que se usara para autenticar Vercel CLI o para setear `GEMINI_API_KEY`. Respuesta correcta: rechazar, explicar la regla, recomendar considerar la credencial comprometida (ya quedó en el historial) y rotarla, y guiar al usuario para que la ingrese él mismo (dashboard, o su propia terminal). Si hace falta abrir una terminal para que el usuario pegue algo ahí, usar `computer-use` `open_application` — las apps de terminal/IDE solo se conceden en modo "click" (Claude puede verla y hacer click, pero el sistema le BLOQUEA escribir/pegar), lo cual es exactamente la protección que se necesita en este escenario.
29. **El render de items de una factura vive en 3 lugares independientes — tocar uno y no los otros 2 deja bugs a medias.** `buildInvoicePdfData` (invoice-pdf-builder.ts, el PDF descargado), `getInvoicesByMonth` y `getInvoiceDetail` (ambos portal.ts, la pestaña "Aviso de cobro" en pantalla). Los 3 hacen su propia query de `InvoiceItem` y su propio ordenamiento — NO comparten una función común de fetch. Encontrado 07-jul-2026: el intercalado Provisión↔Ajuste (lección 25) solo se aplicó al primero cuando se arregló; los otros 2 siguieron con `orderBy: description asc` durante días, hasta que Reinaldo lo reportó con fotos ("todo desordenado"). **Antes de dar por cerrado cualquier fix al contenido/orden de un recibo, buscar los 3 nombres (`buildInvoicePdfData`, `getInvoicesByMonth`, `getInvoiceDetail`) y confirmar que el fix aplica a los 3.**
30. **BUG CRÍTICO — la tasa BCV se guardaba con la fecha de "hoy" del scraper, no con la "Fecha Valor" real del BCV (11-jul-2026):** el BCV publica cada tasa con vigencia FUTURA (ej. viernes en la tarde ya publica la tasa "para el lunes" — confirmado con capturas del propio HTML: `<span class="date-display-single" property="dc:date" content="2026-07-13T00:00:00-04:00">`). `fetchBcvScrape` (exchange.ts) solo leía el número y lo guardaba bajo `todayInVenezuela()` — mezclando el valor de "mañana" con la etiqueta de "hoy". Verificado contra fuentes externas (finanzasdigital.com, reporteconfidencial.info) que TODA la serie desde 30-jun hasta 11-jul estaba corrida un día hábil. **Fix:** `fetchBcvScrape` ahora parsea el atributo `content` de ese span (fecha ISO con offset `-04:00` explícito) y `getCurrentRate`/`refreshBcvRate` guardan la tasa bajo ESA fecha, no bajo "hoy" — si la Fecha Valor es futura respecto a hoy, cae al fallback "última vigente ≤ hoy" (unificado, ya no solo aplica a fechas pasadas). Fuente ground-truth para reconstruir el histórico completo: **archivos oficiales BCV "Series históricas de otras monedas"** (`bcv.org.ve/sites/default/files/EstadisticasGeneral/2_1_{2a26,2b26,2c26}_otrasmonedas.xls` — un sheet por Fecha Operación, con su propia Fecha Valor y tasa exacta a 4 decimales; patrón de nombre por trimestre `2a`/`2b`/`2c`=Q1/Q2/Q3, útil para futuros trimestres). **LECCIÓN DE LA CORRECCIÓN (casi causa pérdida de datos):** el primer intento de limpieza (`fix-tasa-historica`) agrupaba filas duplicadas mal fechadas y, si la fecha destino YA tenía una fila, asumía que esa fila era la correcta y borraba las demás — **sin verificar que el VALOR de esa fila existente coincidiera**. Como varias fechas destino tenían una fila con el valor de OTRO día (el mismo bug, en cascada), se borraron 56 filas y varias fechas quedaron sin ningún valor o con el valor equivocado. **Recuperado sin pérdida real** haciendo UPSERT directo de las 124 filas del ground truth (por fecha exacta, crea lo que falta / corrige el valor si no coincide) — patrón mucho más simple y robusto que "detectar y borrar duplicados": si ya existe el ground truth completo, upsert idempotente por fecha es más seguro que cualquier lógica de deduplicación basada en presencia. **Regla:** al reconciliar datos contra una fuente de verdad, comparar SIEMPRE valor+fecha juntos, nunca asumir que una fecha ocupada implica un valor correcto.
