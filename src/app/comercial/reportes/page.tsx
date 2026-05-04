"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import * as XLSX from "xlsx";

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const AGING_COLORS = ["#22c55e", "#facc15", "#fb923c", "#ef4444", "#991b1b"];

export default function ReportesPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exportMonth, setExportMonth] = useState(new Date().getMonth() + 1);
  const [closeYear, setCloseYear] = useState(new Date().getFullYear());
  const [closeMonth, setCloseMonth] = useState(new Date().getMonth() + 1);
  const [closeNotes, setCloseNotes] = useState("");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const MESES_CC = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const trendQ = trpc.comercial.reports.financialTrend.useQuery(
    { organizationId: selectedOrgId, mallId, months: 12 },
    { enabled: !!mallId },
  );

  const agingQ = trpc.comercial.reports.aging.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: !!mallId },
  );

  const summaryQ = trpc.comercial.reports.summary.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: !!mallId },
  );

  const exportInvoicesQ = trpc.comercial.reports.exportInvoices.useQuery(
    { organizationId: selectedOrgId, mallId, periodYear: exportYear, periodMonth: exportMonth },
    { enabled: false },
  );

  const exportPaymentsQ = trpc.comercial.reports.exportPayments.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: false },
  );

  const monthClosesQ = trpc.comercial.monthClose.list.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: !!mallId },
  );
  const closeMut = trpc.comercial.monthClose.close.useMutation({
    onSuccess: () => { void monthClosesQ.refetch(); setShowCloseConfirm(false); setCloseNotes(""); },
  });
  const reopenMut = trpc.comercial.monthClose.reopen.useMutation({
    onSuccess: () => void monthClosesQ.refetch(),
  });

  const s = summaryQ.data;
  const trend = trendQ.data ?? [];
  const aging = agingQ.data;

  const agingPieData = aging ? [
    { name: "Al día", value: aging.buckets.current },
    { name: "1–30 días", value: aging.buckets.days30 },
    { name: "31–60 días", value: aging.buckets.days60 },
    { name: "61–90 días", value: aging.buckets.days90 },
    { name: "Más de 90", value: aging.buckets.over90 },
  ].filter((d) => d.value > 0) : [];

  const downloadExcelInvoices = async () => {
    const result = await exportInvoicesQ.refetch();
    const data = result.data ?? [];
    const rows = data.map((inv) => ({
      "N° Factura": inv.invoiceNumber,
      "Período": `${inv.periodYear}-${String(inv.periodMonth).padStart(2, "0")}`,
      "Local": inv.local.code,
      "Nombre local": inv.local.name ?? "",
      "Tipo": inv.type,
      "Estado": inv.status,
      "Total USD": Number(inv.totalUsd),
      "Pagado USD": Number(inv.paidUsd),
      "Pendiente USD": Number(inv.totalUsd) - Number(inv.paidUsd),
      "Total Bs": Number(inv.totalBss),
      "Tasa": Number(inv.exchangeRate),
      "Emisión": new Date(inv.issuedAt).toLocaleDateString("es-VE"),
      "Vencimiento": new Date(inv.dueDate).toLocaleDateString("es-VE"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Facturas");
    XLSX.writeFile(wb, `facturas_cc_${exportYear}_${String(exportMonth).padStart(2, "0")}.xlsx`);
  };

  const downloadExcelPayments = async () => {
    const result = await exportPaymentsQ.refetch();
    const data = result.data ?? [];
    const rows = data.map((p) => ({
      "Fecha": new Date(p.paidAt).toLocaleDateString("es-VE"),
      "Local": p.local?.code ?? "",
      "Nombre local": p.local?.name ?? "",
      "Monto USD": Number(p.amountUsd),
      "Monto Bs": Number(p.amountBss),
      "Tasa": Number(p.exchangeRate),
      "Método": p.method,
      "Referencia": p.reference ?? "",
      "Facturas aplicadas": p.allocations.map(a => a.invoice?.invoiceNumber).join(", "),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pagos");
    XLSX.writeFile(wb, `pagos_cc_${new Date().getFullYear()}.xlsx`);
  };

  const downloadExcelAging = () => {
    if (!aging) return;
    const rows = aging.details.map((d) => ({
      "Local": d.localCode,
      "Nombre": d.localName ?? "",
      "N° Factura": d.invoiceNumber,
      "Vencimiento": new Date(d.dueDate).toLocaleDateString("es-VE"),
      "Días vencida": d.daysPast,
      "Pendiente USD": d.pendingUsd,
      "Bucket": d.daysPast === 0 ? "Al día" : d.daysPast <= 30 ? "1–30 días" : d.daysPast <= 60 ? "31–60 días" : d.daysPast <= 90 ? "61–90 días" : "Más de 90",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Aging");
    XLSX.writeFile(wb, `aging_cc_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">📈 Reportes</h1>
        <p className="text-muted-foreground text-sm">Análisis financiero del centro comercial</p>
      </div>

      {/* KPIs del año */}
      {s && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">📊 Resumen del mes actual</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Ocupación", value: `${s.occupancyPct}%`, sub: `${s.occupiedLocales}/${s.totalLocales} locales`, color: s.occupancyPct >= 80 ? "text-green-600" : "text-orange-600" },
              { label: "Cobrado este mes", value: `$${fmt(s.paymentsThisMonthUsd)}`, sub: "Pagos recibidos", color: "text-green-600" },
              { label: "Gastos este mes", value: `$${fmt(s.expensesThisMonthUsd)}`, sub: "Total operativo", color: "text-orange-600" },
              { label: "Deuda pendiente", value: `$${fmt(s.pendingDebtUsd)}`, sub: `${s.pendingCount} facturas`, color: s.pendingDebtUsd > 0 ? "text-red-600" : "text-green-600" },
            ].map((k) => (
              <Card key={k.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{k.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Gráfica tendencia 12 meses */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">📉 Tendencia 12 meses — Gastos vs Cobros</h2>
        <Card>
          <CardContent className="pt-4">
            {trendQ.isLoading ? (
              <div className="h-64 bg-muted animate-pulse rounded" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={trend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v > 999 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip formatter={(v: unknown) => `$${fmt(Number(v))}`} />
                  <Legend />
                  <Bar dataKey="paymentsUsd" name="Cobros USD" fill="#22c55e" radius={[3,3,0,0]} />
                  <Bar dataKey="expensesUsd" name="Gastos USD" fill="#f97316" radius={[3,3,0,0]} />
                  <Bar dataKey="incomesUsd" name="Recaudación extra" fill="#60a5fa" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Aging de cartera */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">⚠️ Aging de cartera</h2>
          {aging && aging.details.length > 0 && (
            <Button size="sm" variant="outline" onClick={downloadExcelAging}>⬇️ Excel</Button>
          )}
        </div>
        {agingQ.isLoading ? (
          <div className="h-32 bg-muted animate-pulse rounded-lg" />
        ) : !aging || aging.totalUsd === 0 ? (
          <Card><CardContent className="py-8 text-center text-green-600 font-medium">✅ No hay deuda pendiente</CardContent></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-4">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={agingPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                      label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                      {agingPieData.map((_, i) => <Cell key={i} fill={AGING_COLORS[i] ?? "#999"} />)}
                    </Pie>
                    <Tooltip formatter={(v: unknown) => `$${fmt(Number(v))}`} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Detalle por bucket</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { label: "Al día", value: aging.buckets.current, color: "bg-green-500" },
                    { label: "1–30 días", value: aging.buckets.days30, color: "bg-yellow-400" },
                    { label: "31–60 días", value: aging.buckets.days60, color: "bg-orange-400" },
                    { label: "61–90 días", value: aging.buckets.days90, color: "bg-red-500" },
                    { label: "Más de 90 días", value: aging.buckets.over90, color: "bg-red-900" },
                  ].map((b) => (
                    <div key={b.label} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${b.color}`} />
                      <span className="text-xs flex-1">{b.label}</span>
                      <span className={`text-sm font-medium ${b.value > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                        ${fmt(b.value)}
                      </span>
                    </div>
                  ))}
                  <div className="border-t pt-2 flex justify-between">
                    <span className="text-xs font-medium">Total deuda</span>
                    <span className="font-bold text-red-700">${fmt(aging.totalUsd)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabla detalle aging */}
        {aging && aging.details.length > 0 && (
          <div className="mt-3 rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Local</th>
                  <th className="text-left px-4 py-3">N° Factura</th>
                  <th className="text-right px-4 py-3">Días vencida</th>
                  <th className="text-right px-4 py-3">Pendiente USD</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {aging.details.sort((a, b) => b.daysPast - a.daysPast).map((d, i) => (
                  <tr key={i} className="hover:bg-accent/30">
                    <td className="px-4 py-3 font-medium">
                      {d.localCode}{d.localName ? ` — ${d.localName}` : ""}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{d.invoiceNumber}</td>
                    <td className={`px-4 py-3 text-right font-medium ${d.daysPast > 90 ? "text-red-700" : d.daysPast > 30 ? "text-orange-600" : "text-yellow-700"}`}>
                      {d.daysPast === 0 ? "Al día" : `${d.daysPast} días`}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-red-700">${fmt(d.pendingUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cierre de mes */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">🗓️ Cierre de mes</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Form de cierre */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Cerrar período</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <div className="space-y-1 flex-1">
                  <Label className="text-xs">Año</Label>
                  <select value={closeYear} onChange={(e) => setCloseYear(parseInt(e.target.value))}
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm">
                    {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="space-y-1 flex-1">
                  <Label className="text-xs">Mes</Label>
                  <select value={closeMonth} onChange={(e) => setCloseMonth(parseInt(e.target.value))}
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm">
                    {MESES_CC.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notas opcionales</Label>
                <Input placeholder="Observaciones del cierre..." value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
              </div>
              <Button className="w-full" disabled={!mallId || closeMut.isPending}
                onClick={() => setShowCloseConfirm(true)}>
                🗓️ Cerrar {MESES_CC[closeMonth - 1]} {closeYear}
              </Button>
              {closeMut.isError && (
                <p className="text-xs text-red-600">{closeMut.error.message}</p>
              )}
            </CardContent>
          </Card>

          {/* Historial de cierres */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Historial de cierres</CardTitle></CardHeader>
            <CardContent>
              {monthClosesQ.data?.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No hay cierres registrados.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {monthClosesQ.data?.map((c) => {
                    const sum = c.summary as { totalInvoicedUsd?: number; totalCollectedUsd?: number; totalExpensesUsd?: number; collectionPct?: number; paidCount?: number; pendingCount?: number };
                    return (
                      <div key={c.id} className="border rounded-lg p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-sm">{MESES_CC[c.month - 1]} {c.year}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{new Date(c.closedAt).toLocaleDateString("es-VE")}</span>
                            <Button size="sm" variant="ghost" className="h-6 px-1 text-xs text-red-500 hover:text-red-700"
                              onClick={() => { if (confirm("¿Reabrir este cierre?")) void reopenMut.mutateAsync({ organizationId: selectedOrgId, closeId: c.id }); }}>
                              Reabrir
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 pt-1">
                          <div>
                            <p className="text-muted-foreground">Facturado</p>
                            <p className="font-medium">${fmt(sum.totalInvoicedUsd ?? 0)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Cobrado</p>
                            <p className="font-medium text-green-700">${fmt(sum.totalCollectedUsd ?? 0)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">% cobro</p>
                            <p className={`font-medium ${(sum.collectionPct ?? 0) >= 80 ? "text-green-700" : "text-orange-600"}`}>
                              {(sum.collectionPct ?? 0).toFixed(1)}%
                            </p>
                          </div>
                        </div>
                        {sum.pendingCount !== undefined && sum.pendingCount > 0 && (
                          <p className="text-orange-600">{sum.pendingCount} factura(s) pendiente(s) al cerrar</p>
                        )}
                        {c.notes && <p className="text-muted-foreground italic">{c.notes}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Dialog confirmación de cierre */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-card shadow-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">⚠️ Confirmar cierre de mes</h2>
            <p className="text-sm text-muted-foreground">
              Se registrará el cierre de <strong>{MESES_CC[closeMonth - 1]} {closeYear}</strong> con un snapshot de facturación y cobros.
              Esta operación no congela los datos, solo registra el estado actual.
            </p>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setShowCloseConfirm(false)}>Cancelar</Button>
              <Button
                disabled={closeMut.isPending}
                onClick={() => void closeMut.mutateAsync({
                  organizationId: selectedOrgId,
                  mallId,
                  year: closeYear,
                  month: closeMonth,
                  notes: closeNotes || undefined,
                })}>
                {closeMut.isPending ? "Guardando..." : "Confirmar cierre"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Exportaciones */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">⬇️ Exportar datos</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Exportar facturas */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">🧾 Facturas</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <div className="space-y-1 flex-1">
                  <label className="text-xs text-muted-foreground">Año</label>
                  <select value={exportYear} onChange={(e) => setExportYear(parseInt(e.target.value))}
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm">
                    {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="space-y-1 flex-1">
                  <label className="text-xs text-muted-foreground">Mes</label>
                  <select value={exportMonth} onChange={(e) => setExportMonth(parseInt(e.target.value))}
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{new Date(2025, m - 1).toLocaleDateString("es-VE", { month: "long" })}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Button className="w-full" variant="outline" onClick={() => void downloadExcelInvoices()}>
                ⬇️ Descargar Excel
              </Button>
            </CardContent>
          </Card>

          {/* Exportar pagos */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">💰 Pagos</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Todos los pagos registrados en el sistema</p>
              <Button className="w-full mt-6" variant="outline" onClick={() => void downloadExcelPayments()}>
                ⬇️ Descargar Excel
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
