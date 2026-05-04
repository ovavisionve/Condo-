"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type PlanForm = {
  code: string; name: string; description: string;
  maxCommunities: number; maxUnits: number; priceUsd: number;
  features: Record<string, boolean>;
};

const DEFAULT_FORM: PlanForm = {
  code: "", name: "", description: "",
  maxCommunities: 1, maxUnits: 100, priceUsd: 0,
  features: { "Reportes": true, "WhatsApp": false, "Conciliación": false, "Gobernanza": false },
};

const FEATURE_LABELS = ["Reportes", "WhatsApp", "Conciliación", "Gobernanza", "Importación masiva", "API access"];

export default function PlansPage() {
  const { data, isLoading, refetch } = trpc.platform.plans.list.useQuery();
  const createMut = trpc.platform.plans.create.useMutation({ onSuccess: () => { void refetch(); setShowCreate(false); setForm(DEFAULT_FORM); } });
  const updateMut = trpc.platform.plans.update.useMutation({ onSuccess: () => { void refetch(); setEditing(null); } });

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(DEFAULT_FORM);
  const [editForm, setEditForm] = useState<Partial<PlanForm & { id: string }>>({});

  function startEdit(plan: typeof data extends (infer T)[] | undefined ? T : never) {
    if (!plan) return;
    setEditing(plan.id);
    setEditForm({
      id: plan.id, name: plan.name, description: plan.description ?? "",
      maxCommunities: plan.maxCommunities, maxUnits: plan.maxUnits,
      priceUsd: Number(plan.priceUsd),
      features: plan.features as Record<string, boolean>,
    });
  }

  const STATUS_LABEL: Record<string, string> = { true: "✅ Activo", false: "❌ Inactivo" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Planes</h1>
          <p className="text-muted-foreground text-sm">Catálogo de planes vendibles a clientes — ResidIA</p>
        </div>
        <Button onClick={() => { setShowCreate(true); setForm(DEFAULT_FORM); }}>+ Nuevo plan</Button>
      </div>

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />)}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.map((plan) => {
          const isEditing = editing === plan.id;
          const subs = plan._count.subscriptions;
          return (
            <Card key={plan.id} className={`relative ${!plan.active ? "opacity-60" : ""}`}>
              {subs > 0 && (
                <div className="absolute top-3 right-3 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {subs} cliente{subs !== 1 ? "s" : ""}
                </div>
              )}
              <CardHeader>
                {isEditing ? (
                  <div className="space-y-2">
                    <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="text-lg font-bold" />
                    <Input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción" className="text-sm" />
                  </div>
                ) : (
                  <>
                    <CardTitle className="pr-16">{plan.name}</CardTitle>
                    <CardDescription>{plan.description ?? "Sin descripción"}</CardDescription>
                  </>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Precio USD/mes</Label>
                        <Input type="number" step="0.01" value={editForm.priceUsd} onChange={e => setEditForm(f => ({ ...f, priceUsd: Number(e.target.value) }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Máx. comunidades</Label>
                        <Input type="number" value={editForm.maxCommunities} onChange={e => setEditForm(f => ({ ...f, maxCommunities: Number(e.target.value) }))} />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Máx. unidades</Label>
                        <Input type="number" value={editForm.maxUnits} onChange={e => setEditForm(f => ({ ...f, maxUnits: Number(e.target.value) }))} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Features incluidas</Label>
                      <div className="grid grid-cols-2 gap-1">
                        {FEATURE_LABELS.map(feat => (
                          <label key={feat} className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!editForm.features?.[feat]}
                              onChange={e => setEditForm(f => ({ ...f, features: { ...f.features, [feat]: e.target.checked } }))}
                              className="accent-primary"
                            />
                            {feat}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" disabled={updateMut.isPending} onClick={() => {
                        if (!editForm.id) return;
                        updateMut.mutate({
                          id: editForm.id,
                          name: editForm.name,
                          description: editForm.description,
                          maxCommunities: editForm.maxCommunities,
                          maxUnits: editForm.maxUnits,
                          priceUsd: editForm.priceUsd,
                          features: editForm.features,
                        });
                      }}>
                        {updateMut.isPending ? "Guardando..." : "Guardar"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-3xl font-bold text-green-700">${Number(plan.priceUsd).toFixed(2)}<span className="text-sm font-normal text-muted-foreground">/mes</span></div>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      <li>🏢 Hasta {plan.maxCommunities} edificio(s)</li>
                      <li>🏠 Hasta {plan.maxUnits} unidades</li>
                    </ul>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(plan.features as Record<string, boolean>)
                        .filter(([, v]) => v)
                        .map(([k]) => (
                          <span key={k} className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{k}</span>
                        ))}
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground">{STATUS_LABEL[String(plan.active)]}</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => startEdit(plan)}>✏️ Editar</Button>
                        <Button size="sm" variant="outline" className={plan.active ? "text-destructive" : "text-green-700"}
                          onClick={() => updateMut.mutate({ id: plan.id, active: !plan.active })}>
                          {plan.active ? "Desactivar" : "Activar"}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Crear nuevo plan */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border bg-card shadow-xl p-6 space-y-4">
            <h2 className="text-xl font-semibold">Nuevo plan</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Código (ej: PRO)</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="STANDARD" />
              </div>
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Estándar" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Descripción</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ideal para condominios medianos" />
              </div>
              <div className="space-y-1">
                <Label>Precio USD/mes</Label>
                <Input type="number" step="0.01" value={form.priceUsd} onChange={e => setForm(f => ({ ...f, priceUsd: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Máx. comunidades</Label>
                <Input type="number" value={form.maxCommunities} onChange={e => setForm(f => ({ ...f, maxCommunities: Number(e.target.value) }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Máx. unidades</Label>
                <Input type="number" value={form.maxUnits} onChange={e => setForm(f => ({ ...f, maxUnits: Number(e.target.value) }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Features incluidas</Label>
                <div className="grid grid-cols-2 gap-1">
                  {FEATURE_LABELS.map(feat => (
                    <label key={feat} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={!!form.features[feat]} onChange={e => setForm(f => ({ ...f, features: { ...f.features, [feat]: e.target.checked } }))} className="accent-primary" />
                      {feat}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button disabled={createMut.isPending || !form.name || !form.code} onClick={() => createMut.mutate(form)}>
                {createMut.isPending ? "Creando..." : "Crear plan"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
