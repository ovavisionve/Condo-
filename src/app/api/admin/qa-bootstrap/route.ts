/**
 * Bootstrap ambiente de QA — aplica el schema completo + siembra datos ficticios
 * sobre la base de datos apuntada por DATABASE_URL en este deployment (debe ser
 * el proyecto Supabase de QA, nunca producción).
 *
 * Pensado para correr en un deployment PREVIEW de Vercel (DATABASE_URL con scope
 * "Preview" apuntando al proyecto QA) — nunca en producción.
 *
 * Guard de seguridad: aborta si detecta una comunidad "Los Arrayanes" real
 * (100+ unidades) ya existente, señal de que apunta a producción por error.
 *
 * Patrón one-shot: desplegar (preview) → GET (dry-run) → POST confirm=1 → borrar.
 */
import { NextResponse, type NextRequest } from "next/server";
import { Decimal } from "decimal.js";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";
import { MIGRATIONS } from "./migrations-data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const ORG_SLUG = "arrayanes-qa";
const COMMUNITY_NAME = "Los Arrayanes — QA (datos ficticios)";

const FAKE_OWNERS = [
  { firstName: "Prueba", lastName: "Uno", idNumber: "V-00000001", email: "qa-test-1@example.com" },
  { firstName: "Prueba", lastName: "Dos", idNumber: "V-00000002", email: "qa-test-2@example.com" },
  { firstName: "Prueba", lastName: "Tres", idNumber: "V-00000003", email: "qa-test-3@example.com" },
  { firstName: "Prueba", lastName: "Cuatro", idNumber: "V-00000004", email: "qa-test-4@example.com" },
  { firstName: "Prueba", lastName: "Cinco", idNumber: "V-00000005", email: "qa-test-5@example.com" },
];

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
  return units;
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isIdempotentSkip(msg: string): boolean {
  return (
    msg.includes("already exists") ||
    msg.includes("duplicate column") ||
    msg.includes("42701") ||
    msg.includes("42P07") ||
    msg.includes("42710")
  );
}

async function checkSafetyGuard(): Promise<{ safe: boolean; reason: string }> {
  try {
    const real = await db.community.findFirst({
      where: { name: "Los Arrayanes", deletedAt: null },
      select: { id: true, _count: { select: { units: true } } },
    });
    if (real && real._count.units >= 100) {
      return { safe: false, reason: `Comunidad 'Los Arrayanes' real con ${real._count.units} unidades ya existe — esto apunta a PRODUCCIÓN.` };
    }
    return { safe: true, reason: "Sin comunidad 'Los Arrayanes' real de 100+ unidades. Seguro para continuar." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Tabla no existe todavía => base de datos vacía/fresca => imposible que sea producción.
    return { safe: true, reason: `Tabla Community no existe aún (BD fresca): ${msg}` };
  }
}

async function applySchema(): Promise<{ steps: string[]; errors: string[] }> {
  const steps: string[] = [];
  const errors: string[] = [];

  for (const file of MIGRATIONS) {
    // Camino rápido: todo el archivo en un solo round-trip (multi-statement).
    try {
      await db.$executeRawUnsafe(file.sql);
      steps.push(`✅ ${file.name} — aplicado completo (batch)`);
    } catch (e) {
      // Fallback: statement por statement (más lento, pero idempotente y con
      // mejor diagnóstico si el batch falla a medio camino).
      const statements = splitStatements(file.sql);
      let fileOk = 0;
      let fileSkipped = 0;
      for (const stmt of statements) {
        try {
          await db.$executeRawUnsafe(stmt);
          fileOk++;
        } catch (e2) {
          const msg = e2 instanceof Error ? e2.message : String(e2);
          if (isIdempotentSkip(msg)) {
            fileSkipped++;
          } else {
            errors.push(`❌ ${file.name}: ${msg} | statement: ${stmt.slice(0, 120)}`);
          }
        }
      }
      steps.push(`⚠️ ${file.name} — batch falló (${e instanceof Error ? e.message.slice(0, 80) : String(e)}), fallback: ${fileOk} aplicados, ${fileSkipped} ya existían`);
    }

    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations"
           ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
         VALUES
           (gen_random_uuid(),'qa-bootstrap-manual',NOW(),'${file.name}',NULL,NULL,NOW(),1)
         ON CONFLICT DO NOTHING`,
      );
    } catch {
      // No crítico — solo para que `prisma migrate status` no se confunda después.
    }
  }

  return { steps, errors };
}

async function seedQaData(): Promise<Record<string, unknown>> {
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
        city: "QA",
        state: "QA",
        country: "VE",
        totalUnits: 188,
        floorsCount: 24,
        towersCount: 2,
        primaryCurrency: "VES",
        monthlyFeeUsd: new Decimal(0),
        reserveFundPct: new Decimal("0.10"),
        invoicePeriodShift: 1,
        rif: "J-00000000-0",
      },
    });
  }

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
        organizationId: org.id,
        communityId: community.id,
        code: def.code,
        type: def.type,
        tower: def.tower,
        floor: def.floor,
        aliquot: aliquot.toFixed(6),
        active: true,
      },
    });
    createdUnits.push({ id: unit.id, code: unit.code });
  }

  for (let i = 0; i < FAKE_OWNERS.length; i++) {
    const o = FAKE_OWNERS[i]!;
    const person = await db.person.upsert({
      where: { organizationId_idType_idNumber: { organizationId: org.id, idType: "CEDULA_V", idNumber: o.idNumber } },
      update: {},
      create: {
        organizationId: org.id,
        idType: "CEDULA_V",
        idNumber: o.idNumber,
        firstName: o.firstName,
        lastName: o.lastName,
        email: o.email,
      },
    });
    const unit = createdUnits[i]!;
    const existing = await db.ownership.findFirst({ where: { unitId: unit.id, personId: person.id, endDate: null } });
    if (!existing) {
      await db.ownership.create({ data: { unitId: unit.id, personId: person.id, sharePercent: "100", startDate: new Date() } });
    }
  }

  const now = new Date();
  const rate = await db.exchangeRate.findFirst({ orderBy: { date: "desc" } });
  const usdRate = rate ? Number(rate.vesPerUsd) : 100;

  let templatesCreated = 0;
  for (const t of PROVISION_TEMPLATES) {
    const existingTpl = await db.recurringExpenseTemplate.findFirst({
      where: { communityId: community.id, description: t.description },
    });
    if (existingTpl) continue;
    const tpl = await db.recurringExpenseTemplate.create({
      data: {
        organizationId: org.id,
        communityId: community.id,
        description: t.description,
        category: "OTHER",
        isProvision: true,
        currencyPrimary: "VES",
        amountBss: t.amountBss,
        amountUsd: (Number(t.amountBss) / usdRate).toFixed(2),
        active: true,
      },
    });
    await db.expense.create({
      data: {
        organizationId: org.id,
        communityId: community.id,
        category: "OTHER",
        description: `Provisión ${t.description}`,
        periodYear: now.getFullYear(),
        periodMonth: now.getMonth() + 1,
        amountBss: t.amountBss,
        amountUsd: (Number(t.amountBss) / usdRate).toFixed(2),
        exchangeRate: usdRate.toFixed(8),
        exchangeSource: "MANUAL",
        currencyPrimary: "VES",
        recurringTemplateId: tpl.id,
        kind: "PROVISION_BASE",
      },
    });
    templatesCreated++;
  }

  return {
    organization: { id: org.id, slug: org.slug },
    community: { id: community.id, name: community.name },
    unitsCreated: createdUnits.length,
    ownersAssigned: FAKE_OWNERS.length,
    templatesCreated,
  };
}

export async function GET(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const guard = await checkSafetyGuard();
  let connected = false;
  let dbInfo: string | null = null;
  try {
    const r = await db.$queryRawUnsafe<{ current_database: string }[]>("SELECT current_database()");
    connected = true;
    dbInfo = r[0]?.current_database ?? null;
  } catch (e) {
    dbInfo = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    dryRun: true,
    connected,
    database: dbInfo,
    safetyGuard: guard,
    migrationsAvailable: MIGRATIONS.length,
    message: "Para ejecutar: POST con body { \"confirm\": \"QA-BOOTSTRAP\" }",
  });
}

export async function POST(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { confirm?: string } = {};
  try {
    body = (await req.json()) as { confirm?: string };
  } catch {
    // sin body -> dry-run
  }

  const guard = await checkSafetyGuard();
  if (!guard.safe) {
    return NextResponse.json({ error: "SAFETY_GUARD_BLOCKED", reason: guard.reason }, { status: 422 });
  }

  if (body.confirm !== "QA-BOOTSTRAP") {
    return NextResponse.json({
      dryRun: true,
      safetyGuard: guard,
      message: "Validación OK. Para ejecutar manda body con confirm: 'QA-BOOTSTRAP'",
    });
  }

  try {
    const schemaResult = await applySchema();
    if (schemaResult.errors.length > 0) {
      return NextResponse.json(
        { step: "SCHEMA", ...schemaResult, seeded: null },
        { status: 500 },
      );
    }
    const seeded = await seedQaData();
    return NextResponse.json({ step: "DONE", schema: schemaResult, seeded });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
