"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../OrgContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CommunityOverview() {
  const { id } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const community = trpc.org.communities.byId.useQuery({ organizationId, id });
  const units = trpc.org.units.list.useQuery({ organizationId, communityId: id });
  const aging = trpc.finance.aging.useQuery({ organizationId, communityId: id });
  const rate = trpc.finance.exchange.current.useQuery({ organizationId });
  const utils = trpc.useUtils();

  const [editing, setEditing] = useState(false);
  const updateCommunity = trpc.org.communities.update.useMutation();

  const sumAliquot = units.data?.reduce((s, u) => s + Number(u.aliquot.toString()), 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Unidades</CardDescription>
            <CardTitle className="text-3xl">{units.data?.length ?? "-"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Suma de alícuotas: {sumAliquot.toFixed(4)}%
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Tasa BCV (USD→VES)</CardDescription>
            <CardTitle className="text-3xl">
              {rate.data ? Number(rate.data.vesPerUsd).toFixed(2) : "..."}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {rate.data ? `${rate.data.source} · ${new Date(rate.data.date).toLocaleDateString("es-VE")}` : ""}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Cartera vencida</CardDescription>
            <CardTitle className="text-3xl">
              ${aging.data ? sumAgingUsd(aging.data) : "0.00"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {aging.data
              ? `${aging.data.d_0_30.count + aging.data.d_31_60.count + aging.data.d_61_90.count + aging.data.d_90_plus.count} recibo(s) vencido(s)`
              : ""}
          </CardContent>
        </Card>
      </div>

      {/* Información del edificio */}
      {community.data && (
        editing ? (
          <EditCommunityForm
            community={community.data}
            organizationId={organizationId}
            onSave={async (fields) => {
              await updateCommunity.mutateAsync({ organizationId, id, ...fields });
              await utils.org.communities.byId.invalidate({ organizationId, id });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
            isSaving={updateCommunity.isPending}
          />
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">Información del edificio</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                ✏️ Editar
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Field label="Nombre" value={community.data.name} />
                <Field label="Dirección" value={community.data.address} />
                <Field label="Ciudad" value={community.data.city} />
                <Field label="Estado" value={community.data.state ?? "—"} />
                <Field label="RIF" value={(community.data as { rif?: string | null }).rif ?? "—"} />
                <Field label="País" value={community.data.country} />
                <Field label="Teléfono" value={(community.data as { phone?: string | null }).phone ?? "—"} />
                <Field label="Email de contacto" value={(community.data as { email?: string | null }).email ?? "—"} />
                <Field label="Web / Redes" value={(community.data as { website?: string | null }).website ?? "—"} />
                <Field label="Torres" value={String(community.data.towersCount ?? 1)} />
                <Field label="Pisos" value={community.data.floorsCount != null ? String(community.data.floorsCount) : "—"} />
                <Field label="Activo" value={community.data.active ? "Sí" : "No"} />
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

// ─── Formulario de edición ────────────────────────────────────────────────────

type CommunityData = {
  name: string;
  address: string;
  city: string;
  state?: string | null;
  country: string;
  towersCount: number;
  floorsCount?: number | null;
  active: boolean;
  [key: string]: unknown;
};

function EditCommunityForm({
  community,
  organizationId: _org,
  onSave,
  onCancel,
  isSaving,
}: {
  community: CommunityData;
  organizationId: string;
  onSave: (fields: {
    name?: string;
    rif?: string;
    address?: string;
    city?: string;
    state?: string;
    phone?: string;
    email?: string;
    website?: string;
    logoUrl?: string | null;
    invoicePeriodShift?: number;
    floorsCount?: number | null;
    towersCount?: number;
  }) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const c = community as CommunityData & { rif?: string | null; phone?: string | null; email?: string | null; website?: string | null; logoUrl?: string | null; invoicePeriodShift?: number };

  const [name, setName] = useState(c.name);
  const [rif, setRif] = useState(c.rif ?? "");
  const [address, setAddress] = useState(c.address);
  const [city, setCity] = useState(c.city);
  const [state, setState] = useState(c.state ?? "");
  const [phone, setPhone] = useState(c.phone ?? "");
  const [email, setEmail] = useState(c.email ?? "");
  const [website, setWebsite] = useState(c.website ?? "");
  const [logoUrl, setLogoUrl] = useState(c.logoUrl ?? "");
  const [invoicePeriodShift, setInvoicePeriodShift] = useState(String(c.invoicePeriodShift ?? 1));
  const [floorsCount, setFloorsCount] = useState(c.floorsCount != null ? String(c.floorsCount) : "");
  const [towersCount, setTowersCount] = useState(String(c.towersCount ?? 1));
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setErr(null);
    if (!name.trim() || !address.trim() || !city.trim()) {
      setErr("Nombre, dirección y ciudad son obligatorios.");
      return;
    }
    try {
      await onSave({
        name: name.trim(),
        rif: rif.trim() || undefined,
        address: address.trim(),
        city: city.trim(),
        state: state.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        website: website.trim() || undefined,
        logoUrl: logoUrl.trim() ? logoUrl.trim() : null,
        invoicePeriodShift: Number(invoicePeriodShift),
        floorsCount: floorsCount ? Number(floorsCount) : null,
        towersCount: towersCount ? Number(towersCount) : undefined,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error al guardar.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Editar información del edificio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}

        {/* Identificación */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificación</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-name">Nombre del edificio *</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-rif">RIF</Label>
              <Input id="c-rif" value={rif} onChange={(e) => setRif(e.target.value)} placeholder="J-12345678-9" disabled={isSaving} />
            </div>
          </div>
        </div>

        {/* Ubicación */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ubicación</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-address">Dirección *</Label>
              <Input id="c-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Av. Principal, edificio..." disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-city">Ciudad *</Label>
              <Input id="c-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Valencia" disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-state">Estado</Label>
              <Input id="c-state" value={state} onChange={(e) => setState(e.target.value)} placeholder="Carabobo" disabled={isSaving} />
            </div>
          </div>
        </div>

        {/* Contacto */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacto</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Teléfono / WhatsApp</Label>
              <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0241-1234567" disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email de contacto</Label>
              <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="administracion@edificio.com" disabled={isSaving} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-website">Página web / Instagram / Red social</Label>
              <Input id="c-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." disabled={isSaving} />
            </div>
          </div>
        </div>

        {/* Branding */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Logo del condominio</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="c-logo">URL del logo (PNG / JPG)</Label>
              <Input
                id="c-logo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://i.imgur.com/abc.png"
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                Aparecerá arriba a la izquierda en todos los recibos PDF emitidos.
                Subí tu logo a un host público (Imgur, Cloudinary, Supabase Storage) y pegá el link aquí.
              </p>
            </div>
            {logoUrl.trim() && (
              <div className="flex items-center justify-center rounded border bg-muted/30 p-2 min-w-[80px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl.trim()}
                  alt="Preview logo"
                  className="h-16 w-16 object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Facturación */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Facturación</p>
          <div className="space-y-1.5 max-w-md">
            <Label htmlFor="c-shift">Período de gastos vs. recibo</Label>
            <select
              id="c-shift"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={invoicePeriodShift}
              onChange={(e) => setInvoicePeriodShift(e.target.value)}
              disabled={isSaving}
            >
              <option value="0">Mismo mes — recibo de julio cobra gastos de julio</option>
              <option value="1">Post-mes (Recomendado) — recibo de julio cobra gastos de junio</option>
              <option value="2">2 meses atrás — recibo de julio cobra gastos de mayo</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Práctica venezolana estándar: <strong>post-mes</strong>. El admin carga los gastos durante el mes (junio) y los cobra en el recibo del mes siguiente (julio).
            </p>
          </div>
        </div>

        {/* Estructura */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estructura</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="c-towers">Torres</Label>
              <Input id="c-towers" type="number" min="1" value={towersCount} onChange={(e) => setTowersCount(e.target.value)} disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-floors">Pisos</Label>
              <Input id="c-floors" type="number" min="1" value={floorsCount} onChange={(e) => setFloorsCount(e.target.value)} placeholder="—" disabled={isSaving} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function sumAgingUsd(data: Record<string, { usd: string }>): string {
  const sum = Object.values(data).reduce((s, b) => s + Number(b.usd), 0);
  return sum.toFixed(2);
}
