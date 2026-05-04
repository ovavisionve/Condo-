-- Migración: Áreas comunes + Reservas + INPC
-- Ejecutar en Supabase SQL Editor

-- Enum ReservationStatus
DO $$ BEGIN
  CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tabla CommonArea
CREATE TABLE IF NOT EXISTS "CommonArea" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId"   TEXT NOT NULL,
  "communityId"      TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "capacity"         INTEGER,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
  "rules"            TEXT,
  "openTime"         TEXT NOT NULL DEFAULT '08:00',
  "closeTime"        TEXT NOT NULL DEFAULT '22:00',
  "slotDurationMin"  INTEGER NOT NULL DEFAULT 120,
  "maxAdvanceDays"   INTEGER NOT NULL DEFAULT 30,
  "maxSimultaneous"  INTEGER NOT NULL DEFAULT 1,
  "costUsd"          DECIMAL(18,2),
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommonArea_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommonArea_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "CommonArea_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "CommonArea_communityId_active_idx" ON "CommonArea"("communityId", "active");
CREATE INDEX IF NOT EXISTS "CommonArea_organizationId_idx" ON "CommonArea"("organizationId");

-- Tabla Reservation
CREATE TABLE IF NOT EXISTS "Reservation" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "communityId"    TEXT NOT NULL,
  "areaId"         TEXT NOT NULL,
  "unitId"         TEXT NOT NULL,
  "requestedById"  TEXT,
  "date"           DATE NOT NULL,
  "startTime"      TEXT NOT NULL,
  "endTime"        TEXT NOT NULL,
  "guestCount"     INTEGER,
  "purpose"        TEXT,
  "notes"          TEXT,
  "status"         "ReservationStatus" NOT NULL DEFAULT 'PENDING',
  "approvedById"   TEXT,
  "approvedAt"     TIMESTAMP(3),
  "cancelledAt"    TIMESTAMP(3),
  "cancelReason"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Reservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "Reservation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE,
  CONSTRAINT "Reservation_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "CommonArea"("id") ON DELETE CASCADE,
  CONSTRAINT "Reservation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id"),
  CONSTRAINT "Reservation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id"),
  CONSTRAINT "Reservation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id")
);
CREATE INDEX IF NOT EXISTS "Reservation_communityId_date_idx" ON "Reservation"("communityId", "date");
CREATE INDEX IF NOT EXISTS "Reservation_areaId_date_idx" ON "Reservation"("areaId", "date");
CREATE INDEX IF NOT EXISTS "Reservation_unitId_idx" ON "Reservation"("unitId");
CREATE INDEX IF NOT EXISTS "Reservation_communityId_status_idx" ON "Reservation"("communityId", "status");

-- Tabla InpcRate
CREATE TABLE IF NOT EXISTS "InpcRate" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "year"        INTEGER NOT NULL,
  "month"       INTEGER NOT NULL,
  "indexValue"  DECIMAL(18,6) NOT NULL,
  "source"      TEXT NOT NULL DEFAULT 'MANUAL',
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InpcRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InpcRate_year_month_key" UNIQUE ("year", "month")
);
CREATE INDEX IF NOT EXISTS "InpcRate_year_month_idx" ON "InpcRate"("year", "month");

-- Registrar en _prisma_migrations para que Prisma no intente re-migrar
INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES (
  gen_random_uuid()::text,
  'reservations_inpc_manual',
  NOW(),
  '20260504_reservations_inpc',
  NULL, NULL, NOW(), 1
) ON CONFLICT DO NOTHING;
