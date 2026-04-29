"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { open: boolean; onClose: () => void; onCreated: () => void };

export function NewOrganizationDialog({ open, onClose, onCreated }: Props) {
  const plans = trpc.platform.plans.list.useQuery(undefined, { enabled: open });
  const createMut = trpc.platform.organizations.create.useMutation();

  const [form, setForm] = useState({
    slug: "",
    name: "",
    rif: "",
    email: "",
    phone: "",
    city: "",
    planId: "",
    trialDays: 30,
    adminEmail: "",
    adminName: "",
    adminPassword: "",
  });
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createMut.mutateAsync({
        ...form,
        adminEmail: form.adminEmail.toLowerCase(),
        rif: form.rif || undefined,
        phone: form.phone || undefined,
        city: form.city || undefined,
      });
      onCreated();
      setForm({
        slug: "",
        name: "",
        rif: "",
        email: "",
        phone: "",
        city: "",
        planId: "",
        trialDays: 30,
        adminEmail: "",
        adminName: "",
        adminPassword: "",
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al crear");
    }
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg border bg-card p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="mb-4 text-xl font-semibold">Nueva organización</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="col-span-2 text-sm font-medium text-muted-foreground">Datos de la organización</legend>
            <div>
              <Label>Slug (URL)</Label>
              <Input value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} required />
            </div>
            <div>
              <Label>Nombre</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </div>
            <div>
              <Label>RIF</Label>
              <Input value={form.rif} onChange={(e) => set("rif", e.target.value)} />
            </div>
            <div>
              <Label>Email contacto</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div>
              <Label>Ciudad</Label>
              <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="col-span-2 text-sm font-medium text-muted-foreground">Suscripción</legend>
            <div>
              <Label>Plan</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.planId}
                onChange={(e) => set("planId", e.target.value)}
                required
              >
                <option value="">Selecciona un plan</option>
                {plans.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (${p.priceUsd.toString()}/mes)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Días de prueba</Label>
              <Input
                type="number"
                min={0}
                value={form.trialDays}
                onChange={(e) => set("trialDays", Number(e.target.value))}
              />
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="col-span-2 text-sm font-medium text-muted-foreground">Administrador inicial (ORG_ADMIN)</legend>
            <div>
              <Label>Nombre</Label>
              <Input value={form.adminName} onChange={(e) => set("adminName", e.target.value)} required />
            </div>
            <div>
              <Label>Email login</Label>
              <Input
                type="email"
                value={form.adminEmail}
                onChange={(e) => set("adminEmail", e.target.value)}
                required
              />
            </div>
            <div className="col-span-2">
              <Label>Contraseña inicial</Label>
              <Input
                type="text"
                value={form.adminPassword}
                onChange={(e) => set("adminPassword", e.target.value)}
                minLength={8}
                required
              />
            </div>
          </fieldset>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Creando..." : "Crear organización"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
