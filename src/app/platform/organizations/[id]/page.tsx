"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type Tab = "resumen" | "comunidades" | "admins" | "suscripcion" | "actividad";

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 border-green-200",
  TRIAL: "bg-yellow-100 text-yellow-700 border-yellow-200",
  PAST_DUE: "bg-orange-100 text-orange-700 border-orange-200",
  SUSPENDED: "bg-red-100 text-red-700 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activo", TRIAL: "Trial", PAST_DUE: "Vencido",
  SUSPENDED: "Suspendido", CANCELLED: "Cancelado",
};

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("resumen");

  const { data: org, isLoading, refetch } = trpc.platform.organizations.byId.useQuery({ id });
  const { data: admins, refetch: refetchAdmins } = trpc.platform.organizations.listAdmins.useQuery({ organizationId: id }, { enabled: !!id });
  const { data: auditLog } = trpc.platform.organizations.auditLog.useQuery({ organizationId: id, take: 30 }, { enabled: tab === "actividad" });
  const { data: plans } = trpc.platform.plans.list.useQuery();

  const updateMut = trpc.platform.organizations.update.useMutation({ onSuccess: () => void refetch() });
  const updateSubMut = trpc.platform.organizations.updateSubscription.useMutation({ onSuccess: () => void refetch() });
  const softDeleteMut = trpc.platform.organizations.softDelete.useMutation({ onSuccess: () => router.push("/platform/organizations") });
  const toggleAiMut = trpc.ai.toggleEnabled.useMutation({ onSuccess: () => void refetch() });
  const createAdminMut = trpc.platform.organizations.createAdmin.useMutation({
    onSuccess: () => { void refetchAdmins(); setShowNewAdmin(false); setAdminForm({ email: "", name: "", password: "", role: "ORG_ADMIN" }); setAdminErr(null); },
    onError: (e) => setAdminErr(e.message),
  });
  const removeAdminMut = trpc.platform.organizations.removeAdmin.useMutation({ onSuccess: () => void refetchAdmins() });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", legalName: "", rif: "", email: "", phone: "", address: "", city: "" });

  const [showNewAdmin, setShowNewAdmin] = useState(false);
  const [adminForm, setAdminForm] = useState({ email: "", name: "", password: "", role: "ORG_ADMIN" as "ORG_ADMIN" | "COMMUNITY_ADMIN" });
  const [adminErr, setAdminErr] = useState<string | null>(null);

  // Subscription management state
  const [subAction, setSubAction] = useState<"none" | "changePlan" | "extendTrial" | "addNote">("none");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [extendDays, setExtendDays] = useState(30);
  const [subNote, setSubNote] = useState("");

  function startEdit() {
    if (!org) return;
    setForm({ name: org.name, legalName: org.legalName ?? "", rif: org.rif ?? "", email: org.email, phone: org.phone ?? "", address: org.address ?? "", city: org.city ?? "" });
    setEditing(true);
  }

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted rounded w-64" /><div className="h-48 bg-muted rounded" /></div>;
  if (!org) return <p className="text-destructive">Organización no encontrada.</p>;

  const sub = org.subscription;
  const trialDaysLeft = sub?.trialEndsAt
    ? Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000)
    : null;

  const TABS: { key: Tab; label: string }[] = [
    { key: "resumen", label: "📋 Resumen" },
    { key: "comunidades", label: `🏢 Comunidades (${org.communities.length})` },
    { key: "admins", label: `👤 Admins (${admins?.length ?? "…"})` },
    { key: "suscripcion", label: "💳 Suscripción" },
    { key: "actividad", label: "📜 Actividad" },
  ];

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/platform/organizations" className="hover:underline">Organizaciones</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{org.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-xl font-bold text-primary">
            {org.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold">{org.name}</h1>
              {/* Tipo de organización */}
              {"type" in org && (
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  (org as { type?: string }).type === "COMMERCIAL"
                    ? "bg-blue-100 text-blue-700 border-blue-200"
                    : "bg-gray-100 text-gray-600 border-gray-200"
                }`}>
                  {(org as { type?: string }).type === "COMMERCIAL" ? "🏬 Centro Comercial" : "🏠 Residencial"}
                </span>
              )}
              {sub && (
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[sub.status] ?? ""}`}>
                  {STATUS_LABEL[sub.status] ?? sub.status}
                </span>
              )}
              {!org.active && (
                <span className="rounded-full border border-red-300 bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                  Inactiva
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              /{org.slug}
              {sub && ` · ${sub.plan.name} · $${sub.plan.priceUsd.toString()}/mes`}
              {sub?.status === "TRIAL" && trialDaysLeft !== null && (
                <span className={trialDaysLeft <= 7 ? " text-orange-600 font-medium" : ""}>
                  {" · Trial: "}
                  {trialDaysLeft > 0 ? `${trialDaysLeft} días restantes` : "expirado"}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {!editing && (
            <>
              <Button variant="outline" size="sm" onClick={startEdit}>✏️ Editar</Button>
              {org.active && (
                <Button variant="destructive" size="sm" onClick={() => {
                  if (confirm(`¿Desactivar "${org.name}"? Suspenderá el acceso.`))
                    softDeleteMut.mutate({ id });
                }}>
                  Desactivar
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Unidades", value: org.stats.unitsCount.toLocaleString() },
          { label: "Comunidades", value: org.communities.length },
          { label: "Total facturado", value: `$${org.stats.totalInvoicedUsd.toFixed(0)}` },
          { label: "Total cobrado", value: `$${org.stats.totalPaidUsd.toFixed(0)}` },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border bg-card p-3 text-center">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Edit inline */}
      {editing && (
        <Card>
          <CardHeader><CardTitle>Editar organización</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Nombre *", key: "name" as const },
                { label: "Razón social", key: "legalName" as const },
                { label: "RIF", key: "rif" as const },
                { label: "Email *", key: "email" as const },
                { label: "Teléfono", key: "phone" as const },
                { label: "Ciudad", key: "city" as const },
              ].map(({ label, key }) => (
                <div key={key} className="space-y-1">
                  <Label>{label}</Label>
                  <Input value={form[key]} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              <div className="sm:col-span-2 space-y-1">
                <Label>Dirección</Label>
                <Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={() => updateMut.mutate({ id, ...form })} disabled={updateMut.isPending}>
                {updateMut.isPending ? "Guardando..." : "Guardar"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="border-b flex gap-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Resumen ─── */}
      {tab === "resumen" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Datos de la organización</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-2 sm:grid-cols-2 text-sm">
                  {[
                    ["Razón social", org.legalName],
                    ["RIF", org.rif],
                    ["Email", org.email],
                    ["Teléfono", org.phone],
                    ["Ciudad", org.city],
                    ["Dirección", org.address],
                    ["Estado", org.active ? "✅ Activa" : "❌ Inactiva"],
                    ["Creada", new Date(org.createdAt).toLocaleDateString("es-VE")],
                  ].map(([label, val]) => (
                    <div key={String(label)}>
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="font-medium">{val ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Suscripción actual</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2">
                {sub ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Plan</span>
                      <span className="font-semibold">{sub.plan.name} — ${sub.plan.priceUsd.toString()}/mes</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Estado</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[sub.status] ?? ""}`}>{STATUS_LABEL[sub.status] ?? sub.status}</span>
                    </div>
                    {sub.trialEndsAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Trial hasta</span>
                        <span>{new Date(sub.trialEndsAt).toLocaleDateString("es-VE")} ({trialDaysLeft}d)</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Período actual</span>
                      <span>{new Date(sub.currentPeriodStart).toLocaleDateString("es-VE")} – {new Date(sub.currentPeriodEnd).toLocaleDateString("es-VE")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Límites</span>
                      <span>{sub.plan.maxCommunities} edif. · {sub.plan.maxUnits} unidades</span>
                    </div>
                    {sub.notes && <div className="rounded bg-muted/50 p-2 text-xs mt-2">📝 {sub.notes}</div>}
                    <div className="pt-2">
                      <Button size="sm" variant="outline" onClick={() => setTab("suscripcion")}>Gestionar suscripción →</Button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">Sin suscripción activa.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* AI Toggle Card */}
          <Card>
            <CardHeader>
              <CardTitle>🤖 Asistente de IA (Gemini)</CardTitle>
              <CardDescription>
                Habilita el bot de consultas con Gemini AI para esta organización.
                Cuando está activo, los administradores verán un botón flotante de chat con acceso a datos en tiempo real.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {(org as { aiEnabled?: boolean }).aiEnabled ? "✅ IA habilitada" : "⭕ IA deshabilitada"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(org as { aiEnabled?: boolean }).aiEnabled
                      ? "El bot está disponible en los módulos residencial y comercial de esta organización."
                      : "El bot está oculto para los usuarios de esta organización."}
                  </p>
                </div>
                <button
                  onClick={() =>
                    toggleAiMut.mutate({
                      organizationId: id,
                      enabled: !(org as { aiEnabled?: boolean }).aiEnabled,
                    })
                  }
                  disabled={toggleAiMut.isPending}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 ${
                    (org as { aiEnabled?: boolean }).aiEnabled ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                      (org as { aiEnabled?: boolean }).aiEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Tab: Comunidades ─── */}
      {tab === "comunidades" && (
        <Card>
          <CardHeader>
            <CardTitle>Edificios / Comunidades</CardTitle>
            <CardDescription>{org.communities.length} comunidad(es) registrada(s)</CardDescription>
          </CardHeader>
          <CardContent>
            {org.communities.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay comunidades aún. El cliente debe crearlas desde su panel.</p>
            ) : (
              <div className="divide-y">
                {org.communities.map((c) => (
                  <div key={c.id} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.city ?? ""}
                        {c.city && " · "}
                        {c.totalUnits} unidades
                      </p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${c.active ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                      {c.active ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Tab: Admins ─── */}
      {tab === "admins" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Administradores</CardTitle>
              <CardDescription>Usuarios con acceso a esta organización</CardDescription>
            </div>
            <Button size="sm" onClick={() => { setShowNewAdmin(true); setAdminErr(null); }}>+ Agregar admin</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {showNewAdmin && (
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <p className="text-sm font-medium">Nuevo administrador</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label>Nombre *</Label><Input value={adminForm.name} onChange={e => setAdminForm(f => ({ ...f, name: e.target.value }))} placeholder="Carlos Pérez" /></div>
                  <div className="space-y-1"><Label>Email *</Label><Input type="email" value={adminForm.email} onChange={e => setAdminForm(f => ({ ...f, email: e.target.value }))} placeholder="carlos@edificio.com" /></div>
                  <div className="space-y-1"><Label>Contraseña *</Label><Input type="text" value={adminForm.password} onChange={e => setAdminForm(f => ({ ...f, password: e.target.value }))} placeholder="mínimo 8 caracteres" /></div>
                  <div className="space-y-1">
                    <Label>Rol</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={adminForm.role} onChange={e => setAdminForm(f => ({ ...f, role: e.target.value as "ORG_ADMIN" | "COMMUNITY_ADMIN" }))}>
                      <option value="ORG_ADMIN">ORG_ADMIN — acceso completo</option>
                      <option value="COMMUNITY_ADMIN">COMMUNITY_ADMIN — solo edificios</option>
                    </select>
                  </div>
                </div>
                {adminErr && <p className="text-sm text-destructive">{adminErr}</p>}
                <div className="flex gap-2">
                  <Button size="sm" disabled={createAdminMut.isPending} onClick={() => createAdminMut.mutate({ organizationId: id, ...adminForm })}>
                    {createAdminMut.isPending ? "Creando..." : "Crear administrador"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowNewAdmin(false)}>Cancelar</Button>
                </div>
              </div>
            )}
            {!admins || admins.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin administradores asignados.</p>
            ) : (
              <div className="divide-y">
                {admins.map((m) => (
                  <div key={m.id} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{m.user.name ?? m.user.email}</p>
                      <p className="text-xs text-muted-foreground">{m.user.email}</p>
                      <div className="flex gap-2 mt-0.5">
                        <span className="inline-block bg-secondary px-1.5 py-0.5 rounded text-xs">{m.role}</span>
                        <span className="text-xs text-muted-foreground">Desde {new Date(m.createdAt).toLocaleDateString("es-VE")}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" disabled={removeAdminMut.isPending}
                      onClick={() => { if (confirm(`¿Revocar acceso de ${m.user.email}?`)) removeAdminMut.mutate({ membershipId: m.id, organizationId: id }); }}
                    >
                      Revocar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Tab: Suscripción ─── */}
      {tab === "suscripcion" && (
        <div className="space-y-4">
          {/* Estado actual */}
          <Card>
            <CardHeader><CardTitle>Estado de la suscripción</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {sub ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><p className="text-xs text-muted-foreground">Plan actual</p><p className="font-semibold text-base">{sub.plan.name}</p><p className="text-muted-foreground text-xs">{sub.plan.description}</p></div>
                  <div><p className="text-xs text-muted-foreground">Estado</p><span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[sub.status] ?? ""}`}>{STATUS_LABEL[sub.status] ?? sub.status}</span></div>
                  <div><p className="text-xs text-muted-foreground">Precio</p><p className="font-bold text-green-700 text-base">${sub.plan.priceUsd.toString()} / mes</p></div>
                  <div><p className="text-xs text-muted-foreground">Límites</p><p>{sub.plan.maxCommunities} edificio(s) · {sub.plan.maxUnits} unidades</p></div>
                  {sub.trialEndsAt && <div><p className="text-xs text-muted-foreground">Trial hasta</p><p>{new Date(sub.trialEndsAt).toLocaleDateString("es-VE")} <span className={trialDaysLeft !== null && trialDaysLeft <= 7 ? "text-orange-600 font-medium" : "text-muted-foreground"}>({trialDaysLeft}d restantes)</span></p></div>}
                  <div><p className="text-xs text-muted-foreground">Período actual</p><p>{new Date(sub.currentPeriodStart).toLocaleDateString("es-VE")} – {new Date(sub.currentPeriodEnd).toLocaleDateString("es-VE")}</p></div>
                  {sub.notes && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Notas CRM</p><p className="rounded bg-muted/50 p-2 text-xs">{sub.notes}</p></div>}
                </div>
              ) : <p className="text-muted-foreground">Sin suscripción.</p>}
            </CardContent>
          </Card>

          {/* Acciones */}
          <Card>
            <CardHeader><CardTitle>Acciones de suscripción</CardTitle><CardDescription>Administra el plan y acceso de este cliente</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {/* Botones de acción rápida */}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setSubAction(a => a === "changePlan" ? "none" : "changePlan")} className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${subAction === "changePlan" ? "border-primary bg-primary/5" : "hover:bg-accent/30"}`}>🔄 Cambiar plan</button>
                <button onClick={() => setSubAction(a => a === "extendTrial" ? "none" : "extendTrial")} className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${subAction === "extendTrial" ? "border-primary bg-primary/5" : "hover:bg-accent/30"}`}>⏳ Extender trial</button>
                <button onClick={() => setSubAction(a => a === "addNote" ? "none" : "addNote")} className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${subAction === "addNote" ? "border-primary bg-primary/5" : "hover:bg-accent/30"}`}>📝 Nota CRM</button>
                <button onClick={() => { if (!sub) return; if (confirm("¿Activar suscripción de este cliente?")) updateSubMut.mutate({ organizationId: id, status: "ACTIVE" }); }} className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors">✅ Activar</button>
                <button onClick={() => { if (!sub) return; if (confirm("¿Marcar como PAST_DUE? El cliente verá aviso de pago vencido.")) updateSubMut.mutate({ organizationId: id, status: "PAST_DUE" }); }} className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 transition-colors">🟠 Marcar vencido</button>
                <button onClick={() => { if (!sub) return; if (confirm("¿Suspender acceso? El cliente no podrá ingresar hasta que se reactive.")) updateSubMut.mutate({ organizationId: id, status: "SUSPENDED" }); }} className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors">🔴 Suspender</button>
              </div>

              {/* Panel: Cambiar plan */}
              {subAction === "changePlan" && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <p className="font-medium text-sm">Cambiar plan</p>
                  <div className="grid gap-2">
                    {plans?.map((p) => (
                      <label key={p.id} className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${selectedPlanId === p.id ? "border-primary bg-primary/5" : "hover:bg-accent/30"}`}>
                        <div className="flex items-center gap-3">
                          <input type="radio" name="newPlan" value={p.id} checked={selectedPlanId === p.id} onChange={() => setSelectedPlanId(p.id)} className="accent-primary" />
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.maxCommunities} edif. · {p.maxUnits} unidades</p>
                          </div>
                        </div>
                        <span className="font-bold text-green-700">${p.priceUsd.toString()}/mes</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!selectedPlanId || updateSubMut.isPending} onClick={() => { updateSubMut.mutate({ organizationId: id, planId: selectedPlanId }); setSubAction("none"); setSelectedPlanId(""); }}>
                      {updateSubMut.isPending ? "Guardando..." : "Aplicar cambio de plan"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSubAction("none")}>Cancelar</Button>
                  </div>
                </div>
              )}

              {/* Panel: Extender trial */}
              {subAction === "extendTrial" && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <p className="font-medium text-sm">Extender período de prueba</p>
                  <div className="flex gap-2">
                    {[7, 14, 30, 60, 90].map((d) => (
                      <button key={d} type="button" onClick={() => setExtendDays(d)} className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${extendDays === d ? "border-primary bg-primary/5 font-medium" : "hover:bg-accent/30"}`}>{d}d</button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Se agregarán {extendDays} días al trial {sub?.trialEndsAt && sub.trialEndsAt > new Date() ? "actual" : "desde hoy"}.</p>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={updateSubMut.isPending} onClick={() => { updateSubMut.mutate({ organizationId: id, extendTrialDays: extendDays }); setSubAction("none"); }}>
                      {updateSubMut.isPending ? "Guardando..." : `Agregar ${extendDays} días`}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSubAction("none")}>Cancelar</Button>
                  </div>
                </div>
              )}

              {/* Panel: Nota CRM */}
              {subAction === "addNote" && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <p className="font-medium text-sm">Nota interna (CRM)</p>
                  <textarea
                    value={subNote}
                    onChange={e => setSubNote(e.target.value)}
                    placeholder="Ej: Cliente interesado en plan PRO. Llamar el martes. Pagó con Zelle el 2/5."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none h-24"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={updateSubMut.isPending} onClick={() => { updateSubMut.mutate({ organizationId: id, notes: subNote }); setSubAction("none"); }}>
                      {updateSubMut.isPending ? "Guardando..." : "Guardar nota"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSubAction("none")}>Cancelar</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Tab: Actividad ─── */}
      {tab === "actividad" && (
        <Card>
          <CardHeader><CardTitle>Registro de actividad</CardTitle><CardDescription>Últimas 30 acciones auditadas</CardDescription></CardHeader>
          <CardContent>
            {!auditLog || auditLog.length === 0 ? (
              <p className="text-muted-foreground text-sm">Sin actividad registrada.</p>
            ) : (
              <div className="divide-y text-sm">
                {auditLog.map((entry) => (
                  <div key={entry.id} className="py-2.5 flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{entry.action} — <span className="text-muted-foreground font-normal">{entry.entityType}</span></p>
                      <p className="text-xs text-muted-foreground">
                        {entry.actor?.name ?? entry.actor?.email ?? "Sistema"}
                        {" · "}
                        {new Date(entry.createdAt).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{(entry.entityId ?? "").slice(-8).toUpperCase()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
