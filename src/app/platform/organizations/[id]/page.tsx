"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: org, isLoading, refetch } = trpc.platform.organizations.byId.useQuery({ id });
  const updateMutation = trpc.platform.organizations.update.useMutation({
    onSuccess: () => { void refetch(); setEditing(false); },
  });
  const softDeleteMutation = trpc.platform.organizations.softDelete.useMutation({
    onSuccess: () => router.push("/platform/organizations"),
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{
    name: string; legalName: string; rif: string; email: string;
    phone: string; address: string; city: string;
  }>({ name: "", legalName: "", rif: "", email: "", phone: "", address: "", city: "" });

  function startEdit() {
    if (!org) return;
    setForm({
      name: org.name,
      legalName: org.legalName ?? "",
      rif: org.rif ?? "",
      email: org.email,
      phone: org.phone ?? "",
      address: org.address ?? "",
      city: org.city ?? "",
    });
    setEditing(true);
  }

  function handleSave() {
    updateMutation.mutate({
      id,
      name: form.name || undefined,
      legalName: form.legalName || undefined,
      rif: form.rif || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
    });
  }

  if (isLoading) return <p className="text-muted-foreground">Cargando...</p>;
  if (!org) return <p className="text-destructive">Organización no encontrada.</p>;

  const sub = org.subscription;
  const statusColor: Record<string, string> = {
    ACTIVE: "text-green-600",
    TRIAL: "text-yellow-600",
    PAST_DUE: "text-orange-600",
    CANCELED: "text-red-600",
    SUSPENDED: "text-red-600",
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/platform/organizations" className="hover:underline">Organizaciones</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{org.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="text-muted-foreground text-sm">/{org.slug}</p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <>
              <Button variant="outline" size="sm" onClick={startEdit}>Editar</Button>
              {org.active && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm(`¿Desactivar "${org.name}"? Esto suspenderá el acceso.`)) {
                      softDeleteMutation.mutate({ id });
                    }
                  }}
                >
                  Desactivar
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Datos de la organización */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Datos de la organización</CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Nombre comercial *</Label>
                    <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Razón social</Label>
                    <Input value={form.legalName} onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>RIF</Label>
                    <Input value={form.rif} onChange={e => setForm(f => ({ ...f, rif: e.target.value }))} placeholder="J-12345678-9" />
                  </div>
                  <div className="space-y-1">
                    <Label>Email *</Label>
                    <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Teléfono</Label>
                    <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Ciudad</Label>
                    <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <Label>Dirección</Label>
                    <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                  </div>
                  <div className="sm:col-span-2 flex gap-2 pt-2">
                    <Button onClick={handleSave} disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                  <div><dt className="text-muted-foreground">Razón social</dt><dd>{org.legalName ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">RIF</dt><dd>{org.rif ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Email</dt><dd>{org.email}</dd></div>
                  <div><dt className="text-muted-foreground">Teléfono</dt><dd>{org.phone ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Ciudad</dt><dd>{org.city ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Dirección</dt><dd>{org.address ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Estado</dt><dd>{org.active ? "Activa" : "Inactiva"}</dd></div>
                  <div><dt className="text-muted-foreground">Creada</dt><dd>{new Date(org.createdAt).toLocaleDateString("es-VE")}</dd></div>
                </dl>
              )}
            </CardContent>
          </Card>

          {/* Edificios */}
          <Card>
            <CardHeader>
              <CardTitle>Edificios / Comunidades</CardTitle>
              <CardDescription>{org.communities.length} comunidad(es) registrada(s)</CardDescription>
            </CardHeader>
            <CardContent>
              {org.communities.length === 0 ? (
                <p className="text-muted-foreground text-sm">No hay comunidades aún.</p>
              ) : (
                <div className="divide-y">
                  {org.communities.map((c) => (
                    <div key={c.id} className="py-3 flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-muted-foreground">{c.city ?? ""} · {c.totalUnits} unidades</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {c.active ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Panel lateral: suscripción */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Suscripción</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {sub ? (
                <>
                  <div>
                    <p className="text-muted-foreground">Plan</p>
                    <p className="font-semibold text-base">{sub.plan.name}</p>
                    <p className="text-muted-foreground text-xs">{sub.plan.description}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Estado</p>
                    <p className={`font-medium ${statusColor[sub.status] ?? ""}`}>{sub.status}</p>
                  </div>
                  {sub.trialEndsAt && (
                    <div>
                      <p className="text-muted-foreground">Trial hasta</p>
                      <p>{new Date(sub.trialEndsAt).toLocaleDateString("es-VE")}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground">Período actual</p>
                    <p>
                      {new Date(sub.currentPeriodStart).toLocaleDateString("es-VE")} –{" "}
                      {new Date(sub.currentPeriodEnd).toLocaleDateString("es-VE")}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Precio</p>
                    <p className="font-semibold">${sub.plan.priceUsd.toString()} / mes</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Límites del plan</p>
                    <p>{sub.plan.maxCommunities} comunidad(es) · {sub.plan.maxUnits} unidades</p>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">Sin suscripción activa.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Acciones rápidas</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/platform/plans">Cambiar plan</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/platform/organizations">← Volver a la lista</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
