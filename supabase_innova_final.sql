-- =========================================================
-- Condominios – Full schema + Prisma migration tracking
-- Paste this entire file in Supabase SQL Editor → Run
-- =========================================================

-- Create Prisma migrations tracking table
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_steps_count INTEGER NOT NULL DEFAULT 0
);
-- === 20260429020424_init ===
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('APARTMENT', 'HOUSE', 'COMMERCIAL', 'PARKING', 'STORAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('CEDULA_V', 'CEDULA_E', 'RIF', 'PASSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'ORG_ADMIN', 'COMMUNITY_ADMIN', 'BOARD_MEMBER', 'OWNER', 'TENANT', 'SECURITY');

-- CreateEnum
CREATE TYPE "MembershipScope" AS ENUM ('PLATFORM', 'ORGANIZATION', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('VES', 'USD');

-- CreateEnum
CREATE TYPE "ExchangeSource" AS ENUM ('BCV', 'BINANCE_P2P', 'MANUAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PERMISSION_DENIED', 'EXPORT', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED', 'INVOICE_ISSUED', 'INVOICE_VOIDED', 'RATE_FETCHED', 'ROLE_GRANTED', 'ROLE_REVOKED');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxCommunities" INTEGER NOT NULL,
    "maxUnits" INTEGER NOT NULL,
    "priceUsd" DECIMAL(10,2) NOT NULL,
    "features" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "rif" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'VE',
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rif" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'VE',
    "totalUnits" INTEGER NOT NULL DEFAULT 0,
    "primaryCurrency" "Currency" NOT NULL DEFAULT 'USD',
    "foundedAt" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "UnitType" NOT NULL DEFAULT 'APARTMENT',
    "aliquot" DECIMAL(9,6) NOT NULL,
    "areaM2" DECIMAL(10,2),
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "parkingSpots" INTEGER NOT NULL DEFAULT 0,
    "storageUnits" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "idType" "IdType" NOT NULL DEFAULT 'CEDULA_V',
    "idNumber" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "passwordHash" TEXT,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "MembershipScope" NOT NULL,
    "role" "Role" NOT NULL,
    "organizationId" TEXT,
    "communityId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ownership" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenancy" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "monthlyRentUsd" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" "ExchangeSource" NOT NULL,
    "vesPerUsd" DECIMAL(18,8) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_active_deletedAt_idx" ON "Organization"("active", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Community_organizationId_active_idx" ON "Community"("organizationId", "active");

-- CreateIndex
CREATE INDEX "Unit_organizationId_idx" ON "Unit"("organizationId");

-- CreateIndex
CREATE INDEX "Unit_communityId_active_idx" ON "Unit"("communityId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_communityId_code_key" ON "Unit"("communityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");

-- CreateIndex
CREATE INDEX "Person_organizationId_lastName_firstName_idx" ON "Person"("organizationId", "lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "Person_organizationId_idType_idNumber_key" ON "Person"("organizationId", "idType", "idNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_active_idx" ON "User"("active");

-- CreateIndex
CREATE INDEX "Membership_userId_active_idx" ON "Membership"("userId", "active");

-- CreateIndex
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");

-- CreateIndex
CREATE INDEX "Membership_communityId_role_idx" ON "Membership"("communityId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_scope_organizationId_communityId_key" ON "Membership"("userId", "scope", "organizationId", "communityId");

-- CreateIndex
CREATE INDEX "Ownership_unitId_endDate_idx" ON "Ownership"("unitId", "endDate");

-- CreateIndex
CREATE INDEX "Ownership_personId_idx" ON "Ownership"("personId");

-- CreateIndex
CREATE INDEX "Tenancy_unitId_endDate_idx" ON "Tenancy"("unitId", "endDate");

-- CreateIndex
CREATE INDEX "Tenancy_personId_idx" ON "Tenancy"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "ExchangeRate_date_idx" ON "ExchangeRate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_date_source_key" ON "ExchangeRate"("date", "source");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- === 20260429021758_finance ===
-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('ELECTRICITY', 'WATER', 'GAS', 'INTERNET', 'CLEANING', 'GARDENING', 'SECURITY', 'ELEVATOR', 'STAFF_PAYROLL', 'ADMINISTRATION', 'INSURANCE', 'REPAIRS', 'RESERVE_FUND', 'TAXES', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIAL', 'PAID', 'OVERDUE', 'VOIDED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('ALIQUOT', 'SPECIAL_FEE', 'FINE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_BSS', 'CASH_USD', 'TRANSFER_BSS', 'TRANSFER_USD', 'ZELLE', 'PAGO_MOVIL', 'CRYPTO', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED', 'CLOSED');

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "amountBss" DECIMAL(18,2) NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL,
    "exchangeSource" "ExchangeSource" NOT NULL,
    "currencyPrimary" "Currency" NOT NULL,
    "supplierName" TEXT,
    "invoiceNumber" TEXT,
    "receiptDate" TIMESTAMP(3),
    "notes" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'ALIQUOT',
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "totalBss" DECIMAL(18,2) NOT NULL,
    "totalUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL,
    "exchangeSource" "ExchangeSource" NOT NULL,
    "currencyPrimary" "Currency" NOT NULL,
    "paidBss" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidUsd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "expenseId" TEXT,
    "description" TEXT NOT NULL,
    "amountBss" DECIMAL(18,2) NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "aliquot" DECIMAL(9,6) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "amountBss" DECIMAL(18,2) NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL,
    "exchangeSource" "ExchangeSource" NOT NULL,
    "currencyPrimary" "Currency" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "bankAccountId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountBss" DECIMAL(18,2) NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalUsd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetItem" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_organizationId_idx" ON "Expense"("organizationId");

-- CreateIndex
CREATE INDEX "Expense_communityId_periodYear_periodMonth_idx" ON "Expense"("communityId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "Expense_communityId_invoicedAt_idx" ON "Expense"("communityId", "invoicedAt");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_communityId_periodYear_periodMonth_idx" ON "Invoice"("communityId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "Invoice_unitId_status_idx" ON "Invoice"("unitId", "status");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_communityId_invoiceNumber_key" ON "Invoice"("communityId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_expenseId_idx" ON "InvoiceItem"("expenseId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_communityId_paidAt_idx" ON "Payment"("communityId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_unitId_paidAt_idx" ON "Payment"("unitId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_voidedAt_idx" ON "Payment"("voidedAt");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceId_key" ON "PaymentAllocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE INDEX "BankAccount_communityId_active_idx" ON "BankAccount"("communityId", "active");

-- CreateIndex
CREATE INDEX "Budget_organizationId_idx" ON "Budget"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_communityId_year_key" ON "Budget"("communityId", "year");

-- CreateIndex
CREATE INDEX "BudgetItem_budgetId_idx" ON "BudgetItem"("budgetId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- === 20260429023802_phase3_floors_income_workorders ===
-- CreateEnum
CREATE TYPE "IncomeCategory" AS ENUM ('HALL_RENTAL', 'PARKING_FEE', 'GUEST_FEE', 'INTEREST', 'DONATION', 'PENALTY', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "floorsCount" INTEGER,
ADD COLUMN     "towersCount" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "floor" INTEGER,
ADD COLUMN     "tower" TEXT;

-- CreateTable
CREATE TABLE "Income" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "category" "IncomeCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "amountBss" DECIMAL(18,2) NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL,
    "exchangeSource" "ExchangeSource" NOT NULL,
    "currencyPrimary" "Currency" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "rating" DECIMAL(3,2),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "unitId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "contractorId" TEXT,
    "estimatedCostUsd" DECIMAL(18,2),
    "actualCostUsd" DECIMAL(18,2),
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reportedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderActivity" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Income_organizationId_idx" ON "Income"("organizationId");

-- CreateIndex
CREATE INDEX "Income_communityId_periodYear_periodMonth_idx" ON "Income"("communityId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "Contractor_organizationId_active_idx" ON "Contractor"("organizationId", "active");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_idx" ON "WorkOrder"("organizationId");

-- CreateIndex
CREATE INDEX "WorkOrder_communityId_status_idx" ON "WorkOrder"("communityId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_unitId_idx" ON "WorkOrder"("unitId");

-- CreateIndex
CREATE INDEX "WorkOrderActivity_workOrderId_createdAt_idx" ON "WorkOrderActivity"("workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "Unit_communityId_floor_idx" ON "Unit"("communityId", "floor");

-- CreateIndex
CREATE INDEX "Unit_communityId_tower_idx" ON "Unit"("communityId", "tower");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderActivity" ADD CONSTRAINT "WorkOrderActivity_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- === 20260429025707_phase3_vehicles ===
-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'OTHER');

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL DEFAULT 'CAR',
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "plate" TEXT,
    "parkingSpot" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_organizationId_idx" ON "Vehicle"("organizationId");

-- CreateIndex
CREATE INDEX "Vehicle_personId_idx" ON "Vehicle"("personId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- === 20260429030233_phase4_notifications ===
-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('INVOICE_ISSUED', 'PAYMENT_RECEIVED', 'PAYMENT_REMINDER', 'OVERDUE_ALERT', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_DONE', 'ANNOUNCEMENT', 'ASSEMBLY_INVITE');

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT,
    "unitId" TEXT,
    "personId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipientPhone" TEXT,
    "recipientEmail" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "externalId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_organizationId_idx" ON "WhatsAppTemplate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_organizationId_event_key" ON "WhatsAppTemplate"("organizationId", "event");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_personId_status_idx" ON "Notification"("personId", "status");

-- CreateIndex
CREATE INDEX "Notification_unitId_idx" ON "Notification"("unitId");

-- CreateIndex
CREATE INDEX "Announcement_communityId_publishedAt_idx" ON "Announcement"("communityId", "publishedAt");


-- === 20260429031147_phase4_notification_relations ===
-- AlterTable
ALTER TABLE "WhatsAppTemplate" ALTER COLUMN "name" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- === 20260429034625_add_monthly_fee ===
-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "monthlyFeeSetAt" TIMESTAMP(3),
ADD COLUMN     "monthlyFeeUsd" DECIMAL(18,2);


-- === 20260429035142_add_audit_fine_monthly_fee ===
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FINE_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE 'MONTHLY_FEE_UPDATED';


-- === 20260429035726_phase5_security_access ===
-- CreateEnum
CREATE TYPE "VisitorStatus" AS ENUM ('PENDING', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ViolationType" AS ENUM ('NOISE', 'PARKING', 'PETS', 'COMMON_AREAS', 'ELEVATOR_MISUSE', 'GARBAGE', 'OTHER');

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "authorizedById" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "idNumber" TEXT,
    "idType" TEXT DEFAULT 'V',
    "phone" TEXT,
    "vehiclePlate" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "accessCode" TEXT NOT NULL,
    "purpose" TEXT,
    "notes" TEXT,
    "status" "VisitorStatus" NOT NULL DEFAULT 'PENDING',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "checkedInById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "unitId" TEXT,
    "visitorId" TEXT,
    "personName" TEXT NOT NULL,
    "personId_doc" TEXT,
    "vehiclePlate" TEXT,
    "purpose" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'IN',
    "deniedReason" TEXT,
    "registeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Violation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" "ViolationType" NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportedById" TEXT,
    "fineInvoiceId" TEXT,
    "fineAmountUsd" DECIMAL(18,2),
    "resolvedAt" TIMESTAMP(3),
    "resolvedNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Violation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_accessCode_key" ON "Visitor"("accessCode");

-- CreateIndex
CREATE INDEX "Visitor_communityId_status_idx" ON "Visitor"("communityId", "status");

-- CreateIndex
CREATE INDEX "Visitor_communityId_validFrom_validUntil_idx" ON "Visitor"("communityId", "validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "Visitor_unitId_idx" ON "Visitor"("unitId");

-- CreateIndex
CREATE INDEX "AccessLog_communityId_createdAt_idx" ON "AccessLog"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_unitId_createdAt_idx" ON "AccessLog"("unitId", "createdAt");

-- CreateIndex
CREATE INDEX "Violation_communityId_createdAt_idx" ON "Violation"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "Violation_unitId_idx" ON "Violation"("unitId");

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_fineInvoiceId_fkey" FOREIGN KEY ("fineInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- === 20260429040943_phase6_governance ===
-- CreateEnum
CREATE TYPE "BoardRole" AS ENUM ('PRESIDENT', 'VICE_PRESIDENT', 'TREASURER', 'SECRETARY', 'VOCAL_1', 'VOCAL_2', 'VOCAL_3', 'ALTERNATE');

-- CreateEnum
CREATE TYPE "AssemblyStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('FOR', 'AGAINST', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('REGULATION', 'MINUTES', 'CERTIFICATE', 'BUDGET', 'CONTRACT', 'LEGAL', 'OTHER');

-- CreateTable
CREATE TABLE "BoardMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "BoardRole" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assembly" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "quorumRequired" INTEGER NOT NULL DEFAULT 50,
    "quorumReached" BOOLEAN,
    "attendeesCount" INTEGER,
    "status" "AssemblyStatus" NOT NULL DEFAULT 'SCHEDULED',
    "closedAt" TIMESTAMP(3),
    "minutesUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assembly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyAgendaItem" (
    "id" TEXT NOT NULL,
    "assemblyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requiresVote" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT,
    "votesFor" INTEGER NOT NULL DEFAULT 0,
    "votesAgainst" INTEGER NOT NULL DEFAULT 0,
    "votesAbstain" INTEGER NOT NULL DEFAULT 0,
    "approved" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyAgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyVote" (
    "id" TEXT NOT NULL,
    "assemblyId" TEXT NOT NULL,
    "agendaItemId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssemblyVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "mimeType" TEXT,
    "uploadedById" TEXT,
    "assemblyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardMember_communityId_endDate_idx" ON "BoardMember"("communityId", "endDate");

-- CreateIndex
CREATE INDEX "BoardMember_personId_idx" ON "BoardMember"("personId");

-- CreateIndex
CREATE INDEX "Assembly_communityId_scheduledAt_idx" ON "Assembly"("communityId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Assembly_communityId_status_idx" ON "Assembly"("communityId", "status");

-- CreateIndex
CREATE INDEX "AssemblyAgendaItem_assemblyId_order_idx" ON "AssemblyAgendaItem"("assemblyId", "order");

-- CreateIndex
CREATE INDEX "AssemblyVote_assemblyId_personId_idx" ON "AssemblyVote"("assemblyId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyVote_agendaItemId_unitId_key" ON "AssemblyVote"("agendaItemId", "unitId");

-- CreateIndex
CREATE INDEX "CommunityDocument_communityId_category_idx" ON "CommunityDocument"("communityId", "category");

-- CreateIndex
CREATE INDEX "CommunityDocument_communityId_createdAt_idx" ON "CommunityDocument"("communityId", "createdAt");

-- AddForeignKey
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyAgendaItem" ADD CONSTRAINT "AssemblyAgendaItem_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyVote" ADD CONSTRAINT "AssemblyVote_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyVote" ADD CONSTRAINT "AssemblyVote_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AssemblyAgendaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyVote" ADD CONSTRAINT "AssemblyVote_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyVote" ADD CONSTRAINT "AssemblyVote_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityDocument" ADD CONSTRAINT "CommunityDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityDocument" ADD CONSTRAINT "CommunityDocument_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityDocument" ADD CONSTRAINT "CommunityDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityDocument" ADD CONSTRAINT "CommunityDocument_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Mark all migrations as applied in Prisma tracking table
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('c93aadac-f5ea-4f85-a279-feba4973919e', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429020424_init', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('936933e2-56e1-4fb1-942b-3394b89fa8cb', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429021758_finance', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('541f243b-f5b9-4cdf-ad9c-a2ee588bdf32', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429023802_phase3_floors_income_workorders', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('e729c2ee-f10b-4aca-a84a-acd2c8915718', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429025707_phase3_vehicles', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('c7baea49-e2c2-4130-8211-269bbdf9fb9c', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429030233_phase4_notifications', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('cfe85f07-b35e-4526-9564-72bc5d0cc833', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429031147_phase4_notification_relations', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('8d396ffa-b95a-4da1-a220-d896084b6bcd', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429034625_add_monthly_fee', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('c2e76ede-1105-4158-9864-7cbc33937a77', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429035142_add_audit_fine_monthly_fee', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('348d0064-896b-40ea-b610-b6564afc8106', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429035726_phase5_security_access', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('ecdfddb2-92ff-46a2-8689-c7f83ba157bd', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429040943_phase6_governance', NULL, NULL, now(), 1)
  ON CONFLICT (id) DO NOTHING;


-- ── Migración: email_template ──────────────────────────────────────────────
-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailTemplate_organizationId_idx" ON "EmailTemplate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_organizationId_event_key" ON "EmailTemplate"("organizationId", "event");

-- ── Migración: extra_fee + portal_token ────────────────────────────────────
-- AlterEnum
ALTER TYPE "InvoiceType" ADD VALUE 'EXTRA_FEE';

-- CreateTable
CREATE TABLE "PortalToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalToken_token_key" ON "PortalToken"("token");

-- CreateIndex
CREATE INDEX "PortalToken_personId_idx" ON "PortalToken"("personId");

-- AddForeignKey
ALTER TABLE "PortalToken" ADD CONSTRAINT "PortalToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Migración: audit action extra_fee ──────────────────────────────────────
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EXTRA_FEE_APPLIED';

-- ── Seed inicial ────────────────────────────────────────────────────────────
﻿-- =========================================================
-- Condominios – Seed data
-- Paste this in Supabase SQL Editor AFTER running the schema
-- Admin login: admin@condominios.local / admin1234
-- =========================================================

DO $$ DECLARE
  v_owner_id TEXT;
  v_org_id   TEXT;
  v_pro_id   TEXT;
  v_starter_id TEXT;
  v_enterprise_id TEXT;
  v_community_id TEXT := 'hugo-chavez-frias-seed';
  v_floor INT;
  v_apt  TEXT;
  v_code TEXT;
BEGIN

-- Plans
INSERT INTO "Plan" (id, code, name, description, "maxCommunities", "maxUnits", "priceUsd", features, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'STARTER', 'Starter', 'Para un solo edificio pequeño', 1, 50, 25, '{"whatsapp":false,"advancedReports":false,"customBranding":false}'::jsonb, now(), now()),
  (gen_random_uuid()::text, 'PRO', 'Pro', 'Para administradoras pequeñas', 5, 500, 99, '{"whatsapp":true,"advancedReports":true,"customBranding":false}'::jsonb, now(), now()),
  (gen_random_uuid()::text, 'ENTERPRISE', 'Enterprise', 'Sin límites', 999, 99999, 299, '{"whatsapp":true,"advancedReports":true,"customBranding":true,"api":true}'::jsonb, now(), now())
ON CONFLICT (code) DO NOTHING;

SELECT id INTO v_starter_id FROM "Plan" WHERE code = 'STARTER';
SELECT id INTO v_pro_id FROM "Plan" WHERE code = 'PRO';
SELECT id INTO v_enterprise_id FROM "Plan" WHERE code = 'ENTERPRISE';

-- Platform owner user
INSERT INTO "User" (id, email, name, "passwordHash", "emailVerified", active, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'admin@condominios.local', 'Platform Owner', '$argon2id$v=19$m=65536,t=3,p=4$rHxIDgpTXlhRrFAYvO/enQ$3QVZ93J6frXMZGknWGNAj0O/xFbDnsTbqYqfYiXVt2g', now(), true, now(), now())
ON CONFLICT (email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", active = true;

SELECT id INTO v_owner_id FROM "User" WHERE email = 'admin@condominios.local';

-- Platform membership
INSERT INTO "Membership" (id, "userId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, 'PLATFORM', 'PLATFORM_OWNER', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND scope = 'PLATFORM' AND role = 'PLATFORM_OWNER'
);

-- Organization
INSERT INTO "Organization" (id, slug, name, "legalName", email, city, country, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'administradora-demo', 'Administradora Demo', 'Administradora Demo C.A.', 'admin@condominios.local', 'Caracas', 'VE', now(), now())
ON CONFLICT (slug) DO NOTHING;

SELECT id INTO v_org_id FROM "Organization" WHERE slug = 'administradora-demo';

-- ORG_ADMIN membership
INSERT INTO "Membership" (id, "userId", "organizationId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, v_org_id, 'ORGANIZATION', 'ORG_ADMIN', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND "organizationId" = v_org_id AND role = 'ORG_ADMIN'
);

-- Subscription
INSERT INTO "Subscription" (id, "organizationId", "planId", status, "currentPeriodStart", "currentPeriodEnd", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_org_id, v_pro_id, 'ACTIVE', now(), now() + interval '365 days', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Subscription" WHERE "organizationId" = v_org_id
);

-- Community Hugo Chavez Frias
INSERT INTO "Community" (id, "organizationId", name, address, city, state, country, "totalUnits", "floorsCount", "towersCount", "primaryCurrency", "createdAt", "updatedAt")
VALUES (v_community_id, v_org_id, 'Residencias Hugo Chávez Frías', 'Av. Principal de las Mercedes, Res. Hugo Chávez Frías', 'Caracas', 'Distrito Capital', 'VE', 40, 10, 1, 'USD', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Community membership for owner
INSERT INTO "Membership" (id, "userId", "organizationId", "communityId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, v_org_id, v_community_id, 'COMMUNITY', 'COMMUNITY_ADMIN', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND "communityId" = v_community_id AND role = 'COMMUNITY_ADMIN'
);

-- 40 units: floors 1-10, apts A-D
FOREACH v_floor IN ARRAY ARRAY[1,2,3,4,5,6,7,8,9,10] LOOP
  FOREACH v_apt IN ARRAY ARRAY['A','B','C','D'] LOOP
    v_code := v_floor::text || v_apt;
    INSERT INTO "Unit" (id, "organizationId", "communityId", code, type, floor, aliquot, bedrooms, bathrooms, "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, v_org_id, v_community_id, v_code, 'APARTMENT', v_floor, 2.500000, 3, 2, now(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM "Unit" WHERE "communityId" = v_community_id AND code = v_code
    );
  END LOOP;
END LOOP;

RAISE NOTICE 'Seed completado. Login: admin@condominios.local / admin1234';
END $$;
