"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

const CAT_LABEL: Record<string, string> = {
  PUBLICIDAD_INTERNA: "Publicidad interna", ALQUILER_ESPACIO: "Alquiler de espacio",
  ESTACIONAMIENTO: "Estacionamiento", PATROCINIOS: "Patrocinios",
  INTERESES: "Intereses", PENALIDADES: "Penalidades", OTHER: "Otro",
};

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function IngresosPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const now = new Date();
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [showNew, setShowNew] = useState(false);

  const ingresosQ = trpc.comercial.incomes.list.useQuery(
    { organizationId: selectedOrgId, mallId, periodYear, periodMonth },
    { enabled: !!mallId },
  );
  const ingresos = ingresosQ.data ?? [];

  const exchangeQ = trpc.finance.exchange.current.useQuery({ organizationId: selectedOrgId });
  const rateToday = exchangeQ.data?.vesPerUsd ? Number(exchangeQ.data.vesPerUsd) : 1; // tmp ?? 1;

  const [form, setForm] = useState({
    category: "PUBLICIDAD_INTERNA", customCategory: "", description: "",
    amountUsd: "", receivedAt: "", reference: "", affectsInvoice: false, notes: "",
  });

  const createMut = trpc.comercial.incomes.create.useMutation({
    onSuccess: () => {
      void ingresosQ.refetch();
      setShowNew(false);
      setForm({ category: "PUBLICIDAD_INTERNA", customCategory: "", description: "", amountUsd: "", receivedAt: "", reference: "", affectsInvoice: false, notes: "" });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amtUsd = parseFloat(form.amountUsd);
    // #2 — Tasa calculada server-side desde receivedAt
    await createMut.mutateAsync({
      organizationId: selectedOrgId,
      mallId,
      category: form.category as "PUBLICIDAD_INTERNA",
      customCategory: form.customCategory || undefined,
      description: form.description,
      periodYear,
      periodMonth,
      amount: amtUsd,
      exchangeSource: "BCV",
      currencyPrimary: "USD",
      receivedAt: form.receivedAt ? new Date(form.receivedAt) : undefined,
      reference: form.reference || undefined,
      affectsInvoice: form.affectsInvoice,
      notes: form.notes || undefined,
    });
  };

  const totalUsd = ingresos.reduce((s, g) => s + Number(g.amountUsd), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">💵 Recaudación</h1>
          <p className="text-muted-foreground text-sm">{ingresos.length} recaudaciones · Total: <span className="font-medium text-green-600">${fmt(totalUsd)}</span></p>
        </div>
        <Button onClick={() => setShowNew(true)} className="bg-blue-600 hover:bg-blue-700">+ Registrar recaudación</Button>
      </div>

      <div className="flex gap-3 items-center">
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
      </div>

      {ingresos.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No hay recaudaciones para este período.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Categoría</th>
                <th className="text-left px-4 py-3">Descripción</th>
                <th className="text-right px-4 py-3">USD</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Referencia</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ingresos.map((g) => (
                <tr key={g.id} className="hover:bg-accent/30">
                  <td className="px-4 py-3 text-xs">{CAT_LABEL[g.category] ?? g.category}</td>
                  <td className="px-4 py-3">{g.description}{g.affectsInvoice && <span className="ml-2 text-xs bg-green-100 text-green-700 rounded-full px-1">reduce gastos</span>}</td>
                  <td className="px-4 py-3 text-right font-medium text-green-700">${fmt(Number(g.amountUsd))}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">{g.reference ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
            <div className="border-b px-6 py-4"><h2 className="font-semibold">💵 Registrar recaudación</h2></div>
            <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Categoría *</Label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                    {Object.entries(CAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {form.category === "OTHER" && (
                  <div className="space-y-1">
                    <Label>Descripción categoría</Label>
                    <Input value={form.customCategory} onChange={(e) => setForm({ ...form, customCategory: e.target.value })} />
                  </div>
                )}
                <div className="col-span-2 space-y-1">
                  <Label>Descripción *</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <Label>Monto (USD) *</Label>
                  <Input type="number" value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} placeholder="500.00" required />
                </div>
                <div className="space-y-1">
                  <Label>Fecha del cobro</Label>
                  <Input type="date" value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} />
                  <p className="text-xs text-muted-foreground">La tasa BCV se toma de esta fecha (tasa de hoy: {rateToday.toFixed(2)}).</p>
                </div>
                <div className="space-y-1">
                  <Label>Referencia</Label>
                  <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input type="checkbox" checked={form.affectsInvoice} onChange={(e) => setForm({ ...form, affectsInvoice: e.target.checked })} id="affectsInvoice" className="accent-primary" />
                  <label htmlFor="affectsInvoice" className="text-sm cursor-pointer">Reduce gastos comunes del período</label>
                </div>
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMut.isPending || !form.description || !form.amountUsd} className="bg-blue-600 hover:bg-blue-700">
                  {createMut.isPending ? "Guardando..." : "✓ Registrar"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
