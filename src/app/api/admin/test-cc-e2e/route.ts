/**
 * Endpoint temporal para E2E tests del sistema CC.
 * Llama con: GET /api/admin/test-cc-e2e?secret=CRON_SECRET
 * Eliminar después de verificar.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { Prisma } from "@prisma/client";

type TestResult = { label: string; ok: boolean; error?: string };
const results: TestResult[] = [];

function ok(label: string) { results.push({ label, ok: true }); }
function fail(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  results.push({ label, ok: false, error: msg });
}

async function cleanup(orgId: string) {
  await db.notification.deleteMany({ where: { organizationId: orgId } });
  await db.ccPaymentAllocation.deleteMany({ where: { payment: { organizationId: orgId } } });
  await db.ccPayment.deleteMany({ where: { organizationId: orgId } });
  await db.ccInvoiceItem.deleteMany({ where: { invoice: { organizationId: orgId } } });
  await db.ccInvoice.deleteMany({ where: { organizationId: orgId } });
  await db.ccSalesDeclaration.deleteMany({ where: { organizationId: orgId } });
  await db.ccTenancy.deleteMany({ where: { organizationId: orgId } });
  await db.ccLocal.deleteMany({ where: { mall: { organizationId: orgId } } });
  await db.ccMall.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  results.length = 0;
  let orgId = "";
  let mallId = "";
  let localId = "";

  // 1. Organización
  try {
    const org = await db.organization.create({
      data: { name: "TEST_CC_E2E", slug: `test-cc-${Date.now()}`, email: "test-e2e@test.com" },
    });
    orgId = org.id;
    ok("Organización de prueba creada");
  } catch (e) {
    fail("Crear organización", e);
    return NextResponse.json({ results, passed: 0, failed: 1 });
  }

  // 2. Mall
  try {
    const mall = await db.ccMall.create({
      data: { organizationId: orgId, name: "TEST_Mall", address: "Test 123", city: "Caracas" },
    });
    mallId = mall.id;
    ok("Mall creado");
  } catch (e) {
    fail("Crear mall", e);
    await cleanup(orgId);
    return NextResponse.json({ results, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
  }

  // 3. Local
  try {
    const local = await db.ccLocal.create({
      data: { mallId, organizationId: orgId, code: "L-TEST-01", name: "Tienda Test", type: "LOCAL" },
    });
    localId = local.id;
    ok("Local creado (L-TEST-01)");
  } catch (e) {
    fail("Crear local", e);
    await cleanup(orgId);
    return NextResponse.json({ results, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
  }

  // 4. Tenancy
  let tenancyId = "";
  try {
    const tenancy = await db.ccTenancy.create({
      data: {
        localId, organizationId: orgId,
        tenantName: "TEST Comercial S.A.", tenantRif: "J-12345678-9",
        tenantEmail: "tenant@test.com",
        canonUsd: new Prisma.Decimal(2500),
        startDate: new Date("2026-01-01"),
      },
    });
    tenancyId = tenancy.id;
    ok(`Tenancy creado — canon $${tenancy.canonUsd}`);
  } catch (e) {
    fail("Crear tenancy", e);
    await cleanup(orgId);
    return NextResponse.json({ results, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
  }

  // 5. Emitir 3 facturas (feb, mar, abr 2026)
  const invoiceIds: string[] = [];
  for (const [year, month] of [[2026, 2], [2026, 3], [2026, 4]] as [number, number][]) {
    try {
      const invoice = await db.ccInvoice.create({
        data: {
          mallId, localId, organizationId: orgId,
          invoiceNumber: `TEST-${year}-${String(month).padStart(2, "0")}-0001`,
          periodYear: year, periodMonth: month,
          issuedAt: new Date(year, month - 1, 1),
          dueDate: new Date(year, month, 5),
          status: "ISSUED",
          totalUsd: new Prisma.Decimal(2500),
          totalBss: new Prisma.Decimal(225000),
          paidUsd: new Prisma.Decimal(0),
          paidBss: new Prisma.Decimal(0),
          exchangeRate: new Prisma.Decimal(90),
          exchangeSource: "BCV",
          currencyPrimary: "USD",
          items: {
            create: [{
              description: `Canon ${month}/${year}`,
              amountUsd: new Prisma.Decimal(2500),
              amountBss: new Prisma.Decimal(225000),
            }],
          },
        },
      });
      invoiceIds.push(invoice.id);
      ok(`Factura ${invoice.invoiceNumber} emitida ($2,500)`);
    } catch (e) {
      fail(`Emitir factura ${month}/${year}`, e);
    }
  }

  // 6. Pago exacto: $2,500 → cubre solo la factura más antigua
  try {
    const pending = await db.ccInvoice.findMany({
      where: { localId, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
      orderBy: { dueDate: "asc" },
    });
    let remaining = 2500;
    const allocs: { invoiceId: string; localId: string; amountUsd: Prisma.Decimal; amountBss: Prisma.Decimal }[] = [];
    for (const inv of pending) {
      if (remaining <= 0) break;
      const pendingUsd = Number(inv.totalUsd) - Number(inv.paidUsd);
      const apply = Math.min(remaining, pendingUsd);
      allocs.push({ invoiceId: inv.id, localId, amountUsd: new Prisma.Decimal(apply), amountBss: new Prisma.Decimal(apply * 90) });
      remaining -= apply;
    }
    await db.ccPayment.create({
      data: {
        mallId, localId, organizationId: orgId,
        amountUsd: new Prisma.Decimal(2500), amountBss: new Prisma.Decimal(225000),
        exchangeRate: new Prisma.Decimal(90), exchangeSource: "BCV", currencyPrimary: "USD",
        method: "TRANSFER_USD", reference: "REF-001", paidAt: new Date(),
        allocations: { create: allocs },
      },
    });
    for (const a of allocs) {
      const inv = await db.ccInvoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      const newPaid = Number(inv.paidUsd) + Number(a.amountUsd);
      await db.ccInvoice.update({
        where: { id: a.invoiceId },
        data: { paidUsd: new Prisma.Decimal(newPaid), paidBss: new Prisma.Decimal(newPaid * 90), status: newPaid >= Number(inv.totalUsd) ? "PAID" : "PARTIAL" },
      });
    }
    if (allocs.length !== 1) throw new Error(`Esperaba 1 allocation, got ${allocs.length}`);
    if (remaining !== 0) throw new Error(`Esperaba $0 restante, got $${remaining}`);
    const updated = await db.ccInvoice.findUniqueOrThrow({ where: { id: allocs[0]!.invoiceId } });
    if (updated.status !== "PAID") throw new Error(`Estado esperado PAID, got ${updated.status}`);
    ok("Pago $2,500 → 1 factura PAID, $0 anticipo ✓");
  } catch (e) { fail("Pago exacto", e); }

  // 7. Pago excedente: $6,000 → cubre 2 facturas + $1,000 anticipo
  try {
    const pending = await db.ccInvoice.findMany({
      where: { localId, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
      orderBy: { dueDate: "asc" },
    });
    let remaining = 6000;
    const allocs: { invoiceId: string; localId: string; amountUsd: Prisma.Decimal; amountBss: Prisma.Decimal }[] = [];
    for (const inv of pending) {
      if (remaining <= 0) break;
      const pendingUsd = Number(inv.totalUsd) - Number(inv.paidUsd);
      const apply = Math.min(remaining, pendingUsd);
      allocs.push({ invoiceId: inv.id, localId, amountUsd: new Prisma.Decimal(apply), amountBss: new Prisma.Decimal(apply * 90) });
      remaining -= apply;
    }
    await db.ccPayment.create({
      data: {
        mallId, localId, organizationId: orgId,
        amountUsd: new Prisma.Decimal(6000), amountBss: new Prisma.Decimal(540000),
        exchangeRate: new Prisma.Decimal(90), exchangeSource: "BCV", currencyPrimary: "USD",
        method: "ZELLE", reference: "REF-002", paidAt: new Date(),
        allocations: { create: allocs },
      },
    });
    for (const a of allocs) {
      const inv = await db.ccInvoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      const newPaid = Number(inv.paidUsd) + Number(a.amountUsd);
      await db.ccInvoice.update({
        where: { id: a.invoiceId },
        data: { paidUsd: new Prisma.Decimal(newPaid), paidBss: new Prisma.Decimal(newPaid * 90), status: newPaid >= Number(inv.totalUsd) ? "PAID" : "PARTIAL" },
      });
    }
    if (allocs.length !== 2) throw new Error(`Esperaba 2 allocations (2 facturas), got ${allocs.length}`);
    if (remaining !== 1000) throw new Error(`Anticipo esperado $1,000, got $${remaining}`);
    ok(`Pago $6,000 → 2 facturas PAID, $${remaining} anticipo ✓`);
  } catch (e) { fail("Pago excedente", e); }

  // 8. Todas las facturas PAID
  try {
    const all = await db.ccInvoice.findMany({ where: { localId } });
    const notPaid = all.filter(i => i.status !== "PAID");
    if (notPaid.length > 0) throw new Error(`${notPaid.length} facturas no PAID: ${notPaid.map(i => i.invoiceNumber).join(", ")}`);
    ok(`Todas las facturas (${all.length}) en estado PAID ✓`);
  } catch (e) { fail("Estado final facturas", e); }

  // 9. Notificación CC_PAGO_POR_VERIFICAR
  let notifId = "";
  try {
    const payload = JSON.stringify({
      mallId, localId, tenancyId, localCode: "L-TEST-01",
      tenantName: "TEST Comercial S.A.", method: "PAGO_MOVIL",
      amountUsd: 2500, reference: "NOTIF-001", bankName: "Mercantil",
      fechaPago: new Date().toISOString(), estado: "PENDIENTE", createdAt: new Date().toISOString(),
    });
    const notif = await db.notification.create({
      data: { channel: "IN_APP", event: "ANNOUNCEMENT", status: "SENT", organizationId: orgId, body: `CC_PAGO_POR_VERIFICAR:${payload}` },
    });
    notifId = notif.id;
    const found = await db.notification.findUniqueOrThrow({ where: { id: notifId } });
    const parsed = JSON.parse(found.body.replace(/^CC_PAGO_POR_VERIFICAR:/, "")) as { mallId: string; amountUsd: number };
    if (parsed.mallId !== mallId) throw new Error("mallId no coincide en payload");
    if (parsed.amountUsd !== 2500) throw new Error(`amountUsd incorrecto: ${parsed.amountUsd}`);
    ok("Notificación CC_PAGO_POR_VERIFICAR: creada y parseable ✓");
  } catch (e) { fail("Notificación portal CC", e); }

  // 10. Dismiss de notificación
  try {
    await db.notification.deleteMany({ where: { id: notifId, organizationId: orgId } });
    const stillExists = await db.notification.findUnique({ where: { id: notifId } });
    if (stillExists) throw new Error("Notificación no fue eliminada");
    ok("Dismiss notificación: eliminada correctamente ✓");
  } catch (e) { fail("Dismiss notificación", e); }

  // 11. Declaración de ventas
  try {
    const decl = await db.ccSalesDeclaration.create({
      data: {
        organizationId: orgId, mallId, localId,
        periodYear: 2026, periodMonth: 4,
        salesAmountUsd: new Prisma.Decimal(15000),
        salesAmountBss: new Prisma.Decimal(1350000),
        exchangeRate: new Prisma.Decimal(90),
      },
    });
    if (!decl.id) throw new Error("No se creó la declaración");
    ok(`Declaración de ventas: $${decl.salesAmountUsd} en abr/2026 ✓`);
  } catch (e) { fail("Declaración de ventas", e); }

  // Cleanup
  try {
    await cleanup(orgId);
    ok("Datos de prueba eliminados ✓");
  } catch (e) { fail("Cleanup", e); }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  return NextResponse.json({ passed, failed, total: results.length, results }, {
    status: failed > 0 ? 207 : 200,
  });
}
