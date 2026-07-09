/**
 * Construye los datos completos del PDF de factura/recibo a partir de una Invoice ya
 * persistida. Lógica compartida entre el download del admin y el download del portal
 * residente para garantizar que AMBOS muestren el mismo contenido:
 *
 * - Secciones agrupadas (GASTOS COMUNES / TORRE / INDIVIDUALES)
 * - SUBTOTAL + Fondo de Reserva + TOTAL por sección
 * - Fondo de Reserva acumulado del EDIFICIO (no de la unidad)
 * - Saldo a Favor (anticipo no aplicado) del residente
 * - Payments allocations aplicados a este recibo
 */
import { db } from "@/server/db/client";
import type { InvoicePdfData } from "@/server/services/pdf";
import { buildProvisionPairKeys } from "@/server/services/invoicing";

/** Convierte el período de EMISIÓN al mes que realmente se cobra (período − shift). */
export function shiftPeriod(year: number, month: number, shift: number): { periodYear: number; periodMonth: number } {
  let y = year;
  let m = month - shift;
  while (m <= 0) { m += 12; y -= 1; }
  return { periodYear: y, periodMonth: m };
}

/**
 * Inversa de `shiftPeriod`: dado el mes COBRADO (el que se le muestra al residente,
 * ej. "Junio") + el shift, devuelve el período de EMISIÓN tal como está guardado en
 * `Invoice.periodYear/periodMonth` (ej. Julio). Necesaria en cualquier consulta que
 * reciba del cliente un año/mes ya desplazado (como el selector de "Avisos de cobro")
 * y tenga que volver a consultar la tabla Invoice, que siempre guarda el mes de emisión.
 */
export function unshiftPeriod(chargedYear: number, chargedMonth: number, shift: number): { periodYear: number; periodMonth: number } {
  let y = chargedYear;
  let m = chargedMonth + shift;
  while (m > 12) { m -= 12; y += 1; }
  return { periodYear: y, periodMonth: m };
}

export async function buildInvoicePdfData(invoiceId: string): Promise<InvoicePdfData> {
  const inv = await db.invoice.findFirstOrThrow({
    where: { id: invoiceId },
    include: {
      unit: true,
      items: {
        // Sin orderBy por descripción: el orden se reconstruye abajo para
        // INTERCALAR cada Provisión con su Ajuste (ver buildProvisionPairKeys),
        // igual que en la emisión. Ordenar por descripción los separaba
        // (todas las provisiones y luego todos los ajustes).
        include: {
          expense: {
            select: {
              id: true, category: true, amountBss: true, amountUsd: true,
              towerScope: true, isIndividual: true, kind: true,
              recurringTemplateId: true, createdAt: true,
            },
          },
        },
      },
      payments: {
        include: {
          payment: {
            select: { paidAt: true, method: true, amountUsd: true, amountBss: true, reference: true },
          },
        },
      },
    },
  });

  const [community, ownership, bankAccounts] = await Promise.all([
    db.community.findFirstOrThrow({
      where: { id: inv.communityId },
      select: { name: true, address: true, rif: true, phone: true, logoUrl: true, invoicePeriodShift: true, reserveFundOpeningUsd: true, reserveFundOpeningBss: true },
    }),
    db.ownership.findFirst({
      where: { unitId: inv.unitId, endDate: null },
      include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
    }),
    db.bankAccount.findMany({
      where: { communityId: inv.communityId, active: true },
      select: { bankName: true, accountNumber: true, accountHolder: true, accountType: true, currency: true, notes: true },
    }),
  ]);

  // ── Ordenar items para reproducir el orden de la emisión ─────────────
  // Cada Provisión debe salir seguida INMEDIATAMENTE de su Ajuste (como en el
  // Excel del cliente), no todas las provisiones y luego todos los ajustes.
  // Rango: 1=provisión/ajuste (pareados, base antes que ajuste), 3=cuota mensual,
  // 4=gasto regular (por createdAt), 5=fondo de reserva (al final de comunes).
  const pairKeys = buildProvisionPairKeys(
    inv.items
      .map((it) => it.expense)
      .filter((e): e is NonNullable<typeof e> => e != null),
  );
  const itemSortKey = (it: (typeof inv.items)[number]): string => {
    const exp = it.expense;
    if (exp && (exp.kind === "PROVISION_BASE" || exp.kind === "PROVISION_ADJUSTMENT")) {
      const token = pairKeys.get(exp.id) ?? exp.id;
      const sub = exp.kind === "PROVISION_ADJUSTMENT" ? "1" : "0";
      return `1|${token}|${sub}`;
    }
    if (!exp) return `3|${it.description}`; // cuota mensual u otros sin gasto
    if (exp.category === "RESERVE_FUND") return "5";
    return `4|${exp.createdAt.toISOString()}|${it.description}`;
  };
  inv.items.sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b)));

  // ── Construir secciones agrupadas (estilo Arrayanes) ─────────────────
  type SectionItem = { description: string; baseBss: string; cuotaUsd: string; cuotaBss: string };
  const aliquotPct = inv.unit.aliquot.toString();
  const sectionMap = new Map<string, { title: string; items: SectionItem[] }>();
  const ensureSection = (key: string, title: string) => {
    if (!sectionMap.has(key)) sectionMap.set(key, { title, items: [] });
    return sectionMap.get(key)!;
  };
  for (const it of inv.items) {
    const exp = it.expense;
    let sectionKey: string;
    let sectionTitle: string;
    if (exp?.isIndividual) {
      sectionKey = "individual";
      sectionTitle = "CARGOS INDIVIDUALES";
    } else if (exp?.towerScope) {
      sectionKey = `tower-${exp.towerScope}`;
      sectionTitle = `GASTOS TORRE ${exp.towerScope}`;
    } else {
      sectionKey = "common";
      sectionTitle = "GASTOS COMUNES";
    }
    const section = ensureSection(sectionKey, sectionTitle);
    section.items.push({
      description: it.description,
      baseBss: exp ? exp.amountBss.toString() : it.amountBss.toString(),
      cuotaUsd: it.amountUsd.toString(),
      cuotaBss: it.amountBss.toString(),
    });
  }
  const sortKey = (k: string) => k === "common" ? 0 : k.startsWith("tower") ? 1 : 2;
  const sections = Array.from(sectionMap.entries())
    .sort(([a], [b]) => sortKey(a) - sortKey(b))
    .map(([, s]) => {
      const subtotalUsd = s.items.reduce((sum, i) => sum + Number(i.cuotaUsd), 0);
      const subtotalBss = s.items.reduce((sum, i) => sum + Number(i.cuotaBss), 0);
      const baseTotalBss = s.items.reduce((sum, i) => sum + Number(i.baseBss), 0);
      return {
        title: s.title,
        aliquotPercent: aliquotPct,
        baseTotalBss: baseTotalBss.toFixed(2),
        items: s.items,
        subtotalUsd: subtotalUsd.toFixed(2),
        subtotalBss: subtotalBss.toFixed(2),
      };
    });

  // ── Fondo de Reserva acumulado del CONDOMINIO ─────────────────────────
  const reserveItemsAll = await db.invoiceItem.findMany({
    where: {
      invoice: { communityId: inv.communityId, status: { not: "VOIDED" } },
      // El fondo de reserva puede venir como Expense categoría RESERVE_FUND (manual) o
      // como línea auto-calculada (10%) sin expense (descripción "Fondo de Reserva …").
      OR: [
        { expense: { category: "RESERVE_FUND" } },
        { expenseId: null, description: { startsWith: "Fondo de Reserva" } },
      ],
    },
    include: { invoice: { select: { periodYear: true, periodMonth: true } } },
  });
  let prevUsd = 0, prevBss = 0, currUsd = 0, currBss = 0;
  for (const ri of reserveItemsAll) {
    const isCurrent = ri.invoice.periodYear === inv.periodYear && ri.invoice.periodMonth === inv.periodMonth;
    if (isCurrent) {
      currUsd += Number(ri.amountUsd);
      currBss += Number(ri.amountBss);
    } else if (
      ri.invoice.periodYear < inv.periodYear ||
      (ri.invoice.periodYear === inv.periodYear && ri.invoice.periodMonth < inv.periodMonth)
    ) {
      prevUsd += Number(ri.amountUsd);
      prevBss += Number(ri.amountBss);
    }
  }
  // Saldo de apertura traído del sistema anterior (Sisconin). Se suma al saldo anterior.
  prevUsd += Number(community.reserveFundOpeningUsd ?? 0);
  prevBss += Number(community.reserveFundOpeningBss ?? 0);
  const reserveFund = (prevUsd > 0 || currUsd > 0)
    ? {
        previousBalanceUsd: prevUsd.toFixed(2),
        previousBalanceBss: prevBss.toFixed(2),
        contributionUsd: currUsd.toFixed(2),
        contributionBss: currBss.toFixed(2),
        period: (() => { const s = shiftPeriod(inv.periodYear, inv.periodMonth, community.invoicePeriodShift ?? 0); return `${String(s.periodMonth).padStart(2, "0")}/${s.periodYear}`; })(),
        totalUsd: (prevUsd + currUsd).toFixed(2),
        totalBss: (prevBss + currBss).toFixed(2),
      }
    : undefined;

  // ── Saldo a favor del residente: anticipo (pagos − allocations) ─────
  // CRÍTICO: excluir isHistorical=true. Los pagos históricos migrados (Sisconin) casi
  // nunca tienen `allocations` (no se vincularon formalmente a una factura al migrarlos),
  // así que su monto COMPLETO se contaba como "crédito no asignado" — inventando un
  // saldo a favor falso que podía anular el cobro del mes (bug encontrado 05-jul-2026,
  // reportado por un residente: su recibo de junio quedó en $0 por un "anticipo" de
  // $47,57 que nunca existió — era un pago histórico de meses atrás, ya consumido por
  // esa deuda vieja, no un sobrante). Mismo criterio que ya usaba `buildUnitPayload`
  // (portal.ts): solo pagos REALES (no históricos) generan anticipo.
  const unitPayments = await db.payment.findMany({
    where: { unitId: inv.unitId, voidedAt: null, isHistorical: false },
    select: {
      amountUsd: true, amountBss: true,
      allocations: { select: { amountUsd: true, amountBss: true } },
    },
  });
  let creditUsdNum = 0, creditBssNum = 0;
  for (const p of unitPayments) {
    const tU = Number(p.amountUsd), tB = Number(p.amountBss);
    const aU = p.allocations.reduce((s, a) => s + Number(a.amountUsd), 0);
    const aB = p.allocations.reduce((s, a) => s + Number(a.amountBss), 0);
    if (tU - aU > 0.005) creditUsdNum += tU - aU;
    if (tB - aB > 0.005) creditBssNum += tB - aB;
  }
  const totalUsdNum = Number(inv.totalUsd);
  const totalBssNum = Number(inv.totalBss);
  const creditApplyU = Math.min(creditUsdNum, totalUsdNum);
  const creditApplyB = Math.min(creditBssNum, totalBssNum);

  // DEUDA ACUMULADA: saldo pendiente de TODAS las demás facturas impagas de la unidad
  // (Sisconin + recibos previos). Invoice.periodYear/periodMonth guarda el mes de EMISIÓN
  // (no el cobrado) — cada emisión tiene su propio mes de emisión único para la unidad, así
  // que basta con excluir esta misma factura por id (sin filtrar por período).
  const otherUnpaid = await db.invoice.findMany({
    where: {
      unitId: inv.unitId,
      voidedAt: null,
      status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
      id: { not: inv.id },
    },
    select: { totalUsd: true, paidUsd: true, totalBss: true, paidBss: true, periodYear: true, periodMonth: true },
  });
  let debtUsdNum = 0, debtBssNum = 0;
  const debtMonths = new Set<string>();
  for (const iv of otherUnpaid) {
    const oU = Number(iv.totalUsd) - Number(iv.paidUsd);
    const oB = Number(iv.totalBss) - Number(iv.paidBss);
    if (oU > 0.005) debtUsdNum += oU;
    if (oB > 0.005) debtBssNum += oB;
    if (oU > 0.005 || oB > 0.005) debtMonths.add(`${iv.periodYear}-${iv.periodMonth}`);
  }
  // Cantidad de MESES distintos con saldo pendiente (pedido cliente 05-jul-2026: "que se
  // registre cuántos meses debe cada quien", no solo el monto). Cuenta meses de emisión
  // únicos, no filas de factura (un mismo mes puede tener 2-3 facturas si hubo ajustes).
  const debtMonthsCount = debtMonths.size;

  return {
    communityName: community.name,
    communityLogoUrl: community.logoUrl,
    communityAddress: community.address ?? "",
    communityRif: community.rif,
    communityPhone: community.phone,
    invoiceNumber: inv.invoiceNumber,
    // El recibo se nombra por el MES QUE COBRA (mes de emisión − shift), no por el
    // período de emisión. Ej: recibo emitido en julio (período 7) con shift=1 cobra
    // junio → muestra "Junio". Igual que el "recibo de mayo" vive en el período 6.
    ...shiftPeriod(inv.periodYear, inv.periodMonth, community.invoicePeriodShift ?? 0),
    // Mes de EMISIÓN (sin shift) para el título "RECIBO DE CONDOMINIO — JULIO 2026".
    issueMonth: inv.periodMonth,
    issueYear: inv.periodYear,
    issuedAt: inv.issuedAt,
    dueDate: inv.dueDate,
    status: inv.status,
    exchangeRate: inv.exchangeRate.toString(),
    exchangeSource: inv.exchangeSource,
    unitCode: inv.unit.code,
    unitFloor: inv.unit.floor,
    unitTower: inv.unit.tower,
    ownerName: ownership?.person
      ? `${ownership.person.firstName} ${ownership.person.lastName}`
      : "Sin propietario registrado",
    ownerIdType: ownership?.person?.idType,
    ownerIdNumber: ownership?.person?.idNumber,
    items: inv.items.map((it) => ({
      description: it.description,
      aliquot: it.aliquot?.toString(),
      amountUsd: it.amountUsd.toString(),
      amountBss: it.amountBss.toString(),
    })),
    sections,
    reserveFund,
    totalUsd: inv.totalUsd.toString(),
    totalBss: inv.totalBss.toString(),
    paidUsd: inv.paidUsd.toString(),
    paidBss: inv.paidBss.toString(),
    creditUsd: creditApplyU > 0.005 ? creditApplyU.toFixed(2) : undefined,
    creditBss: creditApplyB > 0.005 ? creditApplyB.toFixed(2) : undefined,
    debtUsd: debtUsdNum > 0.005 ? debtUsdNum.toFixed(2) : undefined,
    debtBss: debtBssNum > 0.005 ? debtBssNum.toFixed(2) : undefined,
    debtMonthsCount: debtMonthsCount > 0 ? debtMonthsCount : undefined,
    paymentsApplied: inv.payments.map((pa) => ({
      paidAt: pa.payment.paidAt,
      method: pa.payment.method,
      amountUsd: pa.amountUsd.toString(),
      amountBss: pa.amountBss.toString(),
      reference: pa.payment.reference,
    })),
    bankAccounts: bankAccounts.map((b) => ({
      bankName: b.bankName,
      accountNumber: b.accountNumber,
      accountHolder: b.accountHolder,
      accountType: b.accountType,
      currency: b.currency,
      notes: b.notes,
    })),
  };
}
