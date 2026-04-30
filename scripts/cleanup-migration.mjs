import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const COMMUNITY_ID = "cmoky25fo00041026u1nhs0pb";
const ORG_ID       = "cmoky1shn0000a3a65nazzt0z";

async function main() {
  const inv = await db.invoice.deleteMany({ where: { communityId: COMMUNITY_ID, invoiceNumber: { startsWith: "IMP-MIG" } } });
  console.log(`✅ Facturas eliminadas: ${inv.count}`);
  const persons = await db.person.findMany({ where: { organizationId: ORG_ID, idNumber: { startsWith: "991000" } }, select: { id: true } });
  if (persons.length) {
    await db.ownership.deleteMany({ where: { personId: { in: persons.map(p => p.id) } } });
    const per = await db.person.deleteMany({ where: { id: { in: persons.map(p => p.id) } } });
    console.log(`✅ Personas eliminadas: ${per.count}`);
  }
  console.log("✅ Limpieza completa.");
}
main().then(() => db.$disconnect()).catch(e => { console.error(e.message); db.$disconnect(); });
