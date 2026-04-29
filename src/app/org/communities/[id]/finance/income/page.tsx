"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INCOME_CATEGORIES = [
  { value: "HALL_RENTAL", label: "Alquiler de salón" },
  { value: "PARKING_FEE", label: "Estacionamiento" },
  { value: "GUEST_FEE", label: "Cuota visitante" },
  { value: "INTEREST", label: "Intereses" },
  { value: "DONATION", label: "Donación" },
  { value: "PENALTY", label: "Multa" },
  { value: "OTHER", label: "Otro" },
] as const;

type IncomeCategory = (typeof INCOME_CATEGORIES)[number]["value"];

const today = new Date();

export default function IncomePage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [filterYear, setFilterYear] = useState(today.getFullYear());
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1);
  const [showNew, setShowNew] = useState(false);

  const list = trpc.finance.income.list.useQuery({
    organizationId,
    communityId,
    year: filterYear,
    month: filterMonth,
  });

  const totalUsd = list.data?.reduce((s, i) => s + Number(i.amountUsd.toString()), 0) ?? 0;
  const totalBss = list.data?.reduce((s, i) => s + Number(i.amountBss.toString()), 0) ?? 0;

  const labelOf = (cat: string) =>
    INCOME_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Ingresos</h2>
          <p className="text-sm text-muted-foreground">
            Período: {filterMonth}/{filterYear} · Total: ${totalUsd.toFixed(2)} · Bs {totalBss.toFixed(2)}
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
          <Button onClick={() => setShowNew(true)}>+ Ingreso</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Referencia</th>
              <th className="px-3 py-2 text-right">USD</th>
              <th className="px-3 py-2 text-right">Bs</th>
              <th className="px-3 py-2">Tasa</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((inc) => (
              <tr key={inc.id} className="border-t">
                <td className="px-3 py-2">{labelOf(inc.category)}</td>
                <td className="px-3 py-2">{inc.description}</td>
                <td className="px-3 py-2 text-muted-foreground">{inc.reference ?? "—"}</td>
                <td className="px-3 py-2 text-right">${Number(inc.amountUsd.toString()).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{Number(inc.amountBss.toString()).toFixed(2)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{Number(inc.exchangeRate.toString()).toFixed(4)}</td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Sin ingresos en este período
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewIncomeDialog
          organizationId={organizationId}
          communityId={communityId}
          defaultYear={filterYear}
          defaultMonth={filterMonth}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); void list.refetch(); }}
        />
      )}
    </div>
  );
}

function NewIncomeDialog({
  organizationId,
  communityId,
  defaultYear,
  defaultMonth,
  onClose,
  onCreated,
}: {
  organizationId: string;
  communityId: string;
  defaultYear: number;
  defaultMonth: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const create = trpc.finance.income.create.useMutation();
  const [form, setForm] = useState({
    category: "OTHER" as IncomeCategory,
    description: "",
    amount: "",
    currencyPrimary: "USD" as "USD" | "VES",
    reference: "",
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
        amount: Number(form.amount),
        currencyPrimary: form.currencyPrimary,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
        periodYear: form.periodYear,
        periodMonth: form.periodMonth,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al registrar");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Registrar ingreso</h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoría</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as IncomeCategory }))}
              >
                {INCOME_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Período</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={form.periodYear}
                  onChange={(e) => setForm((f) => ({ ...f, periodYear: Number(e.target.value) }))}
                  className="w-24"
                />
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={form.periodMonth}
                  onChange={(e) => setForm((f) => ({ ...f, periodMonth: Number(e.target.value) }))}
                  className="w-16"
                />
              </div>
            </div>
          </div>
          <div>
            <Label>Descripción</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto</Label>
              <Input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                required
              />
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
            <Label>Referencia</Label>
            <Input
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </div>
          <div>
            <Label>Notas</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
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
