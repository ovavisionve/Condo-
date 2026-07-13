"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  // Reporte "Deuda por unidad" (equivalente a "Vencimientos por cuotas" del sistema
  // anterior) — pedido cliente 09-jul-2026 con captura de referencia.
  const [duesDateMode, setDuesDateMode] = useState<"today" | "monthStart" | "monthEnd" | "custom">("today");
  const [duesCustomDate, setDuesCustomDate] = useState(today.toISOString().slice(0, 10));
  const [duesFromCode, setDuesFromCode] = useState("");
  const [duesToCode, setDuesToCode] = useState("");
  const [duesIncludeNoDebt, setDuesIncludeNoDebt] = useState(false);
  const [duesIncludeCredit, setDuesIncludeCredit] = useState(false);
  const [duesCurrency, setDuesCurrency] = useState<"USD" | "VES">("USD");
  const [duesHideOwnerName, setDuesHideOwnerName] = useState(false);
  const [duesGenerated, setDuesGenerated] = useState(false);

  // Marca "⚖️ En abogado" — unidades con un caso legal (LegalCase) OPEN.
  const { data: openLegalCases } = trpc.legal.cases.list.useQuery({ organizationId, communityId, status: "OPEN" });
  const legalUnitIds = new Set((openLegalCases ?? []).map((c) => c.unitId));

  const duesAsOfDate = (() => {
    if (duesDateMode === "today") return today;
    if (duesDateMode === "monthStart") return new Date(today.getFullYear(), today.getMonth(), 1);
    if (duesDateMode === "monthEnd") return new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return new Date(`${duesCustomDate}T12:00:00`);
  })();

  const duesReport = trpc.reports.duesReport.useQuery(
    {
      organizationId, communityId,
      asOfDate: duesAsOfDate,
      fromCode: duesFromCode || undefined,
      toCode: duesToCode || undefined,
      includeNoDebt: duesIncludeNoDebt,
      includeCredit: duesIncludeCredit,
      currency: duesCurrency,
      hideOwnerName: duesHideOwnerName,
    },
    { enabled: duesGenerated },
  );

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
  // Reporte de retenciones ISLR — pedido cliente 12-jul-2026 vía Reinaldo.
  const retentionsQ = trpc.reports.retentionsReport.useQuery({ organizationId, communityId, ...exportRange }, { enabled: false });
  const [retentionsShown, setRetentionsShown] = useState(false);

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

  const handleShowRetentions = async () => {
    await retentionsQ.refetch();
    setRetentionsShown(true);
  };

  const handleExportRetentions = async () => {
    const { data } = await retentionsQ.refetch();
    if (!data?.rows.length) return;
    const xlsx = await import("xlsx");
    const pad = (n: number) => String(n).padStart(2, "0");
    const rangeName = `${exportRange.startYear}-${pad(exportRange.startMonth)}_a_${exportRange.endYear}-${pad(exportRange.endMonth)}`;
    const ws = xlsx.utils.json_to_sheet(data.rows.map((r) => ({
      "Año": r.año, "Mes": r.mes,
      "Proveedor": r.proveedor, "RIF": r.rif,
      "Concepto": r.concepto, "Categoría": r.categoría,
      "% Retención": r.retencionPct,
      "Bruto USD": r.brutoUsd, "Bruto Bs": r.brutoBss,
      "Retenido USD": r.retenidoUsd, "Retenido Bs": r.retenidoBss,
      "Neto USD": r.netoUsd, "Neto Bs": r.netoBss,
    })));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Retenciones");
    xlsx.writeFile(wb, `retenciones-${rangeName}.xlsx`);
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
      {/* Estilos de impresión: solo se ven al imprimir/exportar a PDF (Ctrl+P). Oculta
          los controles (selects, botones) y la barra lateral/nav del layout — pedido
          cliente 07-jul-2026: "los reportes no se imprimen" (no existía ninguna opción). */}
      <style jsx global>{`
        @media print {
          .print\\:hidden { display: none !important; }
          nav, aside, header { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between print:hidden">
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
          <Button variant="outline" onClick={() => window.print()} title="Imprimir o guardar como PDF (Ctrl+P)">
            🖨️ Imprimir / PDF
          </Button>
        </div>
      </div>

      {/* Título visible SOLO al imprimir (reemplaza el header oculto arriba) */}
      <div className="hidden print:block mb-4">
        <h2 className="text-xl font-bold">Reportes y Dashboard — {MONTHS_ES[month - 1]} {year}</h2>
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
            <Button
              size="sm" variant="outline"
              onClick={() => void handleShowRetentions()}
              disabled={retentionsQ.isFetching}
            >
              {retentionsQ.isFetching ? "..." : "🧾 Retenciones"}
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

      {/* ── Reporte de retenciones ISLR sobre honorarios ─────────── */}
      {retentionsShown && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">🧾 Retenciones de ISLR sobre honorarios</h3>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleExportRetentions()} disabled={!retentionsQ.data?.rows.length}>
                ↓ Exportar Excel
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRetentionsShown(false)}>Cerrar</Button>
            </div>
          </div>
          {retentionsQ.isFetching ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : !retentionsQ.data?.rows.length ? (
            <p className="text-sm text-muted-foreground">
              No hay gastos con retención registrada en este rango. Márcalos en Gastos → "🧾 Este pago tiene retención de ISLR".
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-4 rounded-md bg-violet-50 px-3 py-2 text-sm">
                <span><strong>{retentionsQ.data.count}</strong> pagos con retención</span>
                <span>Bruto: <strong>${retentionsQ.data.summary.brutoUsd.toFixed(2)}</strong></span>
                <span className="text-violet-800">Retenido: <strong>${retentionsQ.data.summary.retenidoUsd.toFixed(2)}</strong></span>
                <span>Neto pagado: <strong>${retentionsQ.data.summary.netoUsd.toFixed(2)}</strong></span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2">Período</th>
                      <th className="px-3 py-2">Proveedor</th>
                      <th className="px-3 py-2">RIF</th>
                      <th className="px-3 py-2">Concepto</th>
                      <th className="px-3 py-2 text-right">Bruto USD</th>
                      <th className="px-3 py-2 text-right">%</th>
                      <th className="px-3 py-2 text-right">Retenido USD</th>
                      <th className="px-3 py-2 text-right">Neto USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retentionsQ.data.rows.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2 text-muted-foreground">{MONTHS_ES[r.mes - 1]} {r.año}</td>
                        <td className="px-3 py-2 font-medium">{r.proveedor || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.rif || "—"}</td>
                        <td className="px-3 py-2">{r.concepto}</td>
                        <td className="px-3 py-2 text-right">${r.brutoUsd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{r.retencionPct}%</td>
                        <td className="px-3 py-2 text-right text-violet-800 font-semibold">${r.retenidoUsd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">${r.netoUsd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

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

      {/* ── Vencimientos por cuotas (deuda por unidad, equivalente Sisconin) ── */}
      <div className="rounded-lg border bg-card print:hidden">
        <div className="border-b px-4 py-3">
          <p className="font-semibold text-sm">📋 Vencimientos por cuotas — Deuda por unidad</p>
          <p className="text-xs text-muted-foreground">Reporte completo (todas las unidades) a una fecha de corte, con rango, saldo a favor y moneda — como en el sistema anterior.</p>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-xs">Fecha</Label>
              <div className="flex flex-wrap gap-3 mt-1.5 text-sm">
                {([
                  ["today", "Hoy"],
                  ["monthStart", "Inicio de mes"],
                  ["monthEnd", "Fin de mes"],
                  ["custom", "Otra fecha"],
                ] as const).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      checked={duesDateMode === val}
                      onChange={() => setDuesDateMode(val)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {duesDateMode === "custom" && (
                <Input
                  type="date"
                  className="mt-2"
                  value={duesCustomDate}
                  onChange={(e) => setDuesCustomDate(e.target.value)}
                />
              )}
            </div>
            <div>
              <Label className="text-xs">Rango de unidades (código)</Label>
              <div className="flex gap-2 mt-1.5">
                <Input placeholder="Desde" value={duesFromCode} onChange={(e) => setDuesFromCode(e.target.value)} />
                <Input placeholder="Hasta" value={duesToCode} onChange={(e) => setDuesToCode(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Moneda</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm mt-1.5"
                value={duesCurrency}
                onChange={(e) => setDuesCurrency(e.target.value as "USD" | "VES")}
              >
                <option value="USD">USD — Dólares</option>
                <option value="VES">Bs — Bolívares</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 justify-end text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={duesIncludeNoDebt} onChange={(e) => setDuesIncludeNoDebt(e.target.checked)} />
                Mostrar condóminos sin deuda
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={duesIncludeCredit} onChange={(e) => setDuesIncludeCredit(e.target.checked)} />
                Mostrar saldos a favor
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={duesHideOwnerName} onChange={(e) => setDuesHideOwnerName(e.target.checked)} />
                No mostrar el nombre del condómino
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => setDuesGenerated(true)} disabled={duesReport.isFetching}>
              {duesReport.isFetching ? "Generando..." : "📋 Generar reporte"}
            </Button>
            {duesGenerated && duesReport.data && (
              <Button
                variant="outline"
                onClick={async () => {
                  const xlsx = await import("xlsx");
                  const rows = duesReport.data!.rows.map((r) => ({
                    Unidad: r.unitCode,
                    ...(duesHideOwnerName ? {} : { Propietario: r.ownerName ?? "" }),
                    [`Pendiente ${duesCurrency}`]: duesCurrency === "USD" ? r.pendingUsd : r.pendingBss,
                    ...(duesIncludeCredit ? { [`Saldo a favor ${duesCurrency}`]: duesCurrency === "USD" ? r.creditUsd : r.creditBss } : {}),
                    "Meses en mora": r.monthsOverdue,
                  }));
                  const ws = xlsx.utils.json_to_sheet(rows);
                  const wb = xlsx.utils.book_new();
                  xlsx.utils.book_append_sheet(wb, ws, "Deuda por unidad");
                  xlsx.writeFile(wb, `deuda-por-unidad-${new Date().toISOString().slice(0, 10)}.xlsx`);
                }}
              >
                ⬇️ Excel
              </Button>
            )}
          </div>

          {duesGenerated && (
            <div className="rounded-lg border overflow-auto">
              {duesReport.isLoading ? (
                <p className="px-4 py-6 text-center text-muted-foreground text-sm">Cargando...</p>
              ) : !duesReport.data || duesReport.data.rows.length === 0 ? (
                <p className="px-4 py-6 text-center text-green-600 font-medium text-sm">✓ Sin resultados para estos filtros</p>
              ) : (
                <>
                  <div className="px-4 py-2 bg-muted/40 border-b text-xs flex flex-wrap gap-4">
                    <span><strong>{duesReport.data.summary.unitCount}</strong> unidades</span>
                    <span>Pendiente total: <strong className="text-red-600">
                      {duesCurrency === "USD" ? `$${duesReport.data.summary.totalPendingUsd}` : `Bs ${Number(duesReport.data.summary.totalPendingBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </strong></span>
                    {duesIncludeCredit && (
                      <span>Saldo a favor total: <strong className="text-green-700">${duesReport.data.summary.totalCreditUsd}</strong></span>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2">Unidad</th>
                        {!duesHideOwnerName && <th className="px-3 py-2">Propietario</th>}
                        <th className="px-3 py-2 text-right">Pendiente</th>
                        {duesIncludeCredit && <th className="px-3 py-2 text-right">Saldo a favor</th>}
                        <th className="px-3 py-2 text-right">Meses mora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {duesReport.data.rows.map((r) => (
                        <tr key={r.unitId} className="border-t hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">
                            {r.unitCode}
                            {legalUnitIds.has(r.unitId) && (
                              <span
                                className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700"
                                title="Esta unidad tiene un caso legal (cobranza judicial) abierto"
                              >
                                ⚖️
                              </span>
                            )}
                          </td>
                          {!duesHideOwnerName && <td className="px-3 py-2 text-muted-foreground">{r.ownerName}</td>}
                          <td className="px-3 py-2 text-right font-semibold text-red-600">
                            {duesCurrency === "USD" ? `$${r.pendingUsd}` : `Bs ${Number(r.pendingBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </td>
                          {duesIncludeCredit && (
                            <td className="px-3 py-2 text-right text-green-700">
                              {Number(r.creditUsd) > 0 ? (duesCurrency === "USD" ? `$${r.creditUsd}` : `Bs ${Number(r.creditBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : "—"}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right text-muted-foreground">{r.monthsOverdue || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
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
