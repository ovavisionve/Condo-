-- AlterEnum
ALTER TYPE "InvoiceType" ADD VALUE 'LEGAL_FEE';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'LEGAL_FEE_APPLIED';

-- CreateEnum
CREATE TYPE "LegalCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "Lawyer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lawyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "lawyerId" TEXT,
    "description" TEXT NOT NULL,
    "status" "LegalCaseStatus" NOT NULL DEFAULT 'OPEN',
    "feeInvoiceId" TEXT,
    "feeAmountUsd" DECIMAL(18,2),
    "createdById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lawyer_organizationId_active_idx" ON "Lawyer"("organizationId", "active");

-- CreateIndex
CREATE INDEX "LegalCase_communityId_createdAt_idx" ON "LegalCase"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "LegalCase_unitId_idx" ON "LegalCase"("unitId");

-- AddForeignKey
ALTER TABLE "Lawyer" ADD CONSTRAINT "Lawyer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_lawyerId_fkey" FOREIGN KEY ("lawyerId") REFERENCES "Lawyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_feeInvoiceId_fkey" FOREIGN KEY ("feeInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
