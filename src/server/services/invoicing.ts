import { Decimal } from "decimal.js";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db/client";
import { prorate, assertSumExact } from "@/lib/proration";
import { getCurrentRate } from "@/server/services/exchange";
import { notifyPerson } from "@/server/services/notifications";
import type { Currency, ExchangeSource, PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Convierte un monto en su moneda primaria a un par (BsS, USD) usando una tasa dada.
 * NUNCA redondea decimales intermedios.
 */
export function buildBimonetary(
  amount: Decimal.Value,
  primary: Currency,
  vesPerUsd: Decimal.Value,
): { amountBss: Decimal; amountUsd: Decimal; rate: Decimal } {
  const r = new Decimal(vesPerUsd);
  const a = new Decimal(amount);
  if (primary === "USD") {
    return { amountUsd: a, amountBss: a.mul(r), rate: r };
  }
  return { amountBss: a, amountUsd: a.div(r), rate: r };
}

export type CreateExpenseInput = {
  organizationId: string;
  communityId: string;
  category:
    | "ELECTRICITY"
    | "WATER"
    | "GAS"
    | "INTERNET"
    | "CLEANING"
    | "GARDENING"
    | "SECURITY"
    | "ELEVATOR"
    | "STAFF_PAYROLL"
    | "ADMINISTRATION"
    | "INSURANCE"
    | "REPAIRS"
    | "RESERVE_FUND"
    | "TAXES"
    | "OTHER";
  description: string;
  periodYear: number;
  periodMonth: number; // 1..12
  amount: Decimal.Value;
  currencyPrimary: Currency;
  exchangeSource?: ExchangeSource;
  customCategory?: string;
  supplierName?: string;
  invoiceNumber?: string;
  receiptDate?: Date;
  notes?: string;
  /** Scope de torre: null=general, "A"=Torre A, etc. Solo se prorratea a unidades de esa torre. */
  towerScope?: string | null;
  /** Si true, el gasto va directamente a una unidad específica (sin prorrateo). */
  isIndividual?: boolean;
  /** Unidad destino cuando isIndividual=true. */
  targetUnitId?: string | null;
  /** Plantilla recurrente asociada: si se provee, este gasto se agrupa con otros de la misma plantilla en el recibo. */
  recurringTemplateId?: string | null;
  createdById: string;
};

/**
 * Registra un gasto común.
 *
 * La tasa de cambio se toma del día del comprobante (`receiptDate`), no del momento
 * en que el admin lo registra en el sistema. Si no se provee `receiptDate`, se usa hoy.
 *
 * Además, bloquea el registro si ya se emitieron facturas para ese período: el admin
 * debe usar `expenses.issueDirectCharge` (gasto individual) o anular las facturas y
 * re-emitirlas. Excepción: gastos individuales (`isIndividual=true`) sí se permiten,
 * porque tienen el flujo de cargo directo.
 */
export async function registerExpense(input: CreateExpenseInput) {
  // Bloqueo #4: no aceptar gastos prorrateables después de emitir el recibo del período.
  if (!input.isIndividual) {
    const issued = await db.invoice.findFirst({
      where: {
        communityId: input.communityId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        status: { not: "VOIDED" },
      },
      select: { id: true },
    });
    if (issued) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Ya se emitieron facturas para ${String(input.periodMonth).padStart(2, "0")}/${input.periodYear}. No se pueden añadir gastos comunes a un período cerrado. Marca el gasto como individual o anula las facturas para re-emitirlas.`,
      });
    }
  }

  const source = input.exchangeSource ?? "BCV";
  // La tasa debe ser la del día del gasto (receiptDate), no la del registro.
  const rate = await getCurrentRate(source, input.receiptDate ?? new Date());
  const { amountBss, amountUsd } = buildBimonetary(input.amount, input.currencyPrimary, rate.vesPerUsd);

  return db.expense.create({
    data: {
      organizationId: input.organizationId,
      communityId: input.communityId,
      category: input.category,
      customCategory: input.customCategory ?? null,
      description: input.description,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amountBss: amountBss.toFixed(2),
      amountUsd: amountUsd.toFixed(2),
      exchangeRate: rate.vesPerUsd.toFixed(8),
      exchangeSource: rate.source,
      currencyPrimary: input.currencyPrimary,
      supplierName: input.supplierName,
      invoiceNumber: input.invoiceNumber,
      receiptDate: input.receiptDate,
      notes: input.notes,
      towerScope: input.towerScope ?? null,
      isIndividual: input.isIndividual ?? false,
      targetUnitId: input.targetUnitId ?? null,
      recurringTemplateId: input.recurringTemplateId ?? null,
      createdById: input.createdById,
    },
  });
}

/**
 * Emite las facturas mensuales para una comunidad.
 *
 * 1. Toma todos los Expense del período (year/month) que aún no se hayan facturado.
 * 2. Para cada Expense, prorratea entre todas las unidades activas según su alícuota.
 * 3. Crea una Invoice por unidad agrupando todos los items prorrateados de ese período.
 * 4. Marca los Expense como facturados.
 *
 * Es idempotente solo en el sentido de que no re-emite si ya hay una factura en ese período
 * para esa unidad — lanza error si lo intenta.
 */
export async function issueMonthlyInvoices(params: {
  organizationId: string;
  communityId: string;
  year: number;
  month: number; // 1..12
  dueDate: Date;
  issuedAt?: Date;
  createdById: string;
  asDraft?: boolean; // true = crea en DRAFT para publicar después
}) {
  const { organizationId, communityId, year, month, dueDate, createdById } = params;
  const asDraft = params.asDraft ?? false;
  const issuedAt = params.issuedAt ?? new Date();

  // ── FASE 1: Lecturas fuera de la transacción (no requieren atomicidad) ───────
  const community = await db.community.findFirstOrThrow({
    where: { id: communityId, organizationId, deletedAt: null },
  });

  const units = await db.unit.findMany({
    where: { communityId, active: true, deletedAt: null },
    orderBy: { code: "asc" },
  });
  if (units.length === 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La comunidad no tiene unidades activas" });
  }

  const already = await db.invoice.findFirst({
    where: { communityId, periodYear: year, periodMonth: month, status: { not: "VOIDED" } },
  });
  if (already) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Ya existen facturas emitidas para ${month}/${year}. Anúlalas antes de re-emitir.`,
    });
  }

  const allExpenses = await db.expense.findMany({
    where: { communityId, periodYear: year, periodMonth: month, invoicedAt: null, voidedAt: null },
    include: { recurringTemplate: { select: { id: true, description: true, isProvision: true } } },
  });
  // Excluir gastos REGULAR vinculados a plantilla isProvision: esos son trackeo del real
  // del mes, no se facturan al residente. Solo se usan para calcular AJUSTE el mes siguiente.
  // El residente paga la PROVISION_BASE (estimación fija) + PROVISION_ADJUSTMENT (correción
  // del mes anterior).
  const expenses = allExpenses.filter(
    (e) => !(e.kind === "REGULAR" && e.recurringTemplate?.isProvision === true),
  );

  // Ingresos que reducen gastos antes del prorrateo (affectsInvoice=true)
  const deductibleIncomes = await db.income.findMany({
    where: { communityId, periodYear: year, periodMonth: month, affectsInvoice: true, voidedAt: null },
  });
  const totalIncomeDeductionUsd = deductibleIncomes.reduce((s, i) => s.plus(i.amountUsd.toString()), new Decimal(0));
  const totalIncomeDeductionBss = deductibleIncomes.reduce((s, i) => s.plus(i.amountBss.toString()), new Decimal(0));

  const hasFee = community.monthlyFeeUsd && new Decimal(community.monthlyFeeUsd.toString()).gt(0);
  if (expenses.length === 0 && !hasFee) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No hay gastos ni cuota mensual configurada para ${month}/${year}. Registra gastos o configura la cuota mensual del edificio.`,
    });
  }

  // ── FASE 2: Cálculo en memoria (sin tocar la BD) ──────────────────────────
  // sortOrder: 1=PROVISION_BASE, 2=PROVISION_ADJUSTMENT, 3=Cuota mensual,
  // 4=Gasto general agrupado, 5=Gasto por torre, 6=Gasto individual,
  // 7=Descuento ingreso. Pedido del cliente: "Las provisiones van primero".
  type LineDraft = { unitId: string; expenseId: string | null; description: string; bss: Decimal; usd: Decimal; aliquot: Decimal; sortOrder: number };
  const draftLines: LineDraft[] = [];

  // Separar gastos por tipo: individuales, por torre, generales
  const individualExpenses = expenses.filter((e) => e.isIndividual && e.targetUnitId);
  const towerExpensesRaw = expenses.filter((e) => !e.isIndividual && e.towerScope);
  const generalExpensesRaw = expenses.filter((e) => !e.isIndividual && !e.towerScope);

  // — Plantillas recurrentes —
  // Si varios gastos provienen de la misma plantilla, se agrupan en UNA sola línea
  // del recibo con la descripción de la plantilla. Esto evita recibos con 60 renglones
  // y refleja el patrón típico (PROVISION X = suma de gastos del mes).
  type ExpenseLike = typeof expenses[number];
  function groupByTemplate(rows: ExpenseLike[], scope: string | null): ExpenseLike[] {
    const byTpl = new Map<string, ExpenseLike[]>();
    const byCategory = new Map<string, ExpenseLike[]>(); // gastos sin template, agrupados por (category|customCategory)
    const isolated: ExpenseLike[] = []; // PROVISION_BASE / PROVISION_ADJUSTMENT — cada uno su propia línea
    for (const e of rows) {
      // Provisiones y ajustes NO se agrupan — cada uno es su propia línea con su descripción
      if (e.kind === "PROVISION_BASE" || e.kind === "PROVISION_ADJUSTMENT") {
        isolated.push(e);
        continue;
      }
      if (e.recurringTemplateId) {
        // Plantillas NO-provisión: agrupar por (templateId, scope)
        const key = `${e.recurringTemplateId}|${scope ?? ""}`;
        const arr = byTpl.get(key) ?? [];
        arr.push(e);
        byTpl.set(key, arr);
      } else {
        // Gastos sueltos (sin plantilla): agrupar por categoría + sub-categoría + scope.
        // Pedido cliente: "Una sola en el resumen, no pueden verse 10 de un mismo sector".
        // Ej: 10 gastos "Ferretería" → 1 línea sumada en el recibo.
        const key = `${e.category}|${e.customCategory ?? ""}|${scope ?? ""}`;
        const arr = byCategory.get(key) ?? [];
        arr.push(e);
        byCategory.set(key, arr);
      }
    }

    function aggregateGroup(group: ExpenseLike[], useTemplateDesc: boolean): ExpenseLike {
      if (group.length === 1) {
        const e = group[0]!;
        return { ...e, description: useTemplateDesc ? (e.recurringTemplate?.description ?? e.description) : e.description };
      }
      const sumBss = group.reduce((s, e) => s.plus(e.amountBss.toString()), new Decimal(0));
      const sumUsd = group.reduce((s, e) => s.plus(e.amountUsd.toString()), new Decimal(0));
      const head = group[0]!;
      return {
        ...head,
        amountBss: sumBss.toFixed(2) as never,
        amountUsd: sumUsd.toFixed(2) as never,
        description: useTemplateDesc
          ? (head.recurringTemplate?.description ?? head.description)
          : (head.customCategory ?? head.description),
      };
    }

    const aggregated: ExpenseLike[] = [];
    for (const [, group] of byTpl) aggregated.push(aggregateGroup(group, true));
    for (const [, group] of byCategory) aggregated.push(aggregateGroup(group, false));
    return [...aggregated, ...isolated];
  }
  const towerExpenses = groupByTemplate(towerExpensesRaw, "tower");
  const generalExpenses = groupByTemplate(generalExpensesRaw, null);

  // Calcular cuánto de la deducción de ingresos corresponde a cada tipo
  // Simplificación: la deducción se aplica solo a gastos generales (prorrateados).
  const generalExpensesTotalUsd = generalExpenses.reduce((s, e) => s.plus(e.amountUsd.toString()), new Decimal(0));
  const generalExpensesTotalBss = generalExpenses.reduce((s, e) => s.plus(e.amountBss.toString()), new Decimal(0));
  const deductionFactor = generalExpensesTotalUsd.gt(0)
    ? Decimal.min(totalIncomeDeductionUsd.div(generalExpensesTotalUsd), new Decimal(1))
    : new Decimal(0);

  // 1. Gastos individuales → van directamente a la unidad target
  for (const exp of individualExpenses) {
    if (!exp.targetUnitId) continue;
    const targetUnit = units.find((u) => u.id === exp.targetUnitId);
    if (!targetUnit) continue;
    draftLines.push({
      unitId: targetUnit.id,
      expenseId: exp.id,
      description: `${exp.customCategory ?? exp.description}`,
      bss: new Decimal(exp.amountBss.toString()),
      usd: new Decimal(exp.amountUsd.toString()),
      aliquot: new Decimal("100"),
      sortOrder: 6,
    });
  }

  /** Helper: prorratea respetando signo. Necesario para PROVISION_ADJUSTMENT
   *  donde el ajuste puede ser negativo (real < provisión = crédito al residente). */
  function prorateSigned<K extends string>(
    total: Decimal.Value,
    parts: ReadonlyArray<{ key: K; aliquot: Decimal.Value }>,
  ): Map<K, Decimal> {
    const d = new Decimal(total);
    if (d.gte(0)) return prorate(d.toFixed(2), parts);
    // Negativo: prorratear el valor absoluto y negar el resultado de cada participante
    const abs = prorate(d.abs().toFixed(2), parts);
    const out = new Map<K, Decimal>();
    for (const [k, v] of abs) out.set(k, v.neg());
    return out;
  }

  // 2. Gastos por torre → se prorratean solo entre unidades de esa torre
  for (const exp of towerExpenses) {
    const towerUnits = units.filter((u) => u.tower === exp.towerScope);
    if (towerUnits.length === 0) continue;
    const towerParticipants = towerUnits.map((u) => ({ key: u.id as string, aliquot: u.aliquot.toString() }));
    const bssDistribution = prorateSigned(exp.amountBss.toString(), towerParticipants);
    const usdDistribution = prorateSigned(exp.amountUsd.toString(), towerParticipants);
    for (const u of towerUnits) {
      const bss = bssDistribution.get(u.id) ?? new Decimal(0);
      const usd = usdDistribution.get(u.id) ?? new Decimal(0);
      if (bss.eq(0) && usd.eq(0)) continue;
      // sortOrder: 1 si es PROVISION_BASE, 2 si es AJUSTE, 5 si gasto torre normal
      const sortOrder = exp.kind === "PROVISION_BASE" ? 1
        : exp.kind === "PROVISION_ADJUSTMENT" ? 2
        : 5;
      draftLines.push({
        unitId: u.id, expenseId: exp.id,
        description: `${exp.customCategory ?? exp.description} (Torre ${exp.towerScope})`,
        bss, usd, aliquot: new Decimal(u.aliquot.toString()),
        sortOrder,
      });
    }
  }

  // 3. Gastos generales → se prorratean entre todas las unidades, con deducción de ingresos
  const participants = units.map((u) => ({ key: u.id as string, aliquot: u.aliquot.toString() }));
  for (const exp of generalExpenses) {
    // Aplicar factor de deducción proporcional a cada gasto general
    const adjUsd = new Decimal(exp.amountUsd.toString()).mul(new Decimal(1).minus(deductionFactor));
    const adjBss = new Decimal(exp.amountBss.toString()).mul(new Decimal(1).minus(deductionFactor));
    // Si el ajuste deja el gasto en 0, igual creamos las líneas (puede pasar con deducción total)
    const bssDistribution = prorateSigned(adjBss.toFixed(2), participants);
    const usdDistribution = prorateSigned(adjUsd.toFixed(2), participants);
    for (const u of units) {
      const bss = bssDistribution.get(u.id) ?? new Decimal(0);
      const usd = usdDistribution.get(u.id) ?? new Decimal(0);
      if (bss.eq(0) && usd.eq(0)) continue;
      // sortOrder: 1 si es PROVISION_BASE, 2 si es AJUSTE, 4 si gasto general normal
      const sortOrder = exp.kind === "PROVISION_BASE" ? 1
        : exp.kind === "PROVISION_ADJUSTMENT" ? 2
        : 4;
      draftLines.push({
        unitId: u.id, expenseId: exp.id,
        description: `${exp.customCategory ?? exp.description}`,
        bss, usd, aliquot: new Decimal(u.aliquot.toString()),
        sortOrder,
      });
    }
  }

  // 4. Si hay deducción de ingresos, crear una línea de descuento en cada factura
  if (deductionFactor.gt(0) && generalExpensesTotalUsd.gt(0)) {
    const totalDeductedUsd = generalExpensesTotalUsd.mul(deductionFactor);
    const totalDeductedBss = generalExpensesTotalBss.mul(deductionFactor);
    const bssDeductionDist = prorate(totalDeductedBss.toFixed(2), participants);
    const usdDeductionDist = prorate(totalDeductedUsd.toFixed(2), participants);
    for (const u of units) {
      const bss = bssDeductionDist.get(u.id) ?? new Decimal(0);
      const usd = usdDeductionDist.get(u.id) ?? new Decimal(0);
      if (bss.eq(0) && usd.eq(0)) continue;
      // Línea negativa que muestra el descuento por ingresos comunes
      draftLines.push({
        unitId: u.id, expenseId: null,
        description: `Descuento — Ingresos comunes del período`,
        bss: bss.neg(), usd: usd.neg(),
        aliquot: new Decimal(u.aliquot.toString()),
        sortOrder: 7,
      });
    }
  }

  const refRate = await getCurrentRate("BCV", issuedAt);
  if (hasFee) {
    const feeUsd = new Decimal(community.monthlyFeeUsd!.toString());
    const feeBss = feeUsd.mul(refRate.vesPerUsd);
    for (const u of units) {
      draftLines.push({ unitId: u.id, expenseId: null, description: "Cuota de condominio mensual", usd: feeUsd, bss: feeBss, aliquot: new Decimal(u.aliquot.toString()), sortOrder: 3 });
    }
  }

  // ── Construir datos de invoices + items con IDs pre-generados ─────────────
  // Usar IDs generados aquí permite usar createMany (1 query) en lugar de
  // 188 create() secuenciales (188 round-trips). Reduce de ~8s a <1s.
  interface InvoiceRow {
    id: string; unitId: string; unitCode: string; invoiceNumber: string;
    totalBss: string; totalUsd: string;
    items: { id: string; expenseId: string | null; description: string; amountBss: string; amountUsd: string; aliquot: string }[];
  }
  const invoiceRows: InvoiceRow[] = [];

  for (const u of units) {
    // Ordenar líneas: provisiones primero (sortOrder 1-2), luego cuota (3),
    // gastos generales (4), torre (5), individual (6), descuentos (7).
    // Pedido del cliente: "Las provisiones van primero".
    const lines = draftLines
      .filter((l) => l.unitId === u.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (lines.length === 0) continue;
    const totalBss = lines.reduce((acc, l) => acc.plus(l.bss), new Decimal(0));
    const totalUsd = lines.reduce((acc, l) => acc.plus(l.usd), new Decimal(0));
    invoiceRows.push({
      id: randomUUID(),
      unitId: u.id,
      unitCode: u.code,
      invoiceNumber: `${year}-${String(month).padStart(2, "0")}-${u.code}`,
      totalBss: totalBss.toFixed(2),
      totalUsd: totalUsd.toFixed(2),
      items: lines.map((l) => ({
        id: randomUUID(),
        expenseId: l.expenseId,
        description: l.description,
        amountBss: l.bss.toFixed(2),
        amountUsd: l.usd.toFixed(2),
        aliquot: l.aliquot.toFixed(6),
      })),
    });
  }

  // ── FASE 3: Transacción corta — solo escrituras (2 batch inserts) ─────────
  // Con createMany: 188 facturas = 2 queries en lugar de 188 round-trips.
  const result = await db.$transaction(async (tx) => {
    // Batch insert facturas (1 query para N unidades)
    await tx.invoice.createMany({
      data: invoiceRows.map((r) => ({
        id: r.id,
        organizationId,
        communityId,
        unitId: r.unitId,
        invoiceNumber: r.invoiceNumber,
        type: "ALIQUOT" as const,
        periodYear: year,
        periodMonth: month,
        issuedAt,
        dueDate,
        totalBss: r.totalBss,
        totalUsd: r.totalUsd,
        paidBss: "0",
        paidUsd: "0",
        exchangeRate: refRate.vesPerUsd.toFixed(8),
        exchangeSource: refRate.source,
        currencyPrimary: community.primaryCurrency,
        status: asDraft ? "DRAFT" as const : "ISSUED" as const,
      })),
      skipDuplicates: true,
    });

    // Batch insert items (1 query para todos los items de todas las facturas)
    await tx.invoiceItem.createMany({
      data: invoiceRows.flatMap((r) =>
        r.items.map((item) => ({
          id: item.id,
          invoiceId: r.id,
          expenseId: item.expenseId,
          description: item.description,
          amountBss: item.amountBss,
          amountUsd: item.amountUsd,
          aliquot: item.aliquot,
        }))
      ),
    });

    // Marcar gastos como facturados (1 query)
    if (expenses.length > 0) {
      await tx.expense.updateMany({
        where: { id: { in: expenses.map((e) => e.id) } },
        data: { invoicedAt: issuedAt },
      });
    }

    // Audit log (1 query)
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: createdById,
        action: "INVOICE_ISSUED",
        entityType: "Community",
        entityId: communityId,
        after: { period: `${year}-${month}`, invoicesCount: invoiceRows.length, expensesCount: expenses.length },
      },
    });

    return {
      invoicesCount: invoiceRows.length,
      expensesCount: expenses.length,
      invoices: invoiceRows.map((r) => ({ unitId: r.unitId, unitCode: r.unitCode, invoiceNumber: r.invoiceNumber, totalBss: r.totalBss, totalUsd: r.totalUsd })),
    };
  }, { timeout: 15000 }); // timeout aumentado por si acaso, pero ahora debería completar en <2s

  // Fire-and-forget: notify each unit's current owner after the transaction commits.
  void (async () => {
    for (const inv of result.invoices) {
      const ownership = await db.ownership.findFirst({
        where: { unitId: inv.unitId, endDate: null },
        select: { personId: true },
      });
      if (!ownership) continue;
      const dueDateStr = params.dueDate.toLocaleDateString("es-VE");
      await notifyPerson({
        organizationId,
        communityId,
        unitId: inv.unitId,
        personId: ownership.personId,
        event: "INVOICE_ISSUED",
        vars: {
          monto_usd: inv.totalUsd,
          monto_bs: inv.totalBss,
          fecha_vence: dueDateStr,
          factura: inv.invoiceNumber,
        },
      }).catch(() => {/* ignore notification errors */});
    }
  })();

  return result;
}

/**
 * Anula una factura. No se elimina (soft-void).
 * Si tenía pagos aplicados, esos PaymentAllocations quedan huérfanos pero el Payment se conserva.
 */
export async function voidInvoice(params: {
  organizationId: string;
  invoiceId: string;
  reason: string;
  actorId: string;
}) {
  const { organizationId, invoiceId, reason, actorId } = params;
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirstOrThrow({
      where: { id: invoiceId, organizationId },
    });
    if (inv.status === "VOIDED") {
      throw new TRPCError({ code: "CONFLICT", message: "La factura ya está anulada" });
    }
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: "INVOICE_VOIDED",
        entityType: "Invoice",
        entityId: invoiceId,
        before: { status: inv.status },
        after: { status: updated.status, reason },
      },
    });
    return updated;
  });
}

/**
 * Aging de cartera: agrupa el saldo pendiente de la comunidad por antigüedad.
 */
export async function getAging(communityId: string, today: Date = new Date()) {
  const invoices = await db.invoice.findMany({
    where: {
      communityId,
      status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
    },
    select: {
      id: true,
      unitId: true,
      dueDate: true,
      totalBss: true,
      totalUsd: true,
      paidBss: true,
      paidUsd: true,
    },
  });

  const buckets = {
    current: { bss: new Decimal(0), usd: new Decimal(0), count: 0 },
    d_0_30: { bss: new Decimal(0), usd: new Decimal(0), count: 0 },
    d_31_60: { bss: new Decimal(0), usd: new Decimal(0), count: 0 },
    d_61_90: { bss: new Decimal(0), usd: new Decimal(0), count: 0 },
    d_90_plus: { bss: new Decimal(0), usd: new Decimal(0), count: 0 },
  };

  const MS = 24 * 60 * 60 * 1000;
  for (const inv of invoices) {
    const balanceBss = new Decimal(inv.totalBss.toString()).minus(inv.paidBss.toString());
    const balanceUsd = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
    if (balanceBss.lte(0) && balanceUsd.lte(0)) continue;

    const daysOverdue = Math.floor((today.getTime() - inv.dueDate.getTime()) / MS);
    let bucket: keyof typeof buckets;
    if (daysOverdue < 0) bucket = "current";
    else if (daysOverdue <= 30) bucket = "d_0_30";
    else if (daysOverdue <= 60) bucket = "d_31_60";
    else if (daysOverdue <= 90) bucket = "d_61_90";
    else bucket = "d_90_plus";

    buckets[bucket].bss = buckets[bucket].bss.plus(balanceBss);
    buckets[bucket].usd = buckets[bucket].usd.plus(balanceUsd);
    buckets[bucket].count += 1;
  }

  return Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [
      k,
      { bss: v.bss.toFixed(2), usd: v.usd.toFixed(2), count: v.count },
    ]),
  ) as Record<keyof typeof buckets, { bss: string; usd: string; count: number }>;
}
