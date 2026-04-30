/**
 * Seed: Los Arrayanes — Torre A y Torre B
 *
 * Crea una organización nueva, la comunidad, 188 unidades y 10 propietarios de prueba.
 * Correr con: npx tsx scripts/seed-arrayanes.ts
 */

import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

const db = new PrismaClient();

// ── Propietarios de prueba ─────────────────────────────────────────────────
const OWNERS = [
  { firstName: "Luis",      lastName: "Ilarraza",   idNumber: "12.345.678", email: "luissilvalaguna1@gmail.com", phone: "04141234567", whatsapp: "584141234567" },
  { firstName: "María",     lastName: "González",   idNumber: "10.234.567", email: "maria.gonzalez@ejemplo.com", phone: "04242345678", whatsapp: "584242345678" },
  { firstName: "José",      lastName: "Rodríguez",  idNumber: "8.123.456",  email: "jose.rodriguez@ejemplo.com", phone: "04143456789", whatsapp: "584143456789" },
  { firstName: "Ana",       lastName: "Martínez",   idNumber: "15.432.109", email: "ana.martinez@ejemplo.com",   phone: "04124567890", whatsapp: "584124567890" },
  { firstName: "Carlos",    lastName: "Pérez",      idNumber: "11.876.543", email: "carlos.perez@ejemplo.com",   phone: "04265678901", whatsapp: "584265678901" },
  { firstName: "Carmen",    lastName: "López",      idNumber: "9.765.432",  email: "carmen.lopez@ejemplo.com",   phone: "04146789012", whatsapp: "584146789012" },
  { firstName: "Roberto",   lastName: "Díaz",       idNumber: "13.654.321", email: "roberto.diaz@ejemplo.com",   phone: "04127890123", whatsapp: "584127890123" },
  { firstName: "Patricia",  lastName: "Morales",    idNumber: "16.543.210", email: "patricia.morales@ejemplo.com",phone: "04268901234", whatsapp: "584268901234" },
  { firstName: "Fernando",  lastName: "Torres",     idNumber: "7.432.109",  email: "fernando.torres@ejemplo.com", phone: "04149012345", whatsapp: "584149012345" },
  { firstName: "Gabriela",  lastName: "Ramos",      idNumber: "14.321.098", email: "gabriela.ramos@ejemplo.com",  phone: "04120123456", whatsapp: "584120123456" },
];

// ── Unidades de Los Arrayanes ──────────────────────────────────────────────
function buildUnits() {
  const units: { code: string; tower: string; floor: number; type: "APARTMENT" | "OTHER" }[] = [];
  const FLOORS_NORMAL = 23;
  const APTS_PER_FLOOR = ["A", "B", "C", "D"];

  for (const tower of ["A", "B"]) {
    // Pisos 1–23: 4 apartamentos cada uno
    for (let floor = 1; floor <= FLOORS_NORMAL; floor++) {
      for (const apt of APTS_PER_FLOOR) {
        units.push({
          code: `${tower}-${floor}${apt}`,
          tower,
          floor,
          type: "APARTMENT",
        });
      }
    }
    // Piso 24: 2 penthouses
    units.push({ code: `${tower}-24PH1`, tower, floor: 24, type: "OTHER" });
    units.push({ code: `${tower}-24PH2`, tower, floor: 24, type: "OTHER" });
  }

  return units; // 188 unidades en total
}

async function main() {
  console.log("🌱  Iniciando seed Los Arrayanes...\n");

  // 1. Plan PRO
  const plan = await db.plan.findFirstOrThrow({ where: { code: "PRO" } });
  console.log(`✓  Plan: ${plan.name}`);

  // 2. Organización
  const org = await db.organization.upsert({
    where: { slug: "los-arrayanes" },
    update: {},
    create: {
      slug:    "los-arrayanes",
      name:    "Condominio Los Arrayanes",
      email:   "admin@arrayanes.com",
      phone:   "02412345678",
      address: "Av. Los Arrayanes, Naguanagua",
      city:    "Valencia",
      country: "VE",
    },
  });
  console.log(`✓  Organización: ${org.name} (${org.id})`);

  // 3. Suscripción PRO
  const periodEnd = new Date();
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  await db.subscription.upsert({
    where: { organizationId: org.id },
    update: { currentPeriodEnd: periodEnd },
    create: {
      organizationId:   org.id,
      planId:           plan.id,
      status:           "ACTIVE",
      currentPeriodEnd: periodEnd,
    },
  });
  console.log(`✓  Suscripción PRO activa hasta ${periodEnd.toLocaleDateString("es-VE")}`);

  // 4. Comunidad
  let community = await db.community.findFirst({
    where: { organizationId: org.id, name: "Los Arrayanes", deletedAt: null },
  });
  if (!community) {
    community = await db.community.create({
      data: {
        organizationId:  org.id,
        name:            "Los Arrayanes",
        address:         "Av. Los Arrayanes, Naguanagua, Carabobo",
        city:            "Valencia",
        state:           "Carabobo",
        country:         "VE",
        totalUnits:      188,
        floorsCount:     24,
        towersCount:     2,
        primaryCurrency: "USD",
        monthlyFeeUsd:   new Decimal(20),
      },
    });
  }
  console.log(`✓  Comunidad: ${community.name} (${community.id})`);

  // 5. Unidades — con alícuotas que suman exactamente 100.000000
  const unitDefs = buildUnits(); // 188 unidades
  const TOTAL = unitDefs.length; // 188
  const baseAliquot = new Decimal(100).div(TOTAL).toDecimalPlaces(6, Decimal.ROUND_DOWN);
  const lastAliquot = new Decimal(100).minus(baseAliquot.times(TOTAL - 1));

  console.log(`\n  Creando ${TOTAL} unidades...`);
  const createdUnits: { id: string; code: string }[] = [];

  for (let i = 0; i < unitDefs.length; i++) {
    const def = unitDefs[i]!;
    const aliquot = i === unitDefs.length - 1 ? lastAliquot : baseAliquot;

    const unit = await db.unit.upsert({
      where: { communityId_code: { communityId: community.id, code: def.code } },
      update: {},
      create: {
        organizationId: org.id,
        communityId:    community.id,
        code:           def.code,
        type:           def.type,
        tower:          def.tower,
        floor:          def.floor,
        aliquot:        aliquot.toFixed(6),
        active:         true,
      },
    });
    createdUnits.push({ id: unit.id, code: unit.code });
  }
  console.log(`✓  ${TOTAL} unidades creadas (alícuota base: ${baseAliquot.toFixed(6)}%)`);

  // 6. Propietarios de prueba + asignación a unidades
  console.log(`\n  Creando ${OWNERS.length} propietarios de prueba...`);

  // Unidades donde asignaremos los propietarios (variadas entre las 2 torres)
  const TARGET_UNITS = [
    "A-15C", "A-5B", "A-10C", "A-20A", "A-2D",
    "B-1B", "B-6C", "B-12D", "B-18A", "A-24PH1",
  ];

  for (let i = 0; i < OWNERS.length; i++) {
    const ownerData = OWNERS[i]!;
    const targetCode = TARGET_UNITS[i]!;
    const targetUnit = createdUnits.find((u) => u.code === targetCode);
    if (!targetUnit) { console.warn(`  ⚠️  Unidad ${targetCode} no encontrada`); continue; }

    const person = await db.person.upsert({
      where: { organizationId_idType_idNumber: { organizationId: org.id, idType: "CEDULA_V", idNumber: ownerData.idNumber } },
      update: { email: ownerData.email },
      create: {
        organizationId: org.id,
        firstName:      ownerData.firstName,
        lastName:       ownerData.lastName,
        idType:         "CEDULA_V",
        idNumber:       ownerData.idNumber,
        email:          ownerData.email,
        phone:          ownerData.phone,
        whatsapp:       ownerData.whatsapp,
      },
    });

    // Verificar si ya tiene ownership activo en esa unidad
    const existing = await db.ownership.findFirst({
      where: { unitId: targetUnit.id, personId: person.id, endDate: null },
    });
    if (!existing) {
      await db.ownership.create({
        data: {
          unitId:      targetUnit.id,
          personId:    person.id,
          sharePercent: new Decimal(100),
          startDate:   new Date("2025-01-01"),
        },
      });
    }

    console.log(`  ✓  ${ownerData.firstName} ${ownerData.lastName} → ${targetCode} (${ownerData.email})`);
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║            ✅  Seed completado exitosamente              ║
╠══════════════════════════════════════════════════════════╣
║  Organización : Condominio Los Arrayanes                 ║
║  Slug         : los-arrayanes                            ║
║  Comunidad    : Los Arrayanes (Torre A + Torre B)        ║
║  Unidades     : 188 (pisos 1-23 x 4 apts + PH x 2)      ║
║  Propietarios : 10 de prueba creados                     ║
╠══════════════════════════════════════════════════════════╣
║  Para probar el portal de residentes:                    ║
║  → https://condominios-theta.vercel.app/portal           ║
║  → Email: luissilvalaguna1@gmail.com (Unidad A-15C)      ║
╚══════════════════════════════════════════════════════════╝
`);
}

main()
  .catch((e) => { console.error("❌  Error:", e); process.exit(1); })
  .finally(() => db.$disconnect());
