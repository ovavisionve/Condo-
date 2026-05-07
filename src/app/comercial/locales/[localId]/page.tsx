"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../../ComercialContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const CANON_LABEL: Record<string, string> = { FIXED: "Canon fijo", VARIABLE_SALES: "% ventas", MIXED: "Mixto" };
const LOCAL_TYPE_LABEL: Record<string, string> = {
  LOCAL: "Local", ANCORA: "Áncora", FOOD_COURT: "Food Court", RESTAURANT: "Restaurante",
  BANCO: "Banco/Taquilla", CINE: "Cine", QUIOSCO: "Quiosco", OFICINA: "Oficina", OTHER: "Otro",
};
const STATUS_COLOR: Record<string, string> = {
  ISSUED: "bg-blue-100 text-blue-700", PARTIAL: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700", OVERDUE: "bg-red-100 text-red-700",
  DRAFT: "bg-gray-100 text-gray-600", VOIDED: "bg-gray-100 text-gray-400",
};
const STATUS_LABEL: Record<string, string> = {
  ISSUED: "Emitida", PARTIAL: "Parcial", PAID: "Pagada", OVERDUE: "Vencida", DRAFT: "Borrador", VOIDED: "Anulada",
};
const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD", TRANSFER_BSS: "Trans. Bs",
  TRANSFER_USD: "Trans. USD", ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil", CRYPTO: "Crypto", CHECK: "Cheque", OTHER: "Otro",
};

export default function LocalDetailPage({ params }: { params: { localId: string } }) {
  const { localId } = params;
  const { selectedOrgId } = useComercial();
  const [tab, setTab] = useState<"facturas" | "pagos" | "ventas" | "contratos" | "estado">("facturas");
  const [stmtView, setStmtView] = useState<"statement" | "debt-breakdown" | "accounting">("statement");
  const [showTerminate, setShowTerminate] = useState(false);
  const [terminateDate, setTerminateDate] = useState(new Date().toISOString().split("T")[0]!);

  const localQ = trpc.comercial.locales.byId.useQuery({ organizationId: selectedOrgId, localId });
  const local = localQ.data;

  const exchangeQ = trpc.finance.exchange.current.useQuery({ organizationId: selectedOrgId });
  const rateToday = exchangeQ.data?.vesPerUsd ? Number(exchangeQ.data.vesPerUsd) : 1;

  const terminateMut = trpc.comercial.tenancies.terminate.useMutation({
    onSuccess: () => { void localQ.refetch(); setShowTerminate(false); },
  });

  if (localQ.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-32 bg-muted rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!local) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Local no encontrado.</p>
        <Link href="/comercial/locales" className="text-blue-600 underline text-sm mt-2 inline-block">← Volver a locales</Link>
      </div>
    );
  }

  const activeTenancy = local.tenancies.find((t) => !t.endDate);

  // ── Estado de cuenta: filas contables ──────────────────────────────────────
  type AccountingRow = { date: Date; label: string; debe: number; haber: number; saldo: number; type: "invoice" | "payment" };
  const accountingRows: AccountingRow[] = (() => {
    const rows: Omit<AccountingRow, "saldo">[] = [];
    for (const inv of local.invoices) {
      if (inv.status === "VOIDED") continue;
      rows.push({ date: new Date(inv.issuedAt), label: `Factura ${inv.invoiceNumber} — ${MESES_ES[inv.periodMonth - 1]} ${inv.periodYear}`, debe: Number(inv.totalUsd), haber: 0, type: "invoice" });
    }
    for (const p of local.payments) {
      rows.push({ date: new Date(p.paidAt), label: `Pago — ${METHOD_LABEL[p.method] ?? p.method}${p.reference ? ` · ${p.reference}` : ""}`, debe: 0, haber: Number(p.amountUsd), type: "payment" });
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    let saldo = 0;
    return rows.map((r) => { saldo += r.debe - r.haber; return { ...r, saldo }; });
  })();

  // ── Deuda por mes ──────────────────────────────────────────────────────────
  type DebtMonth = { period: string; totalUsd: number; paidUsd: number; pendingUsd: number; dueDate: Date; daysOverdue: number; status: string };
  const today = new Date();
  const debtByMonth: DebtMonth[] = local.invoices
    .filter((i) => ["ISSUED","PARTIAL","OVERDUE"].includes(i.status))
    .map((i) => {
      const due = new Date(i.dueDate);
      const daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
      return {
        period: `${MESES_ES[i.periodMonth - 1]} ${i.periodYear}`,
        totalUsd: Number(i.totalUsd),
        paidUsd: Number(i.paidUsd),
        pendingUsd: Number(i.totalUsd) - Number(i.paidUsd),
        dueDate: due,
        daysOverdue,
        status: i.status,
      };
    })
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const pendingDebt = local.invoices
    .filter((i) => ["ISSUED", "PARTIAL", "OVERDUE"].includes(i.status))
    .reduce((s, i) => s + Number(i.totalUsd) - Number(i.paidUsd), 0);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/comercial/locales" className="hover:text-foreground">← Locales</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{local.code}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{local.code}{local.name ? ` — ${local.name}` : ""}</h1>
          <div className="flex flex-wrap gap-3 mt-1 text-sm text-muted-foreground">
            <span>{LOCAL_TYPE_LABEL[local.type] ?? local.type}</span>
            {local.floor && <span>· Piso {local.floor}</span>}
            {local.wing && <span>· Ala {local.wing}</span>}
            {local.areaM2 && <span>· {Number(local.areaM2).toFixed(0)} m²</span>}
          </div>
        </div>
        <div className="flex-shrink-0">
          {activeTenancy ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-3 py-1 text-sm font-medium">
              ✅ Ocupado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-3 py-1 text-sm font-medium">
              🔴 Desocupado
            </span>
          )}
        </div>
      </div>

      {/* KPIs rápidos */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Canon</p>
            <p className="text-xl font-bold mt-1">
              {local.canonType === "FIXED" && local.canonUsd ? `$${fmt(Number(local.canonUsd))}/mes` :
               local.canonType === "VARIABLE_SALES" && local.salesPct ? `${Number(local.salesPct).toFixed(2)}% ventas` :
               local.canonType === "MIXED" ? `$${fmt(Number(local.canonUsd ?? 0))} + ${Number(local.salesPct ?? 0).toFixed(2)}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{CANON_LABEL[local.canonType]}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Deuda pendiente</p>
            <p className={`text-xl font-bold mt-1 ${pendingDebt > 0 ? "text-red-600" : "text-green-600"}`}>${fmt(pendingDebt)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{local.invoices.filter(i => ["ISSUED","PARTIAL","OVERDUE"].includes(i.status)).length} facturas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total cobrado</p>
            <p className="text-xl font-bold mt-1 text-green-600">${fmt(local.payments.reduce((s, p) => s + Number(p.amountUsd), 0))}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{local.payments.length} pagos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Alícuota</p>
            <p className="text-xl font-bold mt-1">{local.aliquot ? `${Number(local.aliquot).toFixed(4)}%` : "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Gastos comunes</p>
          </CardContent>
        </Card>
      </div>

      {/* Arrendatario activo */}
      {activeTenancy && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">🤝 Arrendatario activo</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm font-semibold">{activeTenancy.tenantName}</p>
              {activeTenancy.tenantRif && <p className="text-xs text-muted-foreground">RIF: {activeTenancy.tenantRif}</p>}
              {activeTenancy.tenantContact && <p className="text-xs text-muted-foreground">Rep.: {activeTenancy.tenantContact}</p>}
            </div>
            <div>
              {activeTenancy.tenantEmail && <p className="text-xs">📧 {activeTenancy.tenantEmail}</p>}
              {activeTenancy.tenantPhone && <p className="text-xs">📱 {activeTenancy.tenantPhone}</p>}
              <p className="text-xs text-muted-foreground mt-1">Desde: {new Date(activeTenancy.startDate).toLocaleDateString("es-VE")}</p>
              {activeTenancy.depositUsd && <p className="text-xs text-muted-foreground">Depósito: ${fmt(Number(activeTenancy.depositUsd))}</p>}
            </div>
            <div className="sm:col-span-2 flex gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowTerminate(true)}>
                Terminar contrato
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-0">
          {(["facturas", "pagos", "ventas", "contratos", "estado"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {t === "facturas" ? `🧾 Facturas (${local.invoices.length})` :
               t === "pagos" ? `💰 Pagos (${local.payments.length})` :
               t === "ventas" ? `📊 Ventas (${local.salesDeclarations.length})` :
               t === "contratos" ? `🤝 Contratos (${local.tenancies.length})` :
               "📊 Estado de cuenta"}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Facturas */}
      {tab === "facturas" && (
        <div>
          {local.invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No hay facturas registradas para este local.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3">N° Factura</th>
                    <th className="text-left px-4 py-3">Período</th>
                    <th className="text-left px-4 py-3">Estado</th>
                    <th className="text-right px-4 py-3">Total</th>
                    <th className="text-right px-4 py-3">Abonado</th>
                    <th className="text-right px-4 py-3 hidden md:table-cell">Vence</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {local.invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3 font-mono text-xs font-medium">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3 text-xs">
                        {new Date(inv.periodYear, inv.periodMonth - 1).toLocaleDateString("es-VE", { month: "long", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[inv.status] ?? ""}`}>
                          {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">${fmt(Number(inv.totalUsd))}</td>
                      <td className="px-4 py-3 text-right text-green-700">
                        {Number(inv.paidUsd) > 0 ? `$${fmt(Number(inv.paidUsd))}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell text-xs text-muted-foreground">
                        {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Pagos */}
      {tab === "pagos" && (
        <div>
          {local.payments.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No hay pagos registrados para este local.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3">Fecha</th>
                    <th className="text-left px-4 py-3">Método</th>
                    <th className="text-right px-4 py-3">Monto USD</th>
                    <th className="text-right px-4 py-3">Monto Bs</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Ref / Facturas</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {local.payments.map((p) => (
                    <tr key={p.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3 text-xs">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">${fmt(Number(p.amountUsd))}</td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">Bs {fmt(Number(p.amountBss))}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                        {p.reference && <span className="mr-2">{p.reference}</span>}
                        {p.allocations.length > 0 ? p.allocations.map(a => a.invoice?.invoiceNumber).join(", ") : "Anticipo"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Ventas */}
      {tab === "ventas" && (
        <div>
          {local.salesDeclarations.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No hay declaraciones de ventas para este local.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3">Período</th>
                    <th className="text-right px-4 py-3">Ventas USD</th>
                    <th className="text-right px-4 py-3 hidden md:table-cell">Canon estimado</th>
                    <th className="text-left px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {local.salesDeclarations.map((d) => {
                    const canon = local.salesPct ? Number(d.salesAmountUsd) * Number(local.salesPct) / 100 : null;
                    return (
                      <tr key={d.id} className="hover:bg-accent/30">
                        <td className="px-4 py-3 text-xs">
                          {new Date(d.periodYear, d.periodMonth - 1).toLocaleDateString("es-VE", { month: "long", year: "numeric" })}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">${fmt(Number(d.salesAmountUsd))}</td>
                        <td className="px-4 py-3 text-right hidden md:table-cell text-blue-700">
                          {canon ? `$${fmt(canon)}` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {d.verified
                            ? <span className="text-xs text-green-700 font-medium">✅ Verificada</span>
                            : <span className="text-xs text-yellow-700">⏳ Sin verificar</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Contratos (historial) */}
      {tab === "contratos" && (
        <div>
          {local.tenancies.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No hay contratos registrados para este local.</p>
          ) : (
            <div className="space-y-3">
              {local.tenancies.map((t) => (
                <Card key={t.id} className={t.endDate ? "opacity-70" : "border-green-200"}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{t.tenantName}</p>
                        {t.tenantRif && <p className="text-xs text-muted-foreground">{t.tenantRif}</p>}
                        {t.tenantContact && <p className="text-xs text-muted-foreground">{t.tenantContact}</p>}
                        {t.tenantEmail && <p className="text-xs">📧 {t.tenantEmail}</p>}
                        {t.tenantPhone && <p className="text-xs">📱 {t.tenantPhone}</p>}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>Desde: {new Date(t.startDate).toLocaleDateString("es-VE")}</p>
                        <p>{t.endDate ? `Hasta: ${new Date(t.endDate).toLocaleDateString("es-VE")}` : <span className="text-green-700 font-medium">Activo</span>}</p>
                        {t.canonUsd && <p className="mt-1 text-green-700 font-medium">${fmt(Number(t.canonUsd))}/mes</p>}
                        {t.depositUsd && <p>Depósito: ${fmt(Number(t.depositUsd))}</p>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Estado de cuenta */}
      {tab === "estado" && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Saldo deudor</p>
                <p className={`text-2xl font-bold mt-1 ${pendingDebt > 0 ? "text-red-600" : "text-green-600"}`}>
                  ${fmt(pendingDebt)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pendingDebt > 0 ? "Deuda pendiente" : "Al día ✅"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Equivalente en Bs</p>
                <p className="text-2xl font-bold mt-1">
                  {fmt(pendingDebt * rateToday)} Bs
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Tasa BCV: {fmt(rateToday)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Meses con deuda</p>
                <p className={`text-2xl font-bold mt-1 ${debtByMonth.length > 0 ? "text-orange-600" : "text-green-600"}`}>
                  {debtByMonth.length}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">facturas pendientes</p>
              </CardContent>
            </Card>
          </div>

          {/* Selector de vista */}
          <div className="flex rounded-lg border p-0.5 bg-muted/30 w-fit gap-0.5">
            {(["statement","debt-breakdown","accounting"] as const).map((v) => (
              <button key={v} onClick={() => setStmtView(v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  stmtView === v ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                {v === "statement" ? "📋 Estado clásico" : v === "debt-breakdown" ? "📅 Deuda por mes" : "📒 Libro contable"}
              </button>
            ))}
          </div>

          {/* Vista: Estado clásico */}
          {stmtView === "statement" && (
            <div className="space-y-3">
              {local.invoices.filter(i => i.status !== "VOIDED").length === 0 ? (
                <p className="text-muted-foreground text-sm py-4">No hay facturas registradas.</p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-3">N° Factura</th>
                        <th className="text-left px-4 py-3">Período</th>
                        <th className="text-left px-4 py-3">Estado</th>
                        <th className="text-right px-4 py-3">Total</th>
                        <th className="text-right px-4 py-3">Abonado</th>
                        <th className="text-right px-4 py-3">Pendiente</th>
                        <th className="text-right px-4 py-3 hidden md:table-cell">Vence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {local.invoices.filter(i => i.status !== "VOIDED").map((inv) => {
                        const pending = Number(inv.totalUsd) - Number(inv.paidUsd);
                        const isOverdue = new Date(inv.dueDate) < today && inv.status !== "PAID";
                        return (
                          <tr key={inv.id} className={isOverdue ? "bg-red-50/50" : "hover:bg-accent/20"}>
                            <td className="px-4 py-2.5 font-mono text-xs font-medium">{inv.invoiceNumber}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {MESES_ES[inv.periodMonth - 1]} {inv.periodYear}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[inv.status] ?? ""}`}>
                                {STATUS_LABEL[inv.status] ?? inv.status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right">${fmt(Number(inv.totalUsd))}</td>
                            <td className="px-4 py-2.5 text-right text-green-700">
                              {Number(inv.paidUsd) > 0 ? `$${fmt(Number(inv.paidUsd))}` : "—"}
                            </td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${pending > 0 ? (isOverdue ? "text-red-700" : "text-orange-600") : "text-green-700"}`}>
                              {pending > 0 ? `$${fmt(pending)}` : "—"}
                            </td>
                            <td className={`px-4 py-2.5 text-right text-xs hidden md:table-cell ${isOverdue ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
                              {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t text-xs font-semibold">
                      <tr>
                        <td colSpan={3} className="px-4 py-2.5">Total</td>
                        <td className="px-4 py-2.5 text-right">${fmt(local.invoices.filter(i => i.status !== "VOIDED").reduce((s, i) => s + Number(i.totalUsd), 0))}</td>
                        <td className="px-4 py-2.5 text-right text-green-700">${fmt(local.invoices.filter(i => i.status !== "VOIDED").reduce((s, i) => s + Number(i.paidUsd), 0))}</td>
                        <td className={`px-4 py-2.5 text-right ${pendingDebt > 0 ? "text-red-700" : "text-green-700"}`}>${fmt(pendingDebt)}</td>
                        <td className="hidden md:table-cell" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Vista: Deuda por mes */}
          {stmtView === "debt-breakdown" && (
            <div>
              {debtByMonth.length === 0 ? (
                <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
                  <p className="text-2xl mb-2">✅</p>
                  <p className="font-semibold text-green-800">Este local no tiene deuda pendiente</p>
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-3">Período</th>
                        <th className="text-left px-4 py-3">Estado</th>
                        <th className="text-right px-4 py-3">Canon</th>
                        <th className="text-right px-4 py-3">Abonado</th>
                        <th className="text-right px-4 py-3">Pendiente</th>
                        <th className="text-right px-4 py-3">Días mora</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {debtByMonth.map((dm, idx) => (
                        <tr key={idx} className={dm.daysOverdue > 0 ? "bg-red-50/40" : ""}>
                          <td className="px-4 py-3 font-medium">{dm.period}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[dm.status] ?? ""}`}>
                              {STATUS_LABEL[dm.status] ?? dm.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">${fmt(dm.totalUsd)}</td>
                          <td className="px-4 py-3 text-right text-green-700">
                            {dm.paidUsd > 0 ? `$${fmt(dm.paidUsd)}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-red-700">${fmt(dm.pendingUsd)}</td>
                          <td className={`px-4 py-3 text-right font-bold text-sm ${dm.daysOverdue > 30 ? "text-red-700" : dm.daysOverdue > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
                            {dm.daysOverdue > 0 ? dm.daysOverdue : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t text-xs font-semibold">
                      <tr>
                        <td colSpan={4} className="px-4 py-2.5">Total pendiente</td>
                        <td className="px-4 py-2.5 text-right text-red-700">${fmt(debtByMonth.reduce((s, d) => s + d.pendingUsd, 0))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Vista: Libro contable Debe/Haber */}
          {stmtView === "accounting" && (
            <div>
              {accountingRows.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4">No hay movimientos registrados.</p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800 text-white text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-3">Fecha</th>
                        <th className="text-left px-4 py-3">Descripción</th>
                        <th className="text-right px-4 py-3">Debe (cargo)</th>
                        <th className="text-right px-4 py-3">Haber (abono)</th>
                        <th className="text-right px-4 py-3">Saldo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {accountingRows.map((row, idx) => (
                        <tr key={idx} className={row.type === "payment" ? "bg-green-50/40" : "hover:bg-accent/20"}>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                            {row.date.toLocaleDateString("es-VE")}
                          </td>
                          <td className="px-4 py-2.5 text-xs">{row.label}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-red-700">
                            {row.debe > 0 ? `$${fmt(row.debe)}` : ""}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-green-700">
                            {row.haber > 0 ? `$${fmt(row.haber)}` : ""}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-bold ${row.saldo > 0 ? "text-red-700" : row.saldo < 0 ? "text-green-700" : "text-muted-foreground"}`}>
                            {row.saldo !== 0 ? `$${fmt(Math.abs(row.saldo))} ${row.saldo > 0 ? "D" : "H"}` : "$0.00"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-100 border-t">
                      <tr className="font-semibold text-sm">
                        <td colSpan={2} className="px-4 py-3">Totales</td>
                        <td className="px-4 py-3 text-right text-red-700">
                          ${fmt(accountingRows.reduce((s, r) => s + r.debe, 0))}
                        </td>
                        <td className="px-4 py-3 text-right text-green-700">
                          ${fmt(accountingRows.reduce((s, r) => s + r.haber, 0))}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${pendingDebt > 0 ? "text-red-700" : "text-green-700"}`}>
                          {accountingRows.length > 0 ? `$${fmt(Math.abs(accountingRows[accountingRows.length - 1]!.saldo))} ${pendingDebt > 0 ? "D" : "H"}` : "—"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  <p className="text-xs text-muted-foreground px-4 py-2 bg-muted/20 border-t">
                    D = Deudor (saldo a favor del CC) · H = Acreedor (saldo a favor del arrendatario)
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dialog terminar contrato */}
      {showTerminate && activeTenancy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-card shadow-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">⚠️ Terminar contrato</h2>
            <p className="text-sm text-muted-foreground">
              Se cerrará el contrato de <strong>{activeTenancy.tenantName}</strong> en el local <strong>{local.code}</strong>.
            </p>
            <div className="space-y-1">
              <Label>Fecha de terminación</Label>
              <Input type="date" value={terminateDate} onChange={(e) => setTerminateDate(e.target.value)} />
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setShowTerminate(false)}>Cancelar</Button>
              <Button className="bg-red-600 hover:bg-red-700"
                disabled={terminateMut.isPending}
                onClick={() => void terminateMut.mutateAsync({
                  organizationId: selectedOrgId,
                  tenancyId: activeTenancy.id,
                  endDate: new Date(terminateDate),
                })}>
                {terminateMut.isPending ? "Guardando..." : "Terminar contrato"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
