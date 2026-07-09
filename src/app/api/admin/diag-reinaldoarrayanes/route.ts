/**
 * Diagnóstico de solo lectura: busca la cuenta de prueba "Reinaldoarrayanes" que Luis
 * reportó (ligada a la unidad 134A), sospechosa de tener un email inválido que genera
 * un FAILED repetido en cada envío masivo de notificaciones. No modifica nada.
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const persons = await db.person.findMany({
    where: {
      OR: [
        { firstName: { contains: "Reinaldo", mode: "insensitive" } },
        { lastName: { contains: "arrayanes", mode: "insensitive" } },
        { email: { contains: "arrayanes", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, firstName: true, lastName: true, email: true, idNumber: true, userId: true,
      createdAt: true, deletedAt: true,
      ownerships: { select: { unit: { select: { id: true, code: true } } } },
      tenancies: { select: { unit: { select: { id: true, code: true } } } },
      user: { select: { id: true, email: true, active: true } },
    },
  });

  const units134 = await db.unit.findMany({
    where: { code: { contains: "134" } },
    select: { id: true, code: true, tower: true },
  });

  // Para cada Person sospechosa, ver si tiene historial financiero real (pagos/facturas)
  const withHistory = await Promise.all(
    persons.map(async (p) => {
      const unitIds = [...p.ownerships.map((o) => o.unit.id), ...p.tenancies.map((t) => t.unit.id)];
      const [paymentsCount, invoicesCount] = unitIds.length > 0
        ? await Promise.all([
            db.payment.count({ where: { unitId: { in: unitIds }, voidedAt: null } }),
            db.invoice.count({ where: { unitId: { in: unitIds }, status: { not: "VOIDED" } } }),
          ])
        : [0, 0];
      return { ...p, paymentsCount, invoicesCount };
    }),
  );

  return NextResponse.json({ suspiciousPersons: withHistory, units134 });
}
