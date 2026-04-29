/**
 * Test end-to-end del flujo financiero:
 * 1. Crear comunidad + unidades con alícuotas
 * 2. Registrar tasa manual (para reproducibilidad)
 * 3. Registrar varios gastos
 * 4. Emitir facturas mensuales (con prorrateo)
 * 5. Verificar que la suma de facturas == suma de gastos
 * 6. Registrar pago parcial y verificar estado
 * 7. Registrar pago final y verificar PAID
 * 8. Verificar aging
 *
 * Uso: pnpm tsx scripts/test-finance-e2e.ts
 */

import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import { setManualRate } from "../src/server/services/exchange";
import { registerExpense, issueMonthlyInvoices, getAging } from "../src/server/services/invoicing";
import { recordPayment } from "../src/server/services/payments";

const db = new PrismaClient();

const log = (...a: unknown[]) => console.log("·", ...a);
const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string) => { console.error(`  ❌ ${msg}`); process.exit(1); };

async function main() {
  // 1. Encontrar la organización demo
  const org = await db.organization.findUnique({ where: { slug: "demo-edif" } });
  if (!org) throw new Error("Falta organización demo-edif (corre el flujo de creación primero)");
  const owner = await db.user.findUnique({ where: { email: "admin@condominios.local" } });
  if (!owner) throw new Error("Falta admin@condominios.local");

  // Limpiar test runs previos: eliminar comunidad de prueba si existe
  const previous = await db.community.findFirst({
    where: { organizationId: org.id, name: "TEST E2E Building" },
  });
  if (previous) {
    log("Limpiando ejecución previa...");
    await db.payment.deleteMany({ where: { communityId: previous.id } });
    await db.invoice.deleteMany({ where: { communityId: previous.id } });
    await db.expense.deleteMany({ where: { communityId: previous.id } });
    await db.unit.deleteMany({ where: { communityId: previous.id } });
    await db.community.delete({ where: { id: previous.id } });
  }

  // 2. Crear comunidad de prueba
  log("Creando comunidad...");
  const community = await db.community.create({
    data: {
      organizationId: org.id,
      name: "TEST E2E Building",
      address: "Av Test, Torre Test",
      city: "Caracas",
      primaryCurrency: "USD",
      totalUnits: 0,
    },
  });
  ok(`Community ${community.id}`);

  // 3. Crear 4 unidades con alícuotas que sumen 100
  log("Creando 4 unidades...");
  const aliquots = ["25.0000", "25.0000", "25.0000", "25.0000"];
  const units = await Promise.all(
    aliquots.map((a, i) =>
      db.unit.create({
        data: {
          organizationId: org.id,
          communityId: community.id,
          code: `TST-${i + 1}`,
          aliquot: a,
          type: "APARTMENT",
        },
      }),
    ),
  );
  await db.community.update({ where: { id: community.id }, data: { totalUnits: 4 } });
  ok(`${units.length} unidades creadas`);

  // 4. Tasa manual reproducible
  log("Registrando tasa manual 50.0 VES/USD...");
  await setManualRate("50.0", new Date(), "Tasa de prueba E2E");
  ok("Tasa registrada");

  // 5. Registrar 3 gastos del mes actual
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  log(`Registrando gastos para ${month}/${year}...`);

  const expenses = await Promise.all([
    registerExpense({
      organizationId: org.id,
      communityId: community.id,
      category: "ELECTRICITY",
      description: "Factura de luz",
      periodYear: year,
      periodMonth: month,
      amount: 200, // USD
      currencyPrimary: "USD",
      exchangeSource: "MANUAL",
      createdById: owner.id,
    }),
    registerExpense({
      organizationId: org.id,
      communityId: community.id,
      category: "CLEANING",
      description: "Servicio de limpieza",
      periodYear: year,
      periodMonth: month,
      amount: 100,
      currencyPrimary: "USD",
      exchangeSource: "MANUAL",
      createdById: owner.id,
    }),
    registerExpense({
      organizationId: org.id,
      communityId: community.id,
      category: "REPAIRS",
      description: "Reparación bomba",
      periodYear: year,
      periodMonth: month,
      amount: 33.33, // monto irregular para probar prorrateo
      currencyPrimary: "USD",
      exchangeSource: "MANUAL",
      createdById: owner.id,
    }),
  ]);

  const totalExpensesUsd = expenses.reduce(
    (s, e) => s.plus(e.amountUsd.toString()),
    new Decimal(0),
  );
  ok(`3 gastos. Total: $${totalExpensesUsd.toFixed(2)}`);

  // 6. Emitir facturas
  log("Emitiendo facturas...");
  const dueDate = new Date(year, month - 1, 28);
  const result = await issueMonthlyInvoices({
    organizationId: org.id,
    communityId: community.id,
    year,
    month,
    dueDate,
    createdById: owner.id,
  });
  ok(`${result.invoicesCount} facturas emitidas (de ${result.expensesCount} gastos)`);

  // 7. Verificar que la suma de facturas == suma de gastos (USD)
  const invoices = await db.invoice.findMany({
    where: { communityId: community.id },
    include: { items: true, unit: true },
  });
  const sumInvoicesUsd = invoices.reduce(
    (s, i) => s.plus(i.totalUsd.toString()),
    new Decimal(0),
  );
  log(`Suma facturas USD: $${sumInvoicesUsd.toFixed(2)} vs gastos $${totalExpensesUsd.toFixed(2)}`);
  if (!sumInvoicesUsd.eq(totalExpensesUsd)) {
    fail(`SUMA NO CUADRA en USD: ${sumInvoicesUsd.toString()} vs ${totalExpensesUsd.toString()}`);
  }
  ok("Suma exacta de USD ✓");

  // Verificar que para cada gasto, la suma de items == monto del gasto
  for (const exp of expenses) {
    const itemsForExp = await db.invoiceItem.findMany({ where: { expenseId: exp.id } });
    const sumItems = itemsForExp.reduce((s, it) => s.plus(it.amountUsd.toString()), new Decimal(0));
    if (!sumItems.eq(exp.amountUsd.toString())) {
      fail(`Prorrateo del gasto ${exp.description} no cuadra: ${sumItems.toString()} vs ${exp.amountUsd}`);
    }
  }
  ok("Cada gasto está prorrateado exactamente entre las unidades ✓");

  // 8. Registrar un pago parcial a la primera factura
  const firstInvoice = invoices[0]!;
  const partial = new Decimal(firstInvoice.totalUsd.toString()).div(2).toFixed(2);
  log(`Registrando pago parcial de $${partial} a ${firstInvoice.invoiceNumber}...`);
  await recordPayment({
    organizationId: org.id,
    communityId: community.id,
    unitId: firstInvoice.unitId,
    amount: partial,
    currencyPrimary: "USD",
    exchangeSource: "MANUAL",
    method: "TRANSFER_USD",
    reference: "TEST-001",
    paidAt: new Date(),
    allocations: [{ invoiceId: firstInvoice.id, amount: partial }],
    createdById: owner.id,
  });
  const inv1 = await db.invoice.findUniqueOrThrow({ where: { id: firstInvoice.id } });
  if (inv1.status !== "PARTIAL") fail(`Estado debería ser PARTIAL, es ${inv1.status}`);
  ok(`Estado: PARTIAL ✓ (pagado $${inv1.paidUsd})`);

  // 9. Pagar el resto
  const remaining = new Decimal(inv1.totalUsd.toString()).minus(inv1.paidUsd.toString()).toFixed(2);
  log(`Pagando saldo restante $${remaining}...`);
  await recordPayment({
    organizationId: org.id,
    communityId: community.id,
    unitId: firstInvoice.unitId,
    amount: remaining,
    currencyPrimary: "USD",
    exchangeSource: "MANUAL",
    method: "ZELLE",
    reference: "TEST-002",
    paidAt: new Date(),
    allocations: [{ invoiceId: firstInvoice.id, amount: remaining }],
    createdById: owner.id,
  });
  const inv2 = await db.invoice.findUniqueOrThrow({ where: { id: firstInvoice.id } });
  if (inv2.status !== "PAID") fail(`Estado debería ser PAID, es ${inv2.status}`);
  ok(`Estado: PAID ✓`);

  // 10. Aging de cartera
  log("Calculando aging...");
  const aging = await getAging(community.id);
  log("Aging:", aging);
  const totalAgingUsd = Object.values(aging).reduce((s, b) => s + Number(b.usd), 0);
  const expectedPending = totalExpensesUsd.minus(inv2.totalUsd.toString()).toNumber();
  // Tolerancia de 0.01 por redondeo
  if (Math.abs(totalAgingUsd - expectedPending) > 0.01) {
    fail(`Aging esperado ~$${expectedPending} pero es $${totalAgingUsd}`);
  }
  ok(`Aging total: $${totalAgingUsd.toFixed(2)} (esperado: $${expectedPending.toFixed(2)}) ✓`);

  console.log("\n🎉 TODOS LOS PASOS PASARON");
  console.log(`   Comunidad: ${community.id}`);
  console.log(`   Total facturado: $${totalExpensesUsd.toFixed(2)}`);
  console.log(`   Cobrado: $${inv2.totalUsd}`);
  console.log(`   Pendiente (aging): $${totalAgingUsd.toFixed(2)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
