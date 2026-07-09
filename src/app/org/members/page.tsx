"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PERMISSIONS, PERMISSION_GROUPS, CARGO_PRESETS, type Permission } from "@/lib/staff-permissions";

export default function MembersPage() {
  const organizationId = useOrgId();
  const list = trpc.org.members.list.useQuery({ organizationId });
  const createMember = trpc.org.members.create.useMutation();
  const updateMember = trpc.org.members.update.useMutation();
  const revokeMember = trpc.org.members.revoke.useMutation();
  const resetPasswordMember = trpc.org.members.resetPassword.useMutation();
  const utils = trpc.useUtils();
  const [resetCreds, setResetCreds] = useState<{ email: string; password: string } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    cargo: "",
    cargoPreset: "",
    permissions: [] as Permission[],
  });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const applyPreset = (presetValue: string) => {
    const preset = CARGO_PRESETS.find((p) => p.value === presetValue);
    if (preset) {
      setForm((f) => ({
        ...f,
        cargoPreset: presetValue,
        cargo: preset.value === "FULL_ADMIN" ? "Administrador General" : preset.label,
        permissions: [...preset.permissions],
      }));
    }
  };

  const togglePermission = (perm: Permission) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(perm)
        ? f.permissions.filter((p) => p !== perm)
        : [...f.permissions, perm],
    }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setOk(false);
    try {
      if (editingId) {
        await updateMember.mutateAsync({
          organizationId,
          membershipId: editingId,
          cargo: form.cargo,
          permissions: form.permissions,
          email: form.email,
        });
      } else {
        await createMember.mutateAsync({
          organizationId,
          name: form.name,
          email: form.email,
          password: form.password,
          cargo: form.cargo,
          permissions: form.permissions,
        });
      }
      setOk(true);
      setShowForm(false);
      setEditingId(null);
      setForm({ name: "", email: "", password: "", cargo: "", cargoPreset: "", permissions: [] });
      void utils.org.members.list.invalidate();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  };

  const onEdit = (m: NonNullable<typeof list.data>[0]) => {
    setEditingId(m.id);
    const perms = (m as { permissions?: string[] }).permissions ?? [];
    setForm({
      name: m.user.name ?? "",
      email: m.user.email,
      password: "",
      cargo: (m as { cargo?: string }).cargo ?? "",
      cargoPreset: "",
      permissions: perms as Permission[],
    });
    setShowForm(true);
    setErr(null);
    setOk(false);
  };

  const onRevoke = async (m: NonNullable<typeof list.data>[0]) => {
    if (!confirm(`¿Revocar acceso de ${m.user.email}?`)) return;
    await revokeMember.mutateAsync({ organizationId, membershipId: m.id });
    void utils.org.members.list.invalidate();
  };

  const onResetPassword = async (m: NonNullable<typeof list.data>[0]) => {
    if (!confirm(`¿Generar una clave nueva para ${m.user.email}? La clave actual dejará de funcionar.`)) return;
    setResettingId(m.id);
    setResetCreds(null);
    try {
      const result = await resetPasswordMember.mutateAsync({ organizationId, membershipId: m.id });
      setResetCreds({ email: result.email, password: result.password });
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Personal de la organización</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestiona el equipo con acceso al sistema. Cada miembro tiene un cargo y permisos específicos.
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: "", email: "", password: "", cargo: "", cargoPreset: "", permissions: [] }); setErr(null); setOk(false); }}>
            + Agregar personal
          </Button>
        )}
      </div>

      {ok && <p className="text-sm text-green-600 font-medium">✓ {editingId ? "Cambios guardados." : "Personal creado correctamente."}</p>}

      {resetCreds && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center justify-between gap-3">
          <span>
            ✓ Clave nueva para <strong>{resetCreds.email}</strong>: <code className="bg-white px-1.5 py-0.5 rounded border">{resetCreds.password}</code> — cópiala y entrégasela, no se volverá a mostrar.
          </span>
          <button className="text-green-700 hover:underline text-xs shrink-0" onClick={() => setResetCreds(null)}>Cerrar</button>
        </div>
      )}

      {/* Formulario */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Editar personal" : "Nuevo miembro del personal"}</CardTitle>
            <CardDescription>
              Selecciona un cargo predefinido o personaliza los permisos manualmente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              {!editingId ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label>Nombre completo *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Pedro Pérez"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Email *</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="pedro@edificio.com"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Contraseña inicial *</Label>
                    <Input
                      type="text"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="mínimo 8 caracteres"
                      required
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1 sm:max-w-sm">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="pedro@edificio.com"
                    required
                  />
                </div>
              )}

              {/* Cargo y preset */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Cargo predefinido</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.cargoPreset}
                    onChange={(e) => applyPreset(e.target.value)}
                  >
                    <option value="">— Elige un cargo —</option>
                    {CARGO_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Título del cargo (editable) *</Label>
                  <Input
                    value={form.cargo}
                    onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))}
                    placeholder="Ej: Tesorero, Contador, Conserje..."
                    required
                  />
                </div>
              </div>

              {/* Checklist de permisos */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Permisos asignados</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  {PERMISSION_GROUPS.map((group) => (
                    <div key={group.label} className="rounded-md border p-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>
                      {group.keys.map((perm) => (
                        <label key={perm} className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.permissions.includes(perm)}
                            onChange={() => togglePermission(perm)}
                            className="mt-0.5 h-4 w-4 rounded border-input"
                          />
                          <span className="text-xs">{PERMISSIONS[perm]}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {form.permissions.length === 0
                    ? "⚠️ Sin permisos seleccionados — el usuario no podrá hacer nada en el sistema."
                    : `${form.permissions.length} permiso(s) asignado(s)`}
                </p>
              </div>

              {err && <p className="text-sm text-destructive">{err}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={createMember.isPending || updateMember.isPending}>
                  {createMember.isPending || updateMember.isPending ? "Guardando..." : editingId ? "Guardar cambios" : "Crear personal"}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingId(null); }}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Lista de personal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal activo</CardTitle>
          <CardDescription>{list.data?.length ?? 0} miembro(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {!list.data || list.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin personal registrado. Agrega tu primer miembro arriba.</p>
          ) : (
            <div className="divide-y">
              {list.data.map((m) => {
                const perms = (m as { permissions?: string[] }).permissions ?? [];
                const cargo = (m as { cargo?: string }).cargo;
                return (
                  <div key={m.id} className="py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{m.user.name ?? m.user.email}</p>
                        {cargo && (
                          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">{cargo}</span>
                        )}
                        {m.role === "ORG_ADMIN" && !cargo && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Admin completo</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{m.user.email}</p>
                      {perms.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {perms.map((p) => (
                            <span key={p} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {PERMISSIONS[p as Permission] ?? p}
                            </span>
                          ))}
                        </div>
                      )}
                      {perms.length === 0 && m.role !== "ORG_ADMIN" && (
                        <p className="text-xs text-amber-600">Sin permisos asignados</p>
                      )}
                      {m.user.lastLoginAt && (
                        <p className="text-xs text-muted-foreground">
                          Último acceso: {new Date(m.user.lastLoginAt).toLocaleDateString("es-VE")}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => onEdit(m)}>
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resettingId === m.id}
                        onClick={() => onResetPassword(m)}
                      >
                        {resettingId === m.id ? "..." : "🔑 Resetear clave"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10"
                        disabled={revokeMember.isPending}
                        onClick={() => onRevoke(m)}
                      >
                        Revocar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
