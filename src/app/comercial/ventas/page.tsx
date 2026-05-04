"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function VentasPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const now = new Date();
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [showNew, setShowNew] = useState(false);

  const declarationsQ = trpc.comercial.salesDeclarations.list.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: !!mallId },
  );
  const declarations = declarationsQ.data ?? [];

  const localesQ = trpc.comercial.locales.list.useQuery(
    { organizationId: selectedOrgId, mallId },
    { enabled: !!mallId },
  );
  // Solo locales con VARIABLE_SALES o MIXED
  const variableLocales = (localesQ.data ?? []).filter((l) => l.canonType === "VARIABLE_SALES" || l.canonType === "MIXED");

  const exchangeQ = trpc.finance.exchange.current.useQuery({ organizationId: selectedOrgId });
  const rateToday = exchangeQ.data?.vesPerUsd ? Number(exchangeQ.data.vesPerUsd) : 1; // tmp ?? 1;

  const [form, setForm] = useState({
    localId: "", salesAmountUsd: "", exchangeRate: "", notes: "",
  });

  const upsertMut = trpc.comercial.salesDeclarations.upsert.useMutation({
    onSuccess: () => {
      void declarationsQ.refetch();
      setShowNew(false);
      setForm({ localId: "", salesAmountUsd: "", exchangeRate: "", notes: "" });
    },
  });

  const verifyMut = trpc.comercial.salesDeclarations.verify.useMutation({
    onSuccess: () => void declarationsQ.refetch(),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = parseFloat(form.exchangeRate) || rateToday;
    const salesUsd = parseFloat(form.salesAmountUsd);
    await upsertMut.mutateAsync({
      organizationId: selectedOrgId,
      mallId,
      localId: form.localId,
      periodYear,
      periodMonth,
      salesAmountUsd: salesUsd,
      salesAmountBss: salesUsd * rate,
      exchangeRate: rate,
      notes: form.notes || undefined,
    });
  };

  const periodDeclarations = declarations.filter(
    (d) => d.periodYear === periodYear && d.periodMonth === periodMonth,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">📊 Declaración de Ventas</h1>
          <p className="text-muted-foreground text-sm">
            Canon variable — Decreto 929/2014 · {variableLocales.length} locales con canon sobre ventas
          </p>
        </div>
        <Button onClick={() => setShowNew(true)} className="bg-blue-600 hover:bg-blue-700">+ Cargar declaración</Button>
      </div>

      {/* Info legal */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        <p className="font-medium">📜 Decreto 929 / Comité Paritario</p>
        <p className="text-xs mt-1 text-blue-700">
          Los locales con canon variable deben declarar sus ventas mensualmente. El administrador verifica y calcula el canon proporcional antes de emitir la factura.
          El Comité Paritario (50% propietarios + 50% arrendatarios) supervisa este proceso.
        </p>
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

      {/* Tabla de declaraciones del período */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Declaraciones — {new Date(periodYear, periodMonth - 1).toLocaleDateString("es-VE", { month: "long", year: "numeric" })}
        </h2>
        {variableLocales.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
            No hay locales con canon variable configurado. Edita el local y selecciona tipo de canon &quot;% ventas&quot; o &quot;Mixto&quot;.
          </CardContent></Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Local</th>
                  <th className="text-left px-4 py-3">Canon type</th>
                  <th className="text-right px-4 py-3">Ventas declaradas (USD)</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">Canon calculado</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {variableLocales.map((local) => {
                  const decl = periodDeclarations.find((d) => d.localId === local.id);
                  const salesUsd = decl ? Number(decl.salesAmountUsd) : 0;
                  const pct = Number(local.salesPct ?? 0);
                  const canonFijo = Number(local.canonUsd ?? 0);
                  const isCAV = local.canonType === "VARIABLE_SALES";
                  const isCAM = local.canonType === "MIXED";

                  // Cálculo frontend: sin llamada al endpoint mutation
                  let calculatedCanon: number | null = null;
                  let canonLabel = "";
                  if (decl) {
                    if (isCAV) {
                      calculatedCanon = salesUsd * (pct / 100);
                      canonLabel = `${pct.toFixed(2)}% ventas`;
                    } else if (isCAM) {
                      const variable = salesUsd * (pct / 100);
                      calculatedCanon = Math.max(canonFijo, variable);
                      canonLabel = `máx($${fmt(canonFijo)}, var)`;
                    }
                  }

                  return (
                    <tr key={local.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3 font-medium">{local.code}{local.name ? ` — ${local.name}` : ""}</td>
                      <td className="px-4 py-3 text-xs">
                        {isCAV ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">
                            CAV · {pct.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-xs font-medium">
                            CAM · ${fmt(canonFijo)} + {pct.toFixed(2)}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {decl
                          ? <span className="font-medium">${fmt(salesUsd)}</span>
                          : <span className="text-muted-foreground text-xs italic">Pendiente</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        {calculatedCanon !== null ? (
                          isCAV ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-semibold">
                              ${fmt(calculatedCanon)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-xs font-semibold"
                              title={canonLabel}>
                              ${fmt(calculatedCanon)} ({canonLabel})
                            </span>
                          )
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {decl ? (
                          decl.verified
                            ? <span className="text-xs text-green-700 font-medium">✅ Verificada</span>
                            : <span className="text-xs text-yellow-700">⏳ Sin verificar</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin declarar</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {decl && !decl.verified && (
                          <button
                            onClick={() => void verifyMut.mutateAsync({ organizationId: selectedOrgId, declarationId: decl.id })}
                            disabled={verifyMut.isPending}
                            className="text-xs text-blue-600 underline hover:no-underline"
                          >
                            Verificar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
            <div className="border-b px-6 py-4"><h2 className="font-semibold">📊 Cargar declaración de ventas</h2></div>
            <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-3">
              <div className="space-y-1">
                <Label>Local *</Label>
                <select value={form.localId} onChange={(e) => setForm({ ...form, localId: e.target.value })} required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                  <option value="">Selecciona un local...</option>
                  {variableLocales.map((l) => <option key={l.id} value={l.id}>{l.code}{l.name ? ` — ${l.name}` : ""}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Ventas declaradas (USD) *</Label>
                  <Input type="number" value={form.salesAmountUsd} onChange={(e) => setForm({ ...form, salesAmountUsd: e.target.value })} placeholder="15000.00" required />
                </div>
                <div className="space-y-1">
                  <Label>Tasa BCV</Label>
                  <Input type="number" value={form.exchangeRate || rateToday.toFixed(2)} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} step="0.01" />
                </div>
              </div>
              {form.salesAmountUsd && form.localId && (() => {
                const local = variableLocales.find(l => l.id === form.localId);
                const canon = local?.salesPct ? parseFloat(form.salesAmountUsd) * Number(local.salesPct) / 100 : null;
                if (!canon) return null;
                return (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm">
                    <p className="text-blue-800">Canon estimado: <strong>${fmt(canon)}</strong></p>
                    {local?.canonUsd && <p className="text-xs text-blue-600">+ Base fija: ${fmt(Number(local.canonUsd))}</p>}
                  </div>
                );
              })()}
              <div className="space-y-1">
                <Label>Notas / soporte</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ref. declaración SENIAT..." />
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
                <Button type="submit" disabled={upsertMut.isPending || !form.localId || !form.salesAmountUsd} className="bg-blue-600 hover:bg-blue-700">
                  {upsertMut.isPending ? "Guardando..." : "✓ Cargar declaración"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
