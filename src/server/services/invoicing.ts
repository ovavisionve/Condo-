import { Decimal } from "decimal.js";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db/client";
import { prorateUniform } from "@/lib/proration";
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

/**
 * Prorratea respetando signo. Necesario para PROVISION_ADJUSTMENT donde
 * el ajuste puede ser negativo (real < provisión = crédito al residente).
 * El prorate base lanza error con totales negativos.
 */
export function prorateSignedExported<K extends string>(
  total: Decimal.Value,
  parts: ReadonlyArray<{ key: K; aliquot: Decimal.Value }>,
): Map<K, Decimal> {
  // Prorrateo UNIFORME (todos con la misma alícuota pagan lo mismo). Maneja signo.
  return prorateUniform(total, parts);
}

/**
 * Empareja cada PROVISION_BASE con su PROVISION_ADJUSTMENT para que en el recibo
 * salgan INTERCALADAS (PROVISIÓN X seguida inmediatamente de su AJUSTE X), tal como
 * en el Excel del cliente (Arrayanes), en lugar de "todas las provisiones y luego
 * todos los ajustes" (que confunde). Devuelve Map<expenseId, token>: los dos gastos
 * de una misma pareja comparten token → al ordenar quedan pegados.
 *
 * Emparejamiento (dentro de cada scope de torre):
 *  - CON templateId: base y ajuste comparten templateId → misma pareja.
 *  - SIN templateId (Arrayanes jun-2026 cargado a mano): el k-ésimo base con el
 *    k-ésimo ajuste, ordenados por `createdAt`.
 *
 * Orden de las parejas: SIEMPRE por `createdAt` del base (o del ajuste si no hay base),
 * tanto vinculadas como sueltas. Así el orden del recibo respeta el orden en que se
 * cargó/creó (= orden del Excel), y NO el id de la plantilla (que sería arbitrario).
 * Esto hace que funcione igual hoy (junio suelto) y a futuro (agosto+ vinculado por
 * applyToMonth). El token lleva índice zero-padded para ordenar numéricamente.
 */
export function buildProvisionPairKeys<
  T extends {
    id: string;
    kind: string;
    towerScope: string | null;
    recurringTemplateId: string | null;
    createdAt: Date;
  },
>(rows: readonly T[]): Map<string, string> {
  const out = new Map<string, string>();
  const byScope = new Map<string, T[]>();
  for (const e of rows) {
    if (e.kind !== "PROVISION_BASE" && e.kind !== "PROVISION_ADJUSTMENT") continue;
    const scope = e.towerScope ?? "_gen";
    const arr = byScope.get(scope);
    if (arr) arr.push(e);
    else byScope.set(scope, [e]);
  }
  const bySeq = (a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime();
  for (const [scope, arr] of byScope) {
    // Construir las parejas con un tiempo representativo (el del base) para ordenarlas.
    type Pair = { ids: string[]; sortTime: number };
    const pairs: Pair[] = [];

    // 1) Vinculadas: agrupar base+ajuste por templateId.
    const byTpl = new Map<string, T[]>();
    for (const e of arr) {
      if (!e.recurringTemplateId) continue;
      const g = byTpl.get(e.recurringTemplateId);
      if (g) g.push(e);
      else byTpl.set(e.recurringTemplateId, [e]);
    }
    for (const [, group] of byTpl) {
      const base = group.find((e) => e.kind === "PROVISION_BASE") ?? group[0]!;
      pairs.push({ ids: group.map((e) => e.id), sortTime: base.createdAt.getTime() });
    }

    // 2) Sueltas: el k-ésimo base con el k-ésimo ajuste (por createdAt).
    const looseBases = arr.filter((e) => !e.recurringTemplateId && e.kind === "PROVISION_BASE").sort(bySeq);
    const looseAdjs = arr.filter((e) => !e.recurringTemplateId && e.kind === "PROVISION_ADJUSTMENT").sort(bySeq);
    const n = Math.max(looseBases.length, looseAdjs.length);
    for (let k = 0; k < n; k++) {
      const b = looseBases[k];
      const a = looseAdjs[k];
      const ids = [b?.id, a?.id].filter((x): x is string => !!x);
      const sortTime = (b ?? a)!.createdAt.getTime();
      pairs.push({ ids, sortTime });
    }

    // Ordenar todas las parejas por createdAt y asignar token zero-padded compartido.
    pairs.sort((p, q) => p.sortTime - q.sortTime);
    pairs.forEach((p, idx) => {
      const token = `${scope}-${String(idx).padStart(4, "0")}`;
      for (const id of p.ids) out.set(id, token);
    });
  }
  return out;
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
    | "LEGAL"
    | "OTHER";
  description: string;
  periodYear: number;
  periodMonth: number; // 1..12
  amount: Decimal.Value;
  currencyPrimary: Currency;
  exchangeSource?: ExchangeSource;
  customCategory?: string;
  subCategory?: string | null;
  supplierName?: string;
  supplierRif?: string;
  invoiceNumber?: string;
  receiptDate?: Date;
  notes?: string;
  /** % de retención de ISLR sobre honorarios pagados a un profesional (ej. 3.00 = 3%). */
  retentionPct?: Decimal.Value;
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
  // Normalizar towerScope: si el edificio tiene UNA sola torre y el admin marca
  // ese mismo nombre, lo guardamos como NULL (= "general"). Evita que el gasto
  // se trate como "de torre" cuando en realidad cubre a todas las unidades.
  // Pedido cliente Castaños: "Es una sola torre, es la Torre B".
  if (input.towerScope) {
    const distinctTowers = await db.unit.findMany({
      where: { communityId: input.communityId, active: true, deletedAt: null, tower: { not: null } },
      select: { tower: true },
      distinct: ["tower"],
    });
    const towerNames = distinctTowers.map((u) => u.tower).filter((t): t is string => !!t);
    if (towerNames.length <= 1) {
      input.towerScope = null;
    }
  }

  // Si está vinculado a plantilla de provisión: es gasto REAL del condominio que
  // no se factura al residente, solo se usa para calcular el AJUSTE del mes siguiente.
  // No aplicar el bloqueo "ya emitido" — siempre se puede registrar el real aunque
  // ya se haya emitido el recibo del mes con la PROVISION.
  let linkedTpl: { isProvision: boolean; active: boolean } | null = null;
  if (input.recurringTemplateId) {
    linkedTpl = await db.recurringExpenseTemplate.findUnique({
      where: { id: input.recurringTemplateId },
      select: { isProvision: true, active: true },
    });
  }
  const isProvisionRealCost = linkedTpl?.isProvision === true;

  // Antes bloqueábamos crear gastos comunes después de emitir, pero el caso real
  // es: gasto extraordinario imprevisto (ej. "se dañó el ascensor, $100 de
  // reparación") que debe entrar al recibo del mes. Ahora lo permitimos: el
  // Expense queda como Pendiente (`invoicedAt=null`) y el preview lo proyecta
  // automáticamente. La página de Recibos muestra el botón "🔄 Re-emitir
  // período" para incluirlo en los recibos reales (siempre que nadie haya
  // pagado todavía).

  const source = input.exchangeSource ?? "BCV";
  // La tasa debe ser la del día del gasto (receiptDate), no la del registro.
  const rate = await getCurrentRate(source, input.receiptDate ?? new Date());
  const { amountBss, amountUsd } = buildBimonetary(input.amount, input.currencyPrimary, rate.vesPerUsd);

  // Retención de ISLR sobre honorarios (contador, administrador, abogado, etc.) —
  // pedido cliente 12-jul-2026 vía Reinaldo: "hacer el reporte de las retenciones".
  // Se calcula sobre el monto bimonetario ya resuelto, nunca sobre el monto crudo
  // (evita arrastre de redondeo entre Bs/USD).
  const retentionPct = input.retentionPct != null ? new Decimal(input.retentionPct) : null;
  const retentionAmountUsd = retentionPct ? amountUsd.mul(retentionPct).div(100) : null;
  const retentionAmountBss = retentionPct ? amountBss.mul(retentionPct).div(100) : null;

  return db.expense.create({
    data: {
      organizationId: input.organizationId,
      communityId: input.communityId,
      category: input.category,
      customCategory: input.customCategory ?? null,
      subCategory: input.subCategory ?? null,
      description: input.description,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amountBss: amountBss.toFixed(2),
      amountUsd: amountUsd.toFixed(2),
      exchangeRate: rate.vesPerUsd.toFixed(8),
      exchangeSource: rate.source,
      currencyPrimary: input.currencyPrimary,
      supplierName: input.supplierName,
      supplierRif: input.supplierRif,
      invoiceNumber: input.invoiceNumber,
      receiptDate: input.receiptDate,
      notes: input.notes,
      towerScope: input.towerScope ?? null,
      isIndividual: input.isIndividual ?? false,
      targetUnitId: input.targetUnitId ?? null,
      recurringTemplateId: input.recurringTemplateId ?? null,
      retentionPct: retentionPct?.toFixed(2) ?? null,
      retentionAmountUsd: retentionAmountUsd?.toFixed(2) ?? null,
      retentionAmountBss: retentionAmountBss?.toFixed(2) ?? null,
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

  // Shift post-mes: el recibo del mes M cobra gastos del mes M-shift.
  const shift = (community as { invoicePeriodShift?: number }).invoicePeriodShift ?? 0;
  let expenseYear = year;
  let expenseMonth = month - shift;
  while (expenseMonth <= 0) { expenseMonth += 12; expenseYear -= 1; }

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
    where: { communityId, periodYear: expenseYear, periodMonth: expenseMonth, invoicedAt: null, voidedAt: null },
    include: { recurringTemplate: { select: { id: true, description: true, isProvision: true, active: true } } },
  });
  // MODELO PROVISIÓN + AJUSTE (confirmado con el recibo Excel de Arrayanes, 03-jul-2026):
  // el residente paga SIEMPRE la provisión estimada (PROVISION_BASE) + el AJUSTE del mes
  // anterior (real mes pasado − estimado mes pasado). La factura REAL de un servicio
  // provisionado NO se cobra directo — solo alimenta el cálculo del ajuste (ver
  // applyToMonth). Por eso:
  //  - Se EXCLUYE del cobro cualquier REGULAR vinculado a una plantilla isProvision
  //    (es el "real" de un servicio provisionado; su rol es reconciliar, no cobrarse).
  //  - La PROVISION_BASE se cobra SIEMPRE (ya no se anula por existir un real).
  //  - PROVISION_ADJUSTMENT se factura (suma/resta la reconciliación).
  //  - Expenses cuya plantilla está INACTIVA no se facturan.
  // (Antes: lógica "REAL-FIRST" del 8/jun cobraba el real y anulaba la base — revertida.)
  const expensesRaw = allExpenses.filter((e) => {
    if (e.recurringTemplate && e.recurringTemplate.active === false) return false;
    if (e.kind === "REGULAR" && e.recurringTemplateId && e.recurringTemplate?.isProvision === true) return false;
    return true;
  });

  // Ingresos que reducen gastos antes del prorrateo (affectsInvoice=true)
  const deductibleIncomesRaw = await db.income.findMany({
    where: { communityId, periodYear: expenseYear, periodMonth: expenseMonth, affectsInvoice: true, voidedAt: null },
  });

  // Tasa BCV del CIERRE DEL MES COBRADO (último día del período), no la de hoy
  // (pedido Reinaldo 03-jul: "usar la tasa del 30 de junio"). Cada monto se NORMALIZA a
  // esta tasa respetando su moneda primaria: VES-primary → Bs fijo (costo real) y USD = Bs/tasa;
  // USD-primary → USD fijo y Bs = USD×tasa. Así TODO el recibo (líneas, totales, fondo, cuota,
  // exchangeRate guardado) queda consistente con la tasa mostrada.
  const refRate = await getCurrentRate("BCV", new Date(expenseYear, expenseMonth, 0));
  const normalizeAtRate = <T extends { amountBss: unknown; amountUsd: unknown; currencyPrimary: Currency }>(rows: T[]): T[] =>
    rows.map((e) => {
      let bss: Decimal, usd: Decimal;
      if (e.currencyPrimary === "USD") { usd = new Decimal(String(e.amountUsd)); bss = usd.mul(refRate.vesPerUsd); }
      else { bss = new Decimal(String(e.amountBss)); usd = bss.div(refRate.vesPerUsd); }
      return { ...e, amountBss: bss.toFixed(2) as never, amountUsd: usd.toFixed(2) as never };
    });
  const expenses = normalizeAtRate(expensesRaw);
  const deductibleIncomes = normalizeAtRate(deductibleIncomesRaw);
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
  // sortOrder: 1=Provisión+ajuste (pareados), 3=Cuota mensual,
  // 4=Gasto general agrupado, 5=Gasto por torre, 6=Gasto individual,
  // 7=Descuento ingreso. Pedido del cliente: "Las provisiones van primero"
  // y "PROVISION X seguida inmediatamente de AJUSTE PROVISION X mes anterior"
  // (como en el PDF de referencia de Arrayanes — Aviso de Cobro 001923).
  //
  // groupKey: cuando son provisión/ajuste del mismo templateId, comparten groupKey
  // para que aparezcan pegados al ordenar. subOrder: 0=base, 1=ajuste.
  type LineDraft = {
    unitId: string; expenseId: string | null; description: string;
    bss: Decimal; usd: Decimal; aliquot: Decimal;
    sortOrder: number; groupKey: string; subOrder: number;
  };
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
        // Gastos sueltos (sin plantilla): agrupar por CATEGORÍA + SUBCATEGORÍA + scope.
        // Pedido cliente Reinaldo: "crear categorías y subcategorías y que se agrupen".
        // Ej: 10 gastos "Ferretería / Tornillos" → 1 línea sumada en el recibo.
        const key = `${e.category}|${e.customCategory ?? ""}|${e.subCategory ?? ""}|${scope ?? ""}`;
        const arr = byCategory.get(key) ?? [];
        arr.push(e);
        byCategory.set(key, arr);
      }
    }

    // Etiqueta de un gasto agrupado por categoría: "Categoría — Subcategoría".
    function categoryLabel(e: ExpenseLike): string {
      const cat = e.customCategory?.trim() || e.description;
      const sub = (e as { subCategory?: string | null }).subCategory?.trim();
      return sub ? `${cat} — ${sub}` : cat;
    }

    function aggregateGroup(group: ExpenseLike[], useTemplateDesc: boolean): ExpenseLike {
      if (group.length === 1) {
        const e = group[0]!;
        return { ...e, description: useTemplateDesc ? (e.recurringTemplate?.description ?? e.description) : categoryLabel(e) };
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
          : categoryLabel(head),
      };
    }

    const aggregated: ExpenseLike[] = [];
    for (const [, group] of byTpl) aggregated.push(aggregateGroup(group, true));
    for (const [, group] of byCategory) aggregated.push(aggregateGroup(group, false));
    return [...aggregated, ...isolated];
  }
  const towerExpenses = groupByTemplate(towerExpensesRaw, "tower");
  const generalExpenses = groupByTemplate(generalExpensesRaw, null);

  // Emparejar PROVISIÓN↔AJUSTE (por templateId o por posición) para que salgan
  // intercaladas en el recibo, como en el Excel del cliente. Ver helper.
  const provPairKeys = buildProvisionPairKeys(expenses);

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
      groupKey: `indiv-${exp.id}`,
      subOrder: 0,
    });
  }

  // Helper local que usa la función exportada (mantenido para no cambiar la firma del inner code).
  const prorateSigned = prorateSignedExported;

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
      // Provisiones y ajustes comparten sortOrder=1 y se pegan por groupKey (templateId).
      // Subor: 0 = provisión base; 1 = ajuste mes anterior (va abajo de su provisión).
      const isProv = exp.kind === "PROVISION_BASE" || exp.kind === "PROVISION_ADJUSTMENT";
      const sortOrder = isProv ? 1 : 5;
      // groupKey pareado: base y su ajuste comparten token → salen pegados (base, luego ajuste).
      const groupKey = isProv
        ? `prov-${provPairKeys.get(exp.id) ?? exp.id}`
        : `tower-${exp.id}`;
      const subOrder = exp.kind === "PROVISION_ADJUSTMENT" ? 1 : 0;
      draftLines.push({
        unitId: u.id, expenseId: exp.id,
        description: `${exp.customCategory ?? exp.description} (Torre ${exp.towerScope})`,
        bss, usd, aliquot: new Decimal(u.aliquot.toString()),
        sortOrder, groupKey, subOrder,
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
      // Provisiones y ajustes comparten sortOrder=1 y se pegan por groupKey (templateId).
      // Esto reproduce el patrón del PDF Arrayanes: PROVISION X seguida directamente
      // de AJUSTE PROVISION X mes anterior, luego PROVISION Y, AJUSTE Y, etc.
      const isProv = exp.kind === "PROVISION_BASE" || exp.kind === "PROVISION_ADJUSTMENT";
      const sortOrder = isProv ? 1 : 4;
      // groupKey pareado: base y su ajuste comparten token → salen pegados (base, luego ajuste).
      const groupKey = isProv
        ? `prov-${provPairKeys.get(exp.id) ?? exp.id}`
        : `gen-${exp.id}`;
      const subOrder = exp.kind === "PROVISION_ADJUSTMENT" ? 1 : 0;
      draftLines.push({
        unitId: u.id, expenseId: exp.id,
        description: `${exp.customCategory ?? exp.description}`,
        bss, usd, aliquot: new Decimal(u.aliquot.toString()),
        sortOrder, groupKey, subOrder,
      });
    }
  }

  // 4. Si hay deducción de ingresos, crear una línea de descuento en cada factura
  if (deductionFactor.gt(0) && generalExpensesTotalUsd.gt(0)) {
    const totalDeductedUsd = generalExpensesTotalUsd.mul(deductionFactor);
    const totalDeductedBss = generalExpensesTotalBss.mul(deductionFactor);
    const bssDeductionDist = prorateUniform(totalDeductedBss.toFixed(2), participants);
    const usdDeductionDist = prorateUniform(totalDeductedUsd.toFixed(2), participants);
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
        groupKey: "deduction",
        subOrder: 0,
      });
    }
  }

  // refRate ya se calculó arriba (día de emisión) y se usó para normalizar los montos.
  if (hasFee) {
    const feeUsd = new Decimal(community.monthlyFeeUsd!.toString());
    const feeBss = feeUsd.mul(refRate.vesPerUsd);
    for (const u of units) {
      draftLines.push({ unitId: u.id, expenseId: null, description: "Cuota de condominio mensual", usd: feeUsd, bss: feeBss, aliquot: new Decimal(u.aliquot.toString()), sortOrder: 3, groupKey: "fee", subOrder: 0 });
    }
  }

  // FONDO DE RESERVA auto-calculado (10% del subtotal de gastos comunes prorrateados).
  // Solo si community.reserveFundPct > 0 y no hay un Expense manual de RESERVE_FUND
  // para el mismo período (evita doble cobro).
  const reservePctRec = (community as { reserveFundPct?: { toString(): string } }).reserveFundPct;
  const reservePct = new Decimal(reservePctRec?.toString() ?? "0.10");
  const hasManualReserveExpense = expenses.some((e) => e.category === "RESERVE_FUND");
  if (reservePct.gt(0) && !hasManualReserveExpense) {
    // Por cada unidad: sumar las líneas de "common" (excluyendo fee y descuentos),
    // calcular X% y agregar línea Fondo de Reserva.
    for (const u of units) {
      const commonLinesForUnit = draftLines.filter(
        (l) =>
          l.unitId === u.id &&
          l.sortOrder <= 4 && // 1=prov/ajuste, 4=gasto general
          l.description !== "Cuota de condominio mensual",
      );
      const subtotalUsd = commonLinesForUnit.reduce((s, l) => s.plus(l.usd), new Decimal(0));
      const subtotalBss = commonLinesForUnit.reduce((s, l) => s.plus(l.bss), new Decimal(0));
      const reserveUsd = subtotalUsd.mul(reservePct);
      const reserveBss = subtotalBss.mul(reservePct);
      if (reserveUsd.gt("0.005")) {
        draftLines.push({
          unitId: u.id,
          expenseId: null,
          description: `Fondo de Reserva (${reservePct.mul(100).toFixed(0)}%)`,
          usd: reserveUsd,
          bss: reserveBss,
          aliquot: new Decimal(u.aliquot.toString()),
          sortOrder: 4,
          groupKey: "z-reserve-fund",
          subOrder: 99,
        });
      }
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
    // Ordenar líneas: provisiones+ajustes pareadas primero (sortOrder=1, pegadas por
    // groupKey, subOrder=0 base seguido de subOrder=1 ajuste), luego cuota (3),
    // gastos generales (4), torre (5), individual (6), descuentos (7).
    const lines = draftLines
      .filter((l) => l.unitId === u.id)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        // Mismo sortOrder: agrupar por groupKey y dentro de cada grupo subOrder
        if (a.groupKey !== b.groupKey) return a.groupKey.localeCompare(b.groupKey);
        return a.subOrder - b.subOrder;
      });
    if (lines.length === 0) continue;
    const totalBss = lines.reduce((acc, l) => acc.plus(l.bss), new Decimal(0));
    const totalUsd = lines.reduce((acc, l) => acc.plus(l.usd), new Decimal(0));
    invoiceRows.push({
      id: randomUUID(),
      unitId: u.id,
      unitCode: u.code,
      // El número lleva el mes de EMISIÓN (el ciclo del recibo), no el mes cobrado
      // (pedido cliente 03-jul-2026). Ej: recibo emitido en julio que cobra junio →
      // "2026-07-101A". El período (contenido) sigue etiquetado como junio.
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

  // Aplicar automáticamente cualquier saldo a favor PREEXISTENTE contra las facturas
  // recién emitidas — pedido cliente 12-jul-2026 vía Reinaldo: "que el ajuste de saldo
  // a favor se integre automáticamente siempre, no que haga falta aplicarlo manual".
  // Precheck barato: solo unidades con crédito real, antes de intentar el sweep completo
  // por unidad (evita 188 queries de más cuando casi ninguna tiene anticipo).
  {
    const newUnitIds = result.invoices.map((r) => r.unitId);
    const paymentsMaybeWithCredit = await db.payment.findMany({
      where: { communityId, voidedAt: null, isHistorical: false, unitId: { in: newUnitIds } },
      select: { unitId: true, amountUsd: true, allocations: { select: { amountUsd: true } } },
    });
    const creditUnitIds = new Set<string>();
    for (const p of paymentsMaybeWithCredit) {
      const allocSum = p.allocations.reduce((s, a) => s + Number(a.amountUsd), 0);
      if (Number(p.amountUsd) - allocSum > 0.005) creditUnitIds.add(p.unitId);
    }
    if (creditUnitIds.size > 0) {
      const { applyUnitCreditCore } = await import("@/server/services/payments");
      for (const unitId of creditUnitIds) {
        try {
          await db.$transaction((tx) => applyUnitCreditCore(tx, { organizationId, unitId }));
        } catch {
          // Best-effort — que falle para una unidad puntual no debe bloquear la emisión.
        }
      }
    }
  }

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
