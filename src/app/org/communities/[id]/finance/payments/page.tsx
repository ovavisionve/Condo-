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
            </tr>
          </thead>
          <tbody>
            {list.data?.map((p) => (
              <tr key={p.id} className={`border-t ${p.voidedAt ? "text-muted-foreground line-through" : ""}`}>
                <td className="px-3 py-2">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                <td className="px-3 py-2">{p.unit.code}</td>
                <td className="px-3 py-2 text-xs">{p.method}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.reference ?? "—"}</td>
                <td className="px-3 py-2 text-right">${Number(p.amountUsd.toString()).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{Number(p.amountBss.toString()).toFixed(2)}</td>
                <td className="px-3 py-2 text-xs">
                  {p.allocations.length > 0
                    ? p.allocations.map((a) => a.invoice.invoiceNumber).join(", ")
                    : <span className="text-amber-700">anticipo</span>}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sin pagos registrados</td></tr>
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
              <option value="">Selecciona unidad</option>
              {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Monto</Label>
              <Input aria-label="Monto" type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div>
              <Label>Moneda</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.currencyPrimary}
                onChange={(e) => setForm((f) => ({ ...f, currencyPrimary: e.target.value as "USD" | "VES" }))}
              >
                <option value="USD">USD</option>
                <option value="VES">VES</option>
              </select>
            </div>
            <div>
              <Label>Fecha</Label>
              <Input type="date" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Método</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.method}
                onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as (typeof METHODS)[number] }))}
              >
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label>Referencia</Label>
              <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
            </div>
          </div>

          {unitId && pendingInvoices.length > 0 && (
            <div>
              <Label>Aplicar a facturas (opcional, sino queda como anticipo)</Label>
              <div className="rounded border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-2 py-1"># Factura</th>
                      <th className="px-2 py-1 text-right">Pendiente USD</th>
                      <th className="px-2 py-1">Aplicar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingInvoices.map((inv) => {
                      const pendingUsd = Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString());
                      return (
                        <tr key={inv.id} className="border-t">
                          <td className="px-2 py-1">{inv.invoiceNumber}</td>
                          <td className="px-2 py-1 text-right">${pendingUsd.toFixed(2)}</td>
                          <td className="px-2 py-1">
                            <Input
                              type="number"
                              step="0.01"
                              value={allocs[inv.id] ?? ""}
                              onChange={(e) => setAllocs((a) => ({ ...a, [inv.id]: e.target.value }))}
                              className="h-8 w-32"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Suma asignaciones: {sumAllocs.toFixed(2)} {form.currencyPrimary} · Monto pago: {form.amount || "0"} {form.currencyPrimary}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={record.isPending}>{record.isPending ? "..." : "Registrar"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
