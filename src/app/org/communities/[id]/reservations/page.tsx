"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type CommonArea = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  openTime: string | null;
  closeTime: string | null;
  slotDurationMin: number | null;
  requiresApproval: boolean;
  costUsd: string | null;
  rules: string | null;
  maxAdvanceDays: number | null;
  active: boolean;
};

type Reservation = {
  id: string;
  status: "PENDING" | "APPROVED" | "CANCELLED" | "COMPLETED";
  date: string | Date;
  startTime: string;
  endTime: string;
  purpose: string | null;
  guestCount: number | null;
  area: { name: string };
  unit: { code: string };
};

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  PENDING:   "bg-yellow-100 text-yellow-800",
  APPROVED:  "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-700",
  COMPLETED: "bg-gray-100 text-gray-600",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING:   "Pendiente",
  APPROVED:  "Aprobada",
  CANCELLED: "Cancelada",
  COMPLETED: "Completada",
};

// ─── Modal área ───────────────────────────────────────────────────────────────
function AreaModal({
  organizationId,
  communityId,
  area,
  onClose,
  onSaved,
}: {
  organizationId: string;
  communityId: string;
  area: CommonArea | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(area);
  const [form, setForm] = useState({
    name: area?.name ?? "",
    description: area?.description ?? "",
    capacity: area?.capacity?.toString() ?? "",
    openTime: area?.openTime ?? "08:00",
    closeTime: area?.closeTime ?? "22:00",
    slotDurationMin: area?.slotDurationMin?.toString() ?? "60",
    requiresApproval: area?.requiresApproval ?? false,
    costUsd: area?.costUsd?.toString() ?? "",
    rules: area?.rules ?? "",
    maxAdvanceDays: area?.maxAdvanceDays?.toString() ?? "30",
    active: area?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);

  const createArea = trpc.reservations.areas.create.useMutation();
  const updateArea = trpc.reservations.areas.update.useMutation();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        openTime: form.openTime || undefined,
        closeTime: form.closeTime || undefined,
        slotDurationMin: form.slotDurationMin ? Number(form.slotDurationMin) : undefined,
        requiresApproval: form.requiresApproval,
        costUsd: form.costUsd ? Number(form.costUsd) : undefined,
        rules: form.rules || undefined,
        maxAdvanceDays: form.maxAdvanceDays ? Number(form.maxAdvanceDays) : undefined,
        active: form.active,
      };
      if (isEdit && area) {
        await updateArea.mutateAsync({ organizationId, areaId: area.id, ...payload });
      } else {
        await createArea.mutateAsync({ organizationId, communityId, ...payload });
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    }
  };

  const isPending = createArea.isPending || updateArea.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card shadow-lg overflow-y-auto max-h-[90vh]">
        <div className="p-6">
          <h3 className="mb-4 text-lg font-semibold">
            {isEdit ? "Editar área común" : "Nueva área común"}
          </h3>
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <Label>Nombre *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Piscina, Salón social, Cancha"
              />
            </div>
            <div>
              <Label>Descripción</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Descripción breve del área"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Capacidad (personas)</Label>
                <Input
                  type="number" min={1}
                  value={form.capacity}
                  onChange={(e) => setForm(f => ({ ...f, capacity: e.target.value }))}
                  placeholder="Ej: 50"
                />
              </div>
              <div>
                <Label>Duración mínima de slot (min)</Label>
                <Input
                  type="number" min={15} step={15}
                  value={form.slotDurationMin}
                  onChange={(e) => setForm(f => ({ ...f, slotDurationMin: e.target.value }))}
                  placeholder="60"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Hora de apertura</Label>
                <Input
                  type="time"
                  value={form.openTime}
                  onChange={(e) => setForm(f => ({ ...f, openTime: e.target.value }))}
                />
              </div>
              <div>
                <Label>Hora de cierre</Label>
                <Input
                  type="time"
                  value={form.closeTime}
                  onChange={(e) => setForm(f => ({ ...f, closeTime: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Costo USD (opcional)</Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={form.costUsd}
                  onChange={(e) => setForm(f => ({ ...f, costUsd: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Máx. días de anticipación</Label>
                <Input
                  type="number" min={1}
                  value={form.maxAdvanceDays}
                  onChange={(e) => setForm(f => ({ ...f, maxAdvanceDays: e.target.value }))}
                  placeholder="30"
                />
              </div>
            </div>
            <div>
              <Label>Reglas del área</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={3}
                value={form.rules}
                onChange={(e) => setForm(f => ({ ...f, rules: e.target.value }))}
                placeholder="Ej: No se permiten bebidas alcohólicas, respetar horario de silencio..."
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.requiresApproval}
                  onChange={(e) => setForm(f => ({ ...f, requiresApproval: e.target.checked }))}
                />
                <span>Requiere aprobación de administración</span>
              </label>
              {isEdit && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm(f => ({ ...f, active: e.target.checked }))}
                  />
                  <span>Activa</span>
                </label>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Guardando..." : (isEdit ? "Guardar cambios" : "Crear área")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Tab Áreas ────────────────────────────────────────────────────────────────
function AreasTab({
  organizationId,
  communityId,
}: {
  organizationId: string;
  communityId: string;
}) {
  const [showModal, setShowModal] = useState(false);
  const [editArea, setEditArea] = useState<CommonArea | null>(null);

  const areas = trpc.reservations.areas.list.useQuery({ organizationId, communityId });

  const openCreate = () => { setEditArea(null); setShowModal(true); };
  const openEdit = (area: CommonArea) => { setEditArea(area); setShowModal(true); };
  const handleSaved = () => {
    setShowModal(false);
    void areas.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {areas.data?.length ?? 0} área(s) registrada(s)
        </p>
        <Button onClick={openCreate}>+ Nueva área</Button>
      </div>

      {areas.isLoading && (
        <div className="py-8 text-center text-muted-foreground">Cargando áreas...</div>
      )}

      {!areas.isLoading && (areas.data?.length ?? 0) === 0 && (
        <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
          <p className="text-lg mb-1">Sin áreas comunes registradas</p>
          <p className="text-sm">Crea la primera área para empezar a gestionar reservas</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(areas.data ?? []).map((area) => (
          <Card key={area.id} className={area.active ? "" : "opacity-60"}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base">{area.name}</CardTitle>
                <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${area.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {area.active ? "Activa" : "Inactiva"}
                </span>
              </div>
              {area.description && (
                <p className="text-xs text-muted-foreground mt-1">{area.description}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-1 text-xs">
                {area.capacity && (
                  <span className="text-muted-foreground">👥 Capacidad: <strong>{area.capacity}</strong></span>
                )}
                {area.openTime && area.closeTime && (
                  <span className="text-muted-foreground">🕐 {area.openTime} – {area.closeTime}</span>
                )}
                {area.slotDurationMin && (
                  <span className="text-muted-foreground">⏱ Slot: <strong>{area.slotDurationMin} min</strong></span>
                )}
                {area.costUsd && Number(area.costUsd) > 0 && (
                  <span className="text-muted-foreground">💵 Costo: <strong>${Number(area.costUsd).toFixed(2)}</strong></span>
                )}
                {area.maxAdvanceDays && (
                  <span className="text-muted-foreground">📅 Máx. <strong>{area.maxAdvanceDays}</strong> días anticip.</span>
                )}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className={`text-xs rounded px-1.5 py-0.5 ${area.requiresApproval ? "bg-amber-100 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                  {area.requiresApproval ? "✓ Requiere aprobación" : "Auto-aprobado"}
                </span>
              </div>
              {area.rules && (
                <p className="text-xs text-muted-foreground border-t pt-2 line-clamp-2">{area.rules}</p>
              )}
              <div className="pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => openEdit(area as CommonArea)}
                >
                  ✏️ Editar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {showModal && (
        <AreaModal
          organizationId={organizationId}
          communityId={communityId}
          area={editArea}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ─── Tab Solicitudes ──────────────────────────────────────────────────────────
function SolicitudesTab({
  organizationId,
  communityId,
}: {
  organizationId: string;
  communityId: string;
}) {
  const [filterAreaId, setFilterAreaId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const areas = trpc.reservations.areas.list.useQuery({ organizationId, communityId });
  const reservations = trpc.reservations.list.useQuery({
    organizationId,
    communityId,
    areaId: filterAreaId || undefined,
    status: (filterStatus || undefined) as "PENDING" | "APPROVED" | "CANCELLED" | "COMPLETED" | undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  const approve = trpc.reservations.approve.useMutation();
  const cancel = trpc.reservations.cancel.useMutation();
  const utils = trpc.useUtils();

  const handleApprove = async (reservationId: string) => {
    await approve.mutateAsync({ organizationId, reservationId });
    void utils.reservations.list.invalidate();
  };

  const handleCancel = async (reservationId: string) => {
    if (!confirm("¿Cancelar esta reserva?")) return;
    await cancel.mutateAsync({ organizationId, reservationId });
    void utils.reservations.list.invalidate();
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Área</Label>
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={filterAreaId}
            onChange={(e) => setFilterAreaId(e.target.value)}
          >
            <option value="">Todas las áreas</option>
            {(areas.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Estado</Label>
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="PENDING">Pendientes</option>
            <option value="APPROVED">Aprobadas</option>
            <option value="CANCELLED">Canceladas</option>
            <option value="COMPLETED">Completadas</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Desde</Label>
          <Input
            type="date"
            className="h-9 w-36"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Hasta</Label>
          <Input
            type="date"
            className="h-9 w-36"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
          />
        </div>
        {(filterAreaId || filterStatus || filterFrom || filterTo) && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => { setFilterAreaId(""); setFilterStatus(""); setFilterFrom(""); setFilterTo(""); }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Área</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Horario</th>
              <th className="px-3 py-2">Propósito</th>
              <th className="px-3 py-2 text-center">Invitados</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {reservations.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Cargando...</td>
              </tr>
            )}
            {!reservations.isLoading && (reservations.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Sin reservas con los filtros seleccionados
                </td>
              </tr>
            )}
            {(reservations.data ?? []).map((res) => {
              return (
                <tr key={res.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{res.unit.code}</td>
                  <td className="px-3 py-2">{res.area.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(res.date).toLocaleDateString("es-VE")}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {res.startTime} – {res.endTime}
                  </td>
                  <td className="px-3 py-2 max-w-[140px] truncate" title={res.purpose ?? undefined}>
                    {res.purpose ?? <span className="text-muted-foreground italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">{res.guestCount ?? 0}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[res.status] ?? ""}`}>
                      {STATUS_LABEL[res.status] ?? res.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {res.status === "PENDING" && (
                        <>
                          <button
                            onClick={() => void handleApprove(res.id)}
                            disabled={approve.isPending}
                            className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                            title="Aprobar reserva"
                          >
                            ✓ Aprobar
                          </button>
                          <button
                            onClick={() => void handleCancel(res.id)}
                            disabled={cancel.isPending}
                            className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                            title="Cancelar reserva"
                          >
                            ✗ Cancelar
                          </button>
                        </>
                      )}
                      {res.status === "APPROVED" && (
                        <button
                          onClick={() => void handleCancel(res.id)}
                          disabled={cancel.isPending}
                          className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                          title="Cancelar reserva"
                        >
                          ✗ Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ReservationsPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [tab, setTab] = useState<"areas" | "solicitudes">("areas");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Reservas de Áreas Comunes</h2>
        <p className="text-sm text-muted-foreground">
          Gestiona las áreas disponibles y las solicitudes de reserva de los residentes
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {([
          { key: "areas",       label: "🏊 Áreas" },
          { key: "solicitudes", label: "📅 Solicitudes" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido por tab */}
      {tab === "areas" && (
        <AreasTab organizationId={organizationId} communityId={communityId} />
      )}
      {tab === "solicitudes" && (
        <SolicitudesTab organizationId={organizationId} communityId={communityId} />
      )}
    </div>
  );
}
