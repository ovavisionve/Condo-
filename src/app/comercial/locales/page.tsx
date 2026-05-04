"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LOCAL_TYPE_LABEL: Record<string, string> = {
  LOCAL: "Local", ANCORA: "Áncora", FOOD_COURT: "Food Court", RESTAURANT: "Restaurante",
  BANCO: "Banco/Taquilla", CINE: "Cine", QUIOSCO: "Quiosco", OFICINA: "Oficina", OTHER: "Otro",
};

const CANON_TYPE_LABEL: Record<string, string> = {
  FIXED: "Canon fijo", VARIABLE_SALES: "% ventas", MIXED: "Mixto",
};

const CANON_COLOR: Record<string, string> = {
  FIXED: "bg-blue-100 text-blue-700", VARIABLE_SALES: "bg-purple-100 text-purple-700", MIXED: "bg-indigo-100 text-indigo-700",
};

type LocalForm = {
  code: string; type: string; name: string; floor: string; wing: string; areaM2: string;
  canonType: string; canonUsd: string; salesPct: string; aliquot: string; notes: string;
};

const emptyForm: LocalForm = {
  code: "", type: "LOCAL", name: "", floor: "", wing: "", areaM2: "",
  canonType: "FIXED", canonUsd: "", salesPct: "", aliquot: "", notes: "",
};

export default function LocalesPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const malls = mallsQ.data ?? [];
  const [selectedMallId, setSelectedMallId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editLocal, setEditLocal] = useState<{ id: string } & LocalForm | null>(null);

  const mallId = selectedMallId ?? malls[0]?.id ?? "";

  const localesQ = trpc.comercial.locales.list.useQuery(
    { organizationId: selectedOrgId, mallId, includeInactive: false },
    { enabled: !!mallId },
  );
  const locales = localesQ.data ?? [];

  const createMut = trpc.comercial.locales.create.useMutation({
    onSuccess: () => { void localesQ.refetch(); setShowNew(false); setNewForm(emptyForm); },
  });

  const updateMut = trpc.comercial.locales.update.useMutation({
    onSuccess: () => { void localesQ.refetch(); setEditLocal(null); },
  });

  const [newForm, setNewForm] = useState<LocalForm>(emptyForm);

  const filtered = locales.filter((l) =>
    search === "" ||
    l.code.toLowerCase().includes(search.toLowerCase()) ||
    (l.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createMut.mutateAsync({
      organizationId: selectedOrgId, mallId,
      code: newForm.code,
      type: newForm.type as "LOCAL",
      name: newForm.name || undefined,
      floor: newForm.floor ? parseInt(newForm.floor) : undefined,
      wing: newForm.wing || undefined,
      areaM2: newForm.areaM2 ? parseFloat(newForm.areaM2) : undefined,
      canonType: newForm.canonType as "FIXED",
      canonUsd: newForm.canonUsd ? parseFloat(newForm.canonUsd) : undefined,
      salesPct: newForm.salesPct ? parseFloat(newForm.salesPct) : undefined,
      aliquot: newForm.aliquot ? parseFloat(newForm.aliquot) : undefined,
      notes: newForm.notes || undefined,
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editLocal) return;
    await updateMut.mutateAsync({
      organizationId: selectedOrgId,
      localId: editLocal.id,
      code: editLocal.code || undefined,
      type: editLocal.type as "LOCAL" | undefined,
      name: editLocal.name || null,
      floor: editLocal.floor ? parseInt(editLocal.floor) : null,
      wing: editLocal.wing || null,
      areaM2: editLocal.areaM2 ? parseFloat(editLocal.areaM2) : null,
      canonType: editLocal.canonType as "FIXED" | undefined,
      canonUsd: editLocal.canonUsd ? parseFloat(editLocal.canonUsd) : null,
      salesPct: editLocal.salesPct ? parseFloat(editLocal.salesPct) : null,
      aliquot: editLocal.aliquot ? parseFloat(editLocal.aliquot) : null,
      notes: editLocal.notes || null,
    });
  };

  const openEdit = (local: typeof locales[0]) => {
    setEditLocal({
      id: local.id,
      code: local.code,
      type: local.type,
      name: local.name ?? "",
      floor: local.floor?.toString() ?? "",
      wing: local.wing ?? "",
      areaM2: local.areaM2 ? Number(local.areaM2).toString() : "",
      canonType: local.canonType,
      canonUsd: local.canonUsd ? Number(local.canonUsd).toString() : "",
      salesPct: local.salesPct ? Number(local.salesPct).toString() : "",
      aliquot: local.aliquot ? Number(local.aliquot).toString() : "",
      notes: local.notes ?? "",
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">🏪 Locales</h1>
          <p className="text-muted-foreground text-sm">{locales.length} local(es) registrados</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="bg-blue-600 hover:bg-blue-700">+ Nuevo local</Button>
      </div>

      {/* Selector de mall */}
      {malls.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {malls.map((m) => (
            <button key={m.id} onClick={() => setSelectedMallId(m.id)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                mallId === m.id ? "bg-blue-600 text-white border-blue-600" : "border-input bg-background hover:bg-accent"
              }`}>
              {m.name}
            </button>
          ))}
        </div>
      )}

      {/* Búsqueda */}
      <Input placeholder="Buscar por código o nombre..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />

      {/* Tabla */}
      {localesQ.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-blue-200 p-12 text-center">
          <p className="text-muted-foreground">{locales.length === 0 ? "No hay locales registrados aún." : "No hay resultados para esa búsqueda."}</p>
          <Button className="mt-4 bg-blue-600 hover:bg-blue-700" onClick={() => setShowNew(true)}>+ Crear primer local</Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Código</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Tipo</th>
                <th className="text-left px-4 py-3">Canon</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Arrendatario</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Área m²</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Alícuota</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((local) => {
                const activeTenancy = local.tenancies?.[0];
                return (
                  <tr key={local.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium">{local.code}</p>
                      {local.name && <p className="text-xs text-muted-foreground">{local.name}</p>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">{LOCAL_TYPE_LABEL[local.type] ?? local.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CANON_COLOR[local.canonType] ?? ""}`}>
                        {CANON_TYPE_LABEL[local.canonType] ?? local.canonType}
                      </span>
                      {local.canonUsd && <p className="text-xs font-medium mt-0.5 text-green-700">${Number(local.canonUsd).toFixed(2)}/mes</p>}
                      {local.salesPct && <p className="text-xs text-purple-700 mt-0.5">{Number(local.salesPct).toFixed(2)}% ventas</p>}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {activeTenancy ? (
                        <div>
                          <p className="text-sm font-medium">{activeTenancy.tenantName}</p>
                          {activeTenancy.tenantRif && <p className="text-xs text-muted-foreground">{activeTenancy.tenantRif}</p>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Desocupado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell text-muted-foreground text-xs">
                      {local.areaM2 ? `${Number(local.areaM2).toFixed(0)} m²` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell text-muted-foreground text-xs">
                      {local.aliquot ? `${Number(local.aliquot).toFixed(4)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(local)}
                          className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors">
                          ✏️
                        </button>
                        <Link href={`/comercial/locales/${local.id}`}
                          className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors">
                          Ver →
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog nuevo local */}
      {showNew && (
        <LocalFormDialog
          title="🏪 Nuevo local"
          form={newForm}
          setForm={setNewForm}
          onSubmit={handleCreate}
          isPending={createMut.isPending}
          onClose={() => { setShowNew(false); setNewForm(emptyForm); }}
          submitLabel="✓ Crear local"
        />
      )}

      {/* Dialog editar local */}
      {editLocal && (
        <LocalFormDialog
          title="✏️ Editar local"
          form={editLocal}
          setForm={(f) => setEditLocal({ ...editLocal, ...f })}
          onSubmit={handleUpdate}
          isPending={updateMut.isPending}
          onClose={() => setEditLocal(null)}
          submitLabel="✓ Guardar cambios"
        />
      )}
    </div>
  );
}

function LocalFormDialog({
  title, form, setForm, onSubmit, isPending, onClose, submitLabel,
}: {
  title: string;
  form: LocalForm;
  setForm: (f: LocalForm) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  isPending: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-xl">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-lg">{title}</h2>
        </div>
        <form onSubmit={(e) => { void onSubmit(e); }} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Código *</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="L-101" required />
            </div>
            <div className="space-y-1">
              <Label>Tipo *</Label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                {Object.entries(LOCAL_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Nombre / Razón social del local</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Supermercado El Canasto" />
            </div>
            <div className="space-y-1">
              <Label>Piso</Label>
              <Input type="number" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} placeholder="1" />
            </div>
            <div className="space-y-1">
              <Label>Ala / Sector</Label>
              <Input value={form.wing} onChange={(e) => setForm({ ...form, wing: e.target.value })} placeholder="Norte" />
            </div>
            <div className="space-y-1">
              <Label>Área (m²)</Label>
              <Input type="number" value={form.areaM2} onChange={(e) => setForm({ ...form, areaM2: e.target.value })} placeholder="120.50" />
            </div>
            <div className="space-y-1">
              <Label>Alícuota (%)</Label>
              <Input type="number" value={form.aliquot} onChange={(e) => setForm({ ...form, aliquot: e.target.value })} placeholder="2.5000" step="0.0001" />
            </div>
          </div>

          <div className="border-t pt-3">
            <Label className="mb-2 block font-medium">Tipo de canon</Label>
            <div className="flex gap-2">
              {Object.entries(CANON_TYPE_LABEL).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setForm({ ...form, canonType: v })}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.canonType === v ? "border-blue-600 bg-blue-50 text-blue-700" : "hover:bg-accent"
                  }`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(form.canonType === "FIXED" || form.canonType === "MIXED") && (
                <div className="space-y-1">
                  <Label>Canon fijo (USD/mes)</Label>
                  <Input type="number" value={form.canonUsd} onChange={(e) => setForm({ ...form, canonUsd: e.target.value })} placeholder="500.00" />
                </div>
              )}
              {(form.canonType === "VARIABLE_SALES" || form.canonType === "MIXED") && (
                <div className="space-y-1">
                  <Label>% sobre ventas declaradas</Label>
                  <Input type="number" value={form.salesPct} onChange={(e) => setForm({ ...form, salesPct: e.target.value })} placeholder="5.00" step="0.01" />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas adicionales..." />
          </div>

          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isPending || !form.code} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? "Guardando..." : submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
