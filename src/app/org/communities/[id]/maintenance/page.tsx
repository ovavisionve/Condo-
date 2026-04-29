"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const WO_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const WO_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const EXPENSE_CATEGORIES = [
  "ELECTRICITY", "WATER", "GAS", "INTERNET", "CLEANING", "GARDENING",
  "SECURITY", "ELEVATOR", "STAFF_PAYROLL", "ADMINISTRATION", "INSURANCE",
  "REPAIRS", "RESERVE_FUND", "TAXES", "OTHER",
] as const;

type WOStatus = (typeof WO_STATUSES)[number];
type WOPriority = (typeof WO_PRIORITIES)[number];

const STATUS_LABELS: Record<WOStatus, string> = {
  OPEN: "Abierto",
  ASSIGNED: "Asignado",
  IN_PROGRESS: "En progreso",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
};

const STATUS_COLORS: Record<WOStatus, string> = {
  OPEN: "bg-blue-100 text-blue-700",
  ASSIGNED: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-purple-100 text-purple-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-zinc-200 text-zinc-600",
};

const PRIORITY_COLORS: Record<WOPriority, string> = {
  LOW: "bg-gray-100 text-gray-600",
  MEDIUM: "bg-blue-100 text-blue-600",
  HIGH: "bg-orange-100 text-orange-700",
  URGENT: "bg-red-100 text-red-700",
};

const PRIORITY_LABELS: Record<WOPriority, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export default function MaintenancePage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [statusFilter, setStatusFilter] = useState<WOStatus | "">("");
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = trpc.maintenance.workOrders.list.useQuery({
    organizationId,
    communityId,
    status: statusFilter || undefined,
  });

  const counts = list.data?.reduce((acc, wo) => {
    acc[wo.status] = (acc[wo.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Mantenimiento</h2>
          <p className="text-sm text-muted-foreground">
            {list.data?.length ?? 0} órdenes ·{" "}
            {counts?.OPEN ?? 0} abiertas · {counts?.IN_PROGRESS ?? 0} en progreso
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as WOStatus | "")}
          >
            <option value="">Todos los estados</option>
            {WO_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <Button onClick={() => setShowNew(true)}>+ Nueva orden</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Título</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Prioridad</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Contratista</th>
              <th className="px-3 py-2">Creado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((wo) => (
              <tr key={wo.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{wo.title}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {wo.unit ? (
                    <span>
                      {wo.unit.code}
                      {wo.unit.tower && <span className="ml-1 text-xs">T{wo.unit.tower}</span>}
                      {wo.unit.floor != null && <span className="ml-1 text-xs">P{wo.unit.floor}</span>}
                    </span>
                  ) : (
                    <span className="text-xs">Área común</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{wo.category}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[wo.priority as WOPriority]}`}>
                    {PRIORITY_LABELS[wo.priority as WOPriority]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[wo.status as WOStatus]}`}>
                    {STATUS_LABELS[wo.status as WOStatus]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{wo.contractor?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(wo.createdAt).toLocaleDateString("es-VE")}
                </td>
                <td className="px-3 py-2">
                  <Button variant="outline" size="sm" onClick={() => setSelectedId(wo.id)}>
                    Ver
                  </Button>
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Sin órdenes de trabajo
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewWorkOrderDialog
          organizationId={organizationId}
          communityId={communityId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); void list.refetch(); }}
        />
      )}

      {selectedId && (
        <WorkOrderDetailDialog
          organizationId={organizationId}
          workOrderId={selectedId}
          onClose={() => { setSelectedId(null); void list.refetch(); }}
        />
      )}
    </div>
  );
}

function NewWorkOrderDialog({
  organizationId,
  communityId,
  onClose,
  onCreated,
}: {
  organizationId: string;
  communityId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const create = trpc.maintenance.workOrders.create.useMutation();
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "REPAIRS" as (typeof EXPENSE_CATEGORIES)[number],
    priority: "MEDIUM" as WOPriority,
    unitId: "",
    estimatedCostUsd: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        organizationId,
        communityId,
        title: form.title,
        description: form.description,
        category: form.category,
        priority: form.priority,
        unitId: form.unitId || undefined,
        estimatedCostUsd: form.estimatedCostUsd ? Number(form.estimatedCostUsd) : undefined,
        notes: form.notes || undefined,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Nueva orden de trabajo</h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label>Título</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </div>
          <div>
            <Label>Descripción</Label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoría</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as (typeof EXPENSE_CATEGORIES)[number] }))}
              >
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label>Prioridad</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as WOPriority }))}
              >
                {WO_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Unidad (dejar vacío si es área común)</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.unitId}
                onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
              >
                <option value="">Área común</option>
                {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
              </select>
            </div>
            <div>
              <Label>Costo estimado USD</Label>
              <Input
                type="number"
                step="0.01"
                value={form.estimatedCostUsd}
                onChange={(e) => setForm((f) => ({ ...f, estimatedCostUsd: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "..." : "Crear"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WorkOrderDetailDialog({
  organizationId,
  workOrderId,
  onClose,
}: {
  organizationId: string;
  workOrderId: string;
  onClose: () => void;
}) {
  const wo = trpc.maintenance.workOrders.byId.useQuery({ organizationId, id: workOrderId });
  const contractors = trpc.maintenance.contractors.list.useQuery({ organizationId });
  const update = trpc.maintenance.workOrders.update.useMutation();
  const addNote = trpc.maintenance.workOrders.addNote.useMutation();
  const utils = trpc.useUtils();
  const [note, setNote] = useState("");
  const [newStatus, setNewStatus] = useState<WOStatus | "">("");
  const [contractorId, setContractorId] = useState<string>("");

  if (wo.isLoading) return null;
  const data = wo.data;
  if (!data) return null;

  const handleUpdate = async () => {
    await update.mutateAsync({
      organizationId,
      id: workOrderId,
      status: newStatus || undefined,
      contractorId: contractorId || undefined,
    });
    void utils.maintenance.workOrders.byId.invalidate();
    setNewStatus("");
    setContractorId("");
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    await addNote.mutateAsync({ organizationId, workOrderId, content: note });
    setNote("");
    void utils.maintenance.workOrders.byId.invalidate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">{data.title}</h3>
            <p className="text-sm text-muted-foreground">
              {data.unit ? `Unidad ${data.unit.code}` : "Área común"} ·{" "}
              <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLORS[data.status as WOStatus]}`}>
                {STATUS_LABELS[data.status as WOStatus]}
              </span>{" "}
              <span className={`rounded px-1.5 py-0.5 text-xs ${PRIORITY_COLORS[data.priority as WOPriority]}`}>
                {PRIORITY_LABELS[data.priority as WOPriority]}
              </span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
        </div>

        <p className="mb-4 text-sm">{data.description}</p>

        {data.estimatedCostUsd && (
          <p className="mb-4 text-sm text-muted-foreground">
            Costo estimado: ${Number(data.estimatedCostUsd.toString()).toFixed(2)}
            {data.actualCostUsd && ` · Real: $${Number(data.actualCostUsd.toString()).toFixed(2)}`}
          </p>
        )}

        {/* Actualizar estado / asignar contratista */}
        {data.status !== "COMPLETED" && data.status !== "CANCELLED" && (
          <div className="mb-4 flex gap-2 rounded border p-3">
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as WOStatus | "")}
            >
              <option value="">Cambiar estado...</option>
              {WO_STATUSES.filter((s) => s !== data.status).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <select
              className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
            >
              <option value="">Asignar contratista...</option>
              {contractors.data?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={handleUpdate} disabled={update.isPending}>
              Guardar
            </Button>
          </div>
        )}

        {/* Actividad / notas */}
        <h4 className="mb-2 text-sm font-semibold">Actividad</h4>
        <div className="mb-3 max-h-48 overflow-y-auto space-y-2">
          {data.activities.map((act) => (
            <div key={act.id} className="rounded border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-xs text-muted-foreground">
                {new Date(act.createdAt).toLocaleString("es-VE")} · {act.type}
              </span>
              <p>{act.content}</p>
            </div>
          ))}
          {data.activities.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin actividad registrada</p>
          )}
        </div>

        <form onSubmit={handleAddNote} className="flex gap-2">
          <Input
            placeholder="Agregar nota..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={addNote.isPending}>
            Agregar
          </Button>
        </form>
      </div>
    </div>
  );
}
