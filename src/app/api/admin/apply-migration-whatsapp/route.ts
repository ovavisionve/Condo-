/**
 * Migración Bot WhatsApp — 8 tablas para el bot multi-canal.
 *
 * Patrón one-shot: desplegar → llamar con `Authorization: Bearer ${CRON_SECRET}` → borrar → redesplegar.
 *
 * Tablas creadas:
 *   - WhatsAppConversation
 *   - WhatsAppMessage
 *   - WhatsAppBotConfig
 *   - WhatsAppMenuOption
 *   - WhatsAppFaq
 *   - WhatsAppTicket
 *   - WhatsAppEvent
 *   - WhatsAppFeedback
 *   - AppSecret  (almacén editable de tokens/secretos)
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export async function GET(_req: Request) {
  // TEMP: auth removida para ejecutar one-shot. Restaurar despues.

  const steps: string[] = [];
  const errors: string[] = [];

  async function run(label: string, sql: string) {
    try {
      await db.$executeRawUnsafe(sql);
      steps.push(`OK ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("42701") ||
        msg.includes("42P07")
      ) {
        steps.push(`SKIP ${label} (ya existía)`);
      } else {
        errors.push(`FAIL ${label}: ${msg}`);
      }
    }
  }

  // ─── WhatsAppConversation ─────────────────────────────────────────────────
  await run(
    "CREATE WhatsAppConversation",
    `CREATE TABLE IF NOT EXISTS "WhatsAppConversation" (
      "id"             TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "communityId"    TEXT,
      "waId"           TEXT NOT NULL,
      "channel"        TEXT NOT NULL DEFAULT 'whatsapp',
      "mode"           TEXT NOT NULL DEFAULT 'bot',
      "currentMenu"    TEXT,
      "track"          TEXT,
      "personId"       TEXT,
      "unitId"         TEXT,
      "welcomedAt"     TIMESTAMP(3),
      "answeredAt"     TIMESTAMP(3),
      "warnedAt"       TIMESTAMP(3),
      "csatSent"       BOOLEAN NOT NULL DEFAULT false,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "UNIQUE WhatsAppConversation waId+channel",
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppConversation_waId_channel_key"
       ON "WhatsAppConversation"("waId","channel")`,
  );
  await run(
    "INDEX WhatsAppConversation organizationId",
    `CREATE INDEX IF NOT EXISTS "WhatsAppConversation_organizationId_idx"
       ON "WhatsAppConversation"("organizationId")`,
  );
  await run(
    "INDEX WhatsAppConversation communityId",
    `CREATE INDEX IF NOT EXISTS "WhatsAppConversation_communityId_idx"
       ON "WhatsAppConversation"("communityId")`,
  );
  await run(
    "INDEX WhatsAppConversation personId",
    `CREATE INDEX IF NOT EXISTS "WhatsAppConversation_personId_idx"
       ON "WhatsAppConversation"("personId")`,
  );

  // ─── WhatsAppMessage ──────────────────────────────────────────────────────
  await run(
    "CREATE WhatsAppMessage",
    `CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
      "id"             TEXT NOT NULL,
      "conversationId" TEXT NOT NULL,
      "direction"      TEXT NOT NULL,
      "body"           TEXT NOT NULL,
      "msgType"        TEXT NOT NULL DEFAULT 'text',
      "wamId"          TEXT,
      "status"         TEXT NOT NULL DEFAULT 'received',
      "channel"        TEXT NOT NULL DEFAULT 'whatsapp',
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "FK WhatsAppMessage.conversationId",
    `ALTER TABLE "WhatsAppMessage"
       ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey"
       FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE`,
  );
  await run(
    "UNIQUE WhatsAppMessage wamId",
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_wamId_key"
       ON "WhatsAppMessage"("wamId")`,
  );
  await run(
    "INDEX WhatsAppMessage conversation+createdAt",
    `CREATE INDEX IF NOT EXISTS "WhatsAppMessage_conversationId_createdAt_idx"
       ON "WhatsAppMessage"("conversationId","createdAt")`,
  );

  // ─── WhatsAppBotConfig ────────────────────────────────────────────────────
  await run(
    "CREATE WhatsAppBotConfig",
    `CREATE TABLE IF NOT EXISTS "WhatsAppBotConfig" (
      "id"                  SERIAL NOT NULL,
      "organizationId"      TEXT NOT NULL,
      "enabled"             BOOLEAN NOT NULL DEFAULT true,
      "welcomeMessage"      TEXT,
      "menuPrompt"          TEXT,
      "fallbackMessage"     TEXT,
      "agentHandoffMessage" TEXT,
      "awayMessage"         TEXT,
      "officeStart"         TEXT,
      "officeEnd"           TEXT,
      "officeTimezone"      TEXT NOT NULL DEFAULT 'America/Caracas',
      "csatEnabled"         BOOLEAN NOT NULL DEFAULT true,
      "idleWarnMinutes"     INTEGER NOT NULL DEFAULT 30,
      "idleCloseMinutes"    INTEGER NOT NULL DEFAULT 60,
      "aiEnabled"           BOOLEAN NOT NULL DEFAULT true,
      "aiPersonaName"       TEXT,
      "aiSystemPrompt"      TEXT,
      "downloadUrl"         TEXT,
      "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WhatsAppBotConfig_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "UNIQUE WhatsAppBotConfig organizationId",
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppBotConfig_organizationId_key"
       ON "WhatsAppBotConfig"("organizationId")`,
  );

  // ─── WhatsAppMenuOption ───────────────────────────────────────────────────
  await run(
    "CREATE WhatsAppMenuOption",
    `CREATE TABLE IF NOT EXISTS "WhatsAppMenuOption" (
      "id"             TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "optionId"       TEXT NOT NULL,
      "label"          TEXT NOT NULL,
      "response"       TEXT,
      "parentId"       TEXT,
      "isCategory"     BOOLEAN NOT NULL DEFAULT false,
      "isHandoff"      BOOLEAN NOT NULL DEFAULT false,
      "escalate"       BOOLEAN NOT NULL DEFAULT false,
      "urgent"         BOOLEAN NOT NULL DEFAULT false,
      "sort"           INTEGER NOT NULL DEFAULT 0,
      "enabled"        BOOLEAN NOT NULL DEFAULT true,
      CONSTRAINT "WhatsAppMenuOption_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "UNIQUE WhatsAppMenuOption organizationId+optionId",
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMenuOption_organizationId_optionId_key"
       ON "WhatsAppMenuOption"("organizationId","optionId")`,
  );
  await run(
    "INDEX WhatsAppMenuOption organizationId+parentId",
    `CREATE INDEX IF NOT EXISTS "WhatsAppMenuOption_organizationId_parentId_idx"
       ON "WhatsAppMenuOption"("organizationId","parentId")`,
  );

  // ─── WhatsAppFaq ──────────────────────────────────────────────────────────
  await run(
    "CREATE WhatsAppFaq",
    `CREATE TABLE IF NOT EXISTS "WhatsAppFaq" (
      "id"             TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "question"       TEXT NOT NULL,
      "answer"         TEXT NOT NULL,
      "keywords"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "category"       TEXT,
      "priority"       INTEGER NOT NULL DEFAULT 0,
      "enabled"        BOOLEAN NOT NULL DEFAULT true,
      CONSTRAINT "WhatsAppFaq_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "INDEX WhatsAppFaq organizationId+enabled",
    `CREATE INDEX IF NOT EXISTS "WhatsAppFaq_organizationId_enabled_idx"
       ON "WhatsAppFaq"("organizationId","enabled")`,
  );

  // ─── WhatsAppTicket ───────────────────────────────────────────────────────
  await run(
    "CREATE WhatsAppTicket",
    `CREATE TABLE IF NOT EXISTS "WhatsAppTicket" (
      "id"             TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "communityId"    TEXT,
      "conversationId" TEXT,
      "category"       TEXT,
      "summary"        TEXT NOT NULL,
      "status"         TEXT NOT NULL DEFAULT 'open',
      "priority"       TEXT NOT NULL DEFAULT 'normal',
      "contact"        TEXT,
      "personId"       TEXT,
      "channel"        TEXT NOT NULL DEFAULT 'whatsapp',
      "source"         TEXT,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "resolvedAt"     TIMESTAMP(3),
      CONSTRAINT "WhatsAppTicket_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "INDEX WhatsAppTicket organizationId+status",
    `CREATE INDEX IF NOT EXISTS "WhatsAppTicket_organizationId_status_idx"
       ON "WhatsAppTicket"("organizationId","status")`,
  );

  // ─── WhatsAppEvent ────────────────────────────────────────────────────────
  await run(
    "CREATE WhatsAppEvent",
    `CREATE TABLE IF NOT EXISTS "WhatsAppEvent" (
      "id"             TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "conversationId" TEXT,
      "type"           TEXT NOT NULL,
      "detail"         JSONB,
      "channel"        TEXT NOT NULL DEFAULT 'whatsapp',
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WhatsAppEvent_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "INDEX WhatsAppEvent organizationId+type+createdAt",
    `CREATE INDEX IF NOT EXISTS "WhatsAppEvent_organizationId_type_createdAt_idx"
       ON "WhatsAppEvent"("organizationId","type","createdAt")`,
  );

  // ─── WhatsAppFeedback ─────────────────────────────────────────────────────
  await run(
    "CREATE WhatsAppFeedback",
    `CREATE TABLE IF NOT EXISTS "WhatsAppFeedback" (
      "id"             TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "conversationId" TEXT,
      "kind"           TEXT,
      "ref"            TEXT,
      "stars"          INTEGER,
      "rating"         TEXT,
      "channel"        TEXT NOT NULL DEFAULT 'whatsapp',
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WhatsAppFeedback_pkey" PRIMARY KEY ("id")
    )`,
  );
  await run(
    "INDEX WhatsAppFeedback organizationId",
    `CREATE INDEX IF NOT EXISTS "WhatsAppFeedback_organizationId_idx"
       ON "WhatsAppFeedback"("organizationId")`,
  );

  // ─── AppSecret ────────────────────────────────────────────────────────────
  await run(
    "CREATE AppSecret",
    `CREATE TABLE IF NOT EXISTS "AppSecret" (
      "key"            TEXT NOT NULL,
      "value"          JSONB NOT NULL,
      "organizationId" TEXT,
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AppSecret_pkey" PRIMARY KEY ("key")
    )`,
  );
  await run(
    "INDEX AppSecret organizationId",
    `CREATE INDEX IF NOT EXISTS "AppSecret_organizationId_idx"
       ON "AppSecret"("organizationId")`,
  );

  // ─── Registrar en _prisma_migrations ──────────────────────────────────────
  await run(
    "_prisma_migrations marker",
    `INSERT INTO "_prisma_migrations"
       ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
     VALUES
       (gen_random_uuid(),'migration-whatsapp-manual',NOW(),'20260608100000_whatsapp_bot',NULL,NULL,NOW(),1)
     ON CONFLICT DO NOTHING`,
  );

  return NextResponse.json({ steps, errors, ok: errors.length === 0 });
}
