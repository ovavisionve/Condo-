"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function ConfiguracionPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mall = mallsQ.data?.[0];

  const [form, setForm] = useState({
    name: "", rif: "", address: "", city: "", state: "",
    phone: "", email: "", website: "", notes: "",
    totalLocales: "", floorsCount: "",
  });
  const [saved, setSaved] = useState(false);

  // ── Tasa BCV ────────────────────────────────────────────────────────────────
  const exchangeQ = trpc.finance.exchange.current.useQuery({ organizationId: selectedOrgId });
  const recentQ = trpc.finance.exchange.recent.useQuery({ organizationId: selectedOrgId, limit: 7 });
  const refreshBcvMut = trpc.finance.exchange.refreshBcv.useMutation();
  const setManualMut = trpc.finance.exchange.setManual.useMutation();
  const utils = trpc.useUtils();

  const [manualRate, setManualRate] = useState("");
  const [bcvMsg, setBcvMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [manualMsg, setManualMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const onRefreshBcv = async () => {
    setBcvMsg(null);
    try {
      const r = await refreshBcvMut.mutateAsync({ organizationId: selectedOrgId });
      setBcvMsg({ type: "ok", text: `✓ Tasa actualizada: ${Number(r.vesPerUsd).toFixed(4)} VES/USD` });
      void utils.finance.exchange.current.invalidate();
      void utils.finance.exchange.recent.invalidate();
    } catch (e: unknown) {
      setBcvMsg({ type: "err", text: e instanceof Error ? e.message : "Error al conectar con el BCV" });
    }
  };

  const onSetManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualMsg(null);
    const val = parseFloat(manualRate);
    if (!val || val <= 0) return;
    try {
      await setManualMut.mutateAsync({ organizationId: selectedOrgId, vesPerUsd: val });
      setManualMsg({ type: "ok", text: `✓ Tasa corregida: ${val.toFixed(4)} VES/USD` });
      setManualRate("");
      void utils.finance.exchange.current.invalidate();
      void utils.finance.exchange.recent.invalidate();
    } catch (e: unknown) {
      setManualMsg({ type: "err", text: e instanceof Error ? e.message : "Error al guardar" });
    }
  };

  // ── Mall form ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mall) {
      setForm({
        name: mall.name ?? "",
        rif: mall.rif ?? "",
        address: mall.address ?? "",
        city: mall.city ?? "",
        state: mall.state ?? "",
        phone: mall.phone ?? "",
        email: mall.email ?? "",
        website: mall.website ?? "",
        notes: mall.notes ?? "",
        totalLocales: mall.totalLocales?.toString() ?? "",
        floorsCount: mall.floorsCount?.toString() ?? "",
      });
    }
  }, [mall]);

  const updateMut = trpc.comercial.malls.update.useMutation({
    onSuccess: () => {
      void mallsQ.refetch();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mall) return;
    await updateMut.mutateAsync({
      organizationId: selectedOrgId,
      mallId: mall.id,
      name: form.name || undefined,
      rif: form.rif || null,
      address: form.address || undefined,
      city: form.city || undefined,
      state: form.state || null,
      phone: form.phone || null,
      email: form.email || null,
      website: form.website || null,
      notes: form.notes || null,
      totalLocales: form.totalLocales ? parseInt(form.totalLocales) : undefined,
      floorsCount: form.floorsCount ? parseInt(form.floorsCount) : null,
    });
  };

  if (mallsQ.isLoading) {
    return <div className="h-64 bg-muted animate-pulse rounded-lg" />;
  }

  if (!mall) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No hay ningún mall configurado. Ve al Dashboard para crear el primero.
      </div>
    );
  }

  const rateData = exchangeQ.data;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">⚙️ Configuración</h1>
        <p className="text-muted-foreground text-sm">Datos del centro comercial · {mall.name}</p>
      </div>

      {/* ── Tasa BCV ────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">💱 Tasa BCV</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Card: tasa actual + refresh */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Tasa actual</CardDescription>
              <CardTitle className="text-2xl">
                {rateData ? `${Number(rateData.vesPerUsd).toFixed(4)}` : "—"}{" "}
                <span className="text-base font-normal text-muted-foreground">VES/USD</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rateData && (
                <p className="text-xs text-muted-foreground">
                  {rateData.source} · {new Date(rateData.date).toLocaleDateString("es-VE")}
                </p>
              )}
              <Button size="sm" variant="outline" className="w-full"
                onClick={() => void onRefreshBcv()}
                disabled={refreshBcvMut.isPending}>
                {refreshBcvMut.isPending ? "Consultando BCV..." : "🔄 Actualizar desde BCV"}
              </Button>
              {bcvMsg && (
                <p className={`text-xs font-medium ${bcvMsg.type === "ok" ? "text-green-600" : "text-red-600"}`}>
                  {bcvMsg.text}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Card: tasa manual */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Corregir tasa del día</CardTitle>
              <CardDescription>
                Si el BCV no responde o la tasa automática está incorrecta, ingrésala manualmente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void onSetManual(e)} className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">VES por 1 USD</Label>
                  <Input
                    type="number" step="0.0001" min="1"
                    placeholder="ej. 89.50"
                    value={manualRate}
                    onChange={(e) => setManualRate(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={setManualMut.isPending}>
                  {setManualMut.isPending ? "Guardando..." : "✓ Aplicar tasa"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Fuente oficial:{" "}
                  <a href="https://www.bcv.org.ve" target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline">
                    bcv.org.ve
                  </a>
                </p>
                {manualMsg && (
                  <p className={`text-xs font-medium ${manualMsg.type === "ok" ? "text-green-600" : "text-red-600"}`}>
                    {manualMsg.text}
                  </p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Historial reciente */}
        {recentQ.data && recentQ.data.length > 0 && (
          <div className="mt-2 rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Fecha</th>
                  <th className="text-right px-3 py-2">Tasa VES/USD</th>
                  <th className="text-left px-3 py-2">Fuente</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentQ.data.map((r, i) => (
                  <tr key={i} className={i === 0 ? "bg-blue-50/50 font-medium" : "hover:bg-accent/20"}>
                    <td className="px-3 py-2">{new Date(r.date).toLocaleDateString("es-VE")}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(r.vesPerUsd).toFixed(4)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Datos del mall ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">🏬 Información del mall</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label>Nombre del centro comercial *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <Label>RIF</Label>
                <Input value={form.rif} onChange={(e) => setForm({ ...form, rif: e.target.value })} placeholder="J-12345678-9" />
              </div>
              <div className="space-y-1">
                <Label>Teléfono</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+58 212-0000000" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Dirección</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Ciudad</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Estado</Label>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="Miranda, Carabobo..." />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@mall.com" />
              </div>
              <div className="space-y-1">
                <Label>Sitio web</Label>
                <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://mall.com" />
              </div>
              <div className="space-y-1">
                <Label>Locales totales (referencia)</Label>
                <Input type="number" value={form.totalLocales} onChange={(e) => setForm({ ...form, totalLocales: e.target.value })} placeholder="120" />
              </div>
              <div className="space-y-1">
                <Label>Niveles / pisos</Label>
                <Input type="number" value={form.floorsCount} onChange={(e) => setForm({ ...form, floorsCount: e.target.value })} placeholder="3" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Instrucciones de pago (aparece en facturas PDF)</Label>
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder={`Ej:\nBanco de Venezuela — Cuenta Corriente N° 0102-1234-56-0000000001 — J-12345678-9\nZelle: admin@mall.com\nPago Móvil: 0412-0000000 · J-12345678-9 · BDV`}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">Este texto se muestra en la sección "¿Cómo pagar?" de cada factura PDF.</p>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={updateMut.isPending} className="bg-blue-600 hover:bg-blue-700">
                {updateMut.isPending ? "Guardando..." : "✓ Guardar cambios"}
              </Button>
              {saved && <span className="text-sm text-green-600 font-medium">✅ Guardado</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Info de solo lectura ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📋 Información de la cuenta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between border-b py-2">
            <span className="text-muted-foreground">ID del mall</span>
            <span className="font-mono text-xs">{mall.id}</span>
          </div>
          <div className="flex justify-between border-b py-2">
            <span className="text-muted-foreground">Locales registrados</span>
            <span className="font-medium">{mall._count.locales}</span>
          </div>
          <div className="flex justify-between border-b py-2">
            <span className="text-muted-foreground">Estado</span>
            <span className={`font-medium ${mall.active ? "text-green-600" : "text-red-600"}`}>
              {mall.active ? "Activo" : "Inactivo"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Creado</span>
            <span>{new Date(mall.createdAt).toLocaleDateString("es-VE")}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
