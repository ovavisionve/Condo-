"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const METHODS = [
  "CASH_BSS",
  "CASH_USD",
  "TRANSFER_BSS",
  "TRANSFER_USD",
  "ZELLE",
  "PAGO_MOVIL",
  "CRYPTO",
  "CHECK",
  "OTHER",
] as const;

const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD",
  TRANSFER_BSS: "Transfer. Bs", TRANSFER_USD: "Transfer. USD",
  ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil",
  CRYPTO: "Cripto", CHECK: "Cheque", OTHER: "Otro",
};

function downloadBase64Pdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PaymentsPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const list = trpc.finance.payments.list.useQuery({ organizationId, communityId });
  const utils = trpc.useUtils();
  const [showNew, setShowNew] = useState(false);

  const totalUsd = list.data?.reduce((s, p) => s + (p.voidedAt ? 0 : Number(p.amountUsd.toString())), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pagos recibidos</h2>
          <p className="text-sm text-muted-foreground">Total recibido: ${totalUsd.toFixed(2)}</p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ Registrar pago</Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Método</th>
              <th className="px-3 py-2">Referencia</th>
              <th className="px-3 py-2 text-right">USD</th>
              <th className="px-3 py-2 text-right">Bs</th>
              <th className="px-3 py-2">Aplicado a</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                organizationId={organizationId}
              />
            ))}
            {list.data?.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sin pagos registrados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewPaymentDialog
          organizationId={organizationId}
          communityId={communityId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void list.refetch();
            void utils.finance.invoices.list.invalidate();
            void utils.finance.aging.invalidate();
          }}
        />
      )}
    </div>
  );
}

function PaymentRow({ payment, organizationId }: {
  payment: {
    id: string;
    paidAt: Date | string;
    amountUsd: { toString(): string };
    amountBss: { toString(): string };
    method: string;
    reference?: string | null;
    voidedAt?: Date | string | null;
    unit: { code: string };
    allocations: { invoice: { invoiceNumber: string } }[];
  };
  organizationId: string;
}) {
  const getVoucher = trpc.finance.payments.getVoucherPdf.useMutation();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await getVoucher.mutateAsync({ organizationId, paymentId: payment.id });
      downloadBase64Pdf(res.base64, `bauche-${payment.id.slice(-8)}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <tr className={`border-t ${payment.voidedAt ? "text-muted-foreground line-through" : ""}`}>
      <td className="px-3 py-2">{new Date(payment.paidAt).toLocaleDateString("es-VE")}</td>
      <td className="px-3 py-2">{payment.unit.code}</td>
      <td className="px-3 py-2 text-xs">{METHOD_LABEL[payment.method] ?? payment.method}</td>
      <td className="px-3 py-2 text-muted-foreground">{payment.reference ?? "—"}</td>
      <td className="px-3 py-2 text-right">${Number(payment.amountUsd.toString()).toFixed(2)}</td>
      <td className="px-3 py-2 text-right">{Number(payment.amountBss.toString()).toFixed(2)}</td>
      <td className="px-3 py-2 text-xs">
        {payment.allocations.length > 0
          ? payment.allocations.map((a) => a.invoice.invoiceNumber).join(", ")
          : <span className="text-amber-700">anticipo</span>}
      </td>
      <td className="px-3 py-2">
        {!payment.voidedAt && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap"
          >
            {downloading ? "..." : "📄 Bauche"}
          </button>
        )}
      </td>
    </tr>
  );
}

function NewPaymentDialog({ organizationId, communityId, onClose, onCreated }: {
  organizationId: string;
  communityId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const [unitId, setUnitId] = useState<string>("");
  const invoices = trpc.finance.invoices.list.useQuery(
    { organizationId, communityId, unitId, status: undefined },
    { enabled: Boolean(unitId) },
  );
  const record = trpc.finance.payments.record.useMutation();

  const [form, setForm] = useState({
    amount: "",
    currencyPrimary: "USD" as "USD" | "VES",
    method: "TRANSFER_USD" as (typeof METHODS)[number],
    reference: "",
    paidAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [allocs, setAllocs] = useState<Record<string, string>>({}); // invoiceId -> amount
  const [error, setError] = useState<string | null>(null);

  const pendingInvoices = invoices.data?.filter(
    (i) => i.status !== "PAID" && i.status !== "VOIDED",
  ) ?? [];

  const sumAllocs = Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const allocations = Object.entries(allocs)
      .filter(([, v]) => v && Number(v) > 0)
      .map(([invoiceId, v]) => ({ invoiceId, amount: Number(v) }));
    try {
      await record.mutateAsync({
        organizationId,
        communityId,
        unitId,
        amount: Number(form.amount),
        currencyPrimary: form.currencyPrimary,
        method: form.method,
        reference: form.reference || undefined,
        paidAt: new Date(form.paidAt),
        notes: form.notes || undefined,
        allocations: allocations.length > 0 ? allocations : undefined,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Registrar pago</h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label>Unidad</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={unitId}
              onChange={(e) => { setUnitId(e.target.value); setAllocs({}); }}
              required
            >
              <option value="">Selecciona una unidad...</option>
              {units.data?.map((u) => (
                <option key={u.id} value={u.id}>{u.code}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Moneda</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.currencyPrimary}
                onChange={(e) => setForm({ ...form, currencyPrimary: e.target.value as "USD" | "VES" })}
              >
                <option value="USD">USD</option>
                <option value="VES">VES (Bs)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Método de pago</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value as (typeof METHODS)[number] })}
              >
                {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>)}
              </select>
            </div>
            <div>
              <Label>Referencia (opcional)</Label>
              <Input
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="N° de transacción"
              />
            </div>
          </div>

          <div>
            <Label>Fecha del pago</Label>
            <Input
              type="date"
              value={form.paidAt}
              onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
              required
            />
          </div>

          {pendingInvoices.length > 0 && (
            <div>
              <Label>Aplicar a facturas pendientes</Label>
              <div className="mt-2 space-y-2 rounded-md border p-3">
                {pendingInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3">
                    <div className="flex-1 text-sm">
                      <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                      <span className="ml-2 text-muted-foreground">
                        Pendiente: ${(Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString())).toFixed(2)}
                      </span>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-28"
                      placeholder="0.00"
                      value={allocs[inv.id] ?? ""}
                      onChange={(e) => setAllocs({ ...allocs, [inv.id]: e.target.value })}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Suma asignada: {sumAllocs.toFixed(2)} {form.currencyPrimary} · Monto: {form.amount || "0"} {form.currencyPrimary}
                </p>
              </div>
            </div>
          )}

          <div>
            <Label>Notas (opcional)</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Observaciones..."
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? "Guardando..." : "Registrar pago"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
