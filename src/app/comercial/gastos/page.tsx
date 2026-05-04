"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

const CAT_LABEL: Record<string, string> = {
  ELECTRICIDAD: "Electricidad", DIESEL_PLANTA: "Diésel Planta", AGUA_CISTERNA: "Agua Cisterna",
  LIMPIEZA: "Limpieza", SEGURIDAD: "Seguridad", HVAC: "HVAC / Climatización",
  ASCENSORES: "Ascensores", MARKETING: "Marketing", ADMINISTRACION: "Administración",
  MANTENIMIENTO: "Mantenimiento", SEGUROS: "Seguros", NOMINA_STAFF: "Nómina Staff",
  IMPUESTOS: "Impuestos / Tasas", FONDO_RESERVA: "Fondo de Reserva", OTHER: "Otro",
};

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function GastosPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const now = new Date();
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [showNew, setShowNew] = useState(false);

  const gastosQ = trpc.comercial.expenses.list.useQuery(
    { organizationId: selectedOrgId, mallId, periodYear, periodMonth },
    { enabled: !!mallId },
  );
  const gastos = gastosQ.data ?? [];

  const exchangeQ = trpc.finance.exchange.current.useQuery({ organizationId: selectedOrgId });
  const rateToday = exchangeQ.data?.vesPerUsd ? Number(exchangeQ.data.vesPerUsd) : 1; // tmp ?? 1;

  const [form, setForm] = useState({
    category: "ELECTRICIDAD", customCategory: "", description: "",
    amountUsd: "", exchangeRate: "", supplierName: "", invoiceNumber: "", notes: "",
  });

  const createMut = trpc.comercial.expenses.create.useMutation({
    onSuccess: () => {
      void gastosQ.refetch();
      setShowNew(false);
      setForm({ category: "ELECTRICIDAD", customCategory: "", description: "", amountUsd: "", exchangeRate: "", supplierName: "", invoiceNumber: "", notes: "" });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = parseFloat(form.exchangeRate) || rateToday;
    const amtUsd = parseFloat(form.amountUsd);
    await createMut.mutateAsync({
      organizationId: selectedOrgId,
      mallId,
      category: form.category as "ELECTRICIDAD",
      customCategory: form.customCategory || undefined,
      description: form.description,
      periodYear,
      periodMonth,
      amountUsd: amtUsd,
      amountBss: amtUsd * rate,
      exchangeRate: rate,
      exchangeSource: "BCV",
      currencyPrimary: "USD",
      supplierName: form.supplierName || undefined,
      invoiceNumber: form.invoiceNumber || undefined,
      notes: form.notes || undefined,
    });
  };

  const totalUsd = gastos.reduce((s, g) => s + Number(g.amountUsd), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">📋 Gastos</h1>
          <p className="text-muted-foreground text-sm">{gastos.length} gastos · Total: <span className="font-medium">${fmt(totalUsd)}</span></p>
        </div>
        <Button onClick={() => setShowNew(true)} className="bg-blue-600 hover:bg-blue-700">+ Registrar gasto</Button>
      </div>

      {/* Filtros período */}
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

      {gastos.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No hay gastos para este período.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Categoría</th>
                <th className="text-left px-4 py-3">Descripción</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Proveedor</th>
                <th className="text-right px-4 py-3">USD</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Bs</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {gastos.map((g) => (
                <tr key={g.id} className="hover:bg-accent/30">
                  <td className="px-4 py-3 text-xs">{CAT_LABEL[g.category] ?? g.category}{g.customCategory ? ` — ${g.customCategory}` : ""}</td>
                  <td className="px-4 py-3">{g.description}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">{g.supplierName ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-medium">${fmt(Number(g.amountUsd))}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell text-muted-foreground text-xs">Bs {fmt(Number(g.amountBss))}</td>
                </tr>
              ))}
              <tr className="bg-muted/30 font-medium">
                <td colSpan={3} className="px-4 py-2 text-right text-xs text-muted-foreground">TOTAL</td>
                <td className="px-4 py-2 text-right">${fmt(totalUsd)}</td>
                <td className="hidden md:table-cell"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
            <div className="border-b px-6 py-4"><h2 className="font-semibold">📋 Registrar gasto</h2></div>
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
                    <Label>Categoría personalizada</Label>
                    <Input value={form.customCategory} onChange={(e) => setForm({ ...form, customCategory: e.target.value })} placeholder="Piscina, Pintura..." />
                  </div>
                )}
                <div className="col-span-2 space-y-1">
                  <Label>Descripción *</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción del gasto" required />
                </div>
                <div className="space-y-1">
                  <Label>Monto (USD) *</Label>
                  <Input type="number" value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} placeholder="1200.00" required />
                </div>
                <div className="space-y-1">
                  <Label>Tasa BCV</Label>
                  <Input type="number" value={form.exchangeRate || rateToday.toFixed(2)} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} step="0.01" />
                </div>
                <div className="space-y-1">
                  <Label>Proveedor</Label>
                  <Input value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} placeholder="Nombre del proveedor" />
                </div>
                <div className="space-y-1">
                  <Label>N° Factura proveedor</Label>
                  <Input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} placeholder="0001234" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notas</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMut.isPending || !form.description || !form.amountUsd} className="bg-blue-600 hover:bg-blue-700">
                  {createMut.isPending ? "Guardando..." : "✓ Registrar gasto"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
