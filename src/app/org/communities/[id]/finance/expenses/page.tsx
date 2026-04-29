"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CATS = [
  "ELECTRICITY",
  "WATER",
  "GAS",
  "INTERNET",
  "CLEANING",
  "GARDENING",
  "SECURITY",
  "ELEVATOR",
  "STAFF_PAYROLL",
  "ADMINISTRATION",
  "INSURANCE",
  "REPAIRS",
  "RESERVE_FUND",
  "TAXES",
  "OTHER",
] as const;

const today = new Date();

export default function ExpensesPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [filterYear, setFilterYear] = useState(today.getFullYear());
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1);
  const list = trpc.finance.expenses.list.useQuery({
    organizationId,
    communityId,
    year: filterYear,
    month: filterMonth,
  });
  const utils = trpc.useUtils();
  const create = trpc.finance.expenses.create.useMutation();
  const [showNew, setShowNew] = useState(false);

  const totalUsd = list.data?.reduce((s, e) => s + Number(e.amountUsd.toString()), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Gastos comunes</h2>
          <p className="text-sm text-muted-foreground">
            Período: {filterMonth}/{filterYear} · Total: ${totalUsd.toFixed(2)}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>Año</Label>
            <Input type="number" value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))} className="w-24" />
          </div>
          <div>
            <Label>Mes</Label>
            <Input type="number" min={1} max={12} value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))} className="w-20" />
          </div>
          <Button onClick={() => setShowNew(true)}>+ Gasto</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2 text-right">USD</th>
              <th className="px-3 py-2 text-right">Bs</th>
              <th className="px-3 py-2">Tasa</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="px-3 py-2">{e.category}</td>
                <td className="px-3 py-2">{e.description}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.supplierName ?? "—"}</td>
                <td className="px-3 py-2 text-right">${Number(e.amountUsd.toString()).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{Number(e.amountBss.toString()).toFixed(2)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{Number(e.exchangeRate.toString()).toFixed(4)}</td>
                <td className="px-3 py-2 text-xs">
                  {e.invoicedAt ? <span className="text-green-700">Facturado</span> : <span className="text-amber-700">Pendiente</span>}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sin gastos en este período</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewExpenseDialog
          organizationId={organizationId}
          communityId={communityId}
          defaultYear={filterYear}
          defaultMonth={filterMonth}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void list.refetch();
            void utils.finance.exchange.current.invalidate();
          }}
          create={create}
        />
      )}
    </div>
  );
}

function NewExpenseDialog({
  organizationId,
  communityId,
  defaultYear,
  defaultMonth,
  onClose,
  onCreated,
  create,
}: {
  organizationId: string;
  communityId: string;
  defaultYear: number;
  defaultMonth: number;
  onClose: () => void;
  onCreated: () => void;
  create: ReturnType<typeof trpc.finance.expenses.create.useMutation>;
}) {
  const [form, setForm] = useState({
    category: "ELECTRICITY" as (typeof CATS)[number],
    description: "",
    amount: "",
    currencyPrimary: "USD" as "USD" | "VES",
    supplierName: "",
    invoiceNumber: "",
    notes: "",
    periodYear: defaultYear,
    periodMonth: defaultMonth,
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        organizationId,
        communityId,
        category: form.category,
        description: form.description,
        periodYear: form.periodYear,
        periodMonth: form.periodMonth,
        amount: Number(form.amount),
        currencyPrimary: form.currencyPrimary,
        supplierName: form.supplierName || undefined,
        invoiceNumber: form.invoiceNumber || undefined,
        notes: form.notes || undefined,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al registrar");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Registrar gasto común</h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoría</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as (typeof CATS)[number] }))}
              >
                {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label>Proveedor</Label>
              <Input value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Descripción</Label>
            <Input aria-label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Año</Label>
              <Input aria-label="Año" type="number" value={form.periodYear} onChange={(e) => setForm((f) => ({ ...f, periodYear: Number(e.target.value) }))} required />
            </div>
            <div>
              <Label>Mes</Label>
              <Input type="number" min={1} max={12} value={form.periodMonth} onChange={(e) => setForm((f) => ({ ...f, periodMonth: Number(e.target.value) }))} required />
            </div>
            <div>
              <Label># Factura</Label>
              <Input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
                <option value="VES">VES (Bs)</option>
              </select>
            </div>
          </div>
          <div>
            <Label>Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "..." : "Registrar"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
