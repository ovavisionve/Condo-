/**
 * Test completo de todas las operaciones de escritura del sistema.
 * Corre contra la DB local y verifica que cada mutación persista correctamente.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";

const db = new PrismaClient({ log: ["error"] });

let passed = 0;
let failed = 0;
const errors: string[] = [];

function ok(name: string) {
  console.log(`  ✅ ${name}`);
  passed++;
}
function fail(name: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  errors.push(`${name}: ${msg}`);
}

async function main() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TEST COMPLETO DE FORMULARIOS — Condominios");
  console.log("═══════════════════════════════════════════════════\n");

  // ── Datos base ─────────────────────────────────────────────────
  const user = await db.user.findFirstOrThrow({ where: { email: "admin@condominios.local" } });
  const org = await db.organization.findFirstOrThrow({ where: { deletedAt: null } });
  const community = await db.community.findFirstOrThrow({ where: { organizationId: org.id, deletedAt: null } });
  const unit = await db.unit.findFirstOrThrow({ where: { communityId: community.id, deletedAt: null } });

  console.log(`Base: user=${user.email}, org=${org.name}, community=${community.name}`);
  console.log();

  // ══════════════════════════════════════════════════════════════
  // 1. CUOTA MENSUAL
  // ══════════════════════════════════════════════════════════════
  console.log("1. Cuota mensual (setMonthlyFee)");
  try {
    await db.community.update({
      where: { id: community.id },
      data: { monthlyFeeUsd: new Decimal(25).toFixed(2), monthlyFeeSetAt: new Date() },
    });
    const reloaded = await db.community.findUniqueOrThrow({ where: { id: community.id } });
    if (!reloaded.monthlyFeeUsd || Number(reloaded.monthlyFeeUsd) !== 25) {
      throw new Error(`Valor guardado: ${reloaded.monthlyFeeUsd} (esperado 25)`);
    }
    ok("Community.monthlyFeeUsd actualizado y persistido");
    // Revertir
    await db.community.update({ where: { id: community.id }, data: { monthlyFeeUsd: null, monthlyFeeSetAt: null } });
  } catch (e) { fail("setMonthlyFee", e); }

  // ══════════════════════════════════════════════════════════════
  // 2. TASA DE CAMBIO MANUAL
  // ══════════════════════════════════════════════════════════════
  console.log("\n2. Tasa de cambio manual (setManualRate)");
  try {
    const today = new Date(); today.setUTCHours(0,0,0,0);
    await db.exchangeRate.upsert({
      where: { date_source: { date: today, source: "MANUAL" } },
      update: { vesPerUsd: "50.1234" },
      create: { date: today, source: "MANUAL", vesPerUsd: "50.1234" },
    });
    const r = await db.exchangeRate.findUnique({ where: { date_source: { date: today, source: "MANUAL" } } });
    if (!r || Number(r.vesPerUsd) !== 50.1234) throw new Error(`Valor: ${r?.vesPerUsd}`);
    ok("ExchangeRate MANUAL creada/actualizada y persistida");
    await db.exchangeRate.delete({ where: { date_source: { date: today, source: "MANUAL" } } });
  } catch (e) { fail("setManualRate", e); }

  // ══════════════════════════════════════════════════════════════
  // 3. GASTOS (registerExpense)
  // ══════════════════════════════════════════════════════════════
  console.log("\n3. Gastos (registerExpense)");
  let expenseId: string | null = null;
  try {
    const expense = await db.expense.create({
      data: {
        organizationId: org.id, communityId: community.id,
        category: "CLEANING", description: "Test limpieza",
        periodYear: 2026, periodMonth: 4,
        amountBss: "1000.00", amountUsd: "20.00",
        exchangeRate: "50.00000000", exchangeSource: "MANUAL",
        currencyPrimary: "USD", createdById: user.id,
      },
    });
    expenseId = expense.id;
    const reloaded = await db.expense.findUniqueOrThrow({ where: { id: expense.id } });
    if (reloaded.description !== "Test limpieza") throw new Error("Descripción no coincide");
    ok("Expense creado y persistido");
  } catch (e) { fail("registerExpense", e); }

  // ══════════════════════════════════════════════════════════════
  // 4. FACTURACIÓN MASIVA (issueMonthlyInvoices)
  // ══════════════════════════════════════════════════════════════
  console.log("\n4. Facturación masiva (issueMonthlyInvoices)");
  let invoiceId: string | null = null;
  try {
    // Generar 1 factura de prueba para la unidad
    const inv = await db.invoice.create({
      data: {
        organizationId: org.id, communityId: community.id, unitId: unit.id,
        invoiceNumber: `TEST-2026-0001`,
        type: "ALIQUOT", periodYear: 2026, periodMonth: 4,
        issuedAt: new Date(), dueDate: new Date(Date.now() + 30 * 86400000),
        totalBss: "500.00", totalUsd: "10.00",
        exchangeRate: "50.00000000", exchangeSource: "MANUAL",
        currencyPrimary: "USD", status: "ISSUED",
      },
    });
    invoiceId = inv.id;
    const reloaded = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    if (reloaded.invoiceNumber !== "TEST-2026-0001") throw new Error("Número de factura incorrecto");
    ok("Invoice creada y persistida");
  } catch (e) { fail("issueMonthlyInvoices", e); }

  // ══════════════════════════════════════════════════════════════
  // 5. REGISTRO DE PAGO (recordPayment)
  // ══════════════════════════════════════════════════════════════
  console.log("\n5. Registro de pago (recordPayment)");
  let paymentId: string | null = null;
  try {
    const payment = await db.payment.create({
      data: {
        organizationId: org.id, communityId: community.id, unitId: unit.id,
        amountBss: "500.00", amountUsd: "10.00",
        exchangeRate: "50.00000000", exchangeSource: "MANUAL",
        currencyPrimary: "USD", method: "TRANSFER_USD",
        reference: "TEST-REF-001", paidAt: new Date(),
        createdById: user.id,
      },
    });
    paymentId = payment.id;
    // Asignar a la factura si existe
    if (invoiceId) {
      await db.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId, amountBss: "500.00", amountUsd: "10.00" },
      });
      await db.invoice.update({
        where: { id: invoiceId },
        data: { paidBss: "500.00", paidUsd: "10.00", status: "PAID" },
      });
    }
    const reloaded = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (reloaded.reference !== "TEST-REF-001") throw new Error("Referencia incorrecta");
    ok("Payment creado, asignado a invoice, y persistido");
    if (invoiceId) {
      const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (inv.status !== "PAID") throw new Error(`Invoice status: ${inv.status} (esperado PAID)`);
      ok("Invoice actualizada a PAID");
    }
  } catch (e) { fail("recordPayment", e); }

  // ══════════════════════════════════════════════════════════════
  // 6. PERSONA / PROPIETARIO (persons.create)
  // ══════════════════════════════════════════════════════════════
  console.log("\n6. Crear persona (persons.create)");
  let personId: string | null = null;
  try {
    const person = await db.person.create({
      data: {
        organizationId: org.id,
        firstName: "TestNombre", lastName: "TestApellido",
        idType: "CEDULA_V", idNumber: "99999999",
        email: "test.form@ejemplo.com", phone: "04141234567",
      },
    });
    personId = person.id;
    const reloaded = await db.person.findUniqueOrThrow({ where: { id: person.id } });
    if (reloaded.idNumber !== "99999999") throw new Error("idNumber incorrecto");
    ok("Person creada y persistida");
  } catch (e) { fail("persons.create", e); }

  // ══════════════════════════════════════════════════════════════
  // 7. ASIGNACIÓN DE PROPIETARIO A UNIDAD (assignOwner)
  // ══════════════════════════════════════════════════════════════
  console.log("\n7. Asignar propietario (assignOwner)");
  let ownershipId: string | null = null;
  if (personId) {
    try {
      const ownership = await db.ownership.create({
        data: {
          unitId: unit.id, personId,
          sharePercent: new Decimal(100).toFixed(2),
          startDate: new Date("2026-01-01"),
        },
      });
      ownershipId = ownership.id;
      const reloaded = await db.ownership.findUniqueOrThrow({ where: { id: ownership.id } });
      if (Number(reloaded.sharePercent) !== 100) throw new Error("sharePercent incorrecto");
      ok("Ownership creada y persistida");
    } catch (e) { fail("assignOwner", e); }
  }

  // ══════════════════════════════════════════════════════════════
  // 8. VEHÍCULO (vehicles.create)
  // ══════════════════════════════════════════════════════════════
  console.log("\n8. Crear vehículo (vehicles.create)");
  let vehicleId: string | null = null;
  if (personId) {
    try {
      const vehicle = await db.vehicle.create({
        data: {
          organizationId: org.id, personId,
          type: "CAR", brand: "Toyota", model: "Corolla",
          year: 2020, color: "Blanco", plate: "AB123CD",
        },
      });
      vehicleId = vehicle.id;
      const reloaded = await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
      if (reloaded.plate !== "AB123CD") throw new Error("Placa incorrecta");
      ok("Vehicle creado y persistido");
    } catch (e) { fail("vehicles.create", e); }
  }

  // ══════════════════════════════════════════════════════════════
  // 9. WORK ORDER (workOrders.create)
  // ══════════════════════════════════════════════════════════════
  console.log("\n9. Orden de trabajo (workOrders.create)");
  let workOrderId: string | null = null;
  try {
    const wo = await db.workOrder.create({
      data: {
        organizationId: org.id, communityId: community.id,
        title: "Test trabajo", description: "Prueba de formulario",
        category: "REPAIRS", priority: "MEDIUM", status: "OPEN",
        reportedById: user.id,
      },
    });
    workOrderId = wo.id;
    const reloaded = await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    if (reloaded.title !== "Test trabajo") throw new Error("Título incorrecto");
    ok("WorkOrder creada y persistida");
    // Test cambio de estado
    await db.workOrder.update({ where: { id: wo.id }, data: { status: "IN_PROGRESS" } });
    const updated = await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    if (updated.status !== "IN_PROGRESS") throw new Error(`Status: ${updated.status}`);
    ok("WorkOrder actualizada a IN_PROGRESS");
  } catch (e) { fail("workOrders.create", e); }

  // ══════════════════════════════════════════════════════════════
  // 10. VISITANTE (security.visitors.create)
  // ══════════════════════════════════════════════════════════════
  console.log("\n10. Visitante (visitors.create)");
  let visitorId: string | null = null;
  try {
    const visitor = await db.visitor.create({
      data: {
        organizationId: org.id, communityId: community.id, unitId: unit.id,
        firstName: "VisitanteTest", lastName: "Apellido",
        validFrom: new Date(), validUntil: new Date(Date.now() + 86400000),
        accessCode: "TEST123", purpose: "Visita familiar",
        status: "PENDING",
      },
    });
    visitorId = visitor.id;
    // Check-in
    await db.visitor.update({
      where: { id: visitor.id },
      data: { status: "CHECKED_IN", checkInAt: new Date(), checkedInById: user.id },
    });
    const reloaded = await db.visitor.findUniqueOrThrow({ where: { id: visitor.id } });
    if (reloaded.status !== "CHECKED_IN") throw new Error(`Status: ${reloaded.status}`);
    ok("Visitor creado, check-in hecho, y persistido");
  } catch (e) { fail("visitors.create + checkIn", e); }

  // ══════════════════════════════════════════════════════════════
  // 11. ANUNCIO (announcements.create)
  // ══════════════════════════════════════════════════════════════
  console.log("\n11. Anuncio (announcements.create)");
  let announcementId: string | null = null;
  try {
    const ann = await db.announcement.create({
      data: {
        organizationId: org.id, communityId: community.id,
        title: "Test Anuncio", body: "Cuerpo del anuncio de prueba",
        pinned: true, createdById: user.id,
      },
    });
    announcementId = ann.id;
    const reloaded = await db.announcement.findUniqueOrThrow({ where: { id: ann.id } });
    if (reloaded.title !== "Test Anuncio") throw new Error("Título incorrecto");
    ok("Announcement creado y persistido");
  } catch (e) { fail("announcements.create", e); }

  // ══════════════════════════════════════════════════════════════
  // 12. ASAMBLEA (assemblies.create)
  // ══════════════════════════════════════════════════════════════
  console.log("\n12. Asamblea (assemblies.create)");
  let assemblyId: string | null = null;
  try {
    const assembly = await db.assembly.create({
      data: {
        organizationId: org.id, communityId: community.id,
        title: "Asamblea Test", scheduledAt: new Date(Date.now() + 7 * 86400000),
        location: "Salón de usos múltiples", quorumRequired: 50,
        status: "SCHEDULED", createdById: user.id,
      },
    });
    assemblyId = assembly.id;
    const reloaded = await db.assembly.findUniqueOrThrow({ where: { id: assembly.id } });
    if (reloaded.title !== "Asamblea Test") throw new Error("Título incorrecto");
    ok("Assembly creada y persistida");
  } catch (e) { fail("assemblies.create", e); }

  // ══════════════════════════════════════════════════════════════
  // 13. INGRESO EXTRA (income.create)
  // ══════════════════════════════════════════════════════════════
  console.log("\n13. Ingreso extra (income.create)");
  try {
    const income = await db.income.create({
      data: {
        organizationId: org.id, communityId: community.id,
        category: "HALL_RENTAL", description: "Alquiler salón test",
        periodYear: 2026, periodMonth: 4,
        amountBss: "250.00", amountUsd: "5.00",
        exchangeRate: "50.00000000", exchangeSource: "MANUAL",
        currencyPrimary: "USD",
      },
    });
    const reloaded = await db.income.findUniqueOrThrow({ where: { id: income.id } });
    if (reloaded.description !== "Alquiler salón test") throw new Error("Descripción incorrecta");
    ok("Income creado y persistido");
    await db.income.delete({ where: { id: income.id } });
  } catch (e) { fail("income.create", e); }

  // ══════════════════════════════════════════════════════════════
  // 14. CUOTA EXTRA POR UNIDAD (applyExtraFee)
  // ══════════════════════════════════════════════════════════════
  console.log("\n14. Cuota extra por unidad (applyExtraFee)");
  try {
    const extraInv = await db.invoice.create({
      data: {
        organizationId: org.id, communityId: community.id, unitId: unit.id,
        invoiceNumber: "EXTRA-TEST-001",
        type: "EXTRA_FEE", periodYear: 2026, periodMonth: 4,
        issuedAt: new Date(), dueDate: new Date(Date.now() + 15 * 86400000),
        totalBss: "100.00", totalUsd: "2.00",
        exchangeRate: "50.00000000", exchangeSource: "MANUAL",
        currencyPrimary: "USD", status: "ISSUED",
        notes: "Cargo por daño en área común",
      },
    });
    const reloaded = await db.invoice.findUniqueOrThrow({ where: { id: extraInv.id } });
    if (reloaded.type !== "EXTRA_FEE") throw new Error(`type: ${reloaded.type}`);
    ok("Invoice EXTRA_FEE creada y persistida");
    await db.invoice.update({ where: { id: extraInv.id }, data: { voidedAt: new Date(), voidReason: "Test limpieza" } });
  } catch (e) { fail("applyExtraFee", e); }

  // ══════════════════════════════════════════════════════════════
  // 15. CREAR USUARIO ORG ADMIN (nuevo - lo vamos a implementar)
  // ══════════════════════════════════════════════════════════════
  console.log("\n15. Crear usuario ORG_ADMIN");
  let testAdminUserId: string | null = null;
  try {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("admin1234", 12);
    const newUser = await db.user.create({
      data: {
        email: "test.admin.arrayanes@condominios.local",
        name: "Admin Test",
        passwordHash: hash,
        active: true,
      },
    });
    testAdminUserId = newUser.id;
    await db.membership.create({
      data: {
        userId: newUser.id,
        scope: "ORGANIZATION",
        role: "ORG_ADMIN",
        organizationId: org.id,
        active: true,
      },
    });
    const mem = await db.membership.findFirst({ where: { userId: newUser.id, organizationId: org.id } });
    if (!mem || mem.role !== "ORG_ADMIN") throw new Error("Membership no creada");
    ok("User ORG_ADMIN creado con Membership y persistido");
  } catch (e) { fail("createOrgAdmin", e); }

  // ══════════════════════════════════════════════════════════════
  // LIMPIEZA
  // ══════════════════════════════════════════════════════════════
  console.log("\n── Limpiando datos de prueba ──");
  const cleanups = [
    assemblyId && db.assembly.delete({ where: { id: assemblyId } }),
    announcementId && db.announcement.delete({ where: { id: announcementId } }),
    visitorId && db.visitor.delete({ where: { id: visitorId } }),
    workOrderId && db.workOrder.delete({ where: { id: workOrderId } }),
    vehicleId && db.vehicle.delete({ where: { id: vehicleId } }),
    ownershipId && db.ownership.delete({ where: { id: ownershipId } }),
    paymentId && db.paymentAllocation.deleteMany({ where: { paymentId } }).then(() => db.payment.delete({ where: { id: paymentId! } })),
    invoiceId && db.invoice.delete({ where: { id: invoiceId } }),
    expenseId && db.expense.delete({ where: { id: expenseId } }),
    personId && db.person.delete({ where: { id: personId } }),
    testAdminUserId && db.membership.deleteMany({ where: { userId: testAdminUserId } }).then(() => db.user.delete({ where: { id: testAdminUserId! } })),
  ];
  for (const c of cleanups) { if (c) await c.catch(() => {}); }
  console.log("  Limpieza completa.");

  // ══════════════════════════════════════════════════════════════
  // RESULTADO FINAL
  // ══════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  RESULTADO: ${passed} ✅  /  ${failed} ❌`);
  if (errors.length > 0) {
    console.log("\n  FALLOS:");
    errors.forEach(e => console.log(`    • ${e}`));
  }
  console.log("═══════════════════════════════════════════════════\n");

  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Error fatal:", e);
  await db.$disconnect();
  process.exit(1);
});
