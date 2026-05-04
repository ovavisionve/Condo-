"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PAYMENT_METHODS: Record<string, string> = {
  TRANSFER_USD: "Transf. USD", TRANSFER_BSS: "Transf. Bs",
  CASH_USD: "Efectivo USD", CASH_BSS: "Efectivo Bs",
  ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil",
  CHECK: "Cheque", CRYPTO: "Cripto", OTHER: "Otro",
};

const WO_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const WO_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const EXPENSE_CATEGORIES = [
  "ELECTRICITY", "WATER", "GAS", "INTERNET", "CLEANING", "GARDENING",
  "SECURITY", "ELEVATOR", "STAFF_PAYROLL", "ADMINISTRATION", "INSURANCE",
  "REPAIRS", "RESERVE_FUND", "TAXES", "OTHER",
] as const;

const EXPENSE_CAT_LABELS: Record<string, string> = {
  ELECTRICITY:    "Electricidad",
  WATER:          "Agua",
  GAS:            "Gas",
  INTERNET:       "Internet",
  CLEANING:       "Limpieza",
  GARDENING:      "Jardinería",
  SECURITY:       "Seguridad",
  ELEVATOR:       "Ascensor",
  STAFF_PAYROLL:  "Nómina de personal",
  ADMINISTRATION: "Administración",
  INSURANCE:      "Seguro",
  REPAIRS:        "Reparaciones",
  RESERVE_FUND:   "Fondo de reserva",
  TAXES:          "Impuestos",
  OTHER:          "Otro",
};

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
              <th className="px-3 py-2">Pagos</th>
              <th className="px-3 py-2">Creado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((wo) => {
              const totalPaid = wo.payments?.reduce(
                (s, p) => s + Number(p.amountUsd.toString()), 0
              ) ?? 0;
              const agreed = wo.estimatedCostUsd ? Number(wo.estimatedCostUsd.toString()) : null;
              return (
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
                <td className="px-3 py-2 text-xs">{EXPENSE_CAT_LABELS[wo.category] ?? wo.category}</td>
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
                <td className="px-3 py-2 text-xs">
                  {agreed != null ? (
                    <span className={totalPaid >= agreed ? "text-green-700 font-medium" : "text-amber-700"}>
                      ${totalPaid.toFixed(0)} / ${agreed.toFixed(0)}
                    </span>
                  ) : totalPaid > 0 ? (
                    <span className="text-muted-foreground">${totalPaid.toFixed(0)} pagado</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(wo.createdAt).toLocaleDateString("es-VE")}
                </td>
                <td className="px-3 py-2">
                  <Button variant="outline" size="sm" onClick={() => setSelectedId(wo.id)}>
                    Ver
                  </Button>
                </td>
              </tr>
              );
            })}
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
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CAT_LABELS[c] ?? c}</option>)}
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
  const addPayment = trpc.maintenance.workOrders.addPayment.useMutation();
  const deletePayment = trpc.maintenance.workOrders.deletePayment.useMutation();
  const utils = trpc.useUtils();

  const createExpense = trpc.finance.expenses.create.useMutation();
  const [note, setNote] = useState("");
  const [newStatus, setNewStatus] = useState<WOStatus | "">("");
  const [contractorId, setContractorId] = useState<string>("");
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: "", currencyPrimary: "USD" as "USD" | "VES",
    method: "TRANSFER_USD", reference: "", description: "", paidAt: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [payError, setPayError] = useState<string | null>(null);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const todayD = new Date();
  const [expenseForm, setExpenseForm] = useState({
    year: todayD.getFullYear(),
    month: todayD.getMonth() + 1,
    amount: "",
    currencyPrimary: "USD" as "USD" | "VES",
    description: "",
    category: "REPAIRS" as string,
  });
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseDone, setExpenseDone] = useState(false);

  if (wo.isLoading) return null;
  const data = wo.data;
  if (!data) return null;

  const totalPaid = (data.payments ?? []).reduce(
    (s, p) => s + Number(p.amountUsd.toString()), 0
  );
  const agreed = data.estimatedCostUsd ? Number(data.estimatedCostUsd.toString()) : null;
  const remaining = agreed != null ? Math.max(0, agreed - totalPaid) : null;

  const handleUpdate = async () => {
    await update.mutateAsync({
      organizationId, id: workOrderId,
      status: newStatus || undefined,
      contractorId: contractorId || undefined,
    });
    void utils.maintenance.workOrders.byId.invalidate();
    setNewStatus(""); setContractorId("");
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    await addNote.mutateAsync({ organizationId, workOrderId, content: note });
    setNote("");
    void utils.maintenance.workOrders.byId.invalidate();
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayError(null);
    try {
      await addPayment.mutateAsync({
        organizationId,
        workOrderId,
        amount: Number(payForm.amount),
        currencyPrimary: payForm.currencyPrimary,
        method: payForm.method,
        reference: payForm.reference || undefined,
        description: payForm.description || undefined,
        paidAt: new Date(payForm.paidAt),
        notes: payForm.notes || undefined,
      });
      setShowPaymentForm(false);
      setPayForm({ amount: "", currencyPrimary: "USD", method: "TRANSFER_USD", reference: "", description: "", paidAt: new Date().toISOString().slice(0, 10), notes: "" });
      void utils.maintenance.workOrders.byId.invalidate();
      void utils.maintenance.workOrders.list.invalidate();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Error");
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm("¿Eliminar este pago?")) return;
    await deletePayment.mutateAsync({ organizationId, paymentId });
    void utils.maintenance.workOrders.byId.invalidate();
    void utils.maintenance.workOrders.list.invalidate();
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

        {/* ── Resumen de costos ── */}
        {(agreed != null || totalPaid > 0) && (
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Monto acordado</p>
              <p className="font-semibold">{agreed != null ? `$${agreed.toFixed(2)}` : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total pagado</p>
              <p className={`font-semibold ${totalPaid > 0 ? "text-green-700" : "text-muted-foreground"}`}>
                ${totalPaid.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pendiente</p>
              <p className={`font-semibold ${remaining && remaining > 0 ? "text-orange-600" : "text-green-700"}`}>
                {remaining != null
                  ? remaining > 0.005 ? `$${remaining.toFixed(2)}` : "✓ Saldado"
                  : "—"}
              </p>
            </div>
          </div>
        )}

        {/* ── Actualizar estado / asignar contratista ── */}
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

        {/* ── Pagos al proveedor ── */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">💰 Pagos al proveedor</h4>
            <Button size="sm" variant="outline" onClick={() => setShowPaymentForm(!showPaymentForm)}>
              {showPaymentForm ? "Cancelar" : "+ Registrar pago"}
            </Button>
          </div>

          {showPaymentForm && (
            <form onSubmit={handleAddPayment} className="mb-3 rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Monto</Label>
                  <Input
                    type="number" step="0.01" min="0.01"
                    placeholder="0.00"
                    value={payForm.amount}
                    onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs">Moneda</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={payForm.currencyPrimary}
                    onChange={(e) => setPayForm((f) => ({ ...f, currencyPrimary: e.target.value as "USD" | "VES" }))}
                  >
                    <option value="USD">USD</option>
                    <option value="VES">VES (Bs)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Método</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={payForm.method}
                    onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}
                  >
                    {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Referencia</Label>
                  <Input
                    placeholder="N° transferencia..."
                    value={payForm.reference}
                    onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Fecha</Label>
                  <Input
                    type="date"
                    value={payForm.paidAt}
                    onChange={(e) => setPayForm((f) => ({ ...f, paidAt: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs">Descripción (opcional)</Label>
                  <Input
                    placeholder="Cuota 1 de 3..."
                    value={payForm.description}
                    onChange={(e) => setPayForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </div>
              {payError && <p className="text-xs text-destructive">{payError}</p>}
              <div className="flex justify-end gap-2">
                <Button type="submit" size="sm" disabled={addPayment.isPending}>
                  {addPayment.isPending ? "Guardando..." : "Registrar pago"}
                </Button>
              </div>
            </form>
          )}

          {/* Lista de pagos */}
          {(data.payments ?? []).length > 0 ? (
            <div className="rounded-md border divide-y">
              {(data.payments ?? []).map((pay) => (
                <div key={pay.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="flex-1">
                    <span className="font-medium">${Number(pay.amountUsd.toString()).toFixed(2)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      Bs {Number(pay.amountBss.toString()).toLocaleString("es-VE", { maximumFractionDigits: 2 })}
                    </span>
                    {pay.description && (
                      <span className="ml-2 text-xs text-blue-700">— {pay.description}</span>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{new Date(pay.paidAt).toLocaleDateString("es-VE")}</p>
                    <p>{PAYMENT_METHODS[pay.method] ?? pay.method}{pay.reference ? ` · ${pay.reference}` : ""}</p>
                  </div>
                  <button
                    onClick={() => handleDeletePayment(pay.id)}
                    className="text-xs text-red-400 hover:text-red-600"
                    title="Eliminar pago"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2 text-xs font-medium bg-muted/30">
                <span>Total pagado</span>
                <span className="text-green-700">${totalPaid.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin pagos registrados</p>
          )}
        </div>

        {/* ── Registrar como gasto común ── */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">📋 Gasto común</h4>
            {!expenseDone ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const amt = agreed ?? totalPaid;
                  setExpenseForm((f) => ({
                    ...f,
                    amount: amt > 0 ? amt.toFixed(2) : "",
                    description: data.title,
                    category: data.category,
                  }));
                  setShowExpenseForm(!showExpenseForm);
                }}
              >
                {showExpenseForm ? "Cancelar" : "Registrar como gasto"}
              </Button>
            ) : (
              <span className="text-xs text-green-700 font-medium">✓ Gasto registrado</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Convierte el costo de esta orden en un Gasto Común para que se incluya en los recibos del período.
          </p>

          {showExpenseForm && !expenseDone && (
            <div className="rounded-lg border bg-amber-50 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Año</Label>
                  <Input
                    type="number"
                    value={expenseForm.year}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, year: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Mes</Label>
                  <Input
                    type="number" min={1} max={12}
                    value={expenseForm.month}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, month: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Monto</Label>
                  <Input
                    type="number" step="0.01" min="0.01"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs">Moneda</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={expenseForm.currencyPrimary}
                    onChange={(e) => setExpenseForm((f) => ({ ...f, currencyPrimary: e.target.value as "USD" | "VES" }))}
                  >
                    <option value="USD">USD</option>
                    <option value="VES">VES (Bs)</option>
                  </select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Categoría</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{EXPENSE_CAT_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Descripción</Label>
                <Input
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Descripción del gasto..."
                />
              </div>
              {expenseError && <p className="text-xs text-destructive">{expenseError}</p>}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={createExpense.isPending || !expenseForm.amount}
                  onClick={async () => {
                    setExpenseError(null);
                    try {
                      await createExpense.mutateAsync({
                        organizationId,
                        communityId: data.communityId,
                        category: expenseForm.category as (typeof EXPENSE_CATEGORIES)[number],
                        description: expenseForm.description || data.title,
                        periodYear: expenseForm.year,
                        periodMonth: expenseForm.month,
                        amount: Number(expenseForm.amount),
                        currencyPrimary: expenseForm.currencyPrimary,
                        supplierName: data.contractor?.name ?? undefined,
                        notes: `Orden de mantenimiento: ${data.title}`,
                      });
                      setShowExpenseForm(false);
                      setExpenseDone(true);
                    } catch (err) {
                      setExpenseError(err instanceof Error ? err.message : "Error");
                    }
                  }}
                >
                  {createExpense.isPending ? "Guardando..." : "Crear gasto"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Actividad / notas ── */}
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
