"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { SearchableSelect } from "@/components/SearchableSelect";

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  ISSUED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  VOIDED: "bg-gray-100 text-gray-400 line-through",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador", ISSUED: "Emitida", PARTIAL: "Parcial", PAID: "Pagada", OVERDUE: "Vencida", VOIDED: "Anulada",
};
const TYPE_LABEL: Record<string, string> = {
  CANON: "Canon", CANON_SALES: "Canon s/ventas", ALIQUOT: "Alícuota", EXTRA_FEE: "Cargo extra", FINE: "Multa", OTHER: "Otro",
};

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function FacturasPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const now = new Date();
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showNew, setShowNew] = useState(false);

  const invoicesQ = trpc.comercial.invoices.list.useQuery(
    { organizationId: selectedOrgId, mallId, periodYear, periodMonth, ...(statusFilter !== "ALL" ? { status: statusFilter as "ISSUED" } : {}) },
    { enabled: !!mallId },
  );
  const invoices = invoicesQ.data ?? [];

  const localesQ = trpc.comercial.locales.list.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: !!mallId },
  );

  const [form, setForm] = useState({
    localId: "", type: "CANON", description: "Canon de arrendamiento",
    amountUsd: "", exchangeRate: "", notes: "", dueDaysAfterIssue: "5",
  });
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [bulkDueDays, setBulkDueDays] = useState("5");
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const exchangeQ = trpc.finance.exchange.current.useQuery({ organizationId: selectedOrgId });
  const rateToday = exchangeQ.data?.vesPerUsd ? Number(exchangeQ.data.vesPerUsd) : 1; // tmp ?? 1;

  const issueMut = trpc.comercial.invoices.issueCanon.useMutation({
    onSuccess: () => { void invoicesQ.refetch(); setShowNew(false); },
  });

  const bulkMut = trpc.comercial.invoices.bulkIssueCanon.useMutation({
    onSuccess: (res) => {
      void invoicesQ.refetch();
      setShowBulkDialog(false);
      const emailMsg = res.emailsSent > 0 ? ` · ${res.emailsSent} emails enviados` : "";
      setBulkResult(`✅ ${res.issued} emitidas, ${res.skipped} ya existían, ${res.errors} errores${emailMsg}.`);
      setTimeout(() => setBulkResult(null), 6000);
    },
  });

  const voidMut = trpc.comercial.invoices.void.useMutation({
    onSuccess: () => void invoicesQ.refetch(),
  });

  const pdfMut = trpc.comercial.invoices.downloadPdf.useMutation({
    onSuccess: (result) => {
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const emailMut = trpc.comercial.invoices.sendByEmail.useMutation({
    onSuccess: (r) => alert(`✅ Email enviado a ${r.to}`),
    onError: (e) => alert(`❌ ${e.message}`),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // #2 — Tasa calculada server-side desde la fecha de emisión.
    await issueMut.mutateAsync({
      organizationId: selectedOrgId,
      mallId,
      localId: form.localId,
      periodYear,
      periodMonth,
      amount: parseFloat(form.amountUsd),
      type: form.type as "CANON",
      description: form.description,
      dueDaysAfterIssue: parseInt(form.dueDaysAfterIssue),
      notes: form.notes || undefined,
    });
  };

  const totalPending = invoices.filter(i => ["ISSUED","PARTIAL","OVERDUE"].includes(i.status))
    .reduce((s, i) => s + Number(i.totalUsd) - Number(i.paidUsd), 0);
  const totalPaid = invoices.filter(i => i.status === "PAID").reduce((s, i) => s + Number(i.totalUsd), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">🧾 Facturas / Canon</h1>
          <p className="text-muted-foreground text-sm">
            {invoices.length} facturas ·{" "}
            Pendiente: <span className="font-medium text-orange-600">Bs {fmt(totalPending * rateToday)}</span>
            <span className="text-xs"> (≈${fmt(totalPending)})</span> ·{" "}
            Cobrado: <span className="font-medium text-green-600">Bs {fmt(totalPaid * rateToday)}</span>
            <span className="text-xs"> (≈${fmt(totalPaid)})</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {bulkResult && <span className="text-sm text-green-700 font-medium">{bulkResult}</span>}
          <Button variant="outline" disabled={bulkMut.isPending || !mallId}
            onClick={() => setShowBulkDialog(true)}>
            {bulkMut.isPending ? "Emitiendo..." : "⚡ Canon masivo"}
          </Button>
          <Button onClick={() => setShowNew(true)} className="bg-blue-600 hover:bg-blue-700">+ Emitir factura</Button>
        </div>
      </div>

      {/* Filtros período */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Año</Label>
          <select value={periodYear} onChange={(e) => setPeriodYear(parseInt(e.target.value))}
            className="rounded-md border bg-background px-2 py-1 text-sm">
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Mes</Label>
          <select value={periodMonth} onChange={(e) => setPeriodMonth(parseInt(e.target.value))}
            className="rounded-md border bg-background px-2 py-1 text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{new Date(2025, m - 1).toLocaleDateString("es-VE", { month: "long" })}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-1">
          {["ALL", "ISSUED", "PARTIAL", "PAID", "OVERDUE"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
              {s === "ALL" ? "Todos" : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      {invoicesQ.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : invoices.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No hay facturas para este período.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">N° Factura</th>
                <th className="text-left px-4 py-3">Local</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Tipo</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Abonado</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Vence</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-accent/30">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 font-medium">{inv.local?.code ?? "—"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">{TYPE_LABEL[inv.type] ?? inv.type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[inv.status] ?? ""}`}>
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    <div>Bs {fmt(Number(inv.totalBss))}</div>
                    <div className="text-[10px] text-muted-foreground">≈ ${fmt(Number(inv.totalUsd))}</div>
                  </td>
                  <td className="px-4 py-3 text-right hidden md:table-cell text-green-700">
                    {Number(inv.paidUsd) > 0 ? (
                      <>
                        <div>Bs {fmt(Number(inv.paidBss))}</div>
                        <div className="text-[10px] text-muted-foreground">≈ ${fmt(Number(inv.paidUsd))}</div>
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell text-xs text-muted-foreground">
                    {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => void pdfMut.mutateAsync({ organizationId: selectedOrgId, invoiceId: inv.id })}
                        disabled={pdfMut.isPending}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-40"
                        title="Descargar PDF">
                        📄 PDF
                      </button>
                      <button
                        onClick={() => void emailMut.mutateAsync({ organizationId: selectedOrgId, invoiceId: inv.id })}
                        disabled={emailMut.isPending}
                        className="text-xs text-purple-600 hover:underline disabled:opacity-40"
                        title="Enviar por email">
                        ✉️
                      </button>
                      {inv.status !== "VOIDED" && (
                        <button
                          onClick={() => {
                            const motivo = prompt(`Anular factura ${inv.invoiceNumber}\n\nMotivo (obligatorio, mínimo 3 caracteres):`);
                            if (!motivo) return;
                            if (motivo.trim().length < 3) {
                              alert("El motivo debe tener al menos 3 caracteres.");
                              return;
                            }
                            if (!confirm(`¿Anular ${inv.invoiceNumber}?\n\nLa factura queda registrada en auditoría como ANULADA. Si tenía pagos aplicados, esos pagos quedarán como anticipo.`)) return;
                            void voidMut.mutateAsync({ organizationId: selectedOrgId, invoiceId: inv.id, voidReason: motivo.trim() });
                          }}
                          className="text-xs text-destructive hover:underline disabled:opacity-40 whitespace-nowrap"
                          title="Anular esta factura (queda registrada en auditoría)"
                        >
                          🗑️ Anular
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog emitir */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold">🧾 Emitir factura de canon</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Período: {new Date(periodYear, periodMonth - 1).toLocaleDateString("es-VE", { month: "long", year: "numeric" })}
              </p>
            </div>
            <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-3">
              <div className="space-y-1">
                <Label>Local *</Label>
                <SearchableSelect
                  value={form.localId}
                  onChange={(v) => setForm({ ...form, localId: v })}
                  options={(localesQ.data ?? []).map((l) => ({ value: l.id, label: `${l.code}${l.name ? ` — ${l.name}` : ""}` }))}
                  placeholder="Selecciona un local..."
                  emptyText="Sin locales disponibles"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                    <option value="CANON">Canon</option>
                    <option value="CANON_SALES">Canon s/ventas</option>
                    <option value="ALIQUOT">Alícuota gastos comunes</option>
                    <option value="EXTRA_FEE">Cargo extraordinario</option>
                    <option value="FINE">Multa</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Días para vencer</Label>
                  <Input type="number" value={form.dueDaysAfterIssue} onChange={(e) => setForm({ ...form, dueDaysAfterIssue: e.target.value })} min={1} />
                </div>
                <div className="space-y-1">
                  <Label>Monto (USD) *</Label>
                  <Input type="number" value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} placeholder="500.00" step="0.01" required />
                </div>
                <div className="space-y-1">
                  <Label>Tasa BCV</Label>
                  <Input type="number" value={form.exchangeRate || rateToday.toFixed(2)} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} step="0.01" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Descripción</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Notas</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
                <Button type="submit" disabled={issueMut.isPending || !form.localId || !form.amountUsd} className="bg-blue-600 hover:bg-blue-700">
                  {issueMut.isPending ? "Emitiendo..." : "✓ Emitir factura"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dialog: Canon masivo */}
      {showBulkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-card shadow-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">⚡ Emitir canon masivo</h2>
            <p className="text-sm text-muted-foreground">
              Se emitirá el canon de <strong>{new Date(periodYear, periodMonth-1).toLocaleDateString("es-VE",{month:"long",year:"numeric"})}</strong> a todos los locales con canon fijo activos. Los arrendatarios con email configurado recibirán la factura automáticamente.
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Tasa BCV aplicada (Bs/$)</Label>
                <p className="text-sm font-medium">{rateToday.toFixed(4)}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Días para vencimiento desde hoy</Label>
                <Input type="number" min={1} max={90} value={bulkDueDays}
                  onChange={(e) => setBulkDueDays(e.target.value)} />
                <p className="text-xs text-muted-foreground">Por defecto: 5 días</p>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setShowBulkDialog(false)}>Cancelar</Button>
              <Button
                disabled={bulkMut.isPending}
                className="bg-blue-600 hover:bg-blue-700"
                onClick={() => void bulkMut.mutateAsync({
                  organizationId: selectedOrgId,
                  mallId,
                  periodYear,
                  periodMonth,
                  dueDaysAfterIssue: parseInt(bulkDueDays) || 5,
                })}>
                {bulkMut.isPending ? "Emitiendo..." : "✓ Confirmar emisión"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
