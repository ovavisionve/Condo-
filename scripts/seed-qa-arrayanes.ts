/**
 * Seed de AMBIENTE DE QA — "Arrayanes QA" con datos 100% FICTICIOS.
 *
 * Preparado para el ambiente de pruebas que Reinaldo/Luis pidieron (07-jul-2026) para
 * trabajar los recibos sin arriesgar datos reales de producción. Reusa la estructura de
 * `seed-arrayanes.ts` (188 unidades, 2 torres, alícuotas) pero con nombres/emails/deuda
 * inventados, y agrega plantillas de provisión + gastos de ejemplo del mes actual para
 * poder generar un recibo de prueba de inmediato.
 *
 * ⚠️ NUNCA correr esto contra la base de datos de PRODUCCIÓN (Innova). Antes de correr:
 *   1. Crea un proyecto Supabase nuevo dedicado a QA (dashboard de Supabase).
 *   2. Apunta DATABASE_URL (env local o del comando) a ESE proyecto, no al de producción.
 *   3. Aplica el schema (`npx prisma migrate deploy` o el SQL de referencia del repo).
 *   4. Corre: DATABASE_URL="postgres://...supabase-qa..." npx tsx scripts/seed-qa-arrayanes.ts
 *
 * El script tiene un guard de seguridad: si detecta 188 unidades YA existentes bajo el
 * nombre "Los Arrayanes" (sin "QA"), asume que apunta a producción y aborta sin tocar nada.
 */

import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

const db = new PrismaClient();

const ORG_SLUG = "arrayanes-qa";
const COMMUNITY_NAME = "Los Arrayanes — QA (datos ficticios)";

// ── Propietarios ficticios (emails claramente de prueba, nunca reales) ──────────
const FAKE_OWNERS = [
  { firstName: "Prueba", lastName: "Uno",   idNumber: "V-00000001", email: "qa-test-1@example.com" },
  { firstName: "Prueba", lastName: "Dos",   idNumber: "V-00000002", email: "qa-test-2@example.com" },
  { firstName: "Prueba", lastName: "Tres",  idNumber: "V-00000003", email: "qa-test-3@example.com" },
  { firstName: "Prueba", lastName: "Cuatro",idNumber: "V-00000004", email: "qa-test-4@example.com" },
  { firstName: "Prueba", lastName: "Cinco", idNumber: "V-00000005", email: "qa-test-5@example.com" },
];

// ── Plantillas de provisión (mismos conceptos que el Excel real, montos inventados) ──
const PROVISION_TEMPLATES = [
  { description: "Asistente Administrativo", amountBss: "12000" },
  { description: "Bono Alimentación", amountBss: "15000" },
  { description: "Servicios Generales", amountBss: "18000" },
  { description: "Servicio Bote Desechos Sólidos", amountBss: "3000" },
  { description: "Mantenimiento de Ascensores", amountBss: "11000" },
];

function buildUnits() {
  const units: { code: string; tower: string; floor: number; type: "APARTMENT" | "OTHER" }[] = [];
  for (const tower of ["A", "B"]) {
    for (let floor = 1; floor <= 23; floor++) {
      for (const apt of ["A", "B", "C", "D"]) {
        units.push({ code: `${tower}-${floor}${apt}`, tower, floor, type: "APARTMENT" });
      }
    }
    units.push({ code: `${tower}-24PH1`, tower, floor: 24, type: "OTHER" });
    units.push({ code: `${tower}-24PH2`, tower, floor: 24, type: "OTHER" });
  }
  return units; // 188 unidades
}

async function main() {
  console.log("🧪 Iniciando seed de AMBIENTE DE QA (datos ficticios)...\n");

  // ── Guard de seguridad: abortar si esto parece apuntar a producción ──────────
  const realArrayanes = await db.community.findFirst({
    where: { name: "Los Arrayanes", deletedAt: null },
    select: { id: true, _count: { select: { units: true } } },
  });
  if (realArrayanes && realArrayanes._count.units >= 100) {
    console.error("🛑 ABORTADO: ya existe una comunidad 'Los Arrayanes' con 100+ unidades reales.");
    console.error("   Esto indica que DATABASE_URL apunta a PRODUCCIÓN, no a QA.");
    console.error("   Verifica la variable de entorno antes de volver a correr este script.");
    process.exit(1);
  }

  const plan = await db.plan.findFirstOrThrow({ where: { code: "PRO" } });

  const org = await db.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: {
      slug: ORG_SLUG,
      name: "Arrayanes QA (ficticio)",
      email: "qa@example.com",
      phone: "0000000000",
      address: "Ambiente de pruebas — no es una dirección real",
      city: "QA",
      country: "VE",
    },
  });
  console.log(`✓ Organización QA: ${org.name} (${org.id})`);

  const periodEnd = new Date();
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  await db.subscription.upsert({
    where: { organizationId: org.id },
    update: { currentPeriodEnd: periodEnd },
    create: { organizationId: org.id, planId: plan.id, status: "ACTIVE", currentPeriodEnd: periodEnd },
  });

  let community = await db.community.findFirst({
    where: { organizationId: org.id, name: COMMUNITY_NAME, deletedAt: null },
  });
  if (!community) {
    community = await db.community.create({
      data: {
        organizationId: org.id,
        name: COMMUNITY_NAME,
        address: "Ambiente de pruebas — no es una dirección real",
        city: "QA", state: "QA", country: "VE",
        totalUnits: 188, floorsCount: 24, towersCount: 2,
        primaryCurrency: "VES",
        monthlyFeeUsd: new Decimal(0),
        reserveFundPct: new Decimal("0.10"),
        invoicePeriodShift: 1,
        rif: "J-00000000-0",
      },
    });
  }
  console.log(`✓ Comunidad QA: ${community.name} (${community.id})`);

  // ── Unidades ──────────────────────────────────────────────────────────────
  const unitDefs = buildUnits();
  const baseAliquot = new Decimal(100).div(unitDefs.length).toDecimalPlaces(6, Decimal.ROUND_DOWN);
  const lastAliquot = new Decimal(100).minus(baseAliquot.times(unitDefs.length - 1));
  const createdUnits: { id: string; code: string }[] = [];

  for (let i = 0; i < unitDefs.length; i++) {
    const def = unitDefs[i]!;
    const aliquot = i === unitDefs.length - 1 ? lastAliquot : baseAliquot;
    const unit = await db.unit.upsert({
      where: { communityId_code: { communityId: community.id, code: def.code } },
      update: {},
      create: {
        organizationId: org.id, communityId: community.id,
        code: def.code, type: def.type, tower: def.tower, floor: def.floor,
        aliquot: aliquot.toFixed(6), active: true,
      },
    });
    createdUnits.push({ id: unit.id, code: unit.code });
  }
  console.log(`✓ ${createdUnits.length} unidades ficticias creadas`);

  // ── Propietarios de prueba en las primeras 5 unidades ────────────────────────
  for (let i = 0; i < FAKE_OWNERS.length; i++) {
    const o = FAKE_OWNERS[i]!;
    const person = await db.person.upsert({
      where: { organizationId_idType_idNumber: { organizationId: org.id, idType: "CEDULA_V", idNumber: o.idNumber } },
      update: {},
      create: {
        organizationId: org.id, idType: "CEDULA_V", idNumber: o.idNumber,
        firstName: o.firstName, lastName: o.lastName, email: o.email,
      },
    });
    const unit = createdUnits[i]!;
    const existing = await db.ownership.findFirst({ where: { unitId: unit.id, personId: person.id, endDate: null } });
    if (!existing) {
      await db.ownership.create({ data: { unitId: unit.id, personId: person.id, sharePercent: "100", startDate: new Date() } });
    }
  }
  console.log(`✓ ${FAKE_OWNERS.length} propietarios ficticios asignados`);

  // ── Plantillas de provisión + gasto del mes actual (para poder previsualizar
  //     un recibo de inmediato después de correr este script) ──────────────────
  const now = new Date();
  const rate = await db.exchangeRate.findFirst({ orderBy: { date: "desc" } });
  const usdRate = rate ? Number(rate.vesPerUsd) : 100; // fallback si no hay tasas cargadas aún

  for (const t of PROVISION_TEMPLATES) {
    const tpl = await db.recurringExpenseTemplate.create({
      data: {
        organizationId: org.id, communityId: community.id,
        description: t.description, category: "OTHER", isProvision: true,
        currencyPrimary: "VES", amountBss: t.amountBss,
        amountUsd: (Number(t.amountBss) / usdRate).toFixed(2),
        active: true,
      },
    });
    await db.expense.create({
      data: {
        organizationId: org.id, communityId: community.id,
        category: "OTHER", description: `Provisión ${t.description}`,
        periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1,
        amountBss: t.amountBss, amountUsd: (Number(t.amountBss) / usdRate).toFixed(2),
        exchangeRate: usdRate.toFixed(8), exchangeSource: "MANUAL", currencyPrimary: "VES",
        recurringTemplateId: tpl.id, kind: "PROVISION_BASE",
      },
    });
  }
  console.log(`✓ ${PROVISION_TEMPLATES.length} plantillas de provisión + gastos del mes actual creados`);

  console.log("\n🧪 Seed de QA completo. Ya se puede emitir un recibo de prueba para este período.");
  console.log(`   Organización: ${org.slug} — Comunidad: ${community.id}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
