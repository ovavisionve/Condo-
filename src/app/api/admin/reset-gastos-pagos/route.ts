/**
 * Reset PARCIAL — borra gastos + pagos + facturas (excepto SALDO-*),
 * dejando solo las deudas iniciales (facturas SALDO ANTERIOR) intactas.
 *
 * Útil para volver al estado "deuda inicial" sin perder el setup del condominio
 * (unidades, propietarios, plantillas, configuración).
 *
 * Llamada:
 *   curl -X POST https://residia.vercel.app/api/admin/reset-gastos-pagos \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -d '{"communityName":"Arrayanes"}'
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let communityName = "Arrayanes";
  try {
    const body = await req.json();
    if (body?.communityName) communityName = String(body.communityName);
  } catch { /* sin body, usa default */ }

  const community = await db.community.findFirst({
    where: { name: { contains: communityName, mode: "insensitive" } },
    select: { id: true, name: true, organizationId: true },
  });
  if (!community) {
    return NextResponse.json({ error: `No se encontró comunidad "${communityName}"` }, { status: 404 });
  }

  const cid = community.id;
  const result: Record<string, number> = {};

  try {
    // 1. Borrar allocations de pagos (no son de facturas SALDO)
    // Las facturas SALDO se mantienen, pero sus allocations también se borran
    // porque estamos limpiando pagos.
    result.paymentAllocations = (await db.paymentAllocation.deleteMany({
      where: { payment: { communityId: cid } },
    })).count;

    // 2. Borrar pagos
    result.payments = (await db.payment.deleteMany({ where: { communityId: cid } })).count;

    // 3. Borrar pagos no identificados
    result.unidentifiedPayments = (await db.unidentifiedPayment.deleteMany({
      where: { communityId: cid },
    })).count;

    // 4. Borrar invoiceItems de facturas que NO son SALDO
    const nonSaldoInvoices = await db.invoice.findMany({
      where: {
        communityId: cid,
        NOT: { invoiceNumber: { startsWith: "SALDO" } },
      },
      select: { id: true },
    });
    const nonSaldoIds = nonSaldoInvoices.map(i => i.id);
    if (nonSaldoIds.length > 0) {
      result.invoiceItems = (await db.invoiceItem.deleteMany({
        where: { invoiceId: { in: nonSaldoIds } },
      })).count;
      result.invoices = (await db.invoice.deleteMany({
        where: { id: { in: nonSaldoIds } },
      })).count;
    } else {
      result.invoiceItems = 0;
      result.invoices = 0;
    }

    // 5. Resetear paidUsd/paidBss de las facturas SALDO restantes
    const resetSaldo = await db.invoice.updateMany({
      where: { communityId: cid, invoiceNumber: { startsWith: "SALDO" } },
      data: {
        paidUsd: "0",
        paidBss: "0",
        status: "OVERDUE",
      },
    });
    result.saldoInvoicesReset = resetSaldo.count;

    // 6. Borrar gastos (Expense)
    result.expenses = (await db.expense.deleteMany({
      where: { communityId: cid },
    })).count;

    // 7. Borrar ingresos
    result.incomes = (await db.income.deleteMany({
      where: { communityId: cid },
    })).count;

    // 8. Borrar cierres de mes (para empezar fresh)
    result.monthCloses = (await db.monthClose.deleteMany({
      where: { communityId: cid },
    })).count;

    // 9. Mantener: unidades, propietarios, ownerships, plantillas, configuración
    //    (no se tocan)

    return NextResponse.json({
      ok: true,
      community: community.name,
      message: "Reset parcial completo. Facturas SALDO ANTERIOR intactas con paidUsd/Bss=0.",
      deleted: result,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      partial: result,
    }, { status: 500 });
  }
}
