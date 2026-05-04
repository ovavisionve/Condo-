"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">⚙️ Configuración</h1>
        <p className="text-muted-foreground text-sm">Datos del centro comercial · {mall.name}</p>
      </div>

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
                <Label>Notas internas</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones administrativas..." />
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

      {/* Info de solo lectura */}
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
