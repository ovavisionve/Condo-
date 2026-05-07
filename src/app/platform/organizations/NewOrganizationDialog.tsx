"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Plan = { id: string; name: string; priceUsd: { toString(): string } };
type Props = { open: boolean; onClose: () => void; onCreated: () => void; plans?: Plan[] };

type OrgType = "RESIDENTIAL" | "COMMERCIAL";

export function NewOrganizationDialog({ open, onClose, onCreated, plans: plansProp }: Props) {
  const plansQ = trpc.platform.plans.list.useQuery(undefined, { enabled: open && !plansProp });
  const plans = plansProp ?? plansQ.data ?? [];
  const createMut = trpc.platform.organizations.create.useMutation();

  // Paso 0 = selección de tipo; pasos 1-3 = wizard normal
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [orgType, setOrgType] = useState<OrgType>("RESIDENTIAL");
  const [form, setForm] = useState({
    slug: "", name: "", legalName: "", rif: "", email: "", phone: "", city: "", address: "",
    planId: "", trialDays: 30,
    adminEmail: "", adminName: "", adminPassword: "",
  });
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function autoSlug(name: string) {
    return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  }

  if (!open) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createMut.mutateAsync({
        ...form,
        type: orgType,
        adminEmail: form.adminEmail.toLowerCase(),
        rif: form.rif || undefined,
        phone: form.phone || undefined,
        city: form.city || undefined,
        address: form.address || undefined,
        legalName: form.legalName || undefined,
      });
      onCreated();
      setForm({ slug: "", name: "", legalName: "", rif: "", email: "", phone: "", city: "", address: "", planId: "", trialDays: 30, adminEmail: "", adminName: "", adminPassword: "" });
      setStep(0);
      setOrgType("RESIDENTIAL");
    } catch (err) {
      if (err instanceof Error) {
        // tRPC Zod errors come as a JSON string — parse and humanize them
        try {
          const parsed = JSON.parse(err.message) as Array<{ path: string[]; message: string }>;
          if (Array.isArray(parsed)) {
            const fieldNames: Record<string, string> = {
              email: "Email de contacto (paso 1)",
              adminEmail: "Email del administrador",
              adminPassword: "Contraseña",
              adminName: "Nombre del administrador",
              name: "Nombre de la organización",
              slug: "Slug",
            };
            const msgs = parsed.map((e) => {
              const field = fieldNames[e.path[e.path.length - 1] ?? ""] ?? e.path.join(".");
              const msg = e.message === "Invalid email" ? "Formato de email inválido" : e.message;
              return `${field}: ${msg}`;
            });
            setError(msgs.join(" · "));
            return;
          }
        } catch {
          // not JSON, fall through
        }
        setError(err.message);
      } else {
        setError("Error al crear");
      }
    }
  };

  const stepLabels = ["1. Datos", "2. Suscripción", "3. Administrador"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-xl overflow-hidden">

        {/* ─── Paso 0: Tipo de organización ─── */}
        {step === 0 && (
          <div className="p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold">¿Qué tipo de cliente es?</h2>
              <p className="text-sm text-muted-foreground mt-1">Selecciona el tipo de organización. Esto determina qué módulos tendrá disponibles.</p>
            </div>

            <div className="grid gap-3">
              {/* RESIDENTIAL */}
              <button
                type="button"
                onClick={() => setOrgType("RESIDENTIAL")}
                className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
                  orgType === "RESIDENTIAL"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent/30"
                }`}
              >
                <div className="flex items-start gap-4">
                  <span className="text-3xl">🏠</span>
                  <div>
                    <p className="font-semibold text-base">Condominio Residencial</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Edificios residenciales, conjuntos habitacionales o urbanizaciones. Alícuotas, facturas mensuales, portal del residente.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {["Propietarios/Inquilinos", "Alícuotas", "Portal residente", "Asambleas", "Libro de actas"].map(t => (
                        <span key={t} className="text-xs bg-muted px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </button>

              {/* COMMERCIAL */}
              <button
                type="button"
                onClick={() => setOrgType("COMMERCIAL")}
                className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
                  orgType === "COMMERCIAL"
                    ? "border-blue-500 bg-blue-50"
                    : "border-border hover:bg-accent/30"
                }`}
              >
                <div className="flex items-start gap-4">
                  <span className="text-3xl">🏬</span>
                  <div>
                    <p className="font-semibold text-base">Centro Comercial</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Galería, centro comercial o edificio de locales. Canon de arrendamiento, declaración de ventas (Decreto 929), Comité Paritario.
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {["Locales / Áncoras", "Canon fijo o variable", "Declaración de ventas", "Comité Paritario", "Eventos de marketing"].map(t => (
                        <span key={t} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                    <span className="inline-block mt-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Nuevo</span>
                  </div>
                </div>
              </button>
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
              <Button type="button" onClick={() => setStep(1)}>
                Continuar con {orgType === "RESIDENTIAL" ? "Residencial" : "Centro Comercial"} →
              </Button>
            </div>
          </div>
        )}

        {/* ─── Pasos 1-3: Wizard ─── */}
        {step > 0 && (
          <>
            {/* Header con tipo elegido */}
            <div className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b ${
              orgType === "COMMERCIAL" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-green-50 text-green-700 border-green-200"
            }`}>
              <span>{orgType === "COMMERCIAL" ? "🏬" : "🏠"}</span>
              <span>{orgType === "COMMERCIAL" ? "Centro Comercial" : "Condominio Residencial"}</span>
              <button
                type="button"
                onClick={() => setStep(0)}
                className="ml-auto text-xs underline opacity-70 hover:opacity-100"
              >
                Cambiar
              </button>
            </div>

            {/* Progress bar */}
            <div className="flex border-b">
              {stepLabels.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { if (i + 1 < step) setStep(i + 1 as 1 | 2 | 3); }}
                  className={`flex-1 py-3 text-xs font-medium text-center transition-colors border-b-2 ${
                    step === i + 1
                      ? "border-primary text-primary bg-primary/5"
                      : step > i + 1
                        ? "border-green-500 text-green-700 bg-green-50/50 cursor-pointer hover:bg-green-50"
                        : "border-transparent text-muted-foreground"
                  }`}
                >
                  {step > i + 1 ? "✓ " : ""}{t}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              {/* Paso 1: Datos org */}
              {step === 1 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>{orgType === "COMMERCIAL" ? "Nombre del centro comercial *" : "Nombre comercial *"}</Label>
                      <Input
                        value={form.name}
                        onChange={(e) => {
                          set("name", e.target.value);
                          if (!form.slug) set("slug", autoSlug(e.target.value));
                        }}
                        placeholder={orgType === "COMMERCIAL" ? "Centro Comercial Las Vegas" : "Condominio El Pinar"}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Slug (URL) *</Label>
                      <Input
                        value={form.slug}
                        onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                        placeholder={orgType === "COMMERCIAL" ? "cc-las-vegas" : "el-pinar"}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Razón social</Label>
                      <Input value={form.legalName} onChange={(e) => set("legalName", e.target.value)} placeholder="C.A." />
                    </div>
                    <div className="space-y-1">
                      <Label>RIF</Label>
                      <Input value={form.rif} onChange={(e) => set("rif", e.target.value)} placeholder="J-12345678-9" />
                    </div>
                    <div className="space-y-1">
                      <Label>Email de contacto *</Label>
                      <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="admin@ejemplo.com" required />
                    </div>
                    <div className="space-y-1">
                      <Label>Teléfono</Label>
                      <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+58 414-0000000" />
                    </div>
                    <div className="space-y-1">
                      <Label>Ciudad</Label>
                      <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Caracas" />
                    </div>
                    <div className="space-y-1">
                      <Label>Dirección</Label>
                      <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Av. Principal" />
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button type="button" onClick={() => setStep(2)} disabled={!form.name || !form.slug || !form.email}>
                      Siguiente →
                    </Button>
                  </div>
                </div>
              )}

              {/* Paso 2: Suscripción */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label>Plan *</Label>
                    <div className="grid gap-2">
                      {plans.map((p) => (
                        <label
                          key={p.id}
                          className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${
                            form.planId === p.id ? "border-primary bg-primary/5" : "hover:bg-accent/30"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="radio"
                              name="plan"
                              value={p.id}
                              checked={form.planId === p.id}
                              onChange={() => set("planId", p.id)}
                              className="accent-primary"
                            />
                            <span className="font-medium">{p.name}</span>
                          </div>
                          <span className="text-sm font-bold text-green-700">${p.priceUsd.toString()}/mes</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Días de prueba gratuita</Label>
                    <div className="flex gap-2 flex-wrap">
                      {[0, 14, 30, 60, 90].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => set("trialDays", d)}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                            form.trialDays === d ? "border-primary bg-primary/5 font-medium" : "hover:bg-accent/30"
                          }`}
                        >
                          {d === 0 ? "Sin trial" : `${d} días`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-between pt-2">
                    <Button type="button" variant="outline" onClick={() => setStep(1)}>← Atrás</Button>
                    <Button type="button" onClick={() => setStep(3)} disabled={!form.planId}>Siguiente →</Button>
                  </div>
                </div>
              )}

              {/* Paso 3: Admin */}
              {step === 3 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Este usuario tendrá rol <strong>ORG_ADMIN</strong> y podrá gestionar la organización completa.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Nombre completo *</Label>
                      <Input value={form.adminName} onChange={(e) => set("adminName", e.target.value)} placeholder="Carlos Pérez" required />
                    </div>
                    <div className="space-y-1">
                      <Label>Email de acceso *</Label>
                      <Input type="email" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} placeholder="carlos@ejemplo.com" required />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label>Contraseña inicial *</Label>
                      <Input
                        type="text"
                        value={form.adminPassword}
                        onChange={(e) => set("adminPassword", e.target.value)}
                        placeholder="Mínimo 8 caracteres — el admin debe cambiarla luego"
                        minLength={8}
                        required
                      />
                      <p className="text-xs text-muted-foreground">Anota esta contraseña y entrégasela al cliente de forma segura.</p>
                    </div>
                  </div>

                  {/* Resumen */}
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
                    <p className="font-medium text-sm mb-2">Resumen del cliente</p>
                    <p>{orgType === "COMMERCIAL" ? "🏬" : "🏠"} <strong>{form.name}</strong> (/{form.slug}) — {orgType === "COMMERCIAL" ? "Centro Comercial" : "Residencial"}</p>
                    <p>📧 {form.email}</p>
                    <p>💼 {plans.find(p => p.id === form.planId)?.name ?? "—"} · {form.trialDays > 0 ? `${form.trialDays} días de trial` : "Sin trial"}</p>
                    <p>👤 Admin: {form.adminName} ({form.adminEmail})</p>
                  </div>

                  {error && <p className="text-sm text-destructive bg-destructive/10 rounded p-2">{error}</p>}

                  <div className="flex justify-between pt-2">
                    <Button type="button" variant="outline" onClick={() => setStep(2)}>← Atrás</Button>
                    <Button type="submit" disabled={createMut.isPending || !form.adminName || !form.adminEmail || !form.adminPassword}>
                      {createMut.isPending ? "Creando..." : "✓ Crear organización"}
                    </Button>
                  </div>
                </div>
              )}
            </form>

            <div className="border-t px-6 py-3 flex justify-between items-center bg-muted/20">
              <p className="text-xs text-muted-foreground">Paso {step} de 3</p>
              <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
