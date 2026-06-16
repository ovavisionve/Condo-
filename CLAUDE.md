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
12. **Provisiones — modelo REAL-FIRST (vigente):** NO usar `PROVISION_ADJUSTMENT` (eliminado). Si hay `REGULAR` vinculado a plantilla `isProvision` → se cobra el real y se excluye la `PROVISION_BASE`. Si no hay real → fallback a la base. La lógica está duplicada en `previewReceiptPdf` (finance.ts) e `issueMonthlyInvoices` (invoicing.ts) — mantener AMBAS sincronizadas.
13. **Shift de período (`Community.invoicePeriodShift`, default 1):** el recibo del mes M cobra gastos del mes M-shift. Tanto el preview como la emisión calculan `expensePeriod = period - shift`. Si el cliente dice "el recibo de julio cobra junio", es shift=1.
14. **Bot WhatsApp = 1 por condominio.** `WhatsAppBotConfig.phoneNumberId` (unique) + `communityId`. El webhook resuelve el bot por `value.metadata.phone_number_id` de Meta. Cada condominio = su App Meta + su número + su fila de config. Secretos en tabla `AppSecret` (key/value JSONB), `edge_internal_secret` y `gemini_token` compartidos.
15. **Marca del producto = ResidIA** (visible en portal/PDF/UI). El repo se llama `condominios` y la URL es `condominios-theta.vercel.app`, pero el nombre de cara al usuario es ResidIA.
