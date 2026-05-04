-- ============================================================
-- MIGRACIÓN v5 — Centro Comercial (Cc* models)
-- Aplicar en Supabase SQL Editor (Dashboard)
-- ============================================================

-- 1. Enum OrganizationType
DO $$ BEGIN
  CREATE TYPE "OrganizationType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Campo type en Organization
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "type" "OrganizationType" NOT NULL DEFAULT 'RESIDENTIAL';

-- 3. Enums nuevos
DO $$ BEGIN
  CREATE TYPE "CcLocalType" AS ENUM (
    'LOCAL','ANCORA','FOOD_COURT','RESTAURANT','BANCO','CINE','QUIOSCO','OFICINA','OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CcCanonType" AS ENUM ('FIXED','VARIABLE_SALES','MIXED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CcExpenseCategory" AS ENUM (
    'ELECTRICIDAD','DIESEL_PLANTA','AGUA_CISTERNA','LIMPIEZA','SEGURIDAD',
    'HVAC','ASCENSORES','MARKETING','ADMINISTRACION','MANTENIMIENTO',
    'SEGUROS','NOMINA_STAFF','IMPUESTOS','FONDO_RESERVA','OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CcIncomeCategory" AS ENUM (
    'PUBLICIDAD_INTERNA','ALQUILER_ESPACIO','ESTACIONAMIENTO',
    'PATROCINIOS','INTERESES','PENALIDADES','OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CcInvoiceStatus" AS ENUM (
    'DRAFT','ISSUED','PARTIAL','PAID','OVERDUE','VOIDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CcInvoiceType" AS ENUM (
    'ALIQUOT','CANON','CANON_SALES','EXTRA_FEE','FINE','OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Tabla CcMall
CREATE TABLE IF NOT EXISTS "CcMall" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT        NOT NULL,
  "name"           TEXT        NOT NULL,
  "rif"            TEXT,
  "address"        TEXT        NOT NULL,
  "city"           TEXT        NOT NULL,
  "state"          TEXT,
  "country"        TEXT        NOT NULL DEFAULT 'VE',
  "phone"          TEXT,
  "email"          TEXT,
  "website"        TEXT,
  "totalLocales"   INTEGER     NOT NULL DEFAULT 0,
  "floorsCount"    INTEGER,
  "openedAt"       TIMESTAMP(3),
  "notes"          TEXT,
  "active"         BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "CcMall_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcMall_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcMall_organizationId_active_idx" ON "CcMall"("organizationId","active");

-- 5. Tabla CcLocal
CREATE TABLE IF NOT EXISTS "CcLocal" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT         NOT NULL,
  "mallId"         TEXT         NOT NULL,
  "code"           TEXT         NOT NULL,
  "type"           "CcLocalType" NOT NULL DEFAULT 'LOCAL',
  "name"           TEXT,
  "floor"          INTEGER,
  "wing"           TEXT,
  "areaM2"         DECIMAL(10,2),
  "aliquot"        DECIMAL(9,6),
  "canonType"      "CcCanonType" NOT NULL DEFAULT 'FIXED',
  "canonUsd"       DECIMAL(18,2),
  "salesPct"       DECIMAL(7,4),
  "notes"          TEXT,
  "active"         BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "CcLocal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcLocal_mallId_code_key" UNIQUE ("mallId","code"),
  CONSTRAINT "CcLocal_mallId_fkey" FOREIGN KEY ("mallId")
    REFERENCES "CcMall"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcLocal_organizationId_idx" ON "CcLocal"("organizationId");
CREATE INDEX IF NOT EXISTS "CcLocal_mallId_active_idx" ON "CcLocal"("mallId","active");

-- 6. Tabla CcTenancy
CREATE TABLE IF NOT EXISTS "CcTenancy" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT         NOT NULL,
  "localId"        TEXT         NOT NULL,
  "tenantRif"      TEXT,
  "tenantName"     TEXT         NOT NULL,
  "tenantEmail"    TEXT,
  "tenantPhone"    TEXT,
  "tenantContact"  TEXT,
  "canonType"      "CcCanonType" NOT NULL DEFAULT 'FIXED',
  "canonUsd"       DECIMAL(18,2),
  "salesPct"       DECIMAL(7,4),
  "startDate"      TIMESTAMP(3) NOT NULL,
  "endDate"        TIMESTAMP(3),
  "depositUsd"     DECIMAL(18,2),
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CcTenancy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcTenancy_localId_fkey" FOREIGN KEY ("localId")
    REFERENCES "CcLocal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcTenancy_localId_endDate_idx" ON "CcTenancy"("localId","endDate");
CREATE INDEX IF NOT EXISTS "CcTenancy_organizationId_idx" ON "CcTenancy"("organizationId");

-- 7. Tabla CcExpense
CREATE TABLE IF NOT EXISTS "CcExpense" (
  "id"              TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT               NOT NULL,
  "mallId"          TEXT               NOT NULL,
  "category"        "CcExpenseCategory" NOT NULL,
  "customCategory"  TEXT,
  "description"     TEXT               NOT NULL,
  "periodYear"      INTEGER            NOT NULL,
  "periodMonth"     INTEGER            NOT NULL,
  "amountBss"       DECIMAL(18,2)      NOT NULL,
  "amountUsd"       DECIMAL(18,2)      NOT NULL,
  "exchangeRate"    DECIMAL(18,8)      NOT NULL,
  "exchangeSource"  "ExchangeSource"   NOT NULL,
  "currencyPrimary" "Currency"         NOT NULL,
  "supplierName"    TEXT,
  "invoiceNumber"   TEXT,
  "receiptDate"     TIMESTAMP(3),
  "notes"           TEXT,
  "isIndividual"    BOOLEAN            NOT NULL DEFAULT false,
  "targetLocalId"   TEXT,
  "invoicedAt"      TIMESTAMP(3),
  "voidedAt"        TIMESTAMP(3),
  "voidReason"      TEXT,
  "createdAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CcExpense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcExpense_mallId_fkey" FOREIGN KEY ("mallId")
    REFERENCES "CcMall"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcExpense_organizationId_idx" ON "CcExpense"("organizationId");
CREATE INDEX IF NOT EXISTS "CcExpense_mallId_period_idx" ON "CcExpense"("mallId","periodYear","periodMonth");
CREATE INDEX IF NOT EXISTS "CcExpense_mallId_invoicedAt_idx" ON "CcExpense"("mallId","invoicedAt");

-- 8. Tabla CcIncome
CREATE TABLE IF NOT EXISTS "CcIncome" (
  "id"              TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT               NOT NULL,
  "mallId"          TEXT               NOT NULL,
  "category"        "CcIncomeCategory" NOT NULL,
  "customCategory"  TEXT,
  "description"     TEXT               NOT NULL,
  "periodYear"      INTEGER            NOT NULL,
  "periodMonth"     INTEGER            NOT NULL,
  "amountBss"       DECIMAL(18,2)      NOT NULL,
  "amountUsd"       DECIMAL(18,2)      NOT NULL,
  "exchangeRate"    DECIMAL(18,8)      NOT NULL,
  "exchangeSource"  "ExchangeSource"   NOT NULL,
  "currencyPrimary" "Currency"         NOT NULL,
  "reference"       TEXT,
  "affectsInvoice"  BOOLEAN            NOT NULL DEFAULT false,
  "notes"           TEXT,
  "voidedAt"        TIMESTAMP(3),
  "voidReason"      TEXT,
  "createdAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CcIncome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcIncome_mallId_fkey" FOREIGN KEY ("mallId")
    REFERENCES "CcMall"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcIncome_organizationId_idx" ON "CcIncome"("organizationId");
CREATE INDEX IF NOT EXISTS "CcIncome_mallId_period_idx" ON "CcIncome"("mallId","periodYear","periodMonth");

-- 9. Tabla CcInvoice
CREATE TABLE IF NOT EXISTS "CcInvoice" (
  "id"              TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT               NOT NULL,
  "mallId"          TEXT               NOT NULL,
  "localId"         TEXT               NOT NULL,
  "invoiceNumber"   TEXT               NOT NULL,
  "type"            "CcInvoiceType"    NOT NULL DEFAULT 'ALIQUOT',
  "periodYear"      INTEGER            NOT NULL,
  "periodMonth"     INTEGER            NOT NULL,
  "issuedAt"        TIMESTAMP(3)       NOT NULL,
  "dueDate"         TIMESTAMP(3)       NOT NULL,
  "totalBss"        DECIMAL(18,2)      NOT NULL,
  "totalUsd"        DECIMAL(18,2)      NOT NULL,
  "exchangeRate"    DECIMAL(18,8)      NOT NULL,
  "exchangeSource"  "ExchangeSource"   NOT NULL,
  "currencyPrimary" "Currency"         NOT NULL,
  "paidBss"         DECIMAL(18,2)      NOT NULL DEFAULT 0,
  "paidUsd"         DECIMAL(18,2)      NOT NULL DEFAULT 0,
  "status"          "CcInvoiceStatus"  NOT NULL DEFAULT 'ISSUED',
  "voidedAt"        TIMESTAMP(3),
  "voidReason"      TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CcInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcInvoice_mallId_invoiceNumber_key" UNIQUE ("mallId","invoiceNumber"),
  CONSTRAINT "CcInvoice_mallId_fkey" FOREIGN KEY ("mallId")
    REFERENCES "CcMall"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CcInvoice_localId_fkey" FOREIGN KEY ("localId")
    REFERENCES "CcLocal"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcInvoice_organizationId_idx" ON "CcInvoice"("organizationId");
CREATE INDEX IF NOT EXISTS "CcInvoice_mallId_period_idx" ON "CcInvoice"("mallId","periodYear","periodMonth");
CREATE INDEX IF NOT EXISTS "CcInvoice_localId_status_idx" ON "CcInvoice"("localId","status");
CREATE INDEX IF NOT EXISTS "CcInvoice_status_dueDate_idx" ON "CcInvoice"("status","dueDate");

-- 10. Tabla CcInvoiceItem
CREATE TABLE IF NOT EXISTS "CcInvoiceItem" (
  "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "invoiceId"   TEXT         NOT NULL,
  "expenseId"   TEXT,
  "description" TEXT         NOT NULL,
  "amountBss"   DECIMAL(18,2) NOT NULL,
  "amountUsd"   DECIMAL(18,2) NOT NULL,
  "aliquot"     DECIMAL(9,6),
  CONSTRAINT "CcInvoiceItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId")
    REFERENCES "CcInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CcInvoiceItem_expenseId_fkey" FOREIGN KEY ("expenseId")
    REFERENCES "CcExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcInvoiceItem_invoiceId_idx" ON "CcInvoiceItem"("invoiceId");
CREATE INDEX IF NOT EXISTS "CcInvoiceItem_expenseId_idx" ON "CcInvoiceItem"("expenseId");

-- 11. Tabla CcPayment
CREATE TABLE IF NOT EXISTS "CcPayment" (
  "id"              TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT               NOT NULL,
  "mallId"          TEXT               NOT NULL,
  "localId"         TEXT               NOT NULL,
  "amountBss"       DECIMAL(18,2)      NOT NULL,
  "amountUsd"       DECIMAL(18,2)      NOT NULL,
  "exchangeRate"    DECIMAL(18,8)      NOT NULL,
  "exchangeSource"  "ExchangeSource"   NOT NULL,
  "currencyPrimary" "Currency"         NOT NULL,
  "method"          "PaymentMethod"    NOT NULL,
  "reference"       TEXT,
  "paidAt"          TIMESTAMP(3)       NOT NULL,
  "notes"           TEXT,
  "voidedAt"        TIMESTAMP(3),
  "voidReason"      TEXT,
  "createdAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"     TEXT,
  CONSTRAINT "CcPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcPayment_localId_fkey" FOREIGN KEY ("localId")
    REFERENCES "CcLocal"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcPayment_organizationId_idx" ON "CcPayment"("organizationId");
CREATE INDEX IF NOT EXISTS "CcPayment_mallId_paidAt_idx" ON "CcPayment"("mallId","paidAt");
CREATE INDEX IF NOT EXISTS "CcPayment_localId_paidAt_idx" ON "CcPayment"("localId","paidAt");

-- 12. Tabla CcPaymentAllocation
CREATE TABLE IF NOT EXISTS "CcPaymentAllocation" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "paymentId" TEXT         NOT NULL,
  "invoiceId" TEXT         NOT NULL,
  "localId"   TEXT         NOT NULL,
  "amountBss" DECIMAL(18,2) NOT NULL,
  "amountUsd" DECIMAL(18,2) NOT NULL,
  CONSTRAINT "CcPaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcPaymentAllocation_paymentId_invoiceId_key" UNIQUE ("paymentId","invoiceId"),
  CONSTRAINT "CcPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId")
    REFERENCES "CcPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CcPaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId")
    REFERENCES "CcInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CcPaymentAllocation_localId_fkey" FOREIGN KEY ("localId")
    REFERENCES "CcLocal"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcPaymentAllocation_invoiceId_idx" ON "CcPaymentAllocation"("invoiceId");

-- 13. Tabla CcSalesDeclaration
CREATE TABLE IF NOT EXISTS "CcSalesDeclaration" (
  "id"              TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT         NOT NULL,
  "mallId"          TEXT         NOT NULL,
  "localId"         TEXT         NOT NULL,
  "periodYear"      INTEGER      NOT NULL,
  "periodMonth"     INTEGER      NOT NULL,
  "salesAmountBss"  DECIMAL(18,2) NOT NULL,
  "salesAmountUsd"  DECIMAL(18,2) NOT NULL,
  "exchangeRate"    DECIMAL(18,8) NOT NULL,
  "evidenceUrl"     TEXT,
  "verified"        BOOLEAN      NOT NULL DEFAULT false,
  "verifiedAt"      TIMESTAMP(3),
  "verifiedById"    TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CcSalesDeclaration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcSalesDeclaration_localId_period_key" UNIQUE ("localId","periodYear","periodMonth"),
  CONSTRAINT "CcSalesDeclaration_localId_fkey" FOREIGN KEY ("localId")
    REFERENCES "CcLocal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcSalesDeclaration_mallId_period_idx" ON "CcSalesDeclaration"("mallId","periodYear","periodMonth");
CREATE INDEX IF NOT EXISTS "CcSalesDeclaration_organizationId_idx" ON "CcSalesDeclaration"("organizationId");

-- 14. Tabla CcMarketingEvent
CREATE TABLE IF NOT EXISTS "CcMarketingEvent" (
  "id"              TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT         NOT NULL,
  "mallId"          TEXT         NOT NULL,
  "title"           TEXT         NOT NULL,
  "description"     TEXT,
  "scheduledAt"     TIMESTAMP(3) NOT NULL,
  "endsAt"          TIMESTAMP(3),
  "location"        TEXT,
  "budgetUsd"       DECIMAL(18,2),
  "actualCostUsd"   DECIMAL(18,2),
  "sponsor"         TEXT,
  "status"          TEXT         NOT NULL DEFAULT 'PLANNED',
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CcMarketingEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CcMarketingEvent_mallId_scheduledAt_idx" ON "CcMarketingEvent"("mallId","scheduledAt");
CREATE INDEX IF NOT EXISTS "CcMarketingEvent_organizationId_idx" ON "CcMarketingEvent"("organizationId");

-- 15. Tabla CcMonthClose
CREATE TABLE IF NOT EXISTS "CcMonthClose" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT         NOT NULL,
  "mallId"         TEXT         NOT NULL,
  "year"           INTEGER      NOT NULL,
  "month"          INTEGER      NOT NULL,
  "closedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedById"     TEXT         NOT NULL,
  "summary"        JSONB        NOT NULL DEFAULT '{}',
  "notes"          TEXT,
  CONSTRAINT "CcMonthClose_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CcMonthClose_mallId_year_month_key" UNIQUE ("mallId","year","month"),
  CONSTRAINT "CcMonthClose_mallId_fkey" FOREIGN KEY ("mallId")
    REFERENCES "CcMall"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CcMonthClose_mallId_idx" ON "CcMonthClose"("mallId");

-- 16. Marcar migración en _prisma_migrations
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (
  gen_random_uuid()::text,
  'v5_centro_comercial_manual',
  NOW(), '20260504000000_centro_comercial', NULL, NULL, NOW(), 1
)
ON CONFLICT DO NOTHING;

-- ¡Listo! Verificar con:
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'Cc%';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Organization' AND column_name = 'type';
