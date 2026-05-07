"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { SearchableSelect } from "@/components/SearchableSelect";

const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD", TRANSFER_BSS: "Transferencia Bs",
  TRANSFER_USD: "Transferencia USD", ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil",
  CRYPTO: "Crypto", CHECK: "Cheque", OTHER: "Otro",
};

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function PagosPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const paymentsQ = trpc.comercial.payments.list.useQuery(
    { organizationId: selectedOrgId, mallId, take: 100 },
    { enabled: !!mallId },
  );
  const payments = paymentsQ.data ?? [];

  // Notificaciones de pago enviadas por arrendatarios desde el portal CC
  const notifQ = trpc.comercial.portal.listPaymentNotifications.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: !!mallId },
  );
  const pendingNotifs = (notifQ.data ?? []).filter((n) => n !== null);

  const localesQ = trpc.comercial.locales.list.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: !!mallId },
  );

  const exchangeQ = trpc.finance.exchange.current.useQuery({ organizationId: selectedOrgId });
  const rateToday = exchangeQ.data?.vesPerUsd ? Number(exchangeQ.data.vesPerUsd) : 1;

  const [showNew, setShowNew] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [pendingNotifId, setPendingNotifId] = useState<string | null>(null);
  const [form, setForm] = useState({
    localId: "", amountUsd: "", exchangeRate: "",
    method: "TRANSFER_USD", reference: "", paidAt: new Date().toISOString().split("T")[0]!, notes: "",
  });

  const dismissMut = trpc.comercial.portal.dismissPaymentNotification.useMutation({
    onSuccess: () => void notifQ.refetch(),
  });

  const recordMut = trpc.comercial.payments.record.useMutation({
    onSuccess: () => {
      void paymentsQ.refetch();
      // Si el pago vino de una notificación, descartarla
      if (pendingNotifId) {
        void dismissMut.mutateAsync({ organizationId: selectedOrgId, notificationId: pendingNotifId });
        setPendingNotifId(null);
      }
      setShowNew(false);
      setForm({ localId: "", amountUsd: "", exchangeRate: "", method: "TRANSFER_USD", reference: "", paidAt: new Date().toISOString().split("T")[0]!, notes: "" });
    },
  });

  const voidMut = trpc.comercial.payments.void.useMutation({
    onSuccess: () => { void paymentsQ.refetch(); setVoidingId(null); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = parseFloat(form.exchangeRate) || rateToday;
    await recordMut.mutateAsync({
      organizationId: selectedOrgId,
      mallId,
      localId: form.localId,
      amountUsd: parseFloat(form.amountUsd),
      amountBss: parseFloat(form.amountUsd) * rate,
      exchangeRate: rate,
      exchangeSource: "BCV",
      currencyPrimary: "USD",
      method: form.method as "TRANSFER_USD",
      reference: form.reference || undefined,
      paidAt: new Date(form.paidAt),
      notes: form.notes || undefined,
    });
  };

  /** Abre el formulario de registro pre-rellenado con los datos de la notificación */
  const prefillFromNotif = (n: NonNullable<typeof pendingNotifs[number]>) => {
    setPendingNotifId(n.id);
    setForm({
      localId: n.localId,
      amountUsd: String(n.amountUsd),
      exchangeRate: "",
      method: n.method,
      reference: n.reference ?? "",
      paidAt: new Date(n.fechaPago).toISOString().split("T")[0]!,
      notes: [n.bankName ? `Banco: ${n.bankName}` : "", n.notes ?? ""].filter(Boolean).join(" | "),
    });
    setShowNew(true);
  };

  const totalPaid = payments.reduce((s, p) => s + Number(p.amountUsd), 0);

  return (
    <div className="space-y-6">
      {/* ── Notificaciones por verificar ───────────────────────────────── */}
      {pendingNotifs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">📨 Notificaciones por verificar</h2>
            <span className="rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5">
              {pendingNotifs.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Pagos reportados por arrendatarios desde el portal. Verifícalos y regístralos en el sistema.
          </p>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2">Fecha</th>
                  <th className="text-left px-4 py-2">Arrendatario</th>
                  <th className="text-left px-4 py-2">Local</th>
                  <th className="text-left px-4 py-2 hidden sm:table-cell">Método</th>
                  <th className="text-right px-4 py-2">Monto USD</th>
                  <th className="text-left px-4 py-2 hidden md:table-cell">Referencia</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pendingNotifs.map((n) => (
                  <tr key={n.id} className="hover:bg-amber-50/50">
                    <td className="px-4 py-2 text-xs">{new Date(n.fechaPago).toLocaleDateString("es-VE")}</td>
                    <td className="px-4 py-2 font-medium text-xs">
                      {n.tenantName}
                      {n.tenantEmail && <span className="block text-muted-foreground">{n.tenantEmail}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <span className="font-medium">{n.localCode}</span>
                      {n.localName && <span className="text-muted-foreground ml-1">— {n.localName}</span>}
                    </td>
                    <td className="px-4 py-2 hidden sm:table-cell text-xs text-muted-foreground">
                      {METHOD_LABEL[n.method] ?? n.method}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-700">
                      ${fmt(n.amountUsd)}
                    </td>
                    <td className="px-4 py-2 hidden md:table-cell text-xs text-muted-foreground">
                      {n.reference ?? "—"}
                      {n.bankName && <span className="block text-muted-foreground">{n.bankName}</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => prefillFromNotif(n)}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-1 transition-colors"
                      >
                        Registrar pago
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Pagos registrados ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">💰 Pagos recibidos</h1>
          <p className="text-muted-foreground text-sm">
            {payments.length} pagos · Total: <span className="font-medium text-green-600">${fmt(totalPaid)}</span>
          </p>
        </div>
        <Button onClick={() => setShowNew(true)} className="bg-blue-600 hover:bg-blue-700">+ Registrar pago</Button>
      </div>

      {payments.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No hay pagos registrados aún.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Local</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Método</th>
                <th className="text-right px-4 py-3">Monto USD</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Referencia</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Aplicado a</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-accent/30">
                  <td className="px-4 py-3 text-xs">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                  <td className="px-4 py-3 font-medium">
                    {p.local?.code ?? "—"}
                    {p.local?.name && <span className="text-xs text-muted-foreground ml-1">— {p.local.name}</span>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="px-4 py-3 text-right font-medium text-green-700">${fmt(Number(p.amountUsd))}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">{p.reference ?? "—"}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                    {p.allocations && p.allocations.length > 0
                      ? p.allocations.map(a => a.invoice?.invoiceNumber).join(", ")
                      : <span className="italic">Anticipo</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right">
                    {voidingId === p.id ? (
                      <div className="flex gap-1 items-center justify-end">
                        <span className="text-xs text-red-600">¿Anular?</span>
                        <button onClick={() => void voidMut.mutateAsync({ organizationId: selectedOrgId, paymentId: p.id, voidReason: "Anulado por administrador" })}
                          className="text-xs bg-red-600 text-white rounded px-2 py-0.5">Sí</button>
                        <button onClick={() => setVoidingId(null)} className="text-xs border rounded px-2 py-0.5">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setVoidingId(p.id)}
                        className="text-xs text-muted-foreground hover:text-red-600 underline">Anular</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
            <div className="border-b px-6 py-4"><h2 className="font-semibold">💰 Registrar pago de canon</h2></div>
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
                  <Label>Monto (USD) *</Label>
                  <Input type="number" value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} placeholder="500.00" required />
                </div>
                <div className="space-y-1">
                  <Label>Tasa BCV</Label>
                  <Input type="number" value={form.exchangeRate || rateToday.toFixed(2)} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} step="0.01" />
                </div>
                <div className="space-y-1">
                  <Label>Método *</Label>
                  <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                    {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Fecha de pago *</Label>
                  <Input type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} required />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Referencia / Comprobante</Label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="N° de transferencia" />
              </div>
              <div className="space-y-1">
                <Label>Notas</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowNew(false); setPendingNotifId(null); }}>Cancelar</Button>
                <Button type="submit" disabled={recordMut.isPending || !form.localId || !form.amountUsd} className="bg-blue-600 hover:bg-blue-700">
                  {recordMut.isPending ? "Registrando..." : "✓ Registrar pago"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
