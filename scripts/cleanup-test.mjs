import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const COMMUNITY_ID = "cmoky25fo00041026u1nhs0pb";
const ORG_ID       = "cmoky1shn0000a3a65nazzt0z";
const TAG          = "PRUEBA_IMPORTACION";

async function main() {
  console.log("=== LIMPIEZA DE DATOS DE PRUEBA ===\n");

  // Pagos
  const p = await db.payment.deleteMany({ where: { communityId: COMMUNITY_ID, notes: TAG } });
  console.log(`✅ Pagos eliminados: ${p.count}`);

  // Facturas (items se eliminan en cascada)
  const i = await db.invoice.deleteMany({ where: { communityId: COMMUNITY_ID, invoiceNumber: { startsWith: "IMP-TEST" } } });
  console.log(`✅ Facturas eliminadas: ${i.count}`);

  // Gastos
  const e = await db.expense.deleteMany({ where: { communityId: COMMUNITY_ID, description: { contains: TAG } } });
  console.log(`✅ Gastos eliminados: ${e.count}`);

  // Unidades TEST (ownerships y tenancies se eliminan en cascada)
  const testUnits = await db.unit.findMany({
    where: { communityId: COMMUNITY_ID, code: { startsWith: "TEST-" } },
    select: { id: true },
  });
  const testUnitIds = testUnits.map((u) => u.id);

  if (testUnitIds.length > 0) {
    await db.ownership.deleteMany({ where: { unitId: { in: testUnitIds } } });
    await db.tenancy.deleteMany({ where: { unitId: { in: testUnitIds } } });
    const u = await db.unit.deleteMany({ where: { id: { in: testUnitIds } } });
    console.log(`✅ Unidades TEST eliminadas: ${u.count}`);
  }

  // Personas TEST (cédulas 99000001-3)
  const persons = await db.person.findMany({
    where: { organizationId: ORG_ID, idNumber: { startsWith: "990000" } },
    select: { id: true },
  });
  if (persons.length > 0) {
    await db.ownership.deleteMany({ where: { personId: { in: persons.map((p) => p.id) } } });
    const per = await db.person.deleteMany({ where: { id: { in: persons.map((p) => p.id) } } });
    console.log(`✅ Personas TEST eliminadas: ${per.count}`);
  }

  console.log("\n✅ Base de datos limpia — sin rastro de los datos de prueba.");
}

main().then(() => db.$disconnect()).catch((e) => {
  console.error("ERROR:", e.message);
  db.$disconnect();
  process.exit(1);
});
