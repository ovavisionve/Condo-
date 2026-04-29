/**
 * Crea el edificio "Residencias Hugo Chávez Frías" con 10 pisos y 4 aptos por piso.
 * Ejecutar: pnpm tsx scripts/seed-hugo.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const org = await db.organization.findFirst({ select: { id: true, name: true } });
  if (!org) throw new Error("No hay organización. Ejecuta pnpm db:seed primero.");
  console.log(`Org: ${org.name} (${org.id})`);

  // Crear la comunidad
  const community = await db.community.upsert({
    where: { id: "hugo-chavez-frias-seed" },
    update: {},
    create: {
      id: "hugo-chavez-frias-seed",
      organizationId: org.id,
      name: "Residencias Hugo Chávez Frías",
      address: "Av. Bolívar, Sector Centro",
      city: "Caracas",
      state: "Distrito Capital",
      primaryCurrency: "USD",
      floorsCount: 10,
      totalUnits: 0,
      notes: "Edificio residencial 10 pisos · 4 aptos/piso · 1 ascensor. Multa por uso del ascensor sin suministro de agua activo.",
    },
  });
  console.log(`✅ Comunidad: ${community.name}`);

  // 40 unidades: 10 pisos × 4 aptos (A, B, C, D)
  // Alícuota exacta: 100 / 40 = 2.500000%
  const LETTERS = ["A", "B", "C", "D"];
  const ALIQUOT = new Prisma.Decimal(100).div(40).toDecimalPlaces(6).toString();

  const existing = await db.unit.count({ where: { communityId: community.id } });
  if (existing > 0) {
    console.log(`⚠️  Ya existen ${existing} unidades. Saltando creación de unidades.`);
  } else {
    const data = [];
    for (let floor = 1; floor <= 10; floor++) {
      for (let i = 0; i < 4; i++) {
        data.push({
          organizationId: org.id,
          communityId: community.id,
          code: `${floor}${LETTERS[i]}`,   // 1A, 1B, … 10C, 10D
          type: "APARTMENT" as const,
          aliquot: ALIQUOT,
          floor,
          active: true,
        });
      }
    }
    await db.unit.createMany({ data });
    await db.community.update({
      where: { id: community.id },
      data: { totalUnits: 40 },
    });
    console.log(`✅ Creadas 40 unidades (pisos 1–10, aptos A–D)`);
  }

  console.log("\nDatos del edificio:");
  console.log(`  ID comunidad : ${community.id}`);
  console.log(`  Pisos        : 10`);
  console.log(`  Aptos        : 40 (${LETTERS.join(", ")} por piso)`);
  console.log(`  Alícuota     : ${ALIQUOT}% por unidad`);
  console.log(`  Cuota mensual: No configurada (ir a Finanzas → Configuración)`);
}

main()
  .then(() => { console.log("\n✅ Listo."); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
