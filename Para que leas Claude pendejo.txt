-- =========================================================
-- Condominios – RESET + Full schema + Seed
-- Borra todo y lo recrea limpio
-- Pega en Supabase SQL Editor → Run
-- =========================================================

-- ── LIMPIAR TODO ────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "PortalToken" CASCADE;
DROP TABLE IF EXISTS "EmailTemplate" CASCADE;
DROP TABLE IF EXISTS "CommunityDocument" CASCADE;
DROP TABLE IF EXISTS "AssemblyVote" CASCADE;
DROP TABLE IF EXISTS "AssemblyAgendaItem" CASCADE;
DROP TABLE IF EXISTS "Assembly" CASCADE;
DROP TABLE IF EXISTS "BoardMember" CASCADE;
DROP TABLE IF EXISTS "Violation" CASCADE;
DROP TABLE IF EXISTS "AccessLog" CASCADE;
DROP TABLE IF EXISTS "Visitor" CASCADE;
DROP TABLE IF EXISTS "Announcement" CASCADE;
DROP TABLE IF EXISTS "Notification" CASCADE;
DROP TABLE IF EXISTS "WhatsAppTemplate" CASCADE;
DROP TABLE IF EXISTS "Vehicle" CASCADE;
DROP TABLE IF EXISTS "WorkOrderActivity" CASCADE;
DROP TABLE IF EXISTS "WorkOrder" CASCADE;
DROP TABLE IF EXISTS "Contractor" CASCADE;
DROP TABLE IF EXISTS "Income" CASCADE;
DROP TABLE IF EXISTS "BudgetItem" CASCADE;
DROP TABLE IF EXISTS "Budget" CASCADE;
DROP TABLE IF EXISTS "BankAccount" CASCADE;
DROP TABLE IF EXISTS "PaymentAllocation" CASCADE;
DROP TABLE IF EXISTS "Payment" CASCADE;
DROP TABLE IF EXISTS "InvoiceItem" CASCADE;
DROP TABLE IF EXISTS "Invoice" CASCADE;
DROP TABLE IF EXISTS "Expense" CASCADE;
DROP TABLE IF EXISTS "AuditLog" CASCADE;
DROP TABLE IF EXISTS "ExchangeRate" CASCADE;
DROP TABLE IF EXISTS "VerificationToken" CASCADE;
DROP TABLE IF EXISTS "Session" CASCADE;
DROP TABLE IF EXISTS "Account" CASCADE;
DROP TABLE IF EXISTS "Tenancy" CASCADE;
DROP TABLE IF EXISTS "Ownership" CASCADE;
DROP TABLE IF EXISTS "Membership" CASCADE;
DROP TABLE IF EXISTS "Vehicle" CASCADE;
DROP TABLE IF EXISTS "Person" CASCADE;
DROP TABLE IF EXISTS "Unit" CASCADE;
DROP TABLE IF EXISTS "Community" CASCADE;
DROP TABLE IF EXISTS "Subscription" CASCADE;
DROP TABLE IF EXISTS "Organization" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS "Plan" CASCADE;
DROP TABLE IF EXISTS "_prisma_migrations" CASCADE;

DROP TYPE IF EXISTS "DocumentCategory" CASCADE;
DROP TYPE IF EXISTS "VoteChoice" CASCADE;
DROP TYPE IF EXISTS "AssemblyStatus" CASCADE;
DROP TYPE IF EXISTS "BoardRole" CASCADE;
DROP TYPE IF EXISTS "ViolationType" CASCADE;
DROP TYPE IF EXISTS "VisitorStatus" CASCADE;
DROP TYPE IF EXISTS "NotificationEvent" CASCADE;
DROP TYPE IF EXISTS "NotificationStatus" CASCADE;
DROP TYPE IF EXISTS "NotificationChannel" CASCADE;
DROP TYPE IF EXISTS "VehicleType" CASCADE;
DROP TYPE IF EXISTS "WorkOrderPriority" CASCADE;
DROP TYPE IF EXISTS "WorkOrderStatus" CASCADE;
DROP TYPE IF EXISTS "IncomeCategory" CASCADE;
DROP TYPE IF EXISTS "BudgetStatus" CASCADE;
DROP TYPE IF EXISTS "PaymentMethod" CASCADE;
DROP TYPE IF EXISTS "InvoiceType" CASCADE;
DROP TYPE IF EXISTS "InvoiceStatus" CASCADE;
DROP TYPE IF EXISTS "ExpenseCategory" CASCADE;
DROP TYPE IF EXISTS "AuditAction" CASCADE;
DROP TYPE IF EXISTS "ExchangeSource" CASCADE;
DROP TYPE IF EXISTS "Currency" CASCADE;
DROP TYPE IF EXISTS "MembershipScope" CASCADE;
DROP TYPE IF EXISTS "Role" CASCADE;
DROP TYPE IF EXISTS "IdType" CASCADE;
DROP TYPE IF EXISTS "UnitType" CASCADE;
DROP TYPE IF EXISTS "SubscriptionStatus" CASCADE;

-- ── SCHEMA ───────────────────────────────────────────────────────────────────

CREATE TABLE "_prisma_migrations" (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_steps_count INTEGER NOT NULL DEFAULT 0
);

-- Enums
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');
CREATE TYPE "UnitType" AS ENUM ('APARTMENT', 'HOUSE', 'COMMERCIAL', 'PARKING', 'STORAGE', 'OTHER');
CREATE TYPE "IdType" AS ENUM ('CEDULA_V', 'CEDULA_E', 'RIF', 'PASSPORT', 'OTHER');
CREATE TYPE "Role" AS ENUM ('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'ORG_ADMIN', 'COMMUNITY_ADMIN', 'BOARD_MEMBER', 'OWNER', 'TENANT', 'SECURITY');
CREATE TYPE "MembershipScope" AS ENUM ('PLATFORM', 'ORGANIZATION', 'COMMUNITY');
CREATE TYPE "Currency" AS ENUM ('VES', 'USD');
CREATE TYPE "ExchangeSource" AS ENUM ('BCV', 'BINANCE_P2P', 'MANUAL');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PERMISSION_DENIED', 'EXPORT', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED', 'INVOICE_ISSUED', 'INVOICE_VOIDED', 'RATE_FETCHED', 'ROLE_GRANTED', 'ROLE_REVOKED', 'FINE_APPLIED', 'MONTHLY_FEE_UPDATED', 'EXTRA_FEE_APPLIED');
CREATE TYPE "ExpenseCategory" AS ENUM ('ELECTRICITY', 'WATER', 'GAS', 'INTERNET', 'CLEANING', 'GARDENING', 'SECURITY', 'ELEVATOR', 'STAFF_PAYROLL', 'ADMINISTRATION', 'INSURANCE', 'REPAIRS', 'RESERVE_FUND', 'TAXES', 'OTHER');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIAL', 'PAID', 'OVERDUE', 'VOIDED');
CREATE TYPE "InvoiceType" AS ENUM ('ALIQUOT', 'SPECIAL_FEE', 'FINE', 'OTHER', 'EXTRA_FEE');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_BSS', 'CASH_USD', 'TRANSFER_BSS', 'TRANSFER_USD', 'ZELLE', 'PAGO_MOVIL', 'CRYPTO', 'CHECK', 'OTHER');
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED', 'CLOSED');
CREATE TYPE "IncomeCategory" AS ENUM ('HALL_RENTAL', 'PARKING_FEE', 'GUEST_FEE', 'INTEREST', 'DONATION', 'PENALTY', 'OTHER');
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'OTHER');
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'IN_APP');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');
CREATE TYPE "NotificationEvent" AS ENUM ('INVOICE_ISSUED', 'PAYMENT_RECEIVED', 'PAYMENT_REMINDER', 'OVERDUE_ALERT', 'MAINTENANCE_ASSIGNED', 'MAINTENANCE_DONE', 'ANNOUNCEMENT', 'ASSEMBLY_INVITE');
CREATE TYPE "VisitorStatus" AS ENUM ('PENDING', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'EXPIRED');
CREATE TYPE "ViolationType" AS ENUM ('NOISE', 'PARKING', 'PETS', 'COMMON_AREAS', 'ELEVATOR_MISUSE', 'GARBAGE', 'OTHER');
CREATE TYPE "BoardRole" AS ENUM ('PRESIDENT', 'VICE_PRESIDENT', 'TREASURER', 'SECRETARY', 'VOCAL_1', 'VOCAL_2', 'VOCAL_3', 'ALTERNATE');
CREATE TYPE "AssemblyStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED');
CREATE TYPE "VoteChoice" AS ENUM ('FOR', 'AGAINST', 'ABSTAIN');
CREATE TYPE "DocumentCategory" AS ENUM ('REGULATION', 'MINUTES', 'CERTIFICATE', 'BUDGET', 'CONTRACT', 'LEGAL', 'OTHER');

-- Tables
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
    "maxCommunities" INTEGER NOT NULL, "maxUnits" INTEGER NOT NULL, "priceUsd" DECIMAL(10,2) NOT NULL,
    "features" JSONB NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL, "legalName" TEXT, "rif" TEXT,
    "email" TEXT NOT NULL, "phone" TEXT, "address" TEXT, "city" TEXT, "country" TEXT NOT NULL DEFAULT 'VE',
    "logoUrl" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL', "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Community" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL, "rif" TEXT,
    "address" TEXT NOT NULL, "city" TEXT NOT NULL, "state" TEXT, "country" TEXT NOT NULL DEFAULT 'VE',
    "totalUnits" INTEGER NOT NULL DEFAULT 0, "primaryCurrency" "Currency" NOT NULL DEFAULT 'USD',
    "foundedAt" TIMESTAMP(3), "notes" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
    "floorsCount" INTEGER, "towersCount" INTEGER NOT NULL DEFAULT 1,
    "monthlyFeeUsd" DECIMAL(18,2), "monthlyFeeSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "code" TEXT NOT NULL, "type" "UnitType" NOT NULL DEFAULT 'APARTMENT', "aliquot" DECIMAL(9,6) NOT NULL,
    "floor" INTEGER, "tower" TEXT, "areaM2" DECIMAL(10,2), "bedrooms" INTEGER, "bathrooms" INTEGER,
    "parkingSpots" INTEGER NOT NULL DEFAULT 0, "storageUnits" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Person" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL,
    "idType" "IdType" NOT NULL DEFAULT 'CEDULA_V', "idNumber" TEXT NOT NULL,
    "email" TEXT, "phone" TEXT, "whatsapp" TEXT, "address" TEXT, "notes" TEXT, "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "User" (
    "id" TEXT NOT NULL, "email" TEXT NOT NULL, "emailVerified" TIMESTAMP(3), "name" TEXT, "image" TEXT,
    "passwordHash" TEXT, "twoFactorSecret" TEXT, "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3), "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "scope" "MembershipScope" NOT NULL, "role" "Role" NOT NULL,
    "organizationId" TEXT, "communityId" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Ownership" (
    "id" TEXT NOT NULL, "unitId" TEXT NOT NULL, "personId" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL, "startDate" TIMESTAMP(3) NOT NULL, "endDate" TIMESTAMP(3),
    "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ownership_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Tenancy" (
    "id" TEXT NOT NULL, "unitId" TEXT NOT NULL, "personId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL, "endDate" TIMESTAMP(3), "monthlyRentUsd" DECIMAL(12,2),
    "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenancy_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Account" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL, "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL, "refresh_token" TEXT, "access_token" TEXT, "expires_at" INTEGER,
    "token_type" TEXT, "scope" TEXT, "id_token" TEXT, "session_state" TEXT,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Session" (
    "id" TEXT NOT NULL, "sessionToken" TEXT NOT NULL, "userId" TEXT NOT NULL, "expires" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL, "token" TEXT NOT NULL, "expires" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL, "date" DATE NOT NULL, "source" "ExchangeSource" NOT NULL,
    "vesPerUsd" DECIMAL(18,8) NOT NULL, "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL, "organizationId" TEXT, "actorId" TEXT, "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL, "entityId" TEXT, "before" JSONB, "after" JSONB,
    "ip" TEXT, "userAgent" TEXT, "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL, "description" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL, "periodMonth" INTEGER NOT NULL,
    "amountBss" DECIMAL(18,2) NOT NULL, "amountUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL, "exchangeSource" "ExchangeSource" NOT NULL,
    "currencyPrimary" "Currency" NOT NULL, "supplierName" TEXT, "invoiceNumber" TEXT,
    "receiptDate" TIMESTAMP(3), "notes" TEXT, "invoicedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3), "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdById" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL, "invoiceNumber" TEXT NOT NULL, "type" "InvoiceType" NOT NULL DEFAULT 'ALIQUOT',
    "periodYear" INTEGER NOT NULL, "periodMonth" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL, "dueDate" TIMESTAMP(3) NOT NULL,
    "totalBss" DECIMAL(18,2) NOT NULL, "totalUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL, "exchangeSource" "ExchangeSource" NOT NULL,
    "currencyPrimary" "Currency" NOT NULL,
    "paidBss" DECIMAL(18,2) NOT NULL DEFAULT 0, "paidUsd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "voidedAt" TIMESTAMP(3), "voidReason" TEXT, "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "expenseId" TEXT,
    "description" TEXT NOT NULL, "amountBss" DECIMAL(18,2) NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL, "aliquot" DECIMAL(9,6) NOT NULL,
    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL, "amountBss" DECIMAL(18,2) NOT NULL, "amountUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL, "exchangeSource" "ExchangeSource" NOT NULL,
    "currencyPrimary" "Currency" NOT NULL, "method" "PaymentMethod" NOT NULL,
    "reference" TEXT, "paidAt" TIMESTAMP(3) NOT NULL, "bankAccountId" TEXT,
    "reconciledAt" TIMESTAMP(3), "notes" TEXT, "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT, "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdById" TEXT,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL, "paymentId" TEXT NOT NULL, "invoiceId" TEXT NOT NULL,
    "amountBss" DECIMAL(18,2) NOT NULL, "amountUsd" DECIMAL(18,2) NOT NULL,
    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL, "accountNumber" TEXT NOT NULL, "accountHolder" TEXT NOT NULL,
    "accountType" TEXT NOT NULL, "currency" "Currency" NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL, "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalUsd" DECIMAL(18,2) NOT NULL DEFAULT 0, "approvedAt" TIMESTAMP(3), "approvedById" TEXT, "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BudgetItem" (
    "id" TEXT NOT NULL, "budgetId" TEXT NOT NULL, "category" "ExpenseCategory" NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL, "notes" TEXT,
    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Income" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "category" "IncomeCategory" NOT NULL, "description" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL, "periodMonth" INTEGER NOT NULL,
    "amountBss" DECIMAL(18,2) NOT NULL, "amountUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL, "exchangeSource" "ExchangeSource" NOT NULL,
    "currencyPrimary" "Currency" NOT NULL, "reference" TEXT, "notes" TEXT,
    "voidedAt" TIMESTAMP(3), "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdById" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "specialty" TEXT, "phone" TEXT, "email" TEXT, "rating" DECIMAL(3,2),
    "notes" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "unitId" TEXT, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL, "priority" "WorkOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN', "contractorId" TEXT,
    "estimatedCostUsd" DECIMAL(18,2), "actualCostUsd" DECIMAL(18,2),
    "scheduledAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "reportedById" TEXT,
    "assignedAt" TIMESTAMP(3), "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkOrderActivity" (
    "id" TEXT NOT NULL, "workOrderId" TEXT NOT NULL, "actorId" TEXT,
    "type" TEXT NOT NULL, "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkOrderActivity_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "personId" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL DEFAULT 'CAR', "brand" TEXT, "model" TEXT,
    "year" INTEGER, "color" TEXT, "plate" TEXT, "parkingSpot" TEXT, "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "event" "NotificationEvent" NOT NULL,
    "name" TEXT, "body" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT, "unitId" TEXT, "personId" TEXT,
    "channel" "NotificationChannel" NOT NULL, "event" "NotificationEvent" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipientPhone" TEXT, "recipientEmail" TEXT, "subject" TEXT, "body" TEXT NOT NULL,
    "externalId" TEXT, "errorMessage" TEXT, "sentAt" TIMESTAMP(3), "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "title" TEXT NOT NULL, "body" TEXT NOT NULL, "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3),
    "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "event" "NotificationEvent" NOT NULL,
    "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL, "authorizedById" TEXT, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL,
    "idNumber" TEXT, "idType" TEXT DEFAULT 'V', "phone" TEXT, "vehiclePlate" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL, "validUntil" TIMESTAMP(3) NOT NULL, "accessCode" TEXT NOT NULL,
    "purpose" TEXT, "notes" TEXT, "status" "VisitorStatus" NOT NULL DEFAULT 'PENDING',
    "checkInAt" TIMESTAMP(3), "checkOutAt" TIMESTAMP(3), "checkedInById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "unitId" TEXT, "visitorId" TEXT, "personName" TEXT NOT NULL, "personId_doc" TEXT,
    "vehiclePlate" TEXT, "purpose" TEXT, "direction" TEXT NOT NULL DEFAULT 'IN',
    "deniedReason" TEXT, "registeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Violation" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL, "type" "ViolationType" NOT NULL, "description" TEXT NOT NULL,
    "evidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[], "reportedById" TEXT,
    "fineInvoiceId" TEXT, "fineAmountUsd" DECIMAL(18,2), "resolvedAt" TIMESTAMP(3), "resolvedNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Violation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BoardMember" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "personId" TEXT NOT NULL, "role" "BoardRole" NOT NULL, "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3), "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Assembly" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "title" TEXT NOT NULL, "description" TEXT, "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT, "quorumRequired" INTEGER NOT NULL DEFAULT 50,
    "quorumReached" BOOLEAN, "attendeesCount" INTEGER,
    "status" "AssemblyStatus" NOT NULL DEFAULT 'SCHEDULED',
    "closedAt" TIMESTAMP(3), "minutesUrl" TEXT, "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Assembly_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AssemblyAgendaItem" (
    "id" TEXT NOT NULL, "assemblyId" TEXT NOT NULL, "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL, "description" TEXT, "requiresVote" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT, "votesFor" INTEGER NOT NULL DEFAULT 0,
    "votesAgainst" INTEGER NOT NULL DEFAULT 0, "votesAbstain" INTEGER NOT NULL DEFAULT 0,
    "approved" BOOLEAN, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssemblyAgendaItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AssemblyVote" (
    "id" TEXT NOT NULL, "assemblyId" TEXT NOT NULL, "agendaItemId" TEXT NOT NULL,
    "personId" TEXT NOT NULL, "unitId" TEXT NOT NULL, "choice" "VoteChoice" NOT NULL,
    "comment" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssemblyVote_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CommunityDocument" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
    "fileUrl" TEXT NOT NULL, "fileName" TEXT NOT NULL, "fileSizeBytes" INTEGER,
    "mimeType" TEXT, "uploadedById" TEXT, "assemblyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityDocument_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PortalToken" (
    "id" TEXT NOT NULL, "token" TEXT NOT NULL, "personId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalToken_pkey" PRIMARY KEY ("id")
);

-- ── INDEXES ──────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Organization_active_deletedAt_idx" ON "Organization"("active", "deletedAt");
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "Community_organizationId_active_idx" ON "Community"("organizationId", "active");
CREATE INDEX "Unit_organizationId_idx" ON "Unit"("organizationId");
CREATE INDEX "Unit_communityId_active_idx" ON "Unit"("communityId", "active");
CREATE UNIQUE INDEX "Unit_communityId_code_key" ON "Unit"("communityId", "code");
CREATE INDEX "Unit_communityId_floor_idx" ON "Unit"("communityId", "floor");
CREATE INDEX "Unit_communityId_tower_idx" ON "Unit"("communityId", "tower");
CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");
CREATE INDEX "Person_organizationId_lastName_firstName_idx" ON "Person"("organizationId", "lastName", "firstName");
CREATE UNIQUE INDEX "Person_organizationId_idType_idNumber_key" ON "Person"("organizationId", "idType", "idNumber");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_active_idx" ON "User"("active");
CREATE INDEX "Membership_userId_active_idx" ON "Membership"("userId", "active");
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");
CREATE INDEX "Membership_communityId_role_idx" ON "Membership"("communityId", "role");
CREATE UNIQUE INDEX "Membership_userId_scope_organizationId_communityId_key" ON "Membership"("userId", "scope", "organizationId", "communityId");
CREATE INDEX "Ownership_unitId_endDate_idx" ON "Ownership"("unitId", "endDate");
CREATE INDEX "Ownership_personId_idx" ON "Ownership"("personId");
CREATE INDEX "Tenancy_unitId_endDate_idx" ON "Tenancy"("unitId", "endDate");
CREATE INDEX "Tenancy_personId_idx" ON "Tenancy"("personId");
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
CREATE INDEX "ExchangeRate_date_idx" ON "ExchangeRate"("date");
CREATE UNIQUE INDEX "ExchangeRate_date_source_key" ON "ExchangeRate"("date", "source");
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "Expense_organizationId_idx" ON "Expense"("organizationId");
CREATE INDEX "Expense_communityId_periodYear_periodMonth_idx" ON "Expense"("communityId", "periodYear", "periodMonth");
CREATE INDEX "Expense_communityId_invoicedAt_idx" ON "Expense"("communityId", "invoicedAt");
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");
CREATE INDEX "Invoice_communityId_periodYear_periodMonth_idx" ON "Invoice"("communityId", "periodYear", "periodMonth");
CREATE INDEX "Invoice_unitId_status_idx" ON "Invoice"("unitId", "status");
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");
CREATE UNIQUE INDEX "Invoice_communityId_invoiceNumber_key" ON "Invoice"("communityId", "invoiceNumber");
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX "InvoiceItem_expenseId_idx" ON "InvoiceItem"("expenseId");
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");
CREATE INDEX "Payment_communityId_paidAt_idx" ON "Payment"("communityId", "paidAt");
CREATE INDEX "Payment_unitId_paidAt_idx" ON "Payment"("unitId", "paidAt");
CREATE INDEX "Payment_voidedAt_idx" ON "Payment"("voidedAt");
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceId_key" ON "PaymentAllocation"("paymentId", "invoiceId");
CREATE INDEX "BankAccount_communityId_active_idx" ON "BankAccount"("communityId", "active");
CREATE INDEX "Budget_organizationId_idx" ON "Budget"("organizationId");
CREATE UNIQUE INDEX "Budget_communityId_year_key" ON "Budget"("communityId", "year");
CREATE INDEX "BudgetItem_budgetId_idx" ON "BudgetItem"("budgetId");
CREATE INDEX "Income_organizationId_idx" ON "Income"("organizationId");
CREATE INDEX "Income_communityId_periodYear_periodMonth_idx" ON "Income"("communityId", "periodYear", "periodMonth");
CREATE INDEX "Contractor_organizationId_active_idx" ON "Contractor"("organizationId", "active");
CREATE INDEX "WorkOrder_organizationId_idx" ON "WorkOrder"("organizationId");
CREATE INDEX "WorkOrder_communityId_status_idx" ON "WorkOrder"("communityId", "status");
CREATE INDEX "WorkOrder_unitId_idx" ON "WorkOrder"("unitId");
CREATE INDEX "WorkOrderActivity_workOrderId_createdAt_idx" ON "WorkOrderActivity"("workOrderId", "createdAt");
CREATE INDEX "Vehicle_organizationId_idx" ON "Vehicle"("organizationId");
CREATE INDEX "Vehicle_personId_idx" ON "Vehicle"("personId");
CREATE INDEX "WhatsAppTemplate_organizationId_idx" ON "WhatsAppTemplate"("organizationId");
CREATE UNIQUE INDEX "WhatsAppTemplate_organizationId_event_key" ON "WhatsAppTemplate"("organizationId", "event");
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");
CREATE INDEX "Notification_personId_status_idx" ON "Notification"("personId", "status");
CREATE INDEX "Notification_unitId_idx" ON "Notification"("unitId");
CREATE INDEX "Announcement_communityId_publishedAt_idx" ON "Announcement"("communityId", "publishedAt");
CREATE INDEX "EmailTemplate_organizationId_idx" ON "EmailTemplate"("organizationId");
CREATE UNIQUE INDEX "EmailTemplate_organizationId_event_key" ON "EmailTemplate"("organizationId", "event");
CREATE UNIQUE INDEX "Visitor_accessCode_key" ON "Visitor"("accessCode");
CREATE INDEX "Visitor_communityId_status_idx" ON "Visitor"("communityId", "status");
CREATE INDEX "Visitor_communityId_validFrom_validUntil_idx" ON "Visitor"("communityId", "validFrom", "validUntil");
CREATE INDEX "Visitor_unitId_idx" ON "Visitor"("unitId");
CREATE INDEX "AccessLog_communityId_createdAt_idx" ON "AccessLog"("communityId", "createdAt");
CREATE INDEX "AccessLog_unitId_createdAt_idx" ON "AccessLog"("unitId", "createdAt");
CREATE INDEX "Violation_communityId_createdAt_idx" ON "Violation"("communityId", "createdAt");
CREATE INDEX "Violation_unitId_idx" ON "Violation"("unitId");
CREATE INDEX "BoardMember_communityId_endDate_idx" ON "BoardMember"("communityId", "endDate");
CREATE INDEX "BoardMember_personId_idx" ON "BoardMember"("personId");
CREATE INDEX "Assembly_communityId_scheduledAt_idx" ON "Assembly"("communityId", "scheduledAt");
CREATE INDEX "Assembly_communityId_status_idx" ON "Assembly"("communityId", "status");
CREATE INDEX "AssemblyAgendaItem_assemblyId_order_idx" ON "AssemblyAgendaItem"("assemblyId", "order");
CREATE INDEX "AssemblyVote_assemblyId_personId_idx" ON "AssemblyVote"("assemblyId", "personId");
CREATE UNIQUE INDEX "AssemblyVote_agendaItemId_unitId_key" ON "AssemblyVote"("agendaItemId", "unitId");
CREATE INDEX "CommunityDocument_communityId_category_idx" ON "CommunityDocument"("communityId", "category");
CREATE INDEX "CommunityDocument_communityId_createdAt_idx" ON "CommunityDocument"("communityId", "createdAt");
CREATE UNIQUE INDEX "PortalToken_token_key" ON "PortalToken"("token");
CREATE INDEX "PortalToken_personId_idx" ON "PortalToken"("personId");

-- ── FOREIGN KEYS ─────────────────────────────────────────────────────────────
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Community" ADD CONSTRAINT "Community_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Person" ADD CONSTRAINT "Person_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Income" ADD CONSTRAINT "Income_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkOrderActivity" ADD CONSTRAINT "WorkOrderActivity_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_fineInvoiceId_fkey" FOREIGN KEY ("fineInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssemblyAgendaItem" ADD CONSTRAINT "AssemblyAgendaItem_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssemblyVote" ADD CONSTRAINT "AssemblyVote_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssemblyVote" ADD CONSTRAINT "AssemblyVote_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AssemblyAgendaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssemblyVote" ADD CONSTRAINT "AssemblyVote_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssemblyVote" ADD CONSTRAINT "AssemblyVote_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunityDocument" ADD CONSTRAINT "CommunityDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityDocument" ADD CONSTRAINT "CommunityDocument_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityDocument" ADD CONSTRAINT "CommunityDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunityDocument" ADD CONSTRAINT "CommunityDocument_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalToken" ADD CONSTRAINT "PortalToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── PRISMA MIGRATION TRACKING ────────────────────────────────────────────────
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('c93aadac-f5ea-4f85-a279-feba4973919e', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429020424_init', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('936933e2-56e1-4fb1-942b-3394b89fa8cb', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429021758_finance', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('541f243b-f5b9-4cdf-ad9c-a2ee588bdf32', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429023802_phase3_floors_income_workorders', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('e729c2ee-f10b-4aca-a84a-acd2c8915718', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429025707_phase3_vehicles', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('c7baea49-e2c2-4130-8211-269bbdf9fb9c', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429030233_phase4_notifications', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('cfe85f07-b35e-4526-9564-72bc5d0cc833', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429031147_phase4_notification_relations', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('8d396ffa-b95a-4da1-a220-d896084b6bcd', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429034625_add_monthly_fee', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('c2e76ede-1105-4158-9864-7cbc33937a77', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429035142_add_audit_fine_monthly_fee', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('348d0064-896b-40ea-b610-b6564afc8106', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429035726_phase5_security_access', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('ecdfddb2-92ff-46a2-8689-c7f83ba157bd', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429040943_phase6_governance', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('aa11bb22-0001-0001-0001-000000000001', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260429234637_add_email_template', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('aa11bb22-0002-0002-0002-000000000002', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260430005547_add_extra_fee_portal_token', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('aa11bb22-0003-0003-0003-000000000003', '0000000000000000000000000000000000000000000000000000000000000000', now(), '20260430010026_add_extra_fee_audit_action', NULL, NULL, now(), 1) ON CONFLICT (id) DO NOTHING;

-- ── SEED ─────────────────────────────────────────────────────────────────────
DO $$ DECLARE
  v_owner_id TEXT;
  v_org_id   TEXT;
  v_pro_id   TEXT;
  v_community_id TEXT := 'hugo-chavez-frias-seed';
  v_floor INT;
  v_apt  TEXT;
  v_code TEXT;
BEGIN

INSERT INTO "Plan" (id, code, name, description, "maxCommunities", "maxUnits", "priceUsd", features, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'STARTER', 'Starter', 'Para un solo edificio pequeño', 1, 50, 25, '{"whatsapp":false,"advancedReports":false,"customBranding":false}'::jsonb, now(), now()),
  (gen_random_uuid()::text, 'PRO', 'Pro', 'Para administradoras pequeñas', 5, 500, 99, '{"whatsapp":true,"advancedReports":true,"customBranding":false}'::jsonb, now(), now()),
  (gen_random_uuid()::text, 'ENTERPRISE', 'Enterprise', 'Sin límites', 999, 99999, 299, '{"whatsapp":true,"advancedReports":true,"customBranding":true,"api":true}'::jsonb, now(), now())
ON CONFLICT (code) DO NOTHING;

SELECT id INTO v_pro_id FROM "Plan" WHERE code = 'PRO';

INSERT INTO "User" (id, email, name, "passwordHash", "emailVerified", active, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'admin@condominios.local', 'Platform Owner', '$argon2id$v=19$m=65536,t=3,p=4$rHxIDgpTXlhRrFAYvO/enQ$3QVZ93J6frXMZGknWGNAj0O/xFbDnsTbqYqfYiXVt2g', now(), true, now(), now())
ON CONFLICT (email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", active = true;

SELECT id INTO v_owner_id FROM "User" WHERE email = 'admin@condominios.local';

INSERT INTO "Membership" (id, "userId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, 'PLATFORM', 'PLATFORM_OWNER', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND scope = 'PLATFORM' AND role = 'PLATFORM_OWNER');

INSERT INTO "Organization" (id, slug, name, "legalName", email, city, country, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'administradora-demo', 'Administradora Demo', 'Administradora Demo C.A.', 'admin@condominios.local', 'Caracas', 'VE', now(), now())
ON CONFLICT (slug) DO NOTHING;

SELECT id INTO v_org_id FROM "Organization" WHERE slug = 'administradora-demo';

INSERT INTO "Membership" (id, "userId", "organizationId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, v_org_id, 'ORGANIZATION', 'ORG_ADMIN', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND "organizationId" = v_org_id AND role = 'ORG_ADMIN');

INSERT INTO "Subscription" (id, "organizationId", "planId", status, "currentPeriodStart", "currentPeriodEnd", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_org_id, v_pro_id, 'ACTIVE', now(), now() + interval '365 days', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Subscription" WHERE "organizationId" = v_org_id);

INSERT INTO "Community" (id, "organizationId", name, address, city, state, country, "totalUnits", "floorsCount", "towersCount", "primaryCurrency", "createdAt", "updatedAt")
VALUES (v_community_id, v_org_id, 'Residencias Hugo Chávez Frías', 'Av. Principal de las Mercedes', 'Caracas', 'Distrito Capital', 'VE', 40, 10, 1, 'USD', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Membership" (id, "userId", "organizationId", "communityId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, v_org_id, v_community_id, 'COMMUNITY', 'COMMUNITY_ADMIN', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND "communityId" = v_community_id AND role = 'COMMUNITY_ADMIN');

FOREACH v_floor IN ARRAY ARRAY[1,2,3,4,5,6,7,8,9,10] LOOP
  FOREACH v_apt IN ARRAY ARRAY['A','B','C','D'] LOOP
    v_code := v_floor::text || v_apt;
    INSERT INTO "Unit" (id, "organizationId", "communityId", code, type, floor, aliquot, bedrooms, bathrooms, "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, v_org_id, v_community_id, v_code, 'APARTMENT', v_floor, 2.500000, 3, 2, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM "Unit" WHERE "communityId" = v_community_id AND code = v_code);
  END LOOP;
END LOOP;

RAISE NOTICE 'Seed completado. Login: admin@condominios.local / admin1234';
END $$;
