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
  { value: "GUEST_FEE",   label: "Cuota visitante" },
  { value: "INTEREST",    label: "Intereses" },
  { value: "DONATION",    label: "Donación" },
  { value: "PENALTY",     label: "Multa" },
  { value: "OTHER",       label: "Otro" },
] as const;

type IncomeCategory = (typeof INCOME_CATEGORIES)[number]["value"];

function incomeLabel(category: string, customCategory?: string | null) {
  if (category === "OTHER" && customCategory?.trim()) return customCategory.trim();
  return INCOME_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

const today = new Date();

export default function IncomePage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [filterYear, setFilterYear]   = useState(today.getFullYear());
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1);
  const [showNew, setShowNew] = useState(false);

  const list = trpc.finance.income.list.useQuery({
    organizationId, communityId,
    year: filterYear, month: filterMonth,
  });

  const totalUsd = list.data?.reduce((s, i) => s + Number(i.amountUsd.toString()), 0) ?? 0;
  const totalBss = list.data?.reduce((s, i) => s + Number(i.amountBss.toString()), 0) ?? 0;
  const affectsTotal = list.data
    ?.filter((i) => (i as typeof i & { affectsInvoice?: boolean }).affectsInvoice)
    .reduce((s, i) => s + Number(i.amountUsd.toString()), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Ingresos</h2>
          <p className="text-sm text-muted-foreground">
            {filterMonth}/{filterYear} · Total: ${totalUsd.toFixed(2)} / Bs {totalBss.toFixed(2)}
            {affectsTotal > 0 && (
              <span className="ml-2 text-green-700">· Descuenta de recibos: ${affectsTotal.toFixed(2)}</span>
            )}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>Año</Label>
            <Input type="number" value={filterYear}
              onChange={(e) => setFilterYear(Number(e.target.value))} className="w-24" />
          </div>
          <div>
            <Label>Mes</Label>
            <Input type="number" min={1} max={12} value={filterMonth}
              onChange={(e) => setFilterMonth(Number(e.target.value))} className="w-20" />
          </div>
          <Button onClick={() => setShowNew(true)}>+ Ingreso</Button>
        </div>
      </div>

      {affectsTotal > 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <strong>ℹ️ Descuento activo:</strong> ${affectsTotal.toFixed(2)} en ingresos de este período se descontarán
          del total de gastos antes de prorratear los recibos.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Referencia</th>
              <th className="px-3 py-2 text-right">USD</th>
              <th className="px-3 py-2 text-right">Bs</th>
              <th className="px-3 py-2">Descuenta recibo</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((inc) => {
              const row = inc as typeof inc & { affectsInvoice?: boolean; customCategory?: string | null };
              return (
                <tr key={inc.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">{incomeLabel(inc.category, row.customCategory)}</td>
                  <td className="px-3 py-2">{inc.description}</td>
                  <td className="px-3 py-2 text-muted-foreground">{inc.reference ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">${Number(inc.amountUsd.toString()).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {Number(inc.amountBss.toString()).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.affectsInvoice
                      ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Sí</span>
                      : <span className="text-muted-foreground text-xs">No</span>
                    }
                  </td>
                </tr>
              );
            })}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Sin ingresos en este período
                </td>
              </tr>
            )}
          </tbody>
          {(list.data?.length ?? 0) > 0 && (
            <tfoot className="border-t bg-muted/20">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right text-sm font-medium">Total</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">${totalUsd.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">{totalBss.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          )}
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
    customCategory: "",
    description: "",
    amount: "",
    currencyPrimary: "USD" as "USD" | "VES",
    reference: "",
    notes: "",
    affectsInvoice: false,
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
        customCategory: form.category === "OTHER" && form.customCategory.trim()
          ? form.customCategory.trim()
          : undefined,
        description: form.description,
        amount: Number(form.amount),
        currencyPrimary: form.currencyPrimary,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
        affectsInvoice: form.affectsInvoice,
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
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as IncomeCategory, customCategory: "" }))}
              >
                {INCOME_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Período</Label>
              <div className="flex gap-2">
                <Input type="number" value={form.periodYear}
                  onChange={(e) => setForm((f) => ({ ...f, periodYear: Number(e.target.value) }))}
                  className="w-24" />
                <Input type="number" min={1} max={12} value={form.periodMonth}
                  onChange={(e) => setForm((f) => ({ ...f, periodMonth: Number(e.target.value) }))}
                  className="w-16" />
              </div>
            </div>
          </div>

          {form.category === "OTHER" && (
            <div>
              <Label>¿Qué tipo de ingreso? <span className="text-muted-foreground text-xs">(nombre)</span></Label>
              <Input
                placeholder="Ej: Venta de artículos, Rifas, Interés bancario..."
                value={form.customCategory}
                onChange={(e) => setForm((f) => ({ ...f, customCategory: e.target.value }))}
                maxLength={80}
              />
            </div>
          )}

          <div>
            <Label>Descripción</Label>
            <Input value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto</Label>
              <Input type="number" step="0.01" value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
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
            <Input value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
          </div>

          {/* Opción clave: ¿descuenta de los recibos? */}
          <div className="rounded-lg border border-dashed p-3 space-y-1">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.affectsInvoice}
                onChange={(e) => setForm((f) => ({ ...f, affectsInvoice: e.target.checked }))}
              />
              <span className="text-sm">
                <span className="font-medium">Descontar de los recibos del período</span>
                <br />
                <span className="text-muted-foreground text-xs">
                  Este ingreso reducirá el total de gastos antes de prorratear los recibos del mes.
                  Aparecerá como descuento en cada recibo.
                </span>
              </span>
            </label>
          </div>

          <div>
            <Label>Notas</Label>
            <Input value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "..." : "Registrar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
