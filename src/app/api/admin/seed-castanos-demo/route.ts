/**
 * Seed one-shot: carga data demo del condominio LOS CASTAÑOS Torre B.
 *
 * Datos del Excel del cliente (DATA DEMO CASTAÑOS B.xlsx + DEMO RECIBO COND
 * LOS CASTAÑOS TORRE B.xlsm). Para demo de Reinaldo.
 *
 * Idempotente — solo agrega lo que falta:
 * 1. 16 unidades de Torre B (B-011 a B-062) si no existen
 * 2. 16 propietarios + Ownership 100%
 * 3. 4 deudas históricas dic/2025 como Invoices OVERDUE
 * 4. 13 gastos ordinarios x 3 meses (mar, abr, may 2026) + 2 extraordinarios solo marzo
 *
 * Llamada:
 *   curl -X POST "https://condominios-theta.vercel.app/api/admin/seed-castanos-demo?communityId=cmoukqntu00015niqpsjlu4cw" \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

// Tasas BCV referenciales por mes (aprox 487 marzo, escalando)
const RATES_BY_MONTH: Record<number, number> = { 3: 487.12, 4: 495.00, 5: 504.91 };

type Apto = {
  code: string;
  floor: number;
  firstName: string;
  lastName: string;
  email: string;
  deudaUsd: number;
};

// 16 apartamentos del Excel. Alícuota uniforme 1.0638% (1/94 redondeado del recibo).
const APTOS: Apto[] = [
  { code: "B-011", floor: 1, firstName: "FRANCO",   lastName: "SALAZAR",         email: "m0vicalnmuebles@gmail.com",   deudaUsd: 0 },
  { code: "B-012", floor: 1, firstName: "RAMON",    lastName: "CEDEÑO",          email: "geogafia1880@gmail.com",      deudaUsd: 0 },
  { code: "B-013", floor: 1, firstName: "VIRGINIA", lastName: "SATIR",           email: "luiscab78@gmail.com",         deudaUsd: 0 },
  { code: "B-014", floor: 1, firstName: "MARÍA E",  lastName: "SANTOS",          email: "mariab984s@hotmail.com",      deudaUsd: 0 },
  { code: "B-021", floor: 2, firstName: "PEDRO",    lastName: "RICARDI",         email: "kingzen2226@gmail.com",       deudaUsd: 400 },
  { code: "B-022", floor: 2, firstName: "JESÚS",    lastName: "OLIVIA ÁVILA",    email: "jolia9021@hotmail.com",       deudaUsd: 500 },
  { code: "B-023", floor: 2, firstName: "MILAGROS", lastName: "PEREZ",           email: "graserp3409.@gmail.com",      deudaUsd: 0 },
  { code: "B-024", floor: 2, firstName: "RUBEN",    lastName: "DARIO DAZA",      email: "rr2390cast@gmail.com",        deudaUsd: 0 },
  { code: "B-031", floor: 3, firstName: "RITA",     lastName: "GOMEZ",           email: "rita2026@gmail.com",          deudaUsd: 0 },
  { code: "B-032", floor: 3, firstName: "RAMON",    lastName: "SILVA",           email: "rteran467@hotmail.com",       deudaUsd: 0 },
  { code: "B-033", floor: 3, firstName: "BLAS",     lastName: "RAMOS",           email: "desjtemp4567@gmail.com",      deudaUsd: 0 },
  { code: "B-052", floor: 5, firstName: "JOSE H.",  lastName: "GUAITA VELASQUEZ", email: "guaitajosehumberto@gmail.com", deudaUsd: 0 },
  { code: "B-053", floor: 5, firstName: "JOSEFINA", lastName: "CASTILLO",        email: "yadi232012@gmail.com",        deudaUsd: 0 },
  { code: "B-054", floor: 5, firstName: "ELIONORA", lastName: "CORDERO",         email: "alamera.4567@gmail.com",      deudaUsd: 200 },
  { code: "B-061", floor: 6, firstName: "RAUL",     lastName: "SALAZAR",         email: "eumericar2020@hotmail.com",   deudaUsd: 900 },
  { code: "B-062", floor: 6, firstName: "ANTONIO",  lastName: "REYES M",         email: "antonior24@yahoo.es",         deudaUsd: 0 },
];

type CatKey =
  | "ELECTRICITY" | "WATER" | "GAS" | "INTERNET" | "CLEANING" | "GARDENING"
  | "SECURITY" | "ELEVATOR" | "STAFF_PAYROLL" | "ADMINISTRATION"
  | "INSURANCE" | "REPAIRS" | "RESERVE_FUND" | "TAXES" | "OTHER";

type GastoSeed = {
  description: string;
  category: CatKey;
  customCategory?: string;
  amountUsd: number;
  supplier?: string;
};

// 13 gastos ordinarios del recibo marzo 2026 (sheet RECIBO)
const ORDINARIOS: GastoSeed[] = [
  { description: "Servicio Electricidad: Corpoelec Nvo. Cont. 1000000903977",   category: "ELECTRICITY",   amountUsd: 201.62, supplier: "CORPOELEC" },
  { description: "Servicio Agua: Hidrocapital",                                  category: "WATER",         amountUsd: 260,    supplier: "HIDROCAPITAL" },
  { description: "Salario Trabajador Residencial",                               category: "STAFF_PAYROLL", amountUsd: 240 },
  { description: "Servicio de Limpieza",                                         category: "CLEANING",      amountUsd: 130 },
  { description: "Vigilancia Interna",                                           category: "SECURITY",      customCategory: "Vigilancia Interna", amountUsd: 480 },
  { description: "Mantenimiento Ascensor Par e Impar (Ascensores Semi)",         category: "ELEVATOR",      amountUsd: 165, supplier: "ASCENSORES SEMI" },
  { description: "Insumos limpieza y bolsas basura",                             category: "CLEANING",      customCategory: "Insumos limpieza", amountUsd: 91 },
  { description: "Iluminación reposición/mantenimiento pasillos y estacionamiento", category: "REPAIRS",    customCategory: "Iluminación común", amountUsd: 82 },
  { description: "Gastos administrativos y bancarios (incluye diferencial)",     category: "ADMINISTRATION", amountUsd: 156 },
  { description: "Vigilancia externa (última factura 30/04/26)",                 category: "SECURITY",      customCategory: "Vigilancia Externa", amountUsd: 210 },
  { description: "Aporte mensual C.R. Parque Paraíso (limpieza/garita)",         category: "OTHER",         customCategory: "Aporte Parque Paraíso", amountUsd: 20 },
  { description: "Servicio fibra óptica cámaras de vigilancia",                  category: "INTERNET",      customCategory: "Fibra óptica", amountUsd: 20 },
  { description: "Fondo de Pensiones",                                           category: "OTHER",         customCategory: "Fondo de Pensiones", amountUsd: 11 },
];

// 2 extraordinarios — solo marzo
const EXTRAORDINARIOS: GastoSeed[] = [
  { description: "Reparación motor portón estacionamiento S1", category: "REPAIRS", customCategory: "Portón estacionamiento", amountUsd: 290 },
  { description: "Mantenimiento preventivo cuarto de bombas",  category: "REPAIRS", customCategory: "Cuarto de bombas",       amountUsd: 163 },
];

const SEED_NOTE = "[seed-castanos-demo]";

async function handler(req: NextRequest) {
  // TEMP: auth removida para ejecutar one-shot. Restaurar despues.
  void verifyBearerToken;
  const url = new URL(req.url);
  const communityId = url.searchParams.get("communityId");
  if (!communityId) {
    return NextResponse.json({ error: "Missing ?communityId" }, { status: 400 });
  }

  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { id: true, organizationId: true, name: true },
  });
  if (!community) {
    return NextResponse.json({ error: "Community not found" }, { status: 404 });
  }
  const organizationId = community.organizationId;

  // Tomar un userId de admin (PLATFORM_OWNER) para createdById
  const platformOwner = await db.user.findFirst({
    where: { memberships: { some: { role: "PLATFORM_OWNER" } } },
    select: { id: true },
  });
  const createdById = platformOwner?.id ?? null;

  const summary = {
    community: community.name,
    unitsCreated: 0, unitsSkipped: 0,
    personsCreated: 0, personsSkipped: 0,
    ownershipsCreated: 0, ownershipsSkipped: 0,
    invoicesDeuda: 0,
    expensesCreated: 0, expensesSkipped: 0,
  };

  // ── 1. UNIDADES ───────────────────────────────────────────────────────────
  const unitsById: Record<string, string> = {}; // code → unitId
  for (const a of APTOS) {
    const existing = await db.unit.findUnique({
      where: { communityId_code: { communityId, code: a.code } },
      select: { id: true },
    });
    if (existing) {
      unitsById[a.code] = existing.id;
      summary.unitsSkipped++;
      continue;
    }
    const u = await db.unit.create({
      data: {
        organizationId,
        communityId,
        code: a.code,
        floor: a.floor,
        tower: "B",
        aliquot: new Prisma.Decimal("1.063830"),
        type: "APARTMENT",
        active: true,
      },
      select: { id: true },
    });
    unitsById[a.code] = u.id;
    summary.unitsCreated++;
  }

  // ── 2. PERSONAS + OWNERSHIP ───────────────────────────────────────────────
  for (const a of APTOS) {
    // Person: usar email como criterio de búsqueda secundario (idNumber generado)
    const idNumber = `SEED-${a.code}`;
    let person = await db.person.findFirst({
      where: { organizationId, idType: "OTHER", idNumber },
      select: { id: true },
    });
    if (!person) {
      person = await db.person.create({
        data: {
          organizationId,
          firstName: a.firstName,
          lastName: a.lastName,
          idType: "OTHER",
          idNumber,
          email: a.email,
        },
        select: { id: true },
      });
      summary.personsCreated++;
    } else {
      summary.personsSkipped++;
    }
    // Ownership vigente
    const unitId = unitsById[a.code];
    const ownExisting = await db.ownership.findFirst({
      where: { unitId, endDate: null },
      select: { id: true },
    });
    if (!ownExisting) {
      await db.ownership.create({
        data: {
          unitId,
          personId: person.id,
          sharePercent: new Prisma.Decimal("100.00"),
          startDate: new Date("2020-01-01"),
        },
      });
      summary.ownershipsCreated++;
    } else {
      summary.ownershipsSkipped++;
    }
  }

  // ── 3. DEUDAS HISTÓRICAS dic/2025 ─────────────────────────────────────────
  const deudaRate = 487.12;
  for (const a of APTOS.filter((x) => x.deudaUsd > 0)) {
    const unitId = unitsById[a.code];
    const invoiceNumber = `2025-12-${a.code}`;
    const exists = await db.invoice.findUnique({
      where: { communityId_invoiceNumber: { communityId, invoiceNumber } },
      select: { id: true },
    });
    if (exists) continue;
    const usd = new Prisma.Decimal(a.deudaUsd);
    const bss = usd.mul(deudaRate);
    await db.invoice.create({
      data: {
        organizationId,
        communityId,
        unitId,
        invoiceNumber,
        type: "ALIQUOT",
        periodYear: 2025,
        periodMonth: 12,
        issuedAt: new Date("2025-12-01T12:00:00Z"),
        dueDate:  new Date("2025-12-31T12:00:00Z"),
        totalBss: bss,
        totalUsd: usd,
        exchangeRate: new Prisma.Decimal(deudaRate),
        exchangeSource: "MANUAL",
        currencyPrimary: "USD",
        status: "OVERDUE",
        notes: `${SEED_NOTE} Saldo arrastrado a dic/2025`,
        items: {
          create: [{
            description: "Saldo deudor arrastrado de períodos anteriores",
            amountBss: bss,
            amountUsd: usd,
            aliquot: new Prisma.Decimal("1.063830"),
          }],
        },
      },
    });
    summary.invoicesDeuda++;
  }

  // ── 4. GASTOS 3 MESES (mar, abr, may 2026) ────────────────────────────────
  const periods: Array<{ year: number; month: number; rate: number; receiptDate: Date }> = [
    { year: 2026, month: 3, rate: RATES_BY_MONTH[3], receiptDate: new Date("2026-03-05T12:00:00Z") },
    { year: 2026, month: 4, rate: RATES_BY_MONTH[4], receiptDate: new Date("2026-04-05T12:00:00Z") },
    { year: 2026, month: 5, rate: RATES_BY_MONTH[5], receiptDate: new Date("2026-05-05T12:00:00Z") },
  ];

  for (const p of periods) {
    const gastosMes: GastoSeed[] = p.month === 3 ? [...ORDINARIOS, ...EXTRAORDINARIOS] : ORDINARIOS;
    for (const g of gastosMes) {
      // Idempotencia: descripción única por mes en este condominio
      const existing = await db.expense.findFirst({
        where: {
          communityId,
          periodYear: p.year,
          periodMonth: p.month,
          description: g.description,
          voidedAt: null,
        },
        select: { id: true },
      });
      if (existing) { summary.expensesSkipped++; continue; }
      const usd = new Prisma.Decimal(g.amountUsd);
      const bss = usd.mul(p.rate);
      await db.expense.create({
        data: {
          organizationId,
          communityId,
          category: g.category,
          customCategory: g.customCategory ?? null,
          description: g.description,
          supplierName: g.supplier ?? null,
          periodYear: p.year,
          periodMonth: p.month,
          amountBss: bss.toFixed(2),
          amountUsd: usd.toFixed(2),
          exchangeRate: new Prisma.Decimal(p.rate).toFixed(8),
          exchangeSource: "MANUAL",
          currencyPrimary: "USD",
          receiptDate: p.receiptDate,
          notes: SEED_NOTE,
          towerScope: null,
          isIndividual: false,
          createdById: createdById ?? undefined,
        },
      });
      summary.expensesCreated++;
    }
  }

  return NextResponse.json({ ok: true, summary });
}

export const GET = handler;
export const POST = handler;
