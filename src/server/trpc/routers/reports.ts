import { z } from "zod";
import { router, orgProcedure } from "@/server/trpc/init";
import { Decimal } from "decimal.js";

const orgIdInput = z.object({ organizationId: z.string() });

export const reportsRouter = router({
  /**
   * KPIs financieros del período actual + aging + ocupación + work orders.
   * Es el dato principal del dashboard.
   */
  communitySummary: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      year: z.number().int().min(2020).max(2100),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const { organizationId, communityId, year, month } = input;
      const today = new Date();

      // ── Facturación del período ───────────────────────────────
      const invoices = await ctx.db.invoice.findMany({
        where: { organizationId, communityId, periodYear: year, periodMonth: month, status: { not: "VOIDED" } },
        select: { totalUsd: true, totalBss: true, paidUsd: true, paidBss: true, status: true },
      });

      const totalUsd = invoices.reduce((s, i) => s.plus(i.totalUsd.toString()), new Decimal(0));
      const paidUsd  = invoices.reduce((s, i) => s.plus(i.paidUsd.toString()),  new Decimal(0));
      const pendingUsd = totalUsd.minus(paidUsd);
      const collectionRate = totalUsd.isZero() ? 0 : paidUsd.div(totalUsd).mul(100).toDecimalPlaces(1).toNumber();

      const invoicesByStatus = invoices.reduce<Record<string, number>>((acc, i) => {
        acc[i.status] = (acc[i.status] ?? 0) + 1;
        return acc;
      }, {});

      // ── Aging (cartera vencida total) ─────────────────────────
      const overdueInvoices = await ctx.db.invoice.findMany({
        where: { organizationId, communityId, status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] } },
        select: { dueDate: true, totalUsd: true, paidUsd: true },
      });

      const MS = 86_400_000;
      const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
      for (const inv of overdueInvoices) {
        const bal = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString()).toNumber();
        if (bal <= 0) continue;
        const days = Math.floor((today.getTime() - inv.dueDate.getTime()) / MS);
        if (days < 0)       aging.current += bal;
        else if (days <= 30) aging.d30     += bal;
        else if (days <= 60) aging.d60     += bal;
        else if (days <= 90) aging.d90     += bal;
        else                 aging.d90plus += bal;
      }

      // ── Pagos recibidos en el período (por fecha de pago) ────────
      const periodStart = new Date(year, month - 1, 1);
      const periodEnd   = new Date(year, month, 1); // exclusive
      const paymentsInPeriod = await ctx.db.payment.aggregate({
        where: { organizationId, communityId, paidAt: { gte: periodStart, lt: periodEnd }, voidedAt: null, isHistorical: false },
        _sum: { amountUsd: true },
        _count: true,
      });
      const totalReceivedUsd = new Decimal(paymentsInPeriod._sum.amountUsd?.toString() ?? "0");
      const paymentsCount    = paymentsInPeriod._count;

      // Anticipo acumulado total = pagos que no tienen allocations o cuyo monto excede lo asignado
      // (excluye históricos migrados: no son anticipos reales)
      const anticipoAgg = await ctx.db.payment.aggregate({
        where: { organizationId, communityId, voidedAt: null, isHistorical: false },
        _sum: { amountUsd: true },
      });
      const allAllocated = await ctx.db.paymentAllocation.aggregate({
        where: { payment: { organizationId, communityId, voidedAt: null } },
        _sum: { amountUsd: true },
      });
      const anticipoUsd = new Decimal(anticipoAgg._sum.amountUsd?.toString() ?? "0")
        .minus(new Decimal(allAllocated._sum.amountUsd?.toString() ?? "0"));

      // ── Ocupación de unidades ─────────────────────────────────
      const units = await ctx.db.unit.findMany({
        where: { organizationId, communityId, deletedAt: null, active: true },
        select: { id: true },
      });
      const unitIds = units.map((u) => u.id);

      const [ownedUnitRows, rentedUnitRows] = await Promise.all([
        ctx.db.ownership.findMany({ where: { unitId: { in: unitIds }, endDate: null }, select: { unitId: true } }),
        ctx.db.tenancy.findMany({ where: { unitId: { in: unitIds }, endDate: null }, select: { unitId: true } }),
      ]);
      const ownedCount   = ownedUnitRows.length;
      const rentedCount  = rentedUnitRows.length;
      const occupiedIds  = new Set([...ownedUnitRows.map(o => o.unitId), ...rentedUnitRows.map(t => t.unitId)]);
      const vacantCount  = units.length - occupiedIds.size;

      // ── Work orders del período ───────────────────────────────
      const wos = await ctx.db.workOrder.groupBy({
        by: ["status"],
        where: { organizationId, communityId },
        _count: true,
      });
      const woByStatus = Object.fromEntries(wos.map((w) => [w.status, w._count]));

      return {
        period: { year, month },
        billing: {
          totalUsd: totalUsd.toFixed(2),
          paidUsd: paidUsd.toFixed(2),
          pendingUsd: pendingUsd.toFixed(2),
          collectionRate,
          invoiceCount: invoices.length,
          byStatus: invoicesByStatus,
        },
        payments: {
          totalReceivedUsd: totalReceivedUsd.toFixed(2),
          count: paymentsCount,
          anticipoUsd: anticipoUsd.isNegative() ? "0.00" : anticipoUsd.toFixed(2),
        },
        aging: {
          current: Number(aging.current.toFixed(2)),
          d30: Number(aging.d30.toFixed(2)),
          d60: Number(aging.d60.toFixed(2)),
          d90: Number(aging.d90.toFixed(2)),
          d90plus: Number(aging.d90plus.toFixed(2)),
        },
        occupancy: {
          total: units.length,
          owned: ownedCount,
          rented: rentedCount,
          vacant: vacantCount,
        },
        workOrders: {
          open:        woByStatus["OPEN"]        ?? 0,
          inProgress:  woByStatus["IN_PROGRESS"] ?? 0,
          completed:   woByStatus["COMPLETED"]   ?? 0,
          total: wos.reduce((s, w) => s + w._count, 0),
        },
      };
    }),

  /**
   * Tendencia mensual: ingresos vs gastos de los últimos N meses.
   * Usado para el gráfico de barras.
   */
  financialTrend: orgProcedure
    .input(orgIdInput.extend({ communityId: z.string(), months: z.number().int().min(3).max(24).default(12) }))
    .query(async ({ ctx, input }) => {
      const { organizationId, communityId, months } = input;
      const now = new Date();

      // Generar los N períodos hacia atrás
      const periods: { year: number; month: number; label: string }[] = [];
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
        periods.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${MONTHS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
      }

      const [expenses, incomes, invoices] = await Promise.all([
        ctx.db.expense.groupBy({
          by: ["periodYear", "periodMonth"],
          // Solo REGULAR (gastos reales). Excluye PROVISION_BASE/ADJUSTMENT que
          // son cargos contables al residente, no egresos reales del condominio.
          where: { organizationId, communityId, voidedAt: null, kind: "REGULAR" },
          _sum: { amountUsd: true },
        }),
        ctx.db.income.groupBy({
          by: ["periodYear", "periodMonth"],
          where: { organizationId, communityId, voidedAt: null },
          _sum: { amountUsd: true },
        }),
        ctx.db.invoice.groupBy({
          by: ["periodYear", "periodMonth"],
          where: { organizationId, communityId, status: { not: "VOIDED" } },
          _sum: { totalUsd: true, paidUsd: true },
        }),
      ]);

      const expenseMap = new Map(expenses.map((e) => [`${e.periodYear}-${e.periodMonth}`, Number(e._sum.amountUsd ?? 0)]));
      const incomeMap  = new Map(incomes.map((i)  => [`${i.periodYear}-${i.periodMonth}`,  Number(i._sum.amountUsd  ?? 0)]));
      const invoiceMap = new Map(invoices.map((i)  => [`${i.periodYear}-${i.periodMonth}`, {
        issued: Number(i._sum.totalUsd ?? 0),
        paid:   Number(i._sum.paidUsd  ?? 0),
      }]));

      return periods.map((p) => {
        const key = `${p.year}-${p.month}`;
        const inv = invoiceMap.get(key) ?? { issued: 0, paid: 0 };
        return {
          label: p.label,
          year: p.year,
          month: p.month,
          expenses: Number((expenseMap.get(key) ?? 0).toFixed(2)),
          otherIncome: Number((incomeMap.get(key) ?? 0).toFixed(2)),
          invoiced: Number(inv.issued.toFixed(2)),
          collected: Number(inv.paid.toFixed(2)),
        };
      });
    }),

  /**
   * Datos completos de facturas para exportar a Excel.
   */
  invoicesExport: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      year: z.number().int().min(2020).max(2100),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const invoices = await ctx.db.invoice.findMany({
        where: {
          organizationId: input.organizationId,
          communityId: input.communityId,
          periodYear: input.year,
          periodMonth: input.month,
          status: { not: "VOIDED" },
        },
        include: {
          unit: { select: { code: true, floor: true, tower: true } },
          _count: { select: { items: true } },
        },
        orderBy: { unit: { code: "asc" } },
      });

      // Propietarios actuales para cada unidad
      const unitIds = invoices.map((i) => i.unitId);
      const ownerships = await ctx.db.ownership.findMany({
        where: { unitId: { in: unitIds }, endDate: null },
        include: { person: { select: { firstName: true, lastName: true, email: true, phone: true } } },
      });
      const ownerMap = new Map(ownerships.map((o) => [o.unitId, o.person]));

      return invoices.map((inv) => {
        const owner = ownerMap.get(inv.unitId);
        const pending = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString()).toFixed(2);
        return {
          invoiceNumber: inv.invoiceNumber,
          unitCode: inv.unit.code,
          floor: inv.unit.floor ?? "",
          tower: inv.unit.tower ?? "",
          ownerName: owner ? `${owner.firstName} ${owner.lastName}` : "",
          ownerEmail: owner?.email ?? "",
          ownerPhone: owner?.phone ?? "",
          status: inv.status,
          issuedAt: inv.issuedAt.toISOString().split("T")[0],
          dueDate: inv.dueDate.toISOString().split("T")[0],
          totalUsd: inv.totalUsd.toString(),
          totalBss: inv.totalBss.toString(),
          paidUsd: inv.paidUsd.toString(),
          pendingUsd: pending,
          exchangeRate: inv.exchangeRate.toString(),
        };
      });
    }),

  /**
   * Top deudores: unidades con mayor saldo pendiente.
   */
  topDebtors: orgProcedure
    .input(orgIdInput.extend({ communityId: z.string(), take: z.number().int().min(5).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const invoices = await ctx.db.invoice.findMany({
        where: {
          organizationId: input.organizationId,
          communityId: input.communityId,
          status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
        },
        select: { unitId: true, totalUsd: true, paidUsd: true, dueDate: true, unit: { select: { code: true } } },
      });

      const today = new Date();
      const MS = 86_400_000;

      const byUnit = new Map<string, {
        code: string; pending: Decimal; invoiceCount: number; oldestDueDate: Date | null;
      }>();
      for (const inv of invoices) {
        const pending = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
        if (pending.lte(0)) continue;
        const existing = byUnit.get(inv.unitId);
        if (existing) {
          existing.pending = existing.pending.plus(pending);
          existing.invoiceCount += 1;
          if (!existing.oldestDueDate || inv.dueDate < existing.oldestDueDate) {
            existing.oldestDueDate = inv.dueDate;
          }
        } else {
          byUnit.set(inv.unitId, { code: inv.unit.code, pending, invoiceCount: 1, oldestDueDate: inv.dueDate });
        }
      }

      const unitIds = [...byUnit.keys()];
      const ownerships = await ctx.db.ownership.findMany({
        where: { unitId: { in: unitIds }, endDate: null },
        include: { person: { select: { firstName: true, lastName: true, email: true, phone: true } } },
      });
      const ownerMap = new Map(ownerships.map((o) => [o.unitId, o.person]));

      return [...byUnit.entries()]
        .sort((a, b) => b[1].pending.comparedTo(a[1].pending))
        .slice(0, input.take)
        .map(([unitId, data]) => {
          const owner = ownerMap.get(unitId);
          // Math.ceil, no floor — mismo criterio que portal.ts getDeudaGeneral (ya
          // verificado contra dueDates reales). floor() da sistemáticamente 1 mes
          // de menos que el "Meses" real de Sisconin — confirmado 12-jul-2026
          // comparando 20 unidades contra el Excel: TODAS off-by-one con floor.
          const overdueMonths = data.oldestDueDate
            ? Math.max(0, Math.ceil((today.getTime() - data.oldestDueDate.getTime()) / MS / 30))
            : 0;
          return {
            unitId,
            unitCode: data.code,
            ownerName: owner ? `${owner.firstName} ${owner.lastName}` : "Sin propietario",
            ownerEmail: owner?.email ?? "",
            ownerPhone: owner?.phone ?? "",
            pendingUsd: data.pending.toFixed(2),
            invoiceCount: data.invoiceCount,
            overdueMonths,
          };
        });
    }),

  /**
   * Reporte "deuda por unidad" — equivalente al "Vencimientos por cuotas" del
   * sistema anterior (Sisconin). Lista TODAS las unidades (no solo top N) con su
   * deuda pendiente a una fecha de corte, con filtros de rango de código, incluir
   * sin deuda, mostrar saldo a favor, moneda y ocultar nombre del propietario.
   *
   * Nota: "Mostrar recargos" del sistema viejo no tiene equivalente — ResidIA no
   * calcula un cargo de mora/interés (el modelo es USD fijo, se paga más Bs si
   * se paga tarde, pero no hay un monto adicional de recargo que mostrar).
   */
  duesReport: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      asOfDate: z.coerce.date().optional(), // default hoy
      fromCode: z.string().optional(),
      toCode: z.string().optional(),
      includeNoDebt: z.boolean().default(false),
      includeCredit: z.boolean().default(true),
      currency: z.enum(["USD", "VES"]).default("USD"),
      hideOwnerName: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const asOf = input.asOfDate ?? new Date();
      const today = new Date();
      const MS = 86_400_000;
      // Solo filtrar por dueDate cuando asOfDate es una fecha REALMENTE pasada (reconstrucción
      // histórica, ej. "Otra fecha" con un corte anterior). Para "Hoy" (o cualquier fecha de
      // hoy en adelante), NO se filtra por vencimiento — debe mostrar TODA la deuda pendiente
      // ya facturada, igual que "Top deudores" y el resto de la app. Antes filtraba siempre
      // por `dueDate <= asOf`, así que la factura del mes en curso (emitida pero cuyo
      // vencimiento todavía no llega) quedaba excluida del reporte aunque SÍ contaba en
      // "Top deudores" — bug reportado con capturas 12-jul-2026 (montos muy por debajo de
      // los reales, ej. 193A: reporte $685.70 vs real $1004.92).
      const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
      const asOfStart = new Date(asOf); asOfStart.setHours(0, 0, 0, 0);
      const isPastAsOf = asOfStart.getTime() < todayStart.getTime();

      const units = await ctx.db.unit.findMany({
        where: {
          communityId: input.communityId,
          deletedAt: null,
          ...(input.fromCode ? { code: { gte: input.fromCode } } : {}),
          ...(input.toCode ? { code: { lte: input.toCode } } : {}),
        },
        select: {
          id: true, code: true,
          ownerships: {
            where: { endDate: null },
            select: { person: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { code: "asc" },
      });
      const unitIds = units.map((u) => u.id);

      const invoices = await ctx.db.invoice.findMany({
        where: {
          communityId: input.communityId,
          unitId: { in: unitIds },
          status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
          ...(isPastAsOf ? { dueDate: { lte: asOf } } : {}),
        },
        select: { unitId: true, totalUsd: true, paidUsd: true, totalBss: true, paidBss: true, dueDate: true },
      });

      const debtByUnit = new Map<string, { usd: Decimal; bss: Decimal; oldestDueDate: Date | null }>();
      for (const inv of invoices) {
        const pendingUsd = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
        const pendingBss = new Decimal(inv.totalBss.toString()).minus(inv.paidBss.toString());
        if (pendingUsd.lte(0) && pendingBss.lte(0)) continue;
        const existing = debtByUnit.get(inv.unitId) ?? { usd: new Decimal(0), bss: new Decimal(0), oldestDueDate: null as Date | null };
        existing.usd = existing.usd.plus(Decimal.max(pendingUsd, 0));
        existing.bss = existing.bss.plus(Decimal.max(pendingBss, 0));
        if (!existing.oldestDueDate || inv.dueDate < existing.oldestDueDate) existing.oldestDueDate = inv.dueDate;
        debtByUnit.set(inv.unitId, existing);
      }

      // Saldo a favor (mismo criterio que buildInvoicePdfData: excluye pagos históricos
      // migrados, que casi nunca tienen allocations y no representan un anticipo real).
      const creditByUnit = new Map<string, { usd: Decimal; bss: Decimal }>();
      if (input.includeCredit) {
        const payments = await ctx.db.payment.findMany({
          where: { unitId: { in: unitIds }, voidedAt: null, isHistorical: false, paidAt: { lte: asOf } },
          select: {
            unitId: true, amountUsd: true, amountBss: true,
            allocations: { select: { amountUsd: true, amountBss: true } },
          },
        });
        for (const p of payments) {
          const tU = new Decimal(p.amountUsd.toString());
          const tB = new Decimal(p.amountBss.toString());
          const aU = p.allocations.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0));
          const aB = p.allocations.reduce((s, a) => s.plus(a.amountBss.toString()), new Decimal(0));
          const cU = tU.minus(aU);
          const cB = tB.minus(aB);
          if (cU.lte(0.005) && cB.lte(0.005)) continue;
          const existing = creditByUnit.get(p.unitId) ?? { usd: new Decimal(0), bss: new Decimal(0) };
          if (cU.gt(0.005)) existing.usd = existing.usd.plus(cU);
          if (cB.gt(0.005)) existing.bss = existing.bss.plus(cB);
          creditByUnit.set(p.unitId, existing);
        }
      }

      const rows = units.map((u) => {
        const debt = debtByUnit.get(u.id);
        const credit = creditByUnit.get(u.id);
        const owner = u.ownerships[0]?.person;
        // Math.ceil — mismo criterio que portal.ts getDeudaGeneral y topDebtors (ver
        // comentario arriba). floor() quedaba 1 mes por debajo del real.
        const monthsOverdue = debt?.oldestDueDate
          ? Math.max(0, Math.ceil((today.getTime() - debt.oldestDueDate.getTime()) / MS / 30))
          : 0;
        return {
          unitId: u.id,
          unitCode: u.code,
          ownerName: input.hideOwnerName ? null : owner ? `${owner.firstName} ${owner.lastName}` : "Sin propietario",
          pendingUsd: (debt?.usd ?? new Decimal(0)).toFixed(2),
          pendingBss: (debt?.bss ?? new Decimal(0)).toFixed(2),
          creditUsd: (credit?.usd ?? new Decimal(0)).toFixed(2),
          creditBss: (credit?.bss ?? new Decimal(0)).toFixed(2),
          monthsOverdue,
          hasDebt: Boolean(debt),
        };
      });

      const filtered = input.includeNoDebt ? rows : rows.filter((r) => r.hasDebt);

      const totalPendingUsd = filtered.reduce((s, r) => s + Number(r.pendingUsd), 0);
      const totalPendingBss = filtered.reduce((s, r) => s + Number(r.pendingBss), 0);
      const totalCreditUsd = filtered.reduce((s, r) => s + Number(r.creditUsd), 0);

      return {
        asOfDate: asOf,
        currency: input.currency,
        rows: filtered,
        summary: {
          unitCount: filtered.length,
          totalPendingUsd: totalPendingUsd.toFixed(2),
          totalPendingBss: totalPendingBss.toFixed(2),
          totalCreditUsd: totalCreditUsd.toFixed(2),
        },
      };
    }),

  /**
   * Reporte de ingresos vs gastos para un período (mensual / trimestral / semestral).
   * Devuelve totales consolidados + detalle por mes.
   */
  periodReport: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      startYear: z.number().int().min(2020).max(2100),
      startMonth: z.number().int().min(1).max(12),
      endYear: z.number().int().min(2020).max(2100),
      endMonth: z.number().int().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const { organizationId, communityId, startYear, startMonth, endYear, endMonth } = input;

      const [expenses, incomes, invoices] = await Promise.all([
        ctx.db.expense.findMany({
          where: {
            organizationId, communityId, voidedAt: null,
            // Solo gastos REGULAR (lo que el condominio gastó realmente).
            // PROVISION_BASE = cargo estimado al residente (NO es gasto real del condominio).
            // PROVISION_ADJUSTMENT = diferencia que se cobra al residente (NO es gasto).
            // Sin este filtro el reporte hacía doble-conteo: real + estimado = 2x.
            kind: "REGULAR",
            OR: [
              { periodYear: { gt: startYear }, AND: [{ periodYear: { lt: endYear } }] },
              { periodYear: startYear, periodMonth: { gte: startMonth } },
              { periodYear: endYear, periodMonth: { lte: endMonth } },
            ],
          },
          select: { periodYear: true, periodMonth: true, amountUsd: true, category: true, description: true },
          orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
        }),
        ctx.db.income.findMany({
          where: {
            organizationId, communityId, voidedAt: null,
            OR: [
              { periodYear: { gt: startYear }, AND: [{ periodYear: { lt: endYear } }] },
              { periodYear: startYear, periodMonth: { gte: startMonth } },
              { periodYear: endYear, periodMonth: { lte: endMonth } },
            ],
          },
          select: { periodYear: true, periodMonth: true, amountUsd: true, category: true, description: true },
          orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
        }),
        ctx.db.invoice.findMany({
          where: {
            organizationId, communityId, status: { not: "VOIDED" },
            OR: [
              { periodYear: { gt: startYear }, AND: [{ periodYear: { lt: endYear } }] },
              { periodYear: startYear, periodMonth: { gte: startMonth } },
              { periodYear: endYear, periodMonth: { lte: endMonth } },
            ],
          },
          select: { periodYear: true, periodMonth: true, totalUsd: true, paidUsd: true },
        }),
      ]);

      const totalExpenses = expenses.reduce((s, e) => s.plus(e.amountUsd.toString()), new Decimal(0));
      const totalIncome   = incomes.reduce((s, e) => s.plus(e.amountUsd.toString()), new Decimal(0));
      const totalInvoiced = invoices.reduce((s, i) => s.plus(i.totalUsd.toString()), new Decimal(0));
      const totalCollected = invoices.reduce((s, i) => s.plus(i.paidUsd.toString()), new Decimal(0));
      const netBalance    = totalIncome.plus(totalCollected).minus(totalExpenses);

      const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
      const monthlyMap = new Map<string, { label: string; expenses: Decimal; income: Decimal; invoiced: Decimal; collected: Decimal }>();
      const addMonth = (year: number, month: number) => {
        const key = `${year}-${month}`;
        if (!monthlyMap.has(key)) {
          monthlyMap.set(key, {
            label: `${MONTHS_ES[month - 1]} ${year}`,
            expenses: new Decimal(0), income: new Decimal(0),
            invoiced: new Decimal(0), collected: new Decimal(0),
          });
        }
        return monthlyMap.get(key)!;
      };
      for (const e of expenses) addMonth(e.periodYear, e.periodMonth).expenses = addMonth(e.periodYear, e.periodMonth).expenses.plus(e.amountUsd.toString());
      for (const i of incomes)  addMonth(i.periodYear, i.periodMonth).income   = addMonth(i.periodYear, i.periodMonth).income.plus(i.amountUsd.toString());
      for (const i of invoices) {
        const m = addMonth(i.periodYear, i.periodMonth);
        m.invoiced   = m.invoiced.plus(i.totalUsd.toString());
        m.collected  = m.collected.plus(i.paidUsd.toString());
      }

      const byMonth = [...monthlyMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => ({
          label: v.label,
          expenses: v.expenses.toFixed(2),
          income: v.income.toFixed(2),
          invoiced: v.invoiced.toFixed(2),
          collected: v.collected.toFixed(2),
        }));

      return {
        totalExpenses: totalExpenses.toFixed(2),
        totalIncome: totalIncome.toFixed(2),
        totalInvoiced: totalInvoiced.toFixed(2),
        totalCollected: totalCollected.toFixed(2),
        netBalance: netBalance.toFixed(2),
        byMonth,
      };
    }),

  /**
   * Feature 10: Devuelve el período (año/mes) del primer registro de cada módulo
   * para que la UI pueda ofrecer filtros desde "el comienzo de los datos".
   */
  firstRecords: orgProcedure
    .input(orgIdInput.extend({ communityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { communityId } = input;
      const [firstExpense, firstIncome, firstInvoice, firstPayment] = await Promise.all([
        ctx.db.expense.findFirst({
          where: { communityId, voidedAt: null },
          orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
          select: { periodYear: true, periodMonth: true },
        }),
        ctx.db.income.findFirst({
          where: { communityId, voidedAt: null },
          orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
          select: { periodYear: true, periodMonth: true },
        }),
        ctx.db.invoice.findFirst({
          where: { communityId, status: { not: "VOIDED" } },
          orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
          select: { periodYear: true, periodMonth: true },
        }),
        ctx.db.payment.findFirst({
          where: { communityId, voidedAt: null },
          orderBy: { paidAt: "asc" },
          select: { paidAt: true },
        }),
      ]);

      return {
        expenses: firstExpense ?? null,
        income:   firstIncome ?? null,
        invoices: firstInvoice ?? null,
        payments: firstPayment
          ? { year: firstPayment.paidAt.getFullYear(), month: firstPayment.paidAt.getMonth() + 1 }
          : null,
      };
    }),

  /**
   * Feature 8: Exportación de gastos para un rango de meses.
   */
  expensesExport: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      startYear:   z.number().int().min(2000).max(2100),
      startMonth:  z.number().int().min(1).max(12),
      endYear:     z.number().int().min(2000).max(2100),
      endMonth:    z.number().int().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const { organizationId, communityId, startYear, startMonth, endYear, endMonth } = input;
      const expenses = await ctx.db.expense.findMany({
        where: {
          organizationId,
          communityId,
          voidedAt: null,
          OR: [
            { periodYear: { gt: startYear }, AND: { periodYear: { lt: endYear } } },
            { periodYear: startYear, periodMonth: { gte: startMonth } },
            { periodYear: endYear,   periodMonth: { lte: endMonth   } },
          ],
        },
        include: { targetUnit: { select: { code: true } } },
        orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }, { createdAt: "asc" }],
      });

      return expenses.map((e) => ({
        año:           e.periodYear,
        mes:           e.periodMonth,
        categoría:     e.customCategory ?? e.category,
        descripción:   e.description,
        proveedor:     e.supplierName ?? "",
        factura:       e.invoiceNumber ?? "",
        monto_usd:     Number(e.amountUsd),
        monto_bs:      Number(e.amountBss),
        tasa:          Number(e.exchangeRate),
        alcance:       e.towerScope ?? (e.isIndividual ? `Unidad ${e.targetUnit?.code ?? ""}` : "General"),
        estado:        e.voidedAt ? "Anulado" : e.invoicedAt ? "Facturado" : "Pendiente",
      }));
    }),

  /**
   * Reporte de retenciones de ISLR sobre honorarios pagados a profesionales
   * (contador, administrador, abogado, etc.) — pedido cliente 12-jul-2026 vía
   * Reinaldo: "hacer el reporte de las retenciones". Lista los gastos con
   * retentionPct configurado en un rango de meses, con el desglose bruto/retenido/neto.
   */
  retentionsReport: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      startYear:   z.number().int().min(2000).max(2100),
      startMonth:  z.number().int().min(1).max(12),
      endYear:     z.number().int().min(2000).max(2100),
      endMonth:    z.number().int().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const { organizationId, communityId, startYear, startMonth, endYear, endMonth } = input;
      const expenses = await ctx.db.expense.findMany({
        where: {
          organizationId,
          communityId,
          voidedAt: null,
          retentionPct: { not: null },
          OR: [
            { periodYear: { gt: startYear }, AND: { periodYear: { lt: endYear } } },
            { periodYear: startYear, periodMonth: { gte: startMonth } },
            { periodYear: endYear,   periodMonth: { lte: endMonth   } },
          ],
        },
        orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }, { createdAt: "asc" }],
      });

      const rows = expenses.map((e) => {
        const brutoUsd = Number(e.amountUsd);
        const brutoBss = Number(e.amountBss);
        const retUsd = Number(e.retentionAmountUsd ?? 0);
        const retBss = Number(e.retentionAmountBss ?? 0);
        return {
          id: e.id,
          año: e.periodYear,
          mes: e.periodMonth,
          fecha: e.receiptDate?.toISOString() ?? null,
          proveedor: e.supplierName ?? "",
          rif: e.supplierRif ?? "",
          concepto: e.description,
          categoría: e.customCategory ?? e.category,
          retencionPct: Number(e.retentionPct ?? 0),
          brutoUsd, brutoBss,
          retenidoUsd: retUsd, retenidoBss: retBss,
          netoUsd: brutoUsd - retUsd, netoBss: brutoBss - retBss,
        };
      });

      const summary = rows.reduce(
        (s, r) => ({
          brutoUsd: s.brutoUsd + r.brutoUsd, brutoBss: s.brutoBss + r.brutoBss,
          retenidoUsd: s.retenidoUsd + r.retenidoUsd, retenidoBss: s.retenidoBss + r.retenidoBss,
          netoUsd: s.netoUsd + r.netoUsd, netoBss: s.netoBss + r.netoBss,
        }),
        { brutoUsd: 0, brutoBss: 0, retenidoUsd: 0, retenidoBss: 0, netoUsd: 0, netoBss: 0 },
      );

      return { rows, summary, count: rows.length };
    }),

  /**
   * Feature 8: Exportación de pagos para un rango de fechas.
   */
  paymentsExport: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      startYear:   z.number().int().min(2000).max(2100),
      startMonth:  z.number().int().min(1).max(12),
      endYear:     z.number().int().min(2000).max(2100),
      endMonth:    z.number().int().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const { organizationId, communityId, startYear, startMonth, endYear, endMonth } = input;
      const start = new Date(Date.UTC(startYear, startMonth - 1, 1));
      const end   = new Date(Date.UTC(endYear, endMonth, 1)); // exclusive

      const payments = await ctx.db.payment.findMany({
        where: {
          organizationId,
          communityId,
          voidedAt: null,
          paidAt: { gte: start, lt: end },
        },
        include: {
          unit: { select: { code: true, floor: true, tower: true } },
          allocations: {
            include: { invoice: { select: { invoiceNumber: true } } },
          },
        },
        orderBy: { paidAt: "asc" },
      });

      // Propietarios actuales
      const unitIds = [...new Set(payments.map(p => p.unitId))];
      const ownerships = await ctx.db.ownership.findMany({
        where: { unitId: { in: unitIds }, endDate: null },
        include: { person: { select: { firstName: true, lastName: true } } },
      });
      const ownerMap = new Map(ownerships.map(o => [o.unitId, o.person]));

      const METHOD_ES: Record<string, string> = {
        CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD",
        TRANSFER_BSS: "Transfer. Bs", TRANSFER_USD: "Transfer. USD",
        ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil",
        CRYPTO: "Cripto", CHECK: "Cheque", OTHER: "Otro",
      };

      return payments.map((p) => {
        const owner = ownerMap.get(p.unitId);
        return {
          fecha:         p.paidAt.toISOString().split("T")[0],
          unidad:        p.unit.code,
          piso:          p.unit.floor ?? "",
          torre:         p.unit.tower ?? "",
          propietario:   owner ? `${owner.firstName} ${owner.lastName}` : "",
          método:        METHOD_ES[p.method] ?? p.method,
          referencia:    p.reference ?? "",
          monto_usd:     Number(p.amountUsd),
          monto_bs:      Number(p.amountBss),
          tasa:          Number(p.exchangeRate),
          facturas:      p.allocations.map(a => a.invoice.invoiceNumber).join(", "),
          notas:         p.notes ?? "",
        };
      });
    }),

  /**
   * Feature 8: Exportación de ingresos para un rango de meses.
   */
  incomeExport: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      startYear:   z.number().int().min(2000).max(2100),
      startMonth:  z.number().int().min(1).max(12),
      endYear:     z.number().int().min(2000).max(2100),
      endMonth:    z.number().int().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const { organizationId, communityId, startYear, startMonth, endYear, endMonth } = input;
      const incomes = await ctx.db.income.findMany({
        where: {
          organizationId,
          communityId,
          voidedAt: null,
          OR: [
            { periodYear: { gt: startYear }, AND: { periodYear: { lt: endYear } } },
            { periodYear: startYear, periodMonth: { gte: startMonth } },
            { periodYear: endYear,   periodMonth: { lte: endMonth   } },
          ],
        },
        orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }, { createdAt: "asc" }],
      });

      return incomes.map((i) => ({
        año:                i.periodYear,
        mes:                i.periodMonth,
        categoría:          i.customCategory ?? i.category,
        descripción:        i.description,
        referencia:         i.reference ?? "",
        monto_usd:          Number(i.amountUsd),
        monto_bs:           Number(i.amountBss),
        tasa:               Number(i.exchangeRate),
        descuenta_recibos:  i.affectsInvoice ? "Sí" : "No",
        notas:              i.notes ?? "",
      }));
    }),
});
