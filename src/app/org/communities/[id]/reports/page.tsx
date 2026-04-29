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

  const periodRange = getPeriodRange(year, month, periodType);

  const summary   = trpc.reports.communitySummary.useQuery({ organizationId, communityId, year, month });
  const trend     = trpc.reports.financialTrend.useQuery({ organizationId, communityId, months: 12 });
  const debtors   = trpc.reports.topDebtors.useQuery({ organizationId, communityId, take: 10 });
  const periodRpt = trpc.reports.periodReport.useQuery({ organizationId, communityId, ...periodRange });
  const exportQ   = trpc.reports.invoicesExport.useQuery({ organizationId, communityId, year, month }, { enabled: false });

  const onExportExcel = async () => {
    const { data } = await exportQ.refetch();
    if (!data || data.length === 0) return;
    const xlsx = await import("xlsx");
    const ws = xlsx.utils.json_to_sheet(data.map((r) => ({
      "# Factura":       r.invoiceNumber,
      "Unidad":          r.unitCode,
      "Piso":            r.floor,
      "Torre":           r.tower,
      "Propietario":     r.ownerName,
      "Email":           r.ownerEmail,
      "Teléfono":        r.ownerPhone,
      "Estado":          r.status,
      "Emitida":         r.issuedAt,
      "Vence":           r.dueDate,
      "Total USD":       Number(r.totalUsd),
      "Total Bs":        Number(r.totalBss),
      "Pagado USD":      Number(r.paidUsd),
      "Pendiente USD":   Number(r.pendingUsd),
      "Tasa (Bs/USD)":   Number(r.exchangeRate),
    })));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, `Facturas ${month}-${year}`);
    xlsx.writeFile(wb, `facturas-${year}-${String(month).padStart(2,"0")}.xlsx`);
  };

  const s = summary.data;

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
            {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button variant="outline" onClick={onExportExcel} disabled={exportQ.isFetching}>
            {exportQ.isFetching ? "Generando..." : "↓ Excel"}
          </Button>
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Facturado" value={`$${s?.billing.totalUsd ?? "—"}`} sub={`${s?.billing.invoiceCount ?? 0} facturas`} color="blue" loading={summary.isLoading} />
        <KpiCard label="Cobrado"   value={`$${s?.billing.paidUsd ?? "—"}`}  sub={`${s?.billing.collectionRate ?? 0}% de cobranza`} color="green" loading={summary.isLoading} />
        <KpiCard label="Pendiente" value={`$${s?.billing.pendingUsd ?? "—"}`} sub="por cobrar" color={Number(s?.billing.pendingUsd ?? 0) > 0 ? "red" : "green"} loading={summary.isLoading} />
        <KpiCard label="Unidades"  value={String(s?.occupancy.total ?? "—")} sub={`${s?.occupancy.owned ?? 0} con dueño · ${s?.occupancy.rented ?? 0} arrendadas`} color="slate" loading={summary.isLoading} />
      </div>

      {/* ── Gráficas ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Tendencia 12 meses */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-4">
          <p className="mb-3 text-sm font-semibold">Facturado vs Cobrado — últimos 12 meses</p>
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
              <PeriodKpi label="Facturado" value={`$${periodRpt.data?.totalInvoiced ?? "0.00"}`} color="blue" />
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
                  <Bar dataKey="invoiced"  name="Facturado" fill={C.blue}  radius={[3,3,0,0]} />
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
          <p className="font-semibold text-sm">Top deudores</p>
          <p className="text-xs text-muted-foreground">Unidades con mayor saldo pendiente acumulado</p>
        </div>
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
            ) : debtors.data?.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-green-600 font-medium">✓ Sin deudores pendientes</td></tr>
            ) : debtors.data?.map((d, i) => (
              <tr key={d.unitId} className="border-t hover:bg-muted/30">
                <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-4 py-2 font-medium">{d.unitCode}</td>
                <td className="px-4 py-2 text-muted-foreground">{d.ownerName}</td>
                <td className="px-4 py-2 text-right font-semibold text-red-600">${d.pendingUsd}</td>
                <td className="px-4 py-2">
                  <DebtBar pending={Number(d.pendingUsd)} max={Number(debtors.data?.[0]?.pendingUsd ?? 1)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, loading }: {
  label: string; value: string; sub: string; color: string; loading: boolean;
}) {
  const colors: Record<string, string> = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-green-200 bg-green-50 text-green-700",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
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
