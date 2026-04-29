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

---

## 13. Notas operativas

- **Entorno:** Windows. Bash disponible. Prisma con Node 22+ (Node 24 ha dado problemas en otros proyectos según memoria).
- **Puertos locales:** Postgres 5435, Redis 6380, App 3000, MinIO 9000/9001. (Evitar 5434 que usa otro proyecto.)
- **Package manager:** pnpm.
