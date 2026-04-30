"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const VEHICLE_TYPES: Record<string, string> = {
  CAR: "Carro",
  MOTORCYCLE: "Moto",
  TRUCK: "Camión",
  VAN: "Van/Camioneta",
  OTHER: "Otro",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  ISSUED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  VOIDED: "bg-zinc-200 text-zinc-600 line-through",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  PARTIAL: "Parcial",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  VOIDED: "Anulada",
};

export default function UnitDetailPage() {
  const { id: communityId, unitId } = useParams<{ id: string; unitId: string }>();
  const organizationId = useOrgId();
  const [showAddVehicle, setShowAddVehicle] = useState<string | null>(null); // personId
  const [showAssignPerson, setShowAssignPerson] = useState<"OWNER" | "TENANT" | null>(null);
  const [showFineForm, setShowFineForm] = useState(false);
  const [showExtraFeeForm, setShowExtraFeeForm] = useState(false);

  const { data: unit, refetch } = trpc.org.units.detail.useQuery({ organizationId, unitId });
  const rate = trpc.finance.exchange.current.useQuery({ organizationId });
  const todayRate = Number(rate.data?.vesPerUsd ?? 0);
  const utils = trpc.useUtils();

  if (!unit) return <div className="text-muted-foreground">Cargando...</div>;

  const currentOwners = unit.ownerships;
  const currentTenants = unit.tenancies;
  const allPersons = [
    ...currentOwners.map((o) => ({ ...o.person, role: "Propietario" as const, unitRole: o })),
    ...currentTenants.map((t) => ({ ...t.person, role: "Inquilino" as const, unitRole: t })),
  ];
  const allVehicles = allPersons.flatMap((p) => p.vehicles.map((v) => ({ ...v, ownerName: `${p.firstName} ${p.lastName}` })));

  const balance = unit.invoices.reduce(
    (acc, inv) => ({
      usd: acc.usd + Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString()),
      bss: acc.bss + Number(inv.totalBss.toString()) - Number(inv.paidBss.toString()),
    }),
    { usd: 0, bss: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/org/communities/${communityId}/units`} className="text-sm text-muted-foreground hover:underline">
          ← Unidades
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold">{unit.code}</h2>
            <p className="text-sm text-muted-foreground">
              {unit.type}
              {unit.tower && ` · Torre ${unit.tower}`}
              {unit.floor != null && ` · Piso ${unit.floor}`}
              {unit.areaM2 && ` · ${Number(unit.areaM2.toString()).toFixed(0)} m²`}
              {unit.bedrooms && ` · ${unit.bedrooms} hab.`}
              {` · Alícuota ${Number(unit.aliquot.toString()).toFixed(4)}%`}
            </p>
          </div>
          <div className={`rounded-lg px-4 py-2 text-right ${balance.usd > 0.005 ? "bg-destructive/10" : "bg-green-50"}`}>
            <div className="text-xs text-muted-foreground">Saldo pendiente</div>
            <div className={`text-xl font-bold ${balance.usd > 0.005 ? "text-destructive" : "text-green-700"}`}>
              ${balance.usd.toFixed(2)}
            </div>
            {todayRate > 0 && (
              <div className={`text-sm font-medium ${balance.usd > 0.005 ? "text-destructive/80" : "text-green-600"}`}>
                Bs {(balance.usd * todayRate).toLocaleString("es-VE", { maximumFractionDigits: 2 })}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {todayRate > 0 ? `Tasa hoy: ${todayRate.toFixed(2)} Bs/$` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Propietarios e Inquilinos */}
      <div className="grid gap-4 md:grid-cols-2">
        <PersonCard
          title="Propietario(s)"
          persons={currentOwners.map((o) => o.person)}
          role="OWNER"
          onAddVehicle={setShowAddVehicle}
          onAssign={() => setShowAssignPerson("OWNER")}
        />
        <PersonCard
          title="Inquilino(s)"
          persons={currentTenants.map((t) => t.person)}
          role="TENANT"
          onAddVehicle={setShowAddVehicle}
          onAssign={() => setShowAssignPerson("TENANT")}
        />
      </div>

      {/* Vehículos */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Vehículos registrados</h3>
        {allVehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin vehículos registrados</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">Titular</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Vehículo</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Color</th>
                  <th className="px-3 py-2">Puesto</th>
                </tr>
              </thead>
              <tbody>
                {allVehicles.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="px-3 py-2">{v.ownerName}</td>
                    <td className="px-3 py-2">{VEHICLE_TYPES[v.type] ?? v.type}</td>
                    <td className="px-3 py-2">
                      {[v.brand, v.model, v.year].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono font-medium">{v.plate ?? "—"}</td>
                    <td className="px-3 py-2">{v.color ?? "—"}</td>
                    <td className="px-3 py-2">{v.parkingSpot ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Facturas */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Historial de facturas</h3>
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Factura</th>
                <th className="px-3 py-2">Período</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 text-right">Total USD</th>
                <th className="px-3 py-2 text-right">Pagado</th>
                <th className="px-3 py-2 text-right">Pendiente</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Vence</th>
              </tr>
            </thead>
            <tbody>
              {unit.invoices.map((inv) => {
                const pending = Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString());
                return (
                  <tr key={inv.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2 text-muted-foreground">{inv.periodMonth}/{inv.periodYear}</td>
                    <td className="px-3 py-2 text-xs">{inv.type}</td>
                    <td className="px-3 py-2 text-right">${Number(inv.totalUsd.toString()).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-green-700">${Number(inv.paidUsd.toString()).toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right ${pending > 0.005 ? "font-medium text-destructive" : "text-green-600"}`}>
                      ${pending.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100"}`}>
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                    </td>
                  </tr>
                );
              })}
              {unit.invoices.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sin facturas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagos */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Historial de pagos</h3>
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Método</th>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2 text-right">USD</th>
                <th className="px-3 py-2 text-right">Bs</th>
                <th className="px-3 py-2">Aplicado a</th>
              </tr>
            </thead>
            <tbody>
              {unit.payments.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                  <td className="px-3 py-2 text-xs">{p.method}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.reference ?? "—"}</td>
                  <td className="px-3 py-2 text-right">${Number(p.amountUsd.toString()).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{Number(p.amountBss.toString()).toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs">
                    {p.allocations.length > 0
                      ? p.allocations.map((a) => a.invoice.invoiceNumber).join(", ")
                      : <span className="text-amber-700">anticipo</span>}
                  </td>
                </tr>
              ))}
              {unit.payments.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Sin pagos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Multas y cuotas extra */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Aplicar multa</h3>
            <Button variant="outline" size="sm" onClick={() => { setShowFineForm((v) => !v); setShowExtraFeeForm(false); }}>
              {showFineForm ? "Cancelar" : "+ Multa"}
            </Button>
          </div>
          {showFineForm && (
            <ApplyFineForm
              organizationId={organizationId}
              communityId={communityId}
              unitId={unitId}
              onCreated={() => { setShowFineForm(false); void refetch(); void utils.org.units.detail.invalidate(); }}
            />
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Cuota extra individual</h3>
            <Button variant="outline" size="sm" onClick={() => { setShowExtraFeeForm((v) => !v); setShowFineForm(false); }}>
              {showExtraFeeForm ? "Cancelar" : "+ Cuota extra"}
            </Button>
          </div>
          {showExtraFeeForm && (
            <ApplyExtraFeeForm
              organizationId={organizationId}
              communityId={communityId}
              unitId={unitId}
              onCreated={() => { setShowExtraFeeForm(false); void refetch(); void utils.org.units.detail.invalidate(); }}
            />
          )}
        </div>
      </div>

      {/* Dialogs */}
      {showAddVehicle && (
        <AddVehicleDialog
          organizationId={organizationId}
          personId={showAddVehicle}
          onClose={() => setShowAddVehicle(null)}
          onCreated={() => { setShowAddVehicle(null); void refetch(); }}
        />
      )}
      {showAssignPerson && (
        <AssignPersonDialog
          organizationId={organizationId}
          communityId={communityId}
          unitId={unitId}
          role={showAssignPerson}
          onClose={() => setShowAssignPerson(null)}
          onCreated={() => {
            setShowAssignPerson(null);
            void refetch();
            void utils.org.units.list.invalidate();
          }}
        />
      )}
    </div>
  );
}

function PersonCard({
  title,
  persons,
  role,
  onAddVehicle,
  onAssign,
}: {
  title: string;
  persons: Array<{ id: string; firstName: string; lastName: string; idType: string; idNumber: string; email?: string | null; phone?: string | null; whatsapp?: string | null; vehicles: unknown[] }>;
  role: "OWNER" | "TENANT";
  onAddVehicle: (personId: string) => void;
  onAssign: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <Button size="sm" variant="outline" onClick={onAssign}>+ Asignar</Button>
      </div>
      {persons.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin {role === "OWNER" ? "propietario" : "inquilino"} registrado</p>
      ) : (
        <div className="space-y-3">
          {persons.map((p) => (
            <div key={p.id} className="rounded border p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{p.firstName} {p.lastName}</div>
                  <div className="text-xs text-muted-foreground">{p.idType}: {p.idNumber}</div>
                  {p.email && <div className="text-xs text-muted-foreground">{p.email}</div>}
                  {p.phone && <div className="text-xs text-muted-foreground">Tel: {p.phone}</div>}
                  {p.whatsapp && <div className="text-xs text-muted-foreground">WA: {p.whatsapp}</div>}
                </div>
                <Button size="sm" variant="outline" onClick={() => onAddVehicle(p.id)}>+ Vehículo</Button>
              </div>
              {p.vehicles.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {p.vehicles.length} vehículo(s) registrado(s)
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddVehicleDialog({
  organizationId,
  personId,
  onClose,
  onCreated,
}: {
  organizationId: string;
  personId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const create = trpc.org.vehicles.create.useMutation();
  const [form, setForm] = useState({
    type: "CAR" as "CAR" | "MOTORCYCLE" | "TRUCK" | "VAN" | "OTHER",
    brand: "",
    model: "",
    year: "",
    color: "",
    plate: "",
    parkingSpot: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        organizationId,
        personId,
        type: form.type,
        brand: form.brand || undefined,
        model: form.model || undefined,
        year: form.year ? Number(form.year) : undefined,
        color: form.color || undefined,
        plate: form.plate || undefined,
        parkingSpot: form.parkingSpot || undefined,
        notes: form.notes || undefined,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Registrar vehículo</h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as typeof form.type }))}
              >
                {Object.entries(VEHICLE_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <Label>Placa</Label>
              <Input placeholder="ABC-123" value={form.plate} onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <Label>Marca</Label>
              <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
            </div>
            <div>
              <Label>Modelo</Label>
              <Input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
            </div>
            <div>
              <Label>Año</Label>
              <Input type="number" min={1950} max={2099} value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} />
            </div>
            <div>
              <Label>Color</Label>
              <Input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Puesto de estacionamiento</Label>
              <Input placeholder="P1-05" value={form.parkingSpot} onChange={(e) => setForm((f) => ({ ...f, parkingSpot: e.target.value }))} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "..." : "Guardar"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignPersonDialog({
  organizationId,
  communityId,
  unitId,
  role,
  onClose,
  onCreated,
}: {
  organizationId: string;
  communityId: string;
  unitId: string;
  role: "OWNER" | "TENANT";
  onClose: () => void;
  onCreated: () => void;
}) {
  const assignOwner = trpc.org.persons.assignOwner.useMutation();
  const assignTenant = trpc.org.persons.assignTenant.useMutation();
  const createPerson = trpc.org.persons.create.useMutation();

  const [tab, setTab] = useState<"existing" | "new">("new");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    idType: "CEDULA_V" as const,
    idNumber: "",
    email: "",
    phone: "",
    whatsapp: "",
  });
  const [personId, setPersonId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const persons = trpc.org.persons.list.useQuery({ organizationId, communityId });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      let pid = personId;
      if (tab === "new") {
        const p = await createPerson.mutateAsync({
          organizationId,
          firstName: form.firstName,
          lastName: form.lastName,
          idType: form.idType,
          idNumber: form.idNumber,
          email: form.email || undefined,
          phone: form.phone || undefined,
          whatsapp: form.whatsapp || undefined,
        });
        pid = p.id;
      }
      if (!pid) { setError("Selecciona una persona"); return; }
      if (role === "OWNER") {
        await assignOwner.mutateAsync({ organizationId, unitId, personId: pid });
      } else {
        await assignTenant.mutateAsync({ organizationId, unitId, personId: pid });
      }
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  const isPending = assignOwner.isPending || assignTenant.isPending || createPerson.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">
          Asignar {role === "OWNER" ? "propietario" : "inquilino"}
        </h3>
        <div className="mb-4 flex gap-2">
          <Button size="sm" variant={tab === "new" ? "default" : "outline"} onClick={() => setTab("new")}>Persona nueva</Button>
          <Button size="sm" variant={tab === "existing" ? "default" : "outline"} onClick={() => setTab("existing")}>Existente</Button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          {tab === "new" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nombre</Label>
                  <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} required />
                </div>
                <div>
                  <Label>Apellido</Label>
                  <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} required />
                </div>
                <div>
                  <Label>Tipo ID</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.idType}
                    onChange={(e) => setForm((f) => ({ ...f, idType: e.target.value as typeof form.idType }))}
                  >
                    <option value="CEDULA_V">Cédula V</option>
                    <option value="CEDULA_E">Cédula E</option>
                    <option value="RIF">RIF</option>
                    <option value="PASSPORT">Pasaporte</option>
                    <option value="OTHER">Otro</option>
                  </select>
                </div>
                <div>
                  <Label>Nro. ID</Label>
                  <Input value={form.idNumber} onChange={(e) => setForm((f) => ({ ...f, idNumber: e.target.value }))} required />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <Label>Teléfono</Label>
                  <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <Label>WhatsApp</Label>
                  <Input placeholder="584141234567" value={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} />
                </div>
              </div>
            </>
          ) : (
            <div>
              <Label>Seleccionar persona registrada</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                required
              >
                <option value="">Seleccionar...</option>
                {Array.isArray(persons.data) && persons.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} — {p.idType}: {p.idNumber}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "..." : "Asignar"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ApplyFineForm({
  organizationId,
  communityId,
  unitId,
  onCreated,
}: {
  organizationId: string;
  communityId: string;
  unitId: string;
  onCreated: () => void;
}) {
  const applyFine = trpc.finance.fines.create.useMutation();
  const [form, setForm] = useState({
    description: "Uso del ascensor sin suministro de agua activo",
    amountUsd: "",
    dueDate: "",
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await applyFine.mutateAsync({
        organizationId,
        communityId,
        unitId,
        description: form.description,
        amountUsd: Number(form.amountUsd),
        dueDate: new Date(form.dueDate),
        notes: form.notes || undefined,
      });
      onCreated();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-lg border bg-red-50 border-red-200 p-4 space-y-3">
      <p className="text-xs text-red-700 font-medium">Se creará una factura de tipo MULTA para esta unidad.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Descripción de la multa</Label>
          <Input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            required
          />
        </div>
        <div>
          <Label>Monto (USD)</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={form.amountUsd}
            onChange={(e) => setForm((f) => ({ ...f, amountUsd: e.target.value }))}
            required
          />
        </div>
        <div>
          <Label>Fecha de vencimiento</Label>
          <Input
            type="date"
            min={today}
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            required
          />
        </div>
        <div className="col-span-2">
          <Label>Notas (opcional)</Label>
          <Input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={applyFine.isPending} className="bg-red-600 hover:bg-red-700">
          {applyFine.isPending ? "Aplicando..." : "Aplicar multa"}
        </Button>
      </div>
    </form>
  );
}

function ApplyExtraFeeForm({
  organizationId,
  communityId,
  unitId,
  onCreated,
}: {
  organizationId: string;
  communityId: string;
  unitId: string;
  onCreated: () => void;
}) {
  const applyExtra = trpc.finance.extraFees.create.useMutation();
  const [form, setForm] = useState({
    description: "",
    amountUsd: "",
    dueDate: "",
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await applyExtra.mutateAsync({
        organizationId,
        communityId,
        unitId,
        description: form.description,
        amountUsd: Number(form.amountUsd),
        dueDate: new Date(form.dueDate),
        notes: form.notes || undefined,
      });
      onCreated();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-lg border bg-orange-50 border-orange-200 p-4 space-y-3">
      <p className="text-xs text-orange-700 font-medium">
        Cargo exclusivo para esta unidad (reparación, daño, servicio especial, etc.).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Descripción del cargo</Label>
          <Input
            placeholder="Ej: Reparación de tubería por daño en apto A-101"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            required
          />
        </div>
        <div>
          <Label>Monto (USD)</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={form.amountUsd}
            onChange={(e) => setForm((f) => ({ ...f, amountUsd: e.target.value }))}
            required
          />
        </div>
        <div>
          <Label>Fecha de vencimiento</Label>
          <Input
            type="date"
            min={today}
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            required
          />
        </div>
        <div className="col-span-2">
          <Label>Notas (opcional)</Label>
          <Input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={applyExtra.isPending} className="bg-orange-600 hover:bg-orange-700">
          {applyExtra.isPending ? "Aplicando..." : "Cobrar cuota extra"}
        </Button>
      </div>
    </form>
  );
}
