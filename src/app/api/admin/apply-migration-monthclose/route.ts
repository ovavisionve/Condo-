import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MonthClose" (
        "id"             TEXT        NOT NULL,
        "organizationId" TEXT        NOT NULL,
        "communityId"    TEXT        NOT NULL,
        "year"           INTEGER     NOT NULL,
        "month"          INTEGER     NOT NULL,
        "closedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "closedById"     TEXT        NOT NULL,
        "summary"        JSONB       NOT NULL DEFAULT '{}',
        "notes"          TEXT,
        PRIMARY KEY ("id"),
        CONSTRAINT "MonthClose_communityId_fkey"
          FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE,
        CONSTRAINT "MonthClose_closedById_fkey"
          FOREIGN KEY ("closedById") REFERENCES "User"("id"),
        UNIQUE ("communityId", "year", "month")
      );
      CREATE INDEX IF NOT EXISTS "MonthClose_communityId_idx" ON "MonthClose"("communityId");
    `);
    return NextResponse.json({ ok: true, message: "MonthClose table created" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
