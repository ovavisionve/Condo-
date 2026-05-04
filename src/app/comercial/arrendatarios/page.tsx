"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

const CANON_TYPE_LABEL: Record<string, string> = {
  FIXED: "Canon fijo", VARIABLE_SALES: "% ventas", MIXED: "Mixto",
};

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function ArrendatariosPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const localesQ = trpc.comercial.locales.list.useQuery(
    { organizationId: selectedOrgId, mallId, includeInactive: false },
    { enabled: !!mallId },
  );
  const locales = localesQ.data ?? [];

  const [showNew, setShowNew] = useState(false);
  const [selectedLocalId, setSelectedLocalId] = useState("");
  const [terminatingId, setTerminatingId] = useState<{ tenancyId: string; tenantName: string; localCode: string } | null>(null);
  const [terminateDate, setTerminateDate] = useState(new Date().toISOString().split("T")[0]!);
  const [form, setForm] = useState({
    tenantName: "", tenantRif: "", tenantEmail: "", tenantPhone: "", tenantContact: "",
    canonType: "FIXED", canonUsd: "", salesPct: "",
    startDate: new Date().toISOString().split("T")[0]!, depositUsd: "", notes: "",
  });

  const [portalLink, setPortalLink] = useState<{ url: string; tenantName: string } | null>(null);

  const createMut = trpc.comercial.tenancies.create.useMutation({
    onSuccess: () => { void localesQ.refetch(); setShowNew(false); setSelectedLocalId(""); },
  });

  const terminateMut = trpc.comercial.tenancies.terminate.useMutation({
    onSuccess: () => { void localesQ.refetch(); setTerminatingId(null); },
  });

  const linkMut = trpc.comercial.portal.generateLink.useMutation({
    onSuccess: (r, vars) => {
      const tenant = locales.flatMap((l) => l.tenancies ?? []).find((t) => t.id === vars.tenancyId);
      setPortalLink({ url: r.url, tenantName: tenant?.tenantName ?? "Arrendatario" });
    },
    onError: (e) => alert(`❌ ${e.message}`),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocalId) return;
    await createMut.mutateAsync({
      organizationId: selectedOrgId,
      localId: selectedLocalId,
      tenantName: form.tenantName,
      tenantRif: form.tenantRif || undefined,
      tenantEmail: form.tenantEmail || undefined,
      tenantPhone: form.tenantPhone || undefined,
      tenantContact: form.tenantContact || undefined,
      canonType: form.canonType as "FIXED" | "VARIABLE_SALES" | "MIXED",
      canonUsd: form.canonUsd ? parseFloat(form.canonUsd) : undefined,
      salesPct: form.salesPct ? parseFloat(form.salesPct) : undefined,
      startDate: new Date(form.startDate),
      depositUsd: form.depositUsd ? parseFloat(form.depositUsd) : undefined,
      notes: form.notes || undefined,
    });
  };

  const occupied = locales.filter((l) => l.tenancies && l.tenancies.length > 0);
  const vacant = locales.filter((l) => !l.tenancies || l.tenancies.length === 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">🤝 Arrendatarios</h1>
          <p className="text-muted-foreground text-sm">
            {occupied.length} locales ocupados · {vacant.length} desocupados
            {occupied.length + vacant.length > 0 && ` · ${Math.round(occupied.length / (occupied.length + vacant.length) * 100)}% ocupación`}
          </p>
        </div>
        <Button onClick={() => setShowNew(true)} className="bg-blue-600 hover:bg-blue-700">+ Nuevo contrato</Button>
      </div>

      {/* Locales ocupados */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">✅ Locales con contrato vigente</h2>
        {occupied.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No hay locales ocupados aún.</CardContent></Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Local</th>
                  <th className="text-left px-4 py-3">Arrendatario</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">RIF / Contacto</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Canon</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Desde</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Depósito</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {occupied.map((local) => {
                  const t = local.tenancies![0]!;
                  return (
                    <tr key={local.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{local.code}</p>
                        {local.name && <p className="text-xs text-muted-foreground">{local.name}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{t.tenantName}</p>
                        {t.tenantEmail && <p className="text-xs text-muted-foreground">{t.tenantEmail}</p>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">
                        <p>{t.tenantRif ?? "—"}</p>
                        {t.tenantPhone && <p>{t.tenantPhone}</p>}
                        {t.tenantContact && <p className="italic">{t.tenantContact}</p>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs">{CANON_TYPE_LABEL[t.canonType] ?? t.canonType}</span>
                        {t.canonUsd && <p className="text-xs font-medium text-green-700">${fmt(Number(t.canonUsd))}/mes</p>}
                        {t.salesPct && <p className="text-xs text-purple-700">{Number(t.salesPct).toFixed(2)}%</p>}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                        {new Date(t.startDate).toLocaleDateString("es-VE")}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                        {t.depositUsd ? `$${fmt(Number(t.depositUsd))}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end flex-wrap">
                          <Link href={`/comercial/locales/${local.id}`}
                            className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent">
                            Ver →
                          </Link>
                          <button
                            onClick={() => void linkMut.mutateAsync({ organizationId: selectedOrgId, tenancyId: t.id })}
                            disabled={linkMut.isPending}
                            className="inline-flex items-center rounded-md border border-blue-200 text-blue-700 bg-blue-50 px-2.5 py-1 text-xs font-medium hover:bg-blue-100 disabled:opacity-50"
                            title="Generar enlace del portal para el arrendatario">
                            🔗 Portal
                          </button>
                          <button
                            onClick={() => setTerminatingId({ tenancyId: t.id, tenantName: t.tenantName, localCode: local.code })}
                            className="inline-flex items-center rounded-md border border-red-200 text-red-600 bg-red-50 px-2.5 py-1 text-xs font-medium hover:bg-red-100">
                            Terminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Locales desocupados */}
      {vacant.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">🔴 Locales desocupados ({vacant.length})</h2>
          <div className="flex flex-wrap gap-2">
            {vacant.map((l) => (
              <Link key={l.id} href={`/comercial/locales/${l.id}`}
                className="rounded-lg border bg-red-50 px-3 py-2 text-sm hover:bg-red-100 transition-colors">
                <p className="font-medium text-red-700">{l.code}</p>
                {l.name && <p className="text-xs text-muted-foreground">{l.name}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Dialog nuevo contrato */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border bg-card shadow-xl">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold text-lg">🤝 Nuevo contrato de arrendamiento</h2>
            </div>
            <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1">
                <Label>Local *</Label>
                <select value={selectedLocalId} onChange={(e) => setSelectedLocalId(e.target.value)} required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                  <option value="">Selecciona un local...</option>
                  {locales.map((l) => <option key={l.id} value={l.id}>{l.code}{l.name ? ` — ${l.name}` : ""}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label>Razón social del arrendatario *</Label>
                  <Input value={form.tenantName} onChange={(e) => setForm({ ...form, tenantName: e.target.value })} placeholder="Tienda XYZ C.A." required />
                </div>
                <div className="space-y-1">
                  <Label>RIF</Label>
                  <Input value={form.tenantRif} onChange={(e) => setForm({ ...form, tenantRif: e.target.value })} placeholder="J-12345678-9" />
                </div>
                <div className="space-y-1">
                  <Label>Representante legal</Label>
                  <Input value={form.tenantContact} onChange={(e) => setForm({ ...form, tenantContact: e.target.value })} placeholder="Nombre del representante" />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" value={form.tenantEmail} onChange={(e) => setForm({ ...form, tenantEmail: e.target.value })} placeholder="contacto@tienda.com" />
                </div>
                <div className="space-y-1">
                  <Label>Teléfono</Label>
                  <Input value={form.tenantPhone} onChange={(e) => setForm({ ...form, tenantPhone: e.target.value })} placeholder="+58 414-0000000" />
                </div>
                <div className="space-y-1">
                  <Label>Fecha inicio *</Label>
                  <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <Label>Depósito (USD)</Label>
                  <Input type="number" value={form.depositUsd} onChange={(e) => setForm({ ...form, depositUsd: e.target.value })} placeholder="1000.00" />
                </div>
              </div>
              <div className="border-t pt-3">
                <Label className="mb-2 block font-medium">Tipo de canon *</Label>
                <div className="flex gap-2">
                  {Object.entries(CANON_TYPE_LABEL).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setForm({ ...form, canonType: v })}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${form.canonType === v ? "border-blue-600 bg-blue-50 text-blue-700" : "hover:bg-accent"}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {(form.canonType === "FIXED" || form.canonType === "MIXED") && (
                    <div className="space-y-1">
                      <Label>Canon fijo (USD/mes)</Label>
                      <Input type="number" value={form.canonUsd} onChange={(e) => setForm({ ...form, canonUsd: e.target.value })} placeholder="500.00" />
                    </div>
                  )}
                  {(form.canonType === "VARIABLE_SALES" || form.canonType === "MIXED") && (
                    <div className="space-y-1">
                      <Label>% sobre ventas</Label>
                      <Input type="number" value={form.salesPct} onChange={(e) => setForm({ ...form, salesPct: e.target.value })} placeholder="5.00" step="0.01" />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMut.isPending || !selectedLocalId || !form.tenantName} className="bg-blue-600 hover:bg-blue-700">
                  {createMut.isPending ? "Guardando..." : "✓ Registrar contrato"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal enlace del portal */}
      {portalLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border bg-card shadow-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">🔗 Enlace del portal del arrendatario</h2>
            <p className="text-sm text-muted-foreground">
              Comparte este enlace con <strong>{portalLink.tenantName}</strong>. El enlace es válido por <strong>180 días</strong> y permite ver facturas y pagos sin necesidad de crear una cuenta.
            </p>
            <div className="space-y-2">
              <div className="rounded-lg bg-muted p-3 font-mono text-xs break-all select-all">
                {portalLink.url}
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => void navigator.clipboard.writeText(portalLink.url).then(() => alert("✅ Copiado al portapapeles"))}>
                  📋 Copiar enlace
                </Button>
                <Button variant="outline"
                  onClick={() => window.open(portalLink.url, "_blank")}>
                  👁️ Ver portal
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setPortalLink(null)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog terminar contrato */}
      {terminatingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-card shadow-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg text-red-700">⚠️ Terminar contrato</h2>
            <p className="text-sm text-muted-foreground">
              Se cerrará el contrato de <strong>{terminatingId.tenantName}</strong> en el local <strong>{terminatingId.localCode}</strong>.
            </p>
            <div className="space-y-1">
              <Label>Fecha de terminación</Label>
              <Input type="date" value={terminateDate} onChange={(e) => setTerminateDate(e.target.value)} />
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setTerminatingId(null)}>Cancelar</Button>
              <Button className="bg-red-600 hover:bg-red-700"
                disabled={terminateMut.isPending}
                onClick={() => void terminateMut.mutateAsync({
                  organizationId: selectedOrgId,
                  tenancyId: terminatingId.tenancyId,
                  endDate: new Date(terminateDate),
                })}>
                {terminateMut.isPending ? "Guardando..." : "Terminar contrato"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
