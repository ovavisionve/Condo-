"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from "recharts";

// ─── Constantes ───────────────────────────────────────────────────────────────
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MESES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const PIE_COLORS = ["#60a5fa","#3b82f6","#1d4ed8","#1e3a8a","#93c5fd"];

const STATUS_LABEL: Record<string, string> = {
  ISSUED: "Emitida", PARTIAL: "Pago parcial", PAID: "Pagada", OVERDUE: "Vencida", VOIDED: "Anulada",
};
const STATUS_COLOR: Record<string, string> = {
  ISSUED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  VOIDED: "bg-gray-100 text-gray-400",
};
const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD",
  TRANSFER_BSS: "Transferencia Bs", TRANSFER_USD: "Transferencia USD",
  ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil", CRYPTO: "Cripto", CHECK: "Cheque", OTHER: "Otro",
};

const fmt = (n: number | string) =>
  new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { key: "principal",  label: "Principal" },
  { key: "pendientes", label: "Pendientes" },
  { key: "pagos",      label: "Pagos" },
  { key: "factura",    label: "Factura" },
  { key: "notificar",  label: "Notificar pago" },
  { key: "mall",       label: "Deuda del mall" },
] as const;
type TabKey = typeof TABS[number]["key"];

// ─── Tipos ────────────────────────────────────────────────────────────────────
type PortalData = ReturnType<typeof usePortalData>["data"];

function usePortalData(token: string) {
  return trpc.comercial.portal.getByToken.useQuery({ token }, { retry: false });
}

// ─── PDF Buttons ──────────────────────────────────────────────────────────────
function DownloadFacturaButton({ token, invoiceId, invoiceNumber }: { token: string; invoiceId: string; invoiceNumber: string }) {
  const dl = trpc.comercial.portal.downloadInvoicePdf.useMutation();
  const [state, setState] = useState<"idle"|"loading"|"ok"|"err">("idle");

  const handle = async () => {
    setState("loading");
    try {
      const res = await dl.mutateAsync({ token, invoiceId });
      const link = document.createElement("a");
      link.href = `data:${res.mimeType};base64,${res.base64}`;
      link.download = res.fileName;
      link.click();
      setState("ok"); setTimeout(() => setState("idle"), 2500);
    } catch { setState("err"); setTimeout(() => setState("idle"), 3000); }
  };

  return (
    <button onClick={handle} disabled={state === "loading"}
      className="rounded border px-3 py-1 text-sm text-slate-700 border-slate-400 hover:bg-slate-100 transition-colors disabled:opacity-50"
      title={`Descargar PDF — ${invoiceNumber}`}>
      {state === "loading" ? "⏳ Descargando..." : state === "ok" ? "✅ Listo" : state === "err" ? "❌ Error" : "⬇️ Descargar PDF"}
    </button>
  );
}

function DownloadBaucheButton({ token, paymentId }: { token: string; paymentId: string }) {
  const dl = trpc.comercial.portal.downloadPaymentVoucher.useMutation();
  const [state, setState] = useState<"idle"|"loading"|"ok"|"err">("idle");

  const handle = async () => {
    setState("loading");
    try {
      const res = await dl.mutateAsync({ token, paymentId });
      const link = document.createElement("a");
      link.href = `data:${res.mimeType};base64,${res.base64}`;
      link.download = res.fileName;
      link.click();
      setState("ok"); setTimeout(() => setState("idle"), 2500);
    } catch { setState("err"); setTimeout(() => setState("idle"), 3000); }
  };

  return (
    <button onClick={handle} disabled={state === "loading"}
      className="rounded border px-2 py-0.5 text-xs text-blue-700 border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
      title="Descargar comprobante">
      {state === "loading" ? "⏳" : state === "ok" ? "✅" : state === "err" ? "❌" : "⬇️ Bauche"}
    </button>
  );
}

// ─── Tab: Principal ───────────────────────────────────────────────────────────
function PrincipalTab({ data, onTab }: { data: NonNullable<PortalData>; onTab: (t: TabKey) => void }) {
  const pendingUsd = Number(data.summary.totalPendingUsd);
  const todayRate = Number(data.todayRate);
  const pendingBss = pendingUsd * todayRate;
  const last = data.lastInvoice;
  const lastPay = data.lastPayment;

  return (
    <div className="space-y-6">
      {/* Hero deuda */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 border px-8 py-10 text-center space-y-2">
        <p className="text-lg font-medium text-slate-500">Deuda pendiente</p>
        <p className={`text-5xl font-bold tracking-tight ${pendingUsd > 0 ? "text-slate-800" : "text-green-700"}`}>
          US$ {fmt(pendingUsd)}
        </p>
        {todayRate > 1 && (
          <p className="text-xl font-semibold text-slate-500">
            Bs. {fmt(pendingBss)} <span className="text-sm font-normal">(tasa {fmt(todayRate)})</span>
          </p>
        )}
        <div className="pt-2">
          <Button
            className="bg-blue-700 hover:bg-blue-800 text-white px-8 py-2.5 rounded-full text-base font-semibold"
            onClick={() => onTab("notificar")}
          >
            Notificar Pago
          </Button>
        </div>
        {pendingUsd === 0 && (
          <p className="text-green-700 font-semibold text-lg">✅ Al día con sus pagos</p>
        )}
        <p className="text-xs text-slate-400 pt-1">
          Tasa BCV {data.todayRateSource}: {new Date().toLocaleDateString("es-VE")}
        </p>
      </div>

      {/* Último canon + último pago */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {last && (
          <div className="rounded-xl border bg-white px-6 py-5 text-center space-y-1 shadow-sm">
            <p className="text-sm text-muted-foreground font-medium">Último canon facturado</p>
            <p className="text-3xl font-bold text-slate-800">US$ {fmt(last.totalUsd)}</p>
            {todayRate > 1 && <p className="text-sm text-slate-500">Bs. {fmt(Number(last.totalUsd) * todayRate)}</p>}
            {last.periodMonth && last.periodYear && (
              <p className="text-sm font-semibold text-blue-700">{MESES[(last.periodMonth ?? 1) - 1]} {last.periodYear}</p>
            )}
            <button className="mt-2 text-xs border border-blue-700 text-blue-700 px-4 py-1.5 rounded hover:bg-blue-700 hover:text-white transition-colors"
              onClick={() => onTab("factura")}>Ver factura</button>
          </div>
        )}
        {lastPay && (
          <div className="rounded-xl border bg-white px-6 py-5 text-center space-y-1 shadow-sm">
            <p className="text-sm text-muted-foreground font-medium">Último pago registrado</p>
            <p className="text-3xl font-bold text-slate-800">US$ {fmt(lastPay.amountUsd)}</p>
            {todayRate > 1 && <p className="text-sm text-slate-500">Bs. {fmt(Number(lastPay.amountUsd) * todayRate)}</p>}
            <p className="text-sm font-semibold text-blue-700">{new Date(lastPay.paidAt).toLocaleDateString("es-VE")}</p>
            <button className="mt-2 text-xs border border-blue-700 text-blue-700 px-4 py-1.5 rounded hover:bg-blue-700 hover:text-white transition-colors"
              onClick={() => onTab("pagos")}>Ver pagos</button>
          </div>
        )}
        {!last && !lastPay && (
          <div className="col-span-2 rounded-xl border bg-white px-6 py-8 text-center text-muted-foreground">
            Sin movimientos registrados aún.
          </div>
        )}
      </div>

      {/* Instrucciones de pago */}
      {data.mall.paymentInstructions && (
        <div className="rounded-xl border bg-blue-50 border-blue-200 p-4 space-y-2">
          <p className="text-sm font-semibold text-blue-800">💳 ¿Cómo pagar?</p>
          <pre className="text-xs text-blue-700 whitespace-pre-wrap font-sans">{data.mall.paymentInstructions}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Pendientes ──────────────────────────────────────────────────────────
function PendientesTab({ data }: { data: NonNullable<PortalData> }) {
  const todayRate = Number(data.todayRate);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Facturas Pendientes</h2>
        <div className="mt-1 h-0.5 w-16 bg-blue-600" />
        <p className="text-sm text-blue-700 mt-1">Agrupado por días de vencimiento.</p>
      </div>

      {/* Aging chart */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.agingBuckets} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
            <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, "Pendiente"]} />
            <Bar dataKey="usd" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Pendiente" />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-1">
          <span className="font-semibold">Análisis de vencimientos:</span> montos vencidos agrupados por días de mora.
        </p>
      </div>

      {/* Tabla pendientes */}
      <div>
        <h3 className="text-xl font-bold">Facturas por Cobrar</h3>
        <p className="text-sm text-blue-700">Expresado en US$</p>
        <div className="mt-2 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white text-left">
                <th className="px-4 py-2 font-semibold">Período</th>
                <th className="px-4 py-2 font-semibold">Factura</th>
                <th className="px-4 py-2 font-semibold">Estado</th>
                <th className="px-4 py-2 font-semibold text-right">Pendiente US$</th>
                <th className="px-4 py-2 font-semibold text-right">Pendiente Bs.</th>
                <th className="px-4 py-2 font-semibold text-right">Meses vencida</th>
              </tr>
            </thead>
            <tbody>
              {data.pendingInvoices.map((inv, i) => (
                <tr key={inv.id} className={`border-t ${i % 2 === 0 ? "" : "bg-slate-50"}`}>
                  <td className="px-4 py-2 text-muted-foreground">
                    {inv.periodMonth && inv.periodYear
                      ? `${MESES_SHORT[(inv.periodMonth ?? 1) - 1]} ${inv.periodYear}`
                      : new Date(inv.dueDate).toLocaleDateString("es-VE")}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[inv.status] ?? ""}`}>
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-red-700">{fmt(inv.pendingUsd)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {todayRate > 1 ? fmt(Number(inv.pendingUsd) * todayRate) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">{inv.monthsOverdue}</td>
                </tr>
              ))}
              {data.pendingInvoices.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-green-700 font-medium">✓ Sin facturas pendientes</td></tr>
              )}
              {data.pendingInvoices.length > 0 && (
                <tr className="border-t bg-slate-800/5 font-bold">
                  <td colSpan={3} className="px-4 py-2 text-right text-sm">Total pendiente:</td>
                  <td className="px-4 py-2 text-right text-slate-800">US$ {fmt(data.summary.totalPendingUsd)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {todayRate > 1 ? `Bs. ${fmt(Number(data.summary.totalPendingUsd) * todayRate)}` : ""}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground border rounded px-3 py-2 bg-slate-50">
        {todayRate > 1
          ? `Los montos en bolívares se calculan al tipo de cambio BCV del día: ${fmt(todayRate)} Bs/$`
          : "Montos en dólares estadounidenses (USD)."}
      </p>
    </div>
  );
}

// ─── Tab: Pagos ───────────────────────────────────────────────────────────────
function PagosTab({ data, token }: { data: NonNullable<PortalData>; token: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Pagos Registrados</h2>
        <div className="mt-1 h-0.5 w-16 bg-blue-600" />
        <p className="text-sm text-blue-700 mt-1">Últimos 6 meses.</p>
      </div>

      {/* Area chart */}
      {data.monthlyPaymentTotals.length > 0 && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.monthlyPaymentTotals} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="colorPago" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
              <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, "Pagado"]} />
              <Area type="monotone" dataKey="totalUsd" stroke="#3b82f6" strokeWidth={2}
                fill="url(#colorPago)" name="Pagado" />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="font-semibold">Gráfico de pagos:</span> pagos realizados en los últimos 6 meses.
          </p>
        </div>
      )}

      {/* Tabla pagos */}
      <div>
        <h3 className="text-xl font-bold">Historial de Pagos</h3>
        <p className="text-sm text-blue-700">Expresado en US$</p>
        <div className="mt-2 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white text-left">
                <th className="px-4 py-2 font-semibold">Fecha</th>
                <th className="px-4 py-2 font-semibold hidden sm:table-cell">Método</th>
                <th className="px-4 py-2 font-semibold hidden md:table-cell">Referencia</th>
                <th className="px-4 py-2 font-semibold text-right hidden lg:table-cell">Saldo anterior</th>
                <th className="px-4 py-2 font-semibold text-right">Pagado</th>
                <th className="px-4 py-2 font-semibold text-right hidden lg:table-cell">Queda pendiente</th>
                <th className="px-4 py-2 font-semibold text-center">Bauche</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p, i) => (
                <tr key={p.id} className={`border-t ${i % 2 === 0 ? "" : "bg-slate-50"}`}>
                  <td className="px-4 py-2">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                  <td className="px-4 py-2 hidden sm:table-cell text-muted-foreground text-xs">
                    {METHOD_LABEL[p.method] ?? p.method}
                  </td>
                  <td className="px-4 py-2 hidden md:table-cell font-mono text-xs text-muted-foreground">
                    {p.reference ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right hidden lg:table-cell">{fmt(p.saldoAnteriorUsd)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-blue-700">{fmt(p.amountUsd)}</td>
                  <td className="px-4 py-2 text-right hidden lg:table-cell">{fmt(p.quedaPendienteUsd)}</td>
                  <td className="px-4 py-2 text-center">
                    <DownloadBaucheButton token={token} paymentId={p.id} />
                  </td>
                </tr>
              ))}
              {data.payments.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Sin pagos registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Factura ─────────────────────────────────────────────────────────────
function FacturaTab({ data, token }: { data: NonNullable<PortalData>; token: string }) {
  const invoiceOptions = data.invoices.filter(inv => inv.status !== "VOIDED");

  type MonthKey = { key: string; label: string; year: number; month: number };
  const monthGroups: MonthKey[] = [];
  const seen = new Set<string>();
  for (const inv of invoiceOptions) {
    if (!inv.periodYear || !inv.periodMonth) continue;
    const k = `${inv.periodYear}-${String(inv.periodMonth).padStart(2,"0")}`;
    if (!seen.has(k)) {
      seen.add(k);
      monthGroups.push({ key: k, label: `${MESES[(inv.periodMonth ?? 1) - 1]} ${inv.periodYear}`, year: inv.periodYear, month: inv.periodMonth });
    }
  }

  const [selectedKey, setSelectedKey] = useState(monthGroups[0]?.key ?? "");
  const selectedGroup = monthGroups.find(g => g.key === selectedKey);
  const selectedInvoice = invoiceOptions.find(inv => inv.periodYear === selectedGroup?.year && inv.periodMonth === selectedGroup?.month);

  const todayRate = Number(data.todayRate);
  const isPaid = selectedInvoice?.status === "PAID";
  const pendingUsd = selectedInvoice ? Number(selectedInvoice.totalUsd) - Number(selectedInvoice.paidUsd) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Facturas / Cánones</h2>
          <div className="mt-1 h-0.5 w-16 bg-blue-600" />
        </div>
        {monthGroups.length > 0 && (
          <select
            className="rounded-lg border px-3 py-2 text-sm bg-white font-medium"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            {monthGroups.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
        )}
      </div>

      {!selectedInvoice && <p className="py-8 text-center text-muted-foreground">Sin facturas disponibles.</p>}

      {selectedInvoice && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          {/* Acciones */}
          <div className="flex justify-end gap-2 p-3 border-b">
            <DownloadFacturaButton token={token} invoiceId={selectedInvoice.id} invoiceNumber={selectedInvoice.invoiceNumber} />
            <button onClick={() => window.print()} className="rounded border px-3 py-1 text-sm hover:bg-muted">🖨️ Imprimir</button>
          </div>

          {/* Contenido de la factura */}
          <div className="p-5 space-y-4 text-sm print:p-2">
            {/* Membrete */}
            <div className="text-center">
              <p className="font-bold text-base uppercase tracking-wide text-slate-800">{data.mall.name.toUpperCase()}</p>
              {data.mall.rif && <p className="text-xs text-muted-foreground">R.I.F.: {data.mall.rif}</p>}
              {data.mall.address && <p className="text-xs text-muted-foreground">{data.mall.address}{data.mall.city ? `, ${data.mall.city}` : ""}</p>}
              <p className="text-center text-base font-bold text-slate-800 mt-2">Factura Nro. {selectedInvoice.invoiceNumber}</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              {/* Izquierda: arrendatario + ítems */}
              <div>
                <div className="grid grid-cols-2 mb-3 gap-2">
                  <div className="rounded border">
                    <div className="bg-slate-800 px-3 py-1 text-center text-xs font-semibold text-white uppercase">Arrendatario</div>
                    <div className="px-3 py-2 text-center font-medium text-xs">
                      {data.tenancy.tenantName}
                      {data.tenancy.tenantRif && <><br /><span className="text-muted-foreground">{data.tenancy.tenantRif}</span></>}
                    </div>
                  </div>
                  <div className="rounded border">
                    <div className="bg-slate-800 px-3 py-1 text-center text-xs font-semibold text-white uppercase">Local</div>
                    <div className="px-3 py-2 text-center font-medium">
                      {data.local.code}{data.local.name ? ` — ${data.local.name}` : ""}
                      {data.local.floor != null && <><br /><span className="text-xs text-muted-foreground">Piso {data.local.floor}</span></>}
                    </div>
                  </div>
                </div>

                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="px-3 py-1.5 text-left font-semibold">DESCRIPCIÓN</th>
                      <th className="px-3 py-1.5 text-right font-semibold">USD</th>
                      <th className="px-3 py-1.5 text-right font-semibold">BS.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.items.map((it, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="px-3 py-1 border-b border-slate-100">{it.description}</td>
                        <td className="px-3 py-1 border-b border-slate-100 text-right">{fmt(it.amountUsd)}</td>
                        <td className="px-3 py-1 border-b border-slate-100 text-right text-muted-foreground">{fmt(it.amountBss)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800/10 font-semibold">
                      <td className="px-3 py-1.5">TOTAL</td>
                      <td className="px-3 py-1.5 text-right">{fmt(selectedInvoice.totalUsd)}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{fmt(selectedInvoice.totalBss)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Derecha: resumen */}
              <div className="w-full lg:w-64 space-y-3 shrink-0">
                <div className="rounded border overflow-hidden">
                  <div className="bg-slate-800 px-3 py-1 text-center text-xs font-semibold text-white uppercase">Período</div>
                  <div className="px-3 py-2 text-center">
                    <p className="font-bold">{MESES[(selectedInvoice.periodMonth ?? 1) - 1]} {selectedInvoice.periodYear}</p>
                    <p className="text-xs text-muted-foreground">Emitida: {new Date(selectedInvoice.issuedAt).toLocaleDateString("es-VE")}</p>
                    <p className="text-xs text-muted-foreground">Vence: {new Date(selectedInvoice.dueDate).toLocaleDateString("es-VE")}</p>
                  </div>
                </div>

                <div className="rounded border overflow-hidden">
                  <div className="bg-slate-800 px-3 py-1 text-center text-xs font-semibold text-white uppercase">Total a pagar</div>
                  <table className="w-full text-xs">
                    <tbody>
                      <tr className="border-b">
                        <td className="px-3 py-1 text-muted-foreground">Total</td>
                        <td className="px-3 py-1 text-right font-medium">${fmt(selectedInvoice.totalUsd)}</td>
                      </tr>
                      {Number(selectedInvoice.paidUsd) > 0 && (
                        <tr className="border-b">
                          <td className="px-3 py-1 text-green-700">Pagado</td>
                          <td className="px-3 py-1 text-right font-medium text-green-700">−${fmt(selectedInvoice.paidUsd)}</td>
                        </tr>
                      )}
                      <tr className={`font-bold ${isPaid ? "bg-green-50" : "bg-slate-800/10"}`}>
                        <td className="px-3 py-2">PENDIENTE</td>
                        <td className={`px-3 py-2 text-right ${isPaid ? "text-green-700" : "text-slate-800"}`}>
                          ${fmt(pendingUsd)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="rounded border px-3 py-2 text-center text-xs">
                  <span className="text-muted-foreground">Estado: </span>
                  <span className={`font-semibold ${
                    selectedInvoice.status === "PAID" ? "text-green-700"
                    : selectedInvoice.status === "OVERDUE" ? "text-red-600"
                    : selectedInvoice.status === "PARTIAL" ? "text-amber-700" : "text-blue-700"}`}>
                    {STATUS_LABEL[selectedInvoice.status] ?? selectedInvoice.status}
                  </span>
                </div>

                {todayRate > 1 && (
                  <div className="rounded border px-3 py-2 text-center text-xs bg-slate-50">
                    <p className="text-muted-foreground">Tasa BCV ({data.todayRateSource})</p>
                    <p className="font-bold">Bs. {fmt(todayRate)} / USD</p>
                  </div>
                )}
              </div>
            </div>

            {/* Instrucciones de pago */}
            {!isPaid && data.mall.paymentInstructions && (
              <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 text-xs mt-3">
                <p className="font-semibold text-blue-800 mb-1">¿CÓMO PAGAR?</p>
                <pre className="whitespace-pre-wrap text-blue-700 font-sans">{data.mall.paymentInstructions}</pre>
                <p className="text-blue-600 font-medium mt-2">Incluya el número de factura {selectedInvoice.invoiceNumber} en el concepto del pago.</p>
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground pt-2 border-t">
              {data.mall.name}{data.mall.phone ? ` · Tel: ${data.mall.phone}` : ""}{data.mall.email ? ` · ${data.mall.email}` : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Notificar Pago ─────────────────────────────────────────────────────
function NotificarTab({ data, token }: { data: NonNullable<PortalData>; token: string }) {
  const notify = trpc.comercial.portal.notifyPayment.useMutation();
  const [form, setForm] = useState({
    method: "TRANSFER_USD",
    amountUsd: "",
    reference: "",
    bankName: "",
    fechaPago: new Date().toISOString().split("T")[0]!,
    notes: "",
  });
  const [done, setDone] = useState(false);

  const pendingUsd = Number(data.summary.totalPendingUsd);
  const hasPending = pendingUsd > 0.005;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await notify.mutateAsync({
      token,
      method: form.method,
      amountUsd: parseFloat(form.amountUsd),
      reference: form.reference || undefined,
      bankName: form.bankName || undefined,
      notes: (form.fechaPago ? `Fecha del pago: ${form.fechaPago}. ` : "") + (form.notes || ""),
    });
    setDone(true);
  };

  const resetForm = () => {
    setDone(false);
    setForm({ method: "TRANSFER_USD", amountUsd: "", reference: "", bankName: "", fechaPago: new Date().toISOString().split("T")[0]!, notes: "" });
  };

  if (done) return (
    <div className="rounded-xl border bg-green-50 border-green-200 px-6 py-10 text-center space-y-3">
      <p className="text-4xl">✅</p>
      <p className="text-xl font-semibold text-green-800">Pago notificado correctamente</p>
      <p className="text-sm text-green-700">La administración del mall recibió tu notificación y verificará el pago a la brevedad.</p>
      <button onClick={resetForm} className="mt-4 text-sm underline text-green-800">Notificar otro pago</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Notificar un pago realizado</h2>
        <div className="mt-1 h-0.5 w-16 bg-blue-600" />
        <p className="text-sm text-muted-foreground mt-1">
          Ingresa los datos de tu transacción para informar a la administración del centro comercial.
        </p>
      </div>

      {/* Estado */}
      <div className={`rounded-lg border px-4 py-3 text-sm ${hasPending ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
        {hasPending ? (
          <><span className="font-semibold">Saldo pendiente: US$ {fmt(pendingUsd)}</span>
          <span className="text-amber-700"> — Su pago se aplicará a las facturas más antiguas.</span></>
        ) : (
          <><span className="font-semibold">✓ Sin deuda pendiente.</span>
          <span className="text-green-700"> Su pago se registrará como anticipo.</span></>
        )}
      </div>

      <div className="rounded-xl border bg-white shadow-sm p-6 max-w-lg">
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div>
            <Label>Método de pago *</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-1"
              value={form.method} onChange={(e) => setForm(f => ({ ...f, method: e.target.value }))}>
              {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto USD *</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="0.00" required
                value={form.amountUsd} onChange={(e) => setForm(f => ({ ...f, amountUsd: e.target.value }))} />
            </div>
            <div>
              <Label>Fecha del pago *</Label>
              <Input type="date" required value={form.fechaPago} onChange={(e) => setForm(f => ({ ...f, fechaPago: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Número de referencia</Label>
              <Input placeholder="Ej. 00123456" value={form.reference} onChange={(e) => setForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div>
              <Label>Banco / entidad emisora</Label>
              <Input placeholder="Ej. Banesco, Zelle..." value={form.bankName} onChange={(e) => setForm(f => ({ ...f, bankName: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Observaciones (opcional)</Label>
            <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={2}
              placeholder="Ej: pago de feb y mar, transferencia en dos partes..."
              value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          {notify.isError && (
            <p className="text-sm text-destructive">Error al enviar. Por favor intenta de nuevo.</p>
          )}
          <Button type="submit" disabled={notify.isPending || !form.amountUsd || parseFloat(form.amountUsd) <= 0}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white py-3 text-base font-semibold">
            {notify.isPending ? "Enviando..." : "Notificar pago"}
          </Button>
        </form>
      </div>

      {/* Instrucciones de pago */}
      {data.mall.paymentInstructions && (
        <div className="rounded-xl border bg-blue-50 border-blue-200 p-4 space-y-2 max-w-lg">
          <p className="text-sm font-semibold text-blue-800">💳 Datos bancarios del mall</p>
          <pre className="text-xs text-blue-700 whitespace-pre-wrap font-sans">{data.mall.paymentInstructions}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Deuda del Mall ──────────────────────────────────────────────────────
function MallDeudaTab({ token, data }: { token: string; data: NonNullable<PortalData> }) {
  const { data: mallDebt, isLoading } = trpc.comercial.portal.getMallDebt.useQuery({ token });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Cargando deuda general del mall…</div>;
  if (!mallDebt) return null;

  const totalUsd = Number(mallDebt.totalPendingUsd);
  const myPendingUsd = Number(data.summary.totalPendingUsd);
  const myShare = totalUsd > 0 ? (myPendingUsd / totalUsd) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Deuda General — {data.mall.name}</h2>
        <div className="mt-1 h-0.5 w-16 bg-blue-600" />
        <p className="text-sm text-blue-700 mt-1">US$ {fmt(totalUsd)} pendiente en todos los locales.</p>
      </div>

      {/* Mi participación */}
      {totalUsd > 0 && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Tu posición — Local {data.local.code}
          </p>
          <div className="grid grid-cols-3 gap-3 text-center mb-4">
            <div className="rounded-lg bg-slate-800/5 p-3">
              <p className="text-[10px] text-muted-foreground">Deuda total mall</p>
              <p className="text-lg font-bold text-slate-800">US$ {fmt(totalUsd)}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-[10px] text-muted-foreground">Tu deuda</p>
              <p className="text-lg font-bold text-blue-700">US$ {fmt(myPendingUsd)}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-[10px] text-muted-foreground">Tu % del total</p>
              <p className="text-lg font-bold text-amber-700">{myShare.toFixed(2)}%</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Tu parte ({myShare.toFixed(2)}%)</span>
              <span>US$ {fmt(myPendingUsd)} / US$ {fmt(totalUsd)}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-2.5 rounded-full bg-blue-600 transition-all" style={{ width: `${Math.min(myShare, 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Pie chart aging */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={mallDebt.agingBuckets.filter(b => b.usd > 0)}
              dataKey="usd" nameKey="label" cx="50%" cy="50%" outerRadius={110}
              label={({ name, value }: { name?: string; value?: number }) =>
                (value ?? 0) > 0 ? `${name ?? ""} ($${Number(value ?? 0).toFixed(0)})` : ""}
              labelLine={false}
            >
              {mallDebt.agingBuckets.filter(b => b.usd > 0).map((_, index) => (
                <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, ""]} />
            <Legend formatter={(value: string) => value} />
          </PieChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-1">
          <span className="font-semibold">Deuda del mall agrupada por antigüedad:</span> muestra qué tan atrasada está la cartera.
        </p>
      </div>

      {/* Tabla locales */}
      <div>
        <h3 className="text-xl font-bold">Estado por Local</h3>
        <p className="text-sm text-blue-700">Expresado en US$</p>
        <div className="mt-2 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white text-left">
                <th className="px-4 py-2 font-semibold">Local</th>
                <th className="px-4 py-2 font-semibold hidden sm:table-cell">Arrendatario</th>
                <th className="px-4 py-2 font-semibold text-right">Deuda US$</th>
                <th className="px-4 py-2 font-semibold text-right">Meses vencida</th>
              </tr>
            </thead>
            <tbody>
              {mallDebt.locales.filter(l => Number(l.pendingUsd) > 0.005).map((l, i) => (
                <tr key={l.localCode} className={`border-t ${i % 2 === 0 ? "" : "bg-slate-50"} ${l.localCode === data.local.code ? "bg-blue-50 font-semibold" : ""}`}>
                  <td className="px-4 py-2">
                    {l.localCode}
                    {l.localName && <span className="text-muted-foreground text-xs ml-1">— {l.localName}</span>}
                    {l.localCode === data.local.code && <span className="ml-2 text-xs bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded">Tú</span>}
                  </td>
                  <td className="px-4 py-2 hidden sm:table-cell text-muted-foreground">{l.tenantName ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmt(l.pendingUsd)}</td>
                  <td className="px-4 py-2 text-right">{l.overdueMonths}</td>
                </tr>
              ))}
              {mallDebt.locales.filter(l => Number(l.pendingUsd) > 0.005).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-green-700 font-medium">✅ Sin locales con deuda pendiente</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard principal ──────────────────────────────────────────────────────
function PortalDashboard({ data, token }: { data: NonNullable<PortalData>; token: string }) {
  const [tab, setTab] = useState<TabKey>("principal");

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Top bar */}
      <div className="bg-slate-800 text-white">
        <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-300 uppercase tracking-wider">{data.mall.name}</span>
          <div className="flex items-center gap-4">
            <span className="text-slate-300">{data.tenancy.tenantName}</span>
            <span className="font-bold">Local {data.local.code}{data.local.name ? ` — ${data.local.name}` : ""}</span>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="bg-blue-800 shadow">
        <div className="mx-auto max-w-5xl px-4 flex overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`whitespace-nowrap px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? "border-white text-white bg-white/10"
                  : "border-transparent text-blue-200 hover:text-white hover:bg-white/5"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-4 py-6">
        {tab === "principal"  && <PrincipalTab  data={data} onTab={setTab} />}
        {tab === "pendientes" && <PendientesTab data={data} />}
        {tab === "pagos"      && <PagosTab      data={data} token={token} />}
        {tab === "factura"    && <FacturaTab    data={data} token={token} />}
        {tab === "notificar"  && <NotificarTab  data={data} token={token} />}
        {tab === "mall"       && <MallDeudaTab  token={token} data={data} />}
      </div>

      {/* Footer */}
      <div className="border-t bg-white py-4 text-center text-xs text-muted-foreground">
        Portal de {data.mall.name} · Acceso exclusivo para arrendatarios
      </div>
    </div>
  );
}

// ─── Content wrapper ──────────────────────────────────────────────────────────
function PortalContent({ token }: { token: string }) {
  const portalQ = usePortalData(token);

  if (portalQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Cargando portal...</p>
        </div>
      </div>
    );
  }

  if (portalQ.isError) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Card className="w-full max-w-md">
          <CardContent className="py-10 text-center">
            <p className="text-4xl mb-4">🔒</p>
            <p className="font-semibold text-red-600 mb-2">Enlace inválido o expirado</p>
            <p className="text-sm text-muted-foreground">
              Este enlace no es válido o ha expirado. Solicite a la administración del centro comercial un nuevo enlace.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!portalQ.data) return null;
  return <PortalDashboard data={portalQ.data} token={token} />;
}

// ─── Token loader ─────────────────────────────────────────────────────────────
function TokenLoader() {
  const params = useSearchParams();
  const token = params.get("token");

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Portal del Arrendatario</CardTitle></CardHeader>
          <CardContent className="py-8 text-center">
            <p className="text-4xl mb-4">🔗</p>
            <p className="font-semibold mb-2">Enlace incompleto</p>
            <p className="text-sm text-muted-foreground">
              Acceda a este portal mediante el enlace proporcionado por la administración del centro comercial.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <PortalContent token={token} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PortalCcPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <TokenLoader />
    </Suspense>
  );
}
