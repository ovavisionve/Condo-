/**
 * ONE-SHOT: limpia unidades fantasma de Castaños B (sin propietario asignado).
 * - Anula facturas (VOIDED) de esas unidades
 * - Marca las unidades como inactivas (soft delete)
 * Eliminar después.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const COMMUNITY_ID = "cmoukqntu00015niqpsjlu4cw";

export async function GET() {
  // Unidades activas SIN propietario actual
  const ghosts = await db.unit.findMany({
    where: {
      communityId: COMMUNITY_ID,
      deletedAt: null,
      active: true,
      ownerships: { none: { endDate: null } },
    },
    select: { id: true, code: true },
  });
  const ghostIds = ghosts.map((g) => g.id);

  if (ghostIds.length === 0) {
    return NextResponse.json({ ok: true, msg: "Sin fantasmas", ghostCount: 0 });
  }

  // Anular sus facturas activas
  const voidedInvoices = await db.invoice.updateMany({
    where: {
      unitId: { in: ghostIds },
      status: { not: "VOIDED" },
    },
    data: {
      status: "VOIDED",
      voidedAt: new Date(),
      voidReason: "Limpieza unidad fantasma (sin propietario) — demo Castaños",
    },
  });

  // Soft-delete unidades
  const softDeleted = await db.unit.updateMany({
    where: { id: { in: ghostIds } },
    data: { active: false, deletedAt: new Date() },
  });

  return NextResponse.json({
    ok: true,
    ghostCount: ghosts.length,
    voidedInvoices: voidedInvoices.count,
    softDeletedUnits: softDeleted.count,
    ghostCodes: ghosts.map((g) => g.code),
  });
}
