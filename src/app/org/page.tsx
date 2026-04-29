"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "./OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OrgHome() {
  const organizationId = useOrgId();
  const { data, isLoading, refetch } = trpc.org.communities.list.useQuery({ organizationId });
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Edificios</h1>
          <p className="text-muted-foreground">Comunidades administradas por esta organización.</p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ Nuevo edificio</Button>
      </div>

      {isLoading && <p className="text-muted-foreground">Cargando...</p>}

      <div className="grid gap-3">
        {data?.length === 0 && (
          <p className="text-muted-foreground">Aún no hay edificios. Crea el primero.</p>
        )}
        {data?.map((c) => (
          <Link key={c.id} href={`/org/communities/${c.id}`}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardHeader>
                <CardTitle className="text-lg">{c.name}</CardTitle>
                <CardDescription>
                  {c.address}, {c.city} · {c._count.units} unidad(es) · moneda {c.primaryCurrency}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      {showNew && (
        <NewCommunityDialog
          organizationId={organizationId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

function NewCommunityDialog({
  organizationId,
  onClose,
  onCreated,
}: {
  organizationId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const create = trpc.org.communities.create.useMutation();
  const [form, setForm] = useState({
    name: "",
    rif: "",
    address: "",
    city: "Caracas",
    state: "",
    primaryCurrency: "USD" as "USD" | "VES",
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        organizationId,
        ...form,
        rif: form.rif || undefined,
        state: form.state || undefined,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al crear");
    }
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-xl font-semibold">Nuevo edificio</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label>Nombre</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>RIF</Label>
              <Input value={form.rif} onChange={(e) => set("rif", e.target.value)} />
            </div>
            <div>
              <Label>Moneda primaria</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.primaryCurrency}
                onChange={(e) => set("primaryCurrency", e.target.value as "USD" | "VES")}
              >
                <option value="USD">USD</option>
                <option value="VES">VES (Bs)</option>
              </select>
            </div>
          </div>
          <div>
            <Label>Dirección</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ciudad</Label>
              <Input value={form.city} onChange={(e) => set("city", e.target.value)} required />
            </div>
            <div>
              <Label>Estado</Label>
              <Input value={form.state} onChange={(e) => set("state", e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creando..." : "Crear"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
