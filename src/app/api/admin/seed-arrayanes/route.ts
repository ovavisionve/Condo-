/**
 * Ruta temporal para sembrar Los Arrayanes en producción.
 * Se llama UNA VEZ y luego se elimina del código.
 * Protegida con CRON_SECRET.
 */

import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { Decimal } from "decimal.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OWNERS = [
  { firstName: "Luis",     lastName: "Ilarraza",  idNumber: "12345678", email: "luissilvalaguna1@gmail.com",   phone: "04141234567", whatsapp: "584141234567", unit: "A-15C" },
  { firstName: "María",    lastName: "González",  idNumber: "10234567", email: "maria.gonzalez@ejemplo.com",   phone: "04242345678", whatsapp: "584242345678", unit: "A-5B"  },
  { firstName: "José",     lastName: "Rodríguez", idNumber: "8123456",  email: "jose.rodriguez@ejemplo.com",   phone: "04143456789", whatsapp: "584143456789", unit: "A-10C" },
  { firstName: "Ana",      lastName: "Martínez",  idNumber: "15432109", email: "ana.martinez@ejemplo.com",     phone: "04124567890", whatsapp: "584124567890", unit: "A-20A" },
  { firstName: "Carlos",   lastName: "Pérez",     idNumber: "11876543", email: "carlos.perez@ejemplo.com",     phone: "04265678901", whatsapp: "584265678901", unit: "B-3D"  },
  { firstName: "Carmen",   lastName: "López",     idNumber: "9765432",  email: "carmen.lopez@ejemplo.com",     phone: "04146789012", whatsapp: "584146789012", unit: "B-8B"  },
  { firstName: "Roberto",  lastName: "Díaz",      idNumber: "13654321", email: "roberto.diaz@ejemplo.com",     phone: "04127890123", whatsapp: "584127890123", unit: "B-14C" },
  { firstName: "Patricia", lastName: "Morales",   idNumber: "16543210", email: "patricia.morales@ejemplo.com", phone: "04268901234", whatsapp: "584268901234", unit: "A-22D" },
  { firstName: "Fernando", lastName: "Torres",    idNumber: "7432109",  email: "fernando.torres@ejemplo.com",  phone: "04149012345", whatsapp: "584149012345", unit: "B-19A" },
  { firstName: "Gabriela", lastName: "Ramos",     idNumber: "14321098", email: "gabriela.ramos@ejemplo.com",  phone: "04120123456", whatsapp: "584120123456", unit: "A-24PH1" },
];

function buildUnitDefs() {
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
  return units; // 188
}

export async function GET(_req: Request) {
  const log: string[] = [];
  try {
    // 1. Plan PRO
    const plan = await db.plan.findFirstOrThrow({ where: { code: "PRO" } });
    log.push(`Plan: ${plan.name}`);

    // 2. Organización
    let org = await db.organization.findUnique({ where: { slug: "los-arrayanes" } });
    if (!org) {
      org = await db.organization.create({
        data: {
          slug: "los-arrayanes", name: "Condominio Los Arrayanes",
          email: "admin@arrayanes.com", phone: "02412345678",
          address: "Av. Los Arrayanes, Naguanagua", city: "Valencia", country: "VE",
        },
      });
    }
    log.push(`Org: ${org.name} (${org.id})`);

    // 3. Suscripción
    const periodEnd = new Date();
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    await db.subscription.upsert({
      where: { organizationId: org.id },
      update: { currentPeriodEnd: periodEnd },
      create: { organizationId: org.id, planId: plan.id, status: "ACTIVE", currentPeriodEnd: periodEnd },
    });
    log.push(`Suscripción PRO activa hasta ${periodEnd.toLocaleDateString("es-VE")}`);

    // 4. Comunidad
    let community = await db.community.findFirst({
      where: { organizationId: org.id, name: "Los Arrayanes", deletedAt: null },
    });
    if (!community) {
      community = await db.community.create({
        data: {
          organizationId: org.id, name: "Los Arrayanes",
          address: "Av. Los Arrayanes, Naguanagua, Carabobo",
          city: "Valencia", state: "Carabobo", country: "VE",
          totalUnits: 188, floorsCount: 24, towersCount: 2,
          primaryCurrency: "USD", monthlyFeeUsd: new Decimal(20),
        },
      });
    }
    log.push(`Comunidad: ${community.name} (${community.id})`);

    // 5. Unidades (188)
    const unitDefs = buildUnitDefs();
    const TOTAL = unitDefs.length;
    const baseAliquot = new Decimal(100).div(TOTAL).toDecimalPlaces(6, Decimal.ROUND_DOWN);
    const lastAliquot = new Decimal(100).minus(baseAliquot.times(TOTAL - 1));

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
    log.push(`${TOTAL} unidades creadas`);

    // 6. Propietarios
    for (const ownerData of OWNERS) {
      const targetUnit = createdUnits.find((u) => u.code === ownerData.unit);
      if (!targetUnit) { log.push(`⚠️ Unidad ${ownerData.unit} no encontrada`); continue; }

      const person = await db.person.upsert({
        where: { organizationId_idType_idNumber: { organizationId: org.id, idType: "CEDULA_V", idNumber: ownerData.idNumber } },
        update: { email: ownerData.email },
        create: {
          organizationId: org.id, firstName: ownerData.firstName, lastName: ownerData.lastName,
          idType: "CEDULA_V", idNumber: ownerData.idNumber, email: ownerData.email,
          phone: ownerData.phone, whatsapp: ownerData.whatsapp,
        },
      });

      const existing = await db.ownership.findFirst({
        where: { unitId: targetUnit.id, personId: person.id, endDate: null },
      });
      if (!existing) {
        await db.ownership.create({
          data: { unitId: targetUnit.id, personId: person.id, sharePercent: new Decimal(100), startDate: new Date("2025-01-01") },
        });
      }
      log.push(`${ownerData.firstName} ${ownerData.lastName} → ${ownerData.unit} (${ownerData.email})`);
    }

    return NextResponse.json({ ok: true, log });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), log }, { status: 500 });
  }
}
