/**
 * Reset Los Arrayanes — endpoint one-shot para preparar el demo del cliente.
 *
 * Hace 3 cosas (en orden):
 *  1. WIPE: borra TODA la data financiera y operativa de la comunidad
 *     (facturas, pagos, gastos, ingresos, work orders, visitantes, etc.)
 *  2. RECREATE OWNERS: crea Persons + Ownerships nuevas según el Excel del cliente
 *  3. DEUDA INICIAL: crea una factura "SALDO ANTERIOR" por unidad con el
 *     monto pendiente exacto del Excel
 *
 * Idempotente: se puede correr múltiples veces y siempre deja el mismo estado.
 *
 * Seguridad:
 *  - Bearer CRON_SECRET con timing-safe compare
 *  - Requiere body { confirm: "RESET-ARRAYANES" } para ejecutar
 *  - Sin `confirm` corre en modo DRY-RUN (solo reporta lo que haría)
 *
 * Llamada típica:
 *   curl -X POST https://residia.vercel.app/api/admin/reset-arrayanes \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"confirm":"RESET-ARRAYANES"}'
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";
import { ARRAYANES_DATA } from "./arrayanes-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

interface ResetReport {
  community: { id: string; name: string; organizationId: string } | null;
  dryRun: boolean;
  steps: { step: string; details: Record<string, number | string | string[]> }[];
  unmapped: string[];
  summary: {
    excelRows: number;
    unitsMatched: number;
    unitsMissing: string[];
    invoicesPlanned: number;
    totalDebtUsd: string;
  };
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  const lastName = parts.pop()!;
  return { firstName: parts.join(" "), lastName };
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { confirm?: string } = {};
  try {
    body = (await req.json()) as { confirm?: string };
  } catch {
    // body opcional → dry-run por defecto
  }
  const dryRun = body.confirm !== "RESET-ARRAYANES";

  const report: ResetReport = {
    community: null,
    dryRun,
    steps: [],
    unmapped: [],
    summary: {
      excelRows: ARRAYANES_DATA.length,
      unitsMatched: 0,
      unitsMissing: [],
      invoicesPlanned: 0,
      totalDebtUsd: "0",
    },
  };

  try {
    // ─── 1. Localizar la comunidad ─────────────────────────────────────
    const community = await db.community.findFirst({
      where: { name: { contains: "Arrayanes", mode: "insensitive" }, deletedAt: null },
      select: { id: true, name: true, organizationId: true },
    });
    if (!community) {
      report.error = "Comunidad 'Los Arrayanes' no encontrada";
      return NextResponse.json(report, { status: 404 });
    }
    report.community = community;

    // ─── 2. Verificar mapeo de códigos ─────────────────────────────────
    const units = await db.unit.findMany({
      where: { communityId: community.id, deletedAt: null },
      select: { id: true, code: true },
    });
    const unitByCode = new Map(units.map((u) => [u.code, u.id]));

    const missing: string[] = [];
    let totalDebt = 0;
    let invoicesPlanned = 0;

    for (const row of ARRAYANES_DATA) {
      if (!unitByCode.has(row.systemCode)) {
        missing.push(`${row.excelCode} → ${row.systemCode}`);
        continue;
      }
      report.summary.unitsMatched++;
      if (row.pendUsd > 0) {
        invoicesPlanned++;
        totalDebt += row.pendUsd;
      }
    }
    report.summary.unitsMissing = missing;
    report.summary.invoicesPlanned = invoicesPlanned;
    report.summary.totalDebtUsd = totalDebt.toFixed(2);

    if (missing.length > 0) {
      report.error = `Códigos sin matchear: ${missing.length}. Aborto antes de tocar la BD.`;
      // Para diagnosticar: incluir TODOS los códigos REALES del sistema
      const allCodes = units.map((u) => u.code).sort();
      const phCodes = allCodes.filter((c) => /PH/i.test(c));
      report.steps.push({
        step: "DIAGNOSTIC",
        details: {
          allSystemCodes: allCodes,
          phCodes,
          totalUnits: String(units.length),
          hint: "Compara los códigos del sistema con el Excel y ajusta la función de mapeo",
        },
      });
      return NextResponse.json(report, { status: 422 });
    }

    if (dryRun) {
      report.steps.push({
        step: "DRY_RUN_OK",
        details: {
          message: "Validación OK. Para ejecutar manda body con confirm: 'RESET-ARRAYANES'",
        },
      });
      return NextResponse.json(report);
    }

    // ─── 3. WIPE TOTAL (orden FK-safe) ─────────────────────────────────
    const cid = community.id;
    const oid = community.organizationId;
    const wipe: Record<string, number> = {};

    // Allocations primero (FK a payment + invoice)
    wipe.paymentAllocations = (await db.paymentAllocation.deleteMany({
      where: { payment: { communityId: cid } },
    })).count;

    // InvoiceItems antes de Invoice (cascadea pero limpio explícito)
    wipe.invoiceItems = (await db.invoiceItem.deleteMany({
      where: { invoice: { communityId: cid } },
    })).count;

    wipe.payments = (await db.payment.deleteMany({ where: { communityId: cid } })).count;
    wipe.invoices = (await db.invoice.deleteMany({ where: { communityId: cid } })).count;

    // Bank — solo cuentas bancarias (no hay tabla de transacciones separada;
    // los movimientos de banco se conectan vía Payment.bankAccountId, ya borrados)
    wipe.bankAccounts = (await db.bankAccount.deleteMany({ where: { communityId: cid } })).count;

    wipe.unidentifiedPayments = (await db.unidentifiedPayment.deleteMany({
      where: { communityId: cid },
    })).count;

    // Work orders
    wipe.workOrderActivities = (await db.workOrderActivity.deleteMany({
      where: { workOrder: { communityId: cid } },
    })).count;
    wipe.workOrderPayments = (await db.workOrderPayment.deleteMany({
      where: { communityId: cid },
    })).count;
    wipe.workOrders = (await db.workOrder.deleteMany({ where: { communityId: cid } })).count;

    // Otros operativos
    wipe.violations = (await db.violation.deleteMany({ where: { communityId: cid } })).count;
    wipe.accessLogs = (await db.accessLog.deleteMany({ where: { communityId: cid } })).count;
    wipe.visitors = (await db.visitor.deleteMany({ where: { communityId: cid } })).count;
    wipe.securityNotes = (await db.securityNote.deleteMany({ where: { communityId: cid } })).count;
    wipe.notifications = (await db.notification.deleteMany({ where: { communityId: cid } })).count;
    wipe.announcements = (await db.announcement.deleteMany({ where: { communityId: cid } })).count;
    wipe.reservations = (await db.reservation.deleteMany({ where: { communityId: cid } })).count;
    wipe.commonAreas = (await db.commonArea.deleteMany({ where: { communityId: cid } })).count;

    // Asambleas
    wipe.assemblyVotes = (await db.assemblyVote.deleteMany({
      where: { assembly: { communityId: cid } },
    })).count;
    wipe.assemblyAgendaItems = (await db.assemblyAgendaItem.deleteMany({
      where: { assembly: { communityId: cid } },
    })).count;
    wipe.assemblies = (await db.assembly.deleteMany({ where: { communityId: cid } })).count;
    wipe.boardMembers = (await db.boardMember.deleteMany({ where: { communityId: cid } })).count;
    wipe.communityDocuments = (await db.communityDocument.deleteMany({
      where: { communityId: cid },
    })).count;

    // Ingresos / gastos / templates / budget / monthClose
    wipe.incomes = (await db.income.deleteMany({ where: { communityId: cid } })).count;
    wipe.recurringTemplates = (await db.recurringExpenseTemplate.deleteMany({
      where: { communityId: cid },
    })).count;
    wipe.expenses = (await db.expense.deleteMany({ where: { communityId: cid } })).count;
    wipe.budgetItems = (await db.budgetItem.deleteMany({
      where: { budget: { communityId: cid } },
    })).count;
    wipe.budgets = (await db.budget.deleteMany({ where: { communityId: cid } })).count;
    wipe.monthCloses = (await db.monthClose.deleteMany({ where: { communityId: cid } })).count;

    // Tenancies y Ownerships de las unidades
    const unitIds = units.map((u) => u.id);
    wipe.tenancies = (await db.tenancy.deleteMany({
      where: { unitId: { in: unitIds } },
    })).count;
    wipe.ownerships = (await db.ownership.deleteMany({
      where: { unitId: { in: unitIds } },
    })).count;

    // Vehículos de la org (vinculados a Person — los borramos para poder borrar Persons)
    wipe.vehicles = (await db.vehicle.deleteMany({ where: { organizationId: oid } })).count;

    // Antes de borrar Persons, desvincular usuarios y borrar los Users de test
    // (necesario para que el reset sea verdaderamente idempotente — antes preservábamos
    // personas con userId, lo que hacía que recrearlas chocara con el unique
    // (organizationId, idType, idNumber)).
    const personsWithUser = await db.person.findMany({
      where: { organizationId: oid, userId: { not: null } },
      select: { userId: true },
    });
    const userIdsToDelete = personsWithUser.map(p => p.userId!).filter(Boolean);
    // Desvincular primero
    await db.person.updateMany({
      where: { organizationId: oid, userId: { not: null } },
      data: { userId: null },
    });
    // Borrar memberships de esos users antes que el user
    if (userIdsToDelete.length > 0) {
      await db.membership.deleteMany({
        where: { userId: { in: userIdsToDelete } },
      });
      await db.user.deleteMany({ where: { id: { in: userIdsToDelete } } });
    }
    wipe.usersDeleted = userIdsToDelete.length;

    // Ahora SÍ todas las Persons de la org se pueden borrar
    wipe.persons = (await db.person.deleteMany({
      where: { organizationId: oid },
    })).count;

    report.steps.push({ step: "WIPE", details: wipe });

    // ─── 4. RECREAR PERSONS + OWNERSHIPS desde Excel ────────────────────
    const today = new Date();
    let createdPersons = 0;
    let createdOwnerships = 0;
    let createdInvoices = 0;
    let createdItems = 0;

    // Tasa BCV del día — necesaria para que las facturas tengan totalBss correcto.
    // Antes se guardaba totalBss=0 → al pagar en VES la auto-asignación fallaba
    // (balance Bs = 0) y todo el monto caía como anticipo.
    const { getCurrentRate } = await import("@/server/services/exchange");
    const rateRecord = await getCurrentRate("BCV", today);
    const todayRate = Number(rateRecord.vesPerUsd);

    for (const row of ARRAYANES_DATA) {
      const unitId = unitByCode.get(row.systemCode)!;
      const sharePercent = (100 / row.owners.length).toFixed(2);

      for (let i = 0; i < row.owners.length; i++) {
        const fullName = row.owners[i]!;
        const { firstName, lastName } = splitName(fullName);
        const idNumber = `${row.excelCode}-${i + 1}`; // placeholder, cliente actualizará

        const person = await db.person.create({
          data: {
            organizationId: oid,
            firstName,
            lastName,
            idType: "CEDULA_V",
            idNumber,
          },
        });
        createdPersons++;

        await db.ownership.create({
          data: {
            unitId,
            personId: person.id,
            sharePercent,
            startDate: today,
          },
        });
        createdOwnerships++;
      }

      // Crear factura SALDO ANTERIOR si hay deuda
      if (row.pendUsd > 0) {
        const totalBssNum = row.pendUsd * todayRate;
        const inv = await db.invoice.create({
          data: {
            organizationId: oid,
            communityId: cid,
            unitId,
            invoiceNumber: `SALDO-${row.excelCode}`,
            type: "EXTRA_FEE",
            periodYear: today.getFullYear(),
            periodMonth: today.getMonth() + 1,
            issuedAt: today,
            dueDate: today, // ya vencida
            totalUsd: row.pendUsd.toFixed(2),
            totalBss: totalBssNum.toFixed(2),
            paidUsd: "0",
            paidBss: "0",
            exchangeRate: todayRate.toFixed(8),
            exchangeSource: "BCV",
            currencyPrimary: "USD",
            status: "OVERDUE",
          },
        });
        createdInvoices++;

        await db.invoiceItem.create({
          data: {
            invoiceId: inv.id,
            description: `Saldo anterior al ${today.toLocaleDateString("es-VE")} (${row.excelCode})`,
            amountUsd: row.pendUsd.toFixed(2),
            amountBss: totalBssNum.toFixed(2),
            aliquot: "0",
          },
        });
        createdItems++;
      }
    }

    report.steps.push({
      step: "RECREATE",
      details: {
        persons: createdPersons,
        ownerships: createdOwnerships,
        invoices: createdInvoices,
        invoiceItems: createdItems,
      },
    });

    return NextResponse.json(report);
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    return NextResponse.json(report, { status: 500 });
  }
}

/** GET = dry-run rápido para verificar que el endpoint está vivo y validar mapeo */
export async function GET(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Equivalente a POST sin body → dryRun=true
  const fakeReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: "{}",
  }) as NextRequest;
  return POST(fakeReq);
}
