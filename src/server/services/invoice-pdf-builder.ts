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

export async function buildInvoicePdfData(invoiceId: string): Promise<InvoicePdfData> {
  const inv = await db.invoice.findFirstOrThrow({
    where: { id: invoiceId },
    include: {
      unit: true,
      items: {
        orderBy: { description: "asc" },
        include: {
          expense: {
            select: {
              id: true, category: true, amountBss: true, amountUsd: true,
              towerScope: true, isIndividual: true, kind: true,
              recurringTemplateId: true,
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
      select: { name: true, address: true, rif: true, phone: true, logoUrl: true },
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
      expense: { category: "RESERVE_FUND" },
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
  const reserveFund = (prevUsd > 0 || currUsd > 0)
    ? {
        previousBalanceUsd: prevUsd.toFixed(2),
        previousBalanceBss: prevBss.toFixed(2),
        contributionUsd: currUsd.toFixed(2),
        contributionBss: currBss.toFixed(2),
        period: `${String(inv.periodMonth).padStart(2, "0")}/${inv.periodYear}`,
        totalUsd: (prevUsd + currUsd).toFixed(2),
        totalBss: (prevBss + currBss).toFixed(2),
      }
    : undefined;

  // ── Saldo a favor del residente: anticipo (pagos − allocations) ─────
  const unitPayments = await db.payment.findMany({
    where: { unitId: inv.unitId, voidedAt: null },
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

  return {
    communityName: community.name,
    communityLogoUrl: community.logoUrl,
    communityAddress: community.address ?? "",
    communityRif: community.rif,
    communityPhone: community.phone,
    invoiceNumber: inv.invoiceNumber,
    periodYear: inv.periodYear,
    periodMonth: inv.periodMonth,
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
