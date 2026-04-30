/**
 * Cron: publica todas las facturas en DRAFT del mes actual.
 * Se ejecuta automáticamente el día 1 de cada mes a las 8:00 AM UTC.
 *
 * Flujo:
 *   1. Busca todas las Invoice con status=DRAFT cuyo periodYear/periodMonth
 *      corresponden al mes actual.
 *   2. Las cambia a ISSUED y fija issuedAt = ahora.
 *   3. Envía email de notificación al propietario de cada unidad.
 */

import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { notifyPerson } from "@/server/services/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutos (plan Pro)

export async function GET(req: Request) {
  // Verificar token de seguridad para evitar ejecuciones no autorizadas
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  try {
    // 1. Buscar todos los borradores del mes actual
    const drafts = await db.invoice.findMany({
      where: { status: "DRAFT", periodYear: year, periodMonth: month },
      include: {
        unit: {
          include: {
            ownerships: {
              where: { endDate: null },
              select: { personId: true },
              take: 1,
            },
          },
        },
        items: true,
      },
    });

    if (drafts.length === 0) {
      return NextResponse.json({ ok: true, published: 0, message: "No hay borradores para este mes" });
    }

    let published = 0;
    let notified = 0;
    const errors: string[] = [];

    for (const inv of drafts) {
      try {
        // 2. Publicar: DRAFT → ISSUED
        await db.invoice.update({
          where: { id: inv.id },
          data: { status: "ISSUED", issuedAt: now },
        });
        published++;

        // 3. Notificar al propietario si existe
        const personId = inv.unit.ownerships[0]?.personId;
        if (personId) {
          const MONTHS_ES = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
          ];
          await notifyPerson({
            organizationId: inv.organizationId,
            communityId: inv.communityId,
            unitId: inv.unitId,
            personId,
            event: "INVOICE_ISSUED",
            vars: {
              monto_usd: Number(inv.totalUsd.toString()).toFixed(2),
              monto_bs:  Number(inv.totalBss.toString()).toFixed(2),
              fecha_vence: inv.dueDate.toLocaleDateString("es-VE"),
              factura: inv.invoiceNumber,
              periodo: `${MONTHS_ES[month - 1]} ${year}`,
            },
          });
          notified++;
        }
      } catch (err) {
        errors.push(`Factura ${inv.invoiceNumber}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      year,
      month,
      published,
      notified,
      errors,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
