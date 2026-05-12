/**
 * Genera un CSV de prueba para conciliación bancaria.
 *
 * El CSV simula un extracto de Banesco con:
 *   - 2-3 filas que matchean exactamente con Payments existentes (por referencia)
 *   - 1 fila con referencia distinta pero mismo monto que un payment (match por monto)
 *   - 2 filas sin matching en el sistema (oportunidad de "Aparcar" o "Registrar gasto")
 *   - 1 fila de débito (comisión/IGTF) para probar "Registrar como gasto"
 *
 * Llamada:
 *   GET /api/admin/sample-bank-csv?communityName=Arrayanes
 *   → devuelve el CSV directo como descarga
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatBs(n: number): string {
  // Formato europeo (1.234,56) que usan los bancos venezolanos
  return n.toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const communityNameFilter = url.searchParams.get("communityName") ?? "Arrayanes";

  const community = await db.community.findFirst({
    where: { name: { contains: communityNameFilter, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!community) {
    return NextResponse.json(
      { error: `Comunidad "${communityNameFilter}" no encontrada` },
      { status: 404 },
    );
  }

  // Tomar los últimos pagos reales del sistema (hasta 3) para incluirlos en el CSV
  const realPayments = await db.payment.findMany({
    where: { communityId: community.id, voidedAt: null },
    select: {
      reference: true,
      amountBss: true,
      paidAt: true,
      unit: { select: { code: true } },
    },
    orderBy: { paidAt: "desc" },
    take: 3,
  });

  const now = new Date();
  const yest = new Date(now.getTime() - 86_400_000);
  const ddAgo = new Date(now.getTime() - 2 * 86_400_000);

  type Row = { fecha: string; ref: string; concepto: string; monto: number };
  const rows: Row[] = [];

  // 1) Pagos reales — deberían matchear exactamente por referencia
  realPayments.forEach((p, i) => {
    const refNum = (p.reference ?? `9000000${i + 1}`).replace(/\D/g, "") || `9000000${i + 1}`;
    rows.push({
      fecha: formatDate(p.paidAt),
      ref: refNum,
      concepto: `TRF RECIBIDA APT ${p.unit.code} CONDOMINIO`,
      monto: Number(p.amountBss),
    });
  });

  // 2) Si no hay 3 pagos reales, completamos con ficticios para que el CSV
  //    tenga buenos casos de prueba (mínimo 6 filas).
  if (rows.length < 3) {
    rows.push({
      fecha: formatDate(yest),
      ref: "100200001",
      concepto: "TRF RECIBIDA APT 101A JUAN PEREZ",
      monto: 25_000,
    });
    rows.push({
      fecha: formatDate(yest),
      ref: "100200002",
      concepto: "PAGO MOVIL 04141234567 APT 102B",
      monto: 18_500,
    });
  }

  // 3) Fila con monto que coincide con un payment pero referencia distinta
  //    (debe matchear por monto y mostrar badge "Match por monto").
  if (realPayments[0]) {
    rows.push({
      fecha: formatDate(yest),
      ref: "999888777",
      concepto: `TRF DESDE OTRO BANCO ${realPayments[0].unit.code}`,
      monto: Number(realPayments[0].amountBss),
    });
  }

  // 4) Filas sin matching — para probar "Aparcar" y "Registrar gasto"
  rows.push({
    fecha: formatDate(ddAgo),
    ref: "555111222",
    concepto: "TRF RECIBIDA PAGO ANTICIPADO",
    monto: 32_500,
  });
  rows.push({
    fecha: formatDate(ddAgo),
    ref: "555111223",
    concepto: "DEP EFECTIVO TAQUILLA",
    monto: 12_000,
  });

  // 5) Débito — comisión bancaria
  rows.push({
    fecha: formatDate(now),
    ref: "DEBIT001",
    concepto: "COMISION POR MANTENIMIENTO DE CUENTA",
    monto: -150.5,
  });

  // 6) IGTF — débito automático
  rows.push({
    fecha: formatDate(now),
    ref: "IGTF240512",
    concepto: "IGTF 3% S/TRF EN DIVISAS",
    monto: -85.3,
  });

  // Construir CSV con separador ";" (estándar Banesco/Mercantil/Venezuela —
  // permite usar "," como decimal sin conflicto). El parser detectSeparator()
  // detecta automáticamente el ";" como separador dominante.
  const sep = ";";
  const header = ["Fecha", "Referencia", "Concepto", "Monto"].join(sep);
  const csvLines = [header];
  for (const r of rows) {
    csvLines.push([r.fecha, r.ref, r.concepto, formatBs(r.monto)].join(sep));
  }
  const csv = csvLines.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="extracto-banco-prueba.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
