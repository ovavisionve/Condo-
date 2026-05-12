"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const today = new Date();

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// ─── Colores ───────────────────────────────────────────────────────────────
const C = { blue: "#3b82f6", green: "#22c55e", amber: "#f59e0b", red: "#ef4444", slate: "#94a3b8", violet: "#8b5cf6" };

// ─── Helpers para períodos ─────────────────────────────────────────────────
function getPeriodRange(year: number, month: number, type: "monthly" | "quarterly" | "semiannual") {
  if (type === "monthly") return { startYear: year, startMonth: month, endYear: year, endMonth: month };
  if (type === "quarterly") {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const endMonth   = startMonth + 2;
    return { startYear: year, startMonth, endYear: year, endMonth };
  }
  // semiannual
  const startMonth = month <= 6 ? 1 : 7;
  const endMonth   = month <= 6 ? 6 : 12;
  return { startYear: year, startMonth, endYear: year, endMonth };
}

export default function ReportsPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [periodType, setPeriodType] = useState<"monthly" | "quarterly" | "semiannual">("monthly");

  // Tasa BCV para mostrar Bs primario en los KPIs (pedido cliente)
  const rateQ = trpc.finance.exchange.current.useQuery({ organizationId });
  const todayRate = Number(rateQ.data?.vesPerUsd ?? 0);
  const toBs = (usd: number | string) => {
    const n = Number(usd);
    if (!todayRate || !Number.isFinite(n)) return "—";
    return (n * todayRate).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Feature 8: rango para exportaciones por módulo
  const [exportRange, setExportRange] = useState({
    startYear: today.getFullYear(), startMonth: 1,
    endYear:   today.getFullYear(), endMonth:   today.getMonth() + 1,
  });

  const periodRange = getPeriodRange(year, month, periodType);

  const summary       = trpc.reports.communitySummary.useQuery({ organizationId, communityId, year, month });
  const trend         = trpc.reports.financialTrend.useQuery({ organizationId, communityId, months: 12 });
  const debtors       = trpc.reports.topDebtors.useQuery({ organizationId, communityId, take: 10 });
  const periodRpt     = trpc.reports.periodReport.useQuery({ organizationId, communityId, ...periodRange });
  // Feature 10: primer registro de cada módulo
  const firstRecords  = trpc.reports.firstRecords.useQuery({ organizationId, communityId });

  const exportQ         = trpc.reports.invoicesExport.useQuery({ organizationId, communityId, year, month }, { enabled: false });
  const expensesExportQ = trpc.reports.expensesExport.useQuery({ organizationId, communityId, ...exportRange }, { enabled: false });
  const paymentsExportQ = trpc.reports.paymentsExport.useQuery({ organizationId, communityId, ...exportRange }, { enabled: false });
  const incomeExportQ   = trpc.reports.incomeExport.useQuery({ organizationId, communityId, ...exportRange }, { enabled: false });

  const downloadMorososCsv = async () => {
    const { data } = await debtors.refetch();
    if (!data || data.length === 0) { alert("Sin deudores para exportar"); return; }
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const filename = `morosos-${now.getFullYear()}-${pad(now.getMonth() + 1)}.csv`;
    const header = ["Unidad","Propietario","Email","Teléfono","Facturas pendientes","Monto total USD","Meses en mora"];
    const rows = data
      .filter(d => Number(d.pendingUsd) > 0)
      .map(d => [
        d.unitCode,
        d.ownerName ?? "",
        d.ownerEmail ?? "",
        d.ownerPhone ?? "",
        d.invoiceCount ?? "",
        Number(d.pendingUsd).toFixed(2),
        d.overdueMonths ?? "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const onExportExcel = async () => {
    const { data } = await exportQ.refetch();
    if (!data || data.length === 0) return;
    const xlsx = await import("xlsx");
    const ws = xlsx.utils.json_to_sheet(data.map((r) => ({
      "# Recibo":        r.invoiceNumber,
      "Unidad":          r.unitCode,
      "Piso":            r.floor,
      "Torre":           r.tower,
      "Propietario":     r.ownerName,
      "Email":           r.ownerEmail,
      "Teléfono":        r.ownerPhone,
      "Estado":          r.status,
      "Emitido":         r.issuedAt,
      "Vence":           r.dueDate,
      "Total USD":       Number(r.totalUsd),
      "Total Bs":        Number(r.totalBss),
      "Pagado USD":      Number(r.paidUsd),
      "Pendiente USD":   Number(r.pendingUsd),
      "Tasa (Bs/USD)":   Number(r.exchangeRate),
    })));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, `Recibos ${month}-${year}`);
    xlsx.writeFile(wb, `recibos-${year}-${String(month).padStart(2,"0")}.xlsx`);
  };

  // Feature 8: exportar módulo a Excel
  const handleModuleExport = async (type: "expenses" | "payments" | "income") => {
    const xlsx = await import("xlsx");
    const wb = xlsx.utils.book_new();
    const pad = (n: number) => String(n).padStart(2, "0");
    const rangeName = `${exportRange.startYear}-${pad(exportRange.startMonth)}_a_${exportRange.endYear}-${pad(exportRange.endMonth)}`;

    if (type === "expenses") {
      const { data } = await expensesExportQ.refetch();
      if (!data?.length) return;
      const ws = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(wb, ws, "Gastos");
      xlsx.writeFile(wb, `gastos-${rangeName}.xlsx`);
    } else if (type === "payments") {
      const { data } = await paymentsExportQ.refetch();
      if (!data?.length) return;
      const ws = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(wb, ws, "Pagos");
      xlsx.writeFile(wb, `pagos-${rangeName}.xlsx`);
    } else {
      const { data } = await incomeExportQ.refetch();
      if (!data?.length) return;
      const ws = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(wb, ws, "Ingresos");
      xlsx.writeFile(wb, `ingresos-${rangeName}.xlsx`);
    }
  };

  const s = summary.data;
  // Feature 10: años disponibles desde primer registro
  const minYear = Math.min(
    firstRecords.data?.expenses?.periodYear ?? today.getFullYear(),
    firstRecords.data?.invoices?.periodYear ?? today.getFullYear(),
    firstRecords.data?.payments?.year ?? today.getFullYear(),
  );
  const availableYears = Array.from(
    { length: today.getFullYear() - minYear + 2 },
    (_, i) => minYear + i
  );

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Reportes y Dashboard</h2>
          <p className="text-sm text-muted-foreground">Período seleccionado: {MONTHS_ES[month - 1]} {year}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as "monthly" | "quarterly" | "semiannual")}
          >
            <option value="monthly">Mensual</option>
            <option value="quarterly">Trimestral</option>
            <option value="semiannual">Semestral</option>
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS_ES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button variant="outline" onClick={onExportExcel} disabled={exportQ.isFetching}>
            {exportQ.isFetching ? "Generando..." : "↓ Recibos Excel"}
          </Button>
          <Button variant="outline" onClick={() => void downloadMorososCsv()} disabled={debtors.isFetching}>
            {debtors.isFetching ? "Generando..." : "📋 Expediente morosos"}
          </Button>
        </div>
      </div>

      {/* ── Feature 8 + 10: Exportaciones por módulo ───────── */}
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-semibold mb-3">📥 Exportar por módulo</p>
        <div className="flex flex-wrap items-end gap-3">
          {/* Rango desde / hasta — Feature 10: min desde primer registro */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Desde</p>
            <div className="flex gap-1">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={exportRange.startYear}
                onChange={(e) => setExportRange(r => ({ ...r, startYear: Number(e.target.value) }))}
              >
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={exportRange.startMonth}
                onChange={(e) => setExportRange(r => ({ ...r, startMonth: Number(e.target.value) }))}
              >
                {MONTHS_ES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Hasta</p>
            <div className="flex gap-1">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={exportRange.endYear}
                onChange={(e) => setExportRange(r => ({ ...r, endYear: Number(e.target.value) }))}
              >
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={exportRange.endMonth}
                onChange={(e) => setExportRange(r => ({ ...r, endMonth: Number(e.target.value) }))}
              >
                {MONTHS_ES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          {/* Feature 10: botón "desde el inicio" */}
          {firstRecords.data && (
            <button
              onClick={() => setExportRange(r => ({
                ...r,
                startYear: Math.min(
                  firstRecords.data!.expenses?.periodYear ?? 9999,
                  firstRecords.data!.invoices?.periodYear ?? 9999,
                  firstRecords.data!.payments?.year ?? 9999,
                ),
                startMonth: 1,
              }))}
              className="h-8 px-2 text-xs rounded-md border border-dashed hover:bg-muted transition-colors text-muted-foreground"
              title="Exportar desde el primer registro"
            >
              ⏮ Desde inicio
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button
              size="sm" variant="outline"
              onClick={() => void handleModuleExport("expenses")}
              disabled={expensesExportQ.isFetching}
            >
              {expensesExportQ.isFetching ? "..." : "↓ Gastos"}
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => void handleModuleExport("income")}
              disabled={incomeExportQ.isFetching}
            >
              {incomeExportQ.isFetching ? "..." : "↓ Ingresos"}
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => void handleModuleExport("payments")}
              disabled={paymentsExportQ.isFetching}
            >
              {paymentsExportQ.isFetching ? "..." : "↓ Pagos"}
            </Button>
          </div>
        </div>
        {firstRecords.data && (
          <p className="text-xs text-muted-foreground mt-2">
            Primer registro: gastos desde {firstRecords.data.expenses
              ? `${MONTHS_ES[(firstRecords.data.expenses.periodMonth)-1]} ${firstRecords.data.expenses.periodYear}`
              : "sin datos"} · facturas desde {firstRecords.data.invoices
              ? `${MONTHS_ES[(firstRecords.data.invoices.periodMonth)-1]} ${firstRecords.data.invoices.periodYear}`
              : "sin datos"} · pagos desde {firstRecords.data.payments
              ? `${MONTHS_ES[(firstRecords.data.payments.month)-1]} ${firstRecords.data.payments.year}`
              : "sin datos"}
          </p>
        )}
      </div>

      {/* ── KPI Cards (Bs primario + USD secundario) ──────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Recibos emitidos"
          value={`Bs ${toBs(s?.billing.totalUsd ?? 0)}`}
          sub={`≈ $${s?.billing.totalUsd ?? "—"} · ${s?.billing.invoiceCount ?? 0} recibos`}
          color="slate" loading={summary.isLoading}
        />
        <KpiCard
          label="Cobrado en recibos"
          value={`Bs ${toBs(s?.billing.paidUsd ?? 0)}`}
          sub={`≈ $${s?.billing.paidUsd ?? "—"} · ${s?.billing.collectionRate ?? 0}% cobranza`}
          color={Number(s?.billing.collectionRate ?? 0) >= 80 ? "green" : Number(s?.billing.collectionRate ?? 0) >= 40 ? "amber" : "red"}
          loading={summary.isLoading}
        />
        <KpiCard
          label="Por cobrar"
          value={`Bs ${toBs(s?.billing.pendingUsd ?? 0)}`}
          sub={Number(s?.billing.pendingUsd ?? 0) > 0 ? `≈ $${s?.billing.pendingUsd}` : "✓ todo cobrado"}
          color={Number(s?.billing.pendingUsd ?? 0) > 0 ? "red" : "green"}
          loading={summary.isLoading}
        />
        <KpiCard
          label="Unidades"
          value={String(s?.occupancy.total ?? "—")}
          sub={`${s?.occupancy.owned ?? 0} con dueño · ${s?.occupancy.rented ?? 0} arrendadas`}
          color="slate" loading={summary.isLoading}
        />
      </div>

      {/* ── Flujo de caja real ─────────────────────────────── */}
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <p className="text-xs font-semibold text-green-800 mb-2 uppercase tracking-wide">💰 Flujo de caja real — {MONTHS_ES[month - 1]} {year}</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-green-700 opacity-80">Pagos recibidos en el período</p>
            {summary.isLoading
              ? <div className="mt-1 h-6 w-20 animate-pulse rounded bg-green-300/40" />
              : <p className="text-xl font-bold text-green-800">${s?.payments.totalReceivedUsd ?? "0.00"}</p>
            }
            <p className="text-xs text-green-600 mt-0.5">{s?.payments.count ?? 0} transacciones con fecha en el mes</p>
          </div>
          <div>
            <p className="text-xs text-green-700 opacity-80">Anticipo / Crédito disponible</p>
            {summary.isLoading
              ? <div className="mt-1 h-6 w-20 animate-pulse rounded bg-green-300/40" />
              : <p className="text-xl font-bold text-green-800">${s?.payments.anticipoUsd ?? "0.00"}</p>
            }
            <p className="text-xs text-green-600 mt-0.5">Pagos recibidos no asignados a recibos</p>
          </div>
          <div className="hidden sm:block">
            <p className="text-xs text-green-700 opacity-80">Tasa de cobranza (flujo real)</p>
            {summary.isLoading
              ? <div className="mt-1 h-6 w-20 animate-pulse rounded bg-green-300/40" />
              : <p className="text-xl font-bold text-green-800">
                  {s?.billing.totalUsd && Number(s.billing.totalUsd) > 0
                    ? `${(Number(s.payments.totalReceivedUsd) / Number(s.billing.totalUsd) * 100).toFixed(1)}%`
                    : "—"}
                </p>
            }
            <p className="text-xs text-green-600 mt-0.5">Pagos recibidos ÷ recibos emitidos en el mes</p>
          </div>
        </div>
      </div>

      {/* ── Gráficas ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Tendencia 12 meses */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-4">
          <p className="mb-3 text-sm font-semibold">Recibos emitidos vs Cobrado — últimos 12 meses</p>
          {trend.isLoading ? <ChartSkeleton /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend.data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="invoiced"  name="Facturado" fill={C.blue}  radius={[3,3,0,0]} />
                <Bar dataKey="collected" name="Cobrado"   fill={C.green} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Aging */}
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-3 text-sm font-semibold">Aging de cartera (USD)</p>
          {summary.isLoading ? <ChartSkeleton /> : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Al día",   value: s?.aging.current ?? 0 },
                      { name: "0-30d",    value: s?.aging.d30 ?? 0 },
                      { name: "31-60d",   value: s?.aging.d60 ?? 0 },
                      { name: "61-90d",   value: s?.aging.d90 ?? 0 },
                      { name: "+90d",     value: s?.aging.d90plus ?? 0 },
                    ].filter((d) => d.value > 0)}
                    cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                    dataKey="value" paddingAngle={2}
                  >
                    {[C.green, C.amber, C.blue, C.violet, C.red].map((c, i) => <Cell key={i} fill={c} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 text-xs">
                {[
                  { label: "Al día",  val: s?.aging.current ?? 0, color: C.green },
                  { label: "0–30d",   val: s?.aging.d30 ?? 0,     color: C.amber },
                  { label: "31–60d",  val: s?.aging.d60 ?? 0,     color: C.blue },
                  { label: "61–90d",  val: s?.aging.d90 ?? 0,     color: C.violet },
                  { label: "+90d",    val: s?.aging.d90plus ?? 0,  color: C.red },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
                      {r.label}
                    </span>
                    <span className="font-medium">${r.val.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Segunda fila ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Gastos vs Ingresos extra */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-4">
          <p className="mb-3 text-sm font-semibold">Gastos vs Ingresos adicionales — últimos 12 meses</p>
          {trend.isLoading ? <ChartSkeleton /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trend.data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="expenses"    name="Gastos"           fill={C.red}    radius={[3,3,0,0]} />
                <Bar dataKey="otherIncome" name="Ingresos extras"  fill={C.violet} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Work Orders */}
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-3 text-sm font-semibold">Work Orders</p>
          {summary.isLoading ? <ChartSkeleton h={120} /> : (
            <div className="space-y-3 mt-2">
              {[
                { label: "Abiertas",      val: s?.workOrders.open ?? 0,       color: C.amber },
                { label: "En progreso",   val: s?.workOrders.inProgress ?? 0, color: C.blue },
                { label: "Completadas",   val: s?.workOrders.completed ?? 0,  color: C.green },
              ].map((r) => (
                <div key={r.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-semibold">{r.val}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${s?.workOrders.total ? (r.val / s.workOrders.total) * 100 : 0}%`,
                        background: r.color,
                      }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-1">Total: {s?.workOrders.total ?? 0}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Reporte de período ──────────────────────────────── */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <p className="font-semibold text-sm">
            Reporte {periodType === "monthly" ? "mensual" : periodType === "quarterly" ? "trimestral" : "semestral"} —{" "}
            {MONTHS_ES[periodRange.startMonth - 1]} {periodRange.startYear}
            {periodRange.startMonth !== periodRange.endMonth && ` → ${MONTHS_ES[periodRange.endMonth - 1]} ${periodRange.endYear}`}
          </p>
        </div>
        {periodRpt.isLoading ? (
          <div className="p-4"><ChartSkeleton h={80} /></div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <PeriodKpi label="Gastos" value={`$${periodRpt.data?.totalExpenses ?? "0.00"}`} color="red" />
              <PeriodKpi label="Ingresos extra" value={`$${periodRpt.data?.totalIncome ?? "0.00"}`} color="violet" />
              <PeriodKpi label="Recibos emitidos" value={`$${periodRpt.data?.totalInvoiced ?? "0.00"}`} color="slate" />
              <PeriodKpi label="Cobrado" value={`$${periodRpt.data?.totalCollected ?? "0.00"}`} color="green" />
              <PeriodKpi
                label="Balance neto"
                value={`$${periodRpt.data?.netBalance ?? "0.00"}`}
                color={Number(periodRpt.data?.netBalance ?? 0) >= 0 ? "green" : "red"}
              />
            </div>
            {(periodRpt.data?.byMonth.length ?? 0) > 1 && (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={periodRpt.data?.byMonth} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="expenses"  name="Gastos"   fill={C.red}    radius={[3,3,0,0]} />
                  <Bar dataKey="invoiced"  name="Recibos emitidos" fill={C.blue}  radius={[3,3,0,0]} />
                  <Bar dataKey="collected" name="Cobrado"  fill={C.green}  radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* ── Top deudores ────────────────────────────────────── */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <p className="font-semibold text-sm">Top deudores con propietario registrado</p>
          <p className="text-xs text-muted-foreground">Unidades con mayor saldo pendiente acumulado · solo muestra unidades con propietario registrado</p>
        </div>
        {(() => {
          const withOwner  = debtors.data?.filter(d => d.ownerName !== "Sin propietario") ?? [];
          const noOwner    = debtors.data?.filter(d => d.ownerName === "Sin propietario") ?? [];
          const noOwnerTotal = noOwner.reduce((s, d) => s + Number(d.pendingUsd), 0);
          const maxPending = Number(withOwner[0]?.pendingUsd ?? 1);
          return (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Unidad</th>
                  <th className="px-4 py-2">Propietario</th>
                  <th className="px-4 py-2 text-right">Pendiente USD</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {debtors.isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Cargando...</td></tr>
                ) : withOwner.length === 0 && noOwner.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-green-600 font-medium">✓ Sin deudores pendientes</td></tr>
                ) : withOwner.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">
                    Ningún deudor tiene propietario registrado aún. Importa los propietarios para ver el detalle.
                  </td></tr>
                ) : (
                  withOwner.map((d, i) => (
                    <tr key={d.unitId} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2 font-medium">{d.unitCode}</td>
                      <td className="px-4 py-2 text-muted-foreground">{d.ownerName}</td>
                      <td className="px-4 py-2 text-right font-semibold text-red-600">${d.pendingUsd}</td>
                      <td className="px-4 py-2">
                        <DebtBar pending={Number(d.pendingUsd)} max={maxPending} />
                      </td>
                    </tr>
                  ))
                )}
                {noOwner.length > 0 && (
                  <tr className="border-t bg-muted/20">
                    <td colSpan={5} className="px-4 py-2 text-xs text-muted-foreground">
                      ⚠ Además, <span className="font-semibold text-foreground">{noOwner.length} unidades sin propietario registrado</span> tienen
                      {" "}<span className="font-semibold text-red-600">${noOwnerTotal.toFixed(2)}</span> en deuda pendiente. Importa los propietarios para hacer seguimiento.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, loading }: {
  label: string; value: string; sub: string; color: string; loading: boolean;
}) {
  const colors: Record<string, string> = {
    blue:  "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-green-200 bg-green-50 text-green-700",
    red:   "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color] ?? colors.slate}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      {loading
        ? <div className="mt-1 h-7 w-24 animate-pulse rounded bg-current opacity-20" />
        : <p className="mt-1 text-2xl font-bold">{value}</p>}
      <p className="mt-1 text-xs opacity-70">{sub}</p>
    </div>
  );
}

function ChartSkeleton({ h = 220 }: { h?: number }) {
  return <div className={`animate-pulse rounded bg-muted`} style={{ height: h }} />;
}

function DebtBar({ pending, max }: { pending: number; max: number }) {
  const pct = max > 0 ? (pending / max) * 100 : 0;
  return (
    <div className="h-2 w-24 rounded-full bg-muted">
      <div className="h-2 rounded-full bg-red-400" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PeriodKpi({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-green-200 bg-green-50 text-green-700",
    red: "border-red-200 bg-red-50 text-red-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  };
  return (
    <div className={`rounded-lg border p-3 ${colors[color] ?? "border-slate-200 bg-slate-50 text-slate-700"}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
