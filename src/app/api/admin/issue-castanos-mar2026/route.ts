/**
 * ONE-SHOT: emite los recibos de marzo 2026 para Castaños Torre B.
 * Eliminar después.
 */
import { NextResponse } from "next/server";
import { issueMonthlyInvoices } from "@/server/services/invoicing";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const COMMUNITY_ID = "cmoukqntu00015niqpsjlu4cw";

export async function GET() {
  const community = await db.community.findUnique({
    where: { id: COMMUNITY_ID },
    select: { id: true, organizationId: true, name: true },
  });
  if (!community) return NextResponse.json({ error: "community not found" }, { status: 404 });

  const platformOwner = await db.user.findFirst({
    where: { memberships: { some: { role: "PLATFORM_OWNER" } } },
    select: { id: true },
  });
  if (!platformOwner) return NextResponse.json({ error: "no platform owner" }, { status: 500 });

  try {
    const result = await issueMonthlyInvoices({
      organizationId: community.organizationId,
      communityId: community.id,
      year: 2026,
      month: 3,
      dueDate: new Date("2026-03-15T12:00:00Z"),
      createdById: platformOwner.id,
      asDraft: false,
    });
    return NextResponse.json({ ok: true, community: community.name, result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
