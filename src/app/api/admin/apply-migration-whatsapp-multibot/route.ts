/**
 * Migración: hacer que WhatsAppBotConfig soporte 1 bot por community.
 *  - Drop unique(organizationId) único
 *  - Add columns: communityId, phoneNumberId
 *  - Add unique(organizationId, communityId)
 *  - Add unique(phoneNumberId) parcial (solo cuando no es null)
 *  - Change id from Int autoincrement → cuid
 * Cliente: Castaños B y Los Arrayanes tendrán bots independientes.
 *
 * Llamada one-shot, eliminar después.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const steps: string[] = [];
  const errors: string[] = [];
  const run = async (label: string, sql: string) => {
    try { await db.$executeRawUnsafe(sql); steps.push(`OK ${label}`); }
    catch (e) { errors.push(`FAIL ${label}: ${(e as Error).message}`); }
  };

  // 1. Drop unique constraint on organizationId
  await run("drop unique(organizationId)",
    `ALTER TABLE "WhatsAppBotConfig" DROP CONSTRAINT IF EXISTS "WhatsAppBotConfig_organizationId_key";`);

  // 2. Add new columns
  await run("add communityId",
    `ALTER TABLE "WhatsAppBotConfig" ADD COLUMN IF NOT EXISTS "communityId" TEXT;`);
  await run("add phoneNumberId",
    `ALTER TABLE "WhatsAppBotConfig" ADD COLUMN IF NOT EXISTS "phoneNumberId" TEXT;`);

  // 3. Change id from int to text (cuid) — only if it's still int
  // First check if migration needed
  await run("alter id to text",
    `DO $$
     BEGIN
       IF (SELECT data_type FROM information_schema.columns WHERE table_name='WhatsAppBotConfig' AND column_name='id') = 'integer' THEN
         ALTER TABLE "WhatsAppBotConfig" ALTER COLUMN "id" DROP DEFAULT;
         ALTER TABLE "WhatsAppBotConfig" ALTER COLUMN "id" TYPE TEXT USING "id"::text;
         DROP SEQUENCE IF EXISTS "WhatsAppBotConfig_id_seq" CASCADE;
       END IF;
     END$$;`);

  // 4. Add unique constraints
  await run("unique(organizationId, communityId)",
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppBotConfig_organizationId_communityId_key"
       ON "WhatsAppBotConfig" ("organizationId", COALESCE("communityId", ''));`);
  await run("unique(phoneNumberId)",
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppBotConfig_phoneNumberId_key"
       ON "WhatsAppBotConfig" ("phoneNumberId") WHERE "phoneNumberId" IS NOT NULL;`);

  // 5. Index on communityId
  await run("index(communityId)",
    `CREATE INDEX IF NOT EXISTS "WhatsAppBotConfig_communityId_idx" ON "WhatsAppBotConfig" ("communityId");`);

  return NextResponse.json({ ok: errors.length === 0, steps, errors });
}
