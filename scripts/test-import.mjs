import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

const db = new PrismaClient();

const COMMUNITY_ID = "cmoky25fo00041026u1nhs0pb";
const ORG_ID       = "cmoky1shn0000a3a65nazzt0z";
const RATE         = "37.50";
const TAG          = "PRUEBA_IMPORTACION";

async function main() {
  console.log("=== PRUEBA DE IMPORTACIÓN MASIVA ===\n");

  // ─── 1. Unidades ───────────────────────────────────
  console.log("1) Importando 4 unidades de prueba...");
  const unitData = [
    { code: "TEST-101", aliquot: "2.500000", type: "APARTMENT", floor: 1, tower: "TEST" },
    { code: "TEST-102", aliquot: "2.500000", type: "APARTMENT", floor: 1, tower: "TEST" },
    { code: "TEST-201", aliquot: "2.500000", type: "APARTMENT", floor: 2, tower: "TEST" },
    { code: "TEST-202", aliquot: "2.500000", type: "APARTMENT", floor: 2, tower: "TEST" },
  ].map((u) => ({ ...u, organizationId: ORG_ID, communityId: COMMUNITY_ID }));

  const { count: unitsCount } = await db.unit.createMany({ data: unitData, skipDuplicates: true });
  console.log(`   ✅ ${unitsCount} unidades creadas`);

  const units = await db.unit.findMany({
    where: { communityId: COMMUNITY_ID, code: { startsWith: "TEST-" } },
    select: { id: true, code: true },
  });
  const unitMap = Object.fromEntries(units.map((u) => [u.code, u.id]));

  // ─── 2. Residentes ─────────────────────────────────
  console.log("\n2) Importando 3 residentes de prueba...");
  const residents = [
    { idNumber: "99000001", firstName: "Carlos", lastName: "Prueba", email: "carlos.prueba@test.com", unit: "TEST-101" },
    { idNumber: "99000002", firstName: "Ana",    lastName: "Demo",   email: "ana.demo@test.com",    unit: "TEST-102" },
    { idNumber: "99000003", firstName: "Luis",   lastName: "Test",   email: null,                   unit: "TEST-201" },
  ];

  let resCreated = 0;
  for (const r of residents) {
    const person = await db.person.upsert({
      where: { organizationId_idType_idNumber: { organizationId: ORG_ID, idType: "CEDULA_V", idNumber: r.idNumber } },
      update: { firstName: r.firstName, lastName: r.lastName, email: r.email },
      create: { organizationId: ORG_ID, idType: "CEDULA_V", idNumber: r.idNumber, firstName: r.firstName, lastName: r.lastName, email: r.email },
    });
    const unitId = unitMap[r.unit];
    if (unitId) {
      const exists = await db.ownership.findFirst({ where: { unitId, personId: person.id, endDate: null } });
      if (!exists) {
        await db.ownership.create({ data: { unitId, personId: person.id, sharePercent: "100", startDate: new Date() } });
        resCreated++;
      }
    }
  }
  console.log(`   ✅ ${resCreated} propietarios asignados`);

  // ─── 3. Deudas históricas ───────────────────────────
  console.log("\n3) Importando 3 facturas/deudas históricas...");
  const invoices = [
    { unit: "TEST-101", desc: "Cuota Ene 2026", total: "20.00", issued: "2026-01-01", due: "2026-01-05", paid: "0.00" },
    { unit: "TEST-102", desc: "Cuota Ene 2026", total: "20.00", issued: "2026-01-01", due: "2026-01-05", paid: "10.00" },
    { unit: "TEST-201", desc: "Deuda 2025",     total: "60.00", issued: "2025-10-01", due: "2025-10-31", paid: "0.00" },
  ];

  let invCreated = 0;
  for (const inv of invoices) {
    const unitId = unitMap[inv.unit];
    if (!unitId) { console.log(`   ⚠️  Unidad ${inv.unit} no encontrada`); continue; }
    const totalUsd = new Decimal(inv.total);
    const paidUsd  = new Decimal(inv.paid);
    const totalBss = totalUsd.mul(RATE);
    const paidBss  = paidUsd.mul(RATE);
    const dueDate  = new Date(inv.due);
    const pending  = totalUsd.minus(paidUsd);
    const status   = pending.lte(0) ? "PAID" : paidUsd.gt(0) ? "PARTIAL" : dueDate < new Date() ? "OVERDUE" : "ISSUED";

    await db.invoice.create({
      data: {
        organizationId: ORG_ID, communityId: COMMUNITY_ID, unitId,
        invoiceNumber: `IMP-TEST-${String(++invCreated).padStart(3, "0")}`,
        periodYear: new Date(inv.issued).getFullYear(),
        periodMonth: new Date(inv.issued).getMonth() + 1,
        issuedAt: new Date(inv.issued), dueDate,
        totalUsd: totalUsd.toFixed(2), totalBss: totalBss.toFixed(2),
        paidUsd: paidUsd.toFixed(2),   paidBss: paidBss.toFixed(2),
        exchangeRate: RATE, exchangeSource: "MANUAL", currencyPrimary: "USD",
        status,
        notes: `${TAG} — ${inv.desc}`,
        items: { create: [{ description: inv.desc, amountUsd: totalUsd.toFixed(2), amountBss: totalBss.toFixed(2), aliquot: "0" }] },
      },
    });
  }
  console.log(`   ✅ ${invCreated} facturas creadas`);
  console.log(`   📊 Estados: TEST-101=ISSUED, TEST-102=PARTIAL, TEST-201=OVERDUE`);

  // ─── 4. Gastos históricos ───────────────────────────
  console.log("\n4) Importando 3 gastos históricos...");
  const expenses = [
    { year: 2026, month: 1, desc: "Electricidad CORPOELEC", cat: "ELECTRICITY",   usd: "45.00" },
    { year: 2026, month: 1, desc: "Agua HIDROCAPITAL",      cat: "WATER",         usd: "20.00" },
    { year: 2026, month: 1, desc: "Nomina conserje",        cat: "STAFF_PAYROLL", usd: "150.00" },
  ];

  for (const exp of expenses) {
    const usd = new Decimal(exp.usd);
    await db.expense.create({
      data: {
        organizationId: ORG_ID, communityId: COMMUNITY_ID,
        description: `${TAG} — ${exp.desc}`,
        category: exp.cat,
        periodYear: exp.year, periodMonth: exp.month,
        amountUsd: usd.toFixed(2), amountBss: usd.mul(RATE).toFixed(2),
        exchangeRate: RATE, exchangeSource: "MANUAL", currencyPrimary: "USD",
      },
    });
  }
  console.log(`   ✅ ${expenses.length} gastos creados ($${expenses.reduce((s, e) => s + Number(e.usd), 0).toFixed(2)} USD total)`);

  // ─── 5. Pagos históricos ────────────────────────────
  console.log("\n5) Importando 2 pagos históricos...");
  const payments = [
    { unit: "TEST-101", usd: "20.00", method: "TRANSFER_USD", date: "2026-01-05", ref: "00123456" },
    { unit: "TEST-102", usd: "10.00", method: "ZELLE",        date: "2026-01-10", ref: "abc@gmail.com" },
  ];

  let payCreated = 0;
  for (const pay of payments) {
    const unitId = unitMap[pay.unit];
    if (!unitId) continue;
    const usd = new Decimal(pay.usd);
    await db.payment.create({
      data: {
        organizationId: ORG_ID, communityId: COMMUNITY_ID, unitId,
        amountUsd: usd.toFixed(2), amountBss: usd.mul(RATE).toFixed(2),
        exchangeRate: RATE, exchangeSource: "MANUAL", currencyPrimary: "USD",
        method: pay.method, reference: pay.ref,
        paidAt: new Date(pay.date),
        notes: TAG,
      },
    });
    payCreated++;
  }
  console.log(`   ✅ ${payCreated} pagos creados`);

  // ─── Verificación final ─────────────────────────────
  console.log("\n=== VERIFICACIÓN FINAL ===");
  const counts = {
    units:    await db.unit.count({ where: { communityId: COMMUNITY_ID, code: { startsWith: "TEST-" } } }),
    persons:  await db.person.count({ where: { organizationId: ORG_ID, idNumber: { startsWith: "990000" } } }),
    invoices: await db.invoice.count({ where: { communityId: COMMUNITY_ID, invoiceNumber: { startsWith: "IMP-TEST" } } }),
    expenses: await db.expense.count({ where: { communityId: COMMUNITY_ID, description: { contains: TAG } } }),
    payments: await db.payment.count({ where: { communityId: COMMUNITY_ID, notes: TAG } }),
  };
  console.log(`  Unidades TEST:   ${counts.units}   ${counts.units === 4 ? "✅" : "❌"}`);
  console.log(`  Personas TEST:   ${counts.persons}   ${counts.persons === 3 ? "✅" : "❌"}`);
  console.log(`  Facturas TEST:   ${counts.invoices}   ${counts.invoices === 3 ? "✅" : "❌"}`);
  console.log(`  Gastos TEST:     ${counts.expenses}   ${counts.expenses === 3 ? "✅" : "❌"}`);
  console.log(`  Pagos TEST:      ${counts.payments}   ${counts.payments === 2 ? "✅" : "❌"}`);

  const allOk = counts.units === 4 && counts.persons === 3 && counts.invoices === 3 && counts.expenses === 3 && counts.payments === 2;
  console.log(`\n${allOk ? "✅ TODAS LAS IMPORTACIONES FUNCIONAN CORRECTAMENTE" : "❌ HAY ERRORES — revisar logs"}`);
  console.log("\n👉 Ejecuta scripts/cleanup-test.mjs para limpiar los datos de prueba.");
}

main().then(() => db.$disconnect()).catch((e) => {
  console.error("ERROR:", e.message);
  db.$disconnect();
  process.exit(1);
});
