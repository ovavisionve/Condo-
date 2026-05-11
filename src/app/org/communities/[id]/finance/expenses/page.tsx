"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/SearchableSelect";

const CATS = [
  "ELECTRICITY", "WATER", "GAS", "INTERNET", "CLEANING", "GARDENING",
  "SECURITY", "ELEVATOR", "STAFF_PAYROLL", "ADMINISTRATION", "INSURANCE",
  "REPAIRS", "RESERVE_FUND", "TAXES", "OTHER",
] as const;

const CAT_LABELS: Record<string, string> = {
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

function categoryLabel(category: string, customCategory?: string | null) {
  if (category === "OTHER" && customCategory?.trim()) return customCategory.trim();
  return CAT_LABELS[category] ?? category;
}

const today = new Date();

export default function ExpensesPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();

  // Filtros
  const [filterYear, setFilterYear]   = useState(today.getFullYear());
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1);
  const [filterCat, setFilterCat]     = useState("");
  const [filterTower, setFilterTower] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Tab activo: "list" | "templates"
  const [tab, setTab] = useState<"list" | "templates">("list");

  const [showNew, setShowNew] = useState(false);

  const list = trpc.finance.expenses.list.useQuery({
    organizationId,
    communityId,
    year: filterYear,
    month: filterMonth,
    category: filterCat ? filterCat as (typeof CATS)[number] : undefined,
    towerScope: filterTower || undefined,
    status: filterStatus as "pending" | "invoiced" | "voided" | undefined || undefined,
  });

  const utils = trpc.useUtils();
  const create = trpc.finance.expenses.create.useMutation();
  const issueDirectCharge = trpc.finance.expenses.issueDirectCharge.useMutation();

  // Dialog "Emitir cargo directo"
  const [directChargeExpense, setDirectChargeExpense] = useState<{
    id: string; description: string; customCategory?: string | null; amountUsd: string;
  } | null>(null);
  const [directChargeDue, setDirectChargeDue] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 5); return d.toISOString().slice(0, 10);
  });

  // Templates
  const templates = trpc.finance.recurringTemplates.list.useQuery({ organizationId, communityId });
  const createTpl = trpc.finance.recurringTemplates.create.useMutation();
  const deleteTpl = trpc.finance.recurringTemplates.delete.useMutation();
  const applyTpl  = trpc.finance.recurringTemplates.applyToMonth.useMutation();
  const updateTpl = trpc.finance.recurringTemplates.update.useMutation();

  // Unidades para gastos individuales
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });

  const totalUsd  = list.data?.reduce((s, e) => s + Number(e.amountUsd.toString()), 0) ?? 0;
  const pendingUsd = list.data?.filter(e => !e.invoicedAt && !e.voidedAt)
    .reduce((s, e) => s + Number(e.amountUsd.toString()), 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Header y tabs */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Gastos comunes</h2>
          <p className="text-sm text-muted-foreground">
            {filterMonth}/{filterYear} · Total: ${totalUsd.toFixed(2)} · Pendiente de facturar: ${pendingUsd.toFixed(2)}
          </p>
        </div>
        <div className="flex gap-2">
          {tab === "list" && <Button onClick={() => setShowNew(true)}>+ Gasto</Button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["list", "templates"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "list" ? "Gastos del período" : "Plantillas recurrentes"}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <>
          {/* Filtros */}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Año</Label>
              <Input type="number" value={filterYear}
                onChange={(e) => setFilterYear(Number(e.target.value))} className="w-24" />
            </div>
            <div>
              <Label className="text-xs">Mes</Label>
              <Input type="number" min={1} max={12} value={filterMonth}
                onChange={(e) => setFilterMonth(Number(e.target.value))} className="w-20" />
            </div>
            <div>
              <Label className="text-xs">Categoría</Label>
              <select
                className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={filterCat}
                onChange={(e) => setFilterCat(e.target.value)}
              >
                <option value="">Todas</option>
                {CATS.map((c) => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Torre / Alcance</Label>
              <select
                className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={filterTower}
                onChange={(e) => setFilterTower(e.target.value)}
              >
                <option value="">Todas</option>
                <option value="__general__">Solo generales</option>
                <option value="A">Torre A</option>
                <option value="B">Torre B</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Estado</Label>
              <select
                className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="pending">Pendiente</option>
                <option value="invoiced">Facturado</option>
                <option value="voided">Anulado</option>
              </select>
            </div>
          </div>

          {/* Botón aplicar plantillas */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={applyTpl.isPending}
              onClick={async () => {
                const r = await applyTpl.mutateAsync({ organizationId, communityId, year: filterYear, month: filterMonth });
                if (r.created > 0) {
                  void list.refetch();
                  alert(`✅ ${r.created} gasto(s) creados desde plantillas`);
                } else {
                  alert("Sin plantillas pendientes para este período");
                }
              }}
            >
              {applyTpl.isPending ? "Aplicando..." : "⚡ Aplicar plantillas recurrentes"}
            </Button>
          </div>

          {/* Tabla */}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2">Alcance</th>
                  <th className="px-3 py-2 text-right">USD</th>
                  <th className="px-3 py-2 text-right">Bs</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.data?.map((e) => {
                  const exp = e as typeof e & {
                    customCategory?: string | null;
                    towerScope?: string | null;
                    isIndividual?: boolean;
                    targetUnit?: { code: string } | null;
                  };
                  return (
                    <tr key={e.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2">{categoryLabel(e.category, exp.customCategory)}</td>
                      <td className="px-3 py-2">{e.description}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.supplierName ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {exp.isIndividual && exp.targetUnit
                          ? <span className="rounded bg-purple-100 px-1 py-0.5 text-purple-800">Unidad {exp.targetUnit.code}</span>
                          : exp.towerScope
                          ? <span className="rounded bg-blue-100 px-1 py-0.5 text-blue-800">Torre {exp.towerScope}</span>
                          : <span className="text-muted-foreground">General</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-right font-mono">${Number(e.amountUsd.toString()).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{Number(e.amountBss.toString()).toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs">
                        {e.voidedAt
                          ? <span className="text-red-600">Anulado</span>
                          : e.invoicedAt
                          ? <span className="text-green-700">Facturado</span>
                          : <span className="text-amber-700">Pendiente</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        {exp.isIndividual && exp.targetUnit && !e.invoicedAt && !e.voidedAt && (
                          <button
                            className="rounded bg-purple-600 px-2 py-1 text-xs font-medium text-white hover:bg-purple-700 whitespace-nowrap"
                            onClick={() => setDirectChargeExpense({
                              id: e.id,
                              description: e.description,
                              customCategory: exp.customCategory,
                              amountUsd: e.amountUsd.toString(),
                            })}
                          >
                            ⚡ Emitir cargo
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {list.data?.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      Sin gastos con los filtros seleccionados
                    </td>
                  </tr>
                )}
              </tbody>
              {(list.data?.length ?? 0) > 0 && (
                <tfoot className="border-t bg-muted/20">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-sm font-medium text-right">Total</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">${totalUsd.toFixed(2)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {tab === "templates" && (
        <RecurringTemplatesPanel
          organizationId={organizationId}
          communityId={communityId}
          templates={templates.data ?? []}
          loading={templates.isLoading}
          createTpl={createTpl}
          deleteTpl={deleteTpl}
          updateTpl={updateTpl}
          onMutated={() => void templates.refetch()}
        />
      )}

      {showNew && (
        <NewExpenseDialog
          organizationId={organizationId}
          communityId={communityId}
          defaultYear={filterYear}
          defaultMonth={filterMonth}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void list.refetch();
          }}
          create={create}
          units={units.data ?? []}
        />
      )}

      {/* Dialog: Emitir cargo directo para gasto individual */}
      {directChargeExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">⚡ Emitir cargo directo</h3>
            <p className="text-sm text-muted-foreground">
              Se creará una factura de tipo <strong>Cargo extra</strong> directamente a la unidad,
              sin necesidad de re-emitir todo el mes.
            </p>
            <div className="rounded-lg border bg-purple-50 p-3 text-sm space-y-1">
              <div><span className="font-medium">Concepto:</span> {categoryLabel(directChargeExpense.description, directChargeExpense.customCategory)}</div>
              <div><span className="font-medium">Monto:</span> US$ {Number(directChargeExpense.amountUsd).toFixed(2)}</div>
            </div>
            <div>
              <label className="text-sm font-medium">Fecha de vencimiento</label>
              <input
                type="date"
                value={directChargeDue}
                onChange={(e) => setDirectChargeDue(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDirectChargeExpense(null)}>Cancelar</Button>
              <Button
                disabled={issueDirectCharge.isPending}
                className="bg-purple-600 hover:bg-purple-700"
                onClick={async () => {
                  try {
                    await issueDirectCharge.mutateAsync({
                      organizationId,
                      communityId,
                      expenseId: directChargeExpense.id,
                      dueDate: new Date(directChargeDue),
                    });
                    setDirectChargeExpense(null);
                    void list.refetch();
                    alert("✅ Cargo emitido correctamente");
                  } catch (err) {
                    alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
              >
                {issueDirectCharge.isPending ? "Emitiendo..." : "Emitir cargo"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Panel de plantillas recurrentes ──────────────────────────────────────────

type TplRecord = {
  id: string;
  category: string;
  customCategory?: string | null;
  description: string;
  supplierName?: string | null;
  amountUsd: import("decimal.js").Decimal | string | number;
  towerScope?: string | null;
  active: boolean;
  isProvision?: boolean;
};

function RecurringTemplatesPanel({
  organizationId,
  communityId,
  templates,
  loading,
  createTpl,
  deleteTpl,
  updateTpl,
  onMutated,
}: {
  organizationId: string;
  communityId: string;
  templates: TplRecord[];
  loading: boolean;
  createTpl: ReturnType<typeof trpc.finance.recurringTemplates.create.useMutation>;
  deleteTpl: ReturnType<typeof trpc.finance.recurringTemplates.delete.useMutation>;
  updateTpl: ReturnType<typeof trpc.finance.recurringTemplates.update.useMutation>;
  onMutated: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    category: "ELECTRICITY" as (typeof CATS)[number],
    customCategory: "",
    description: "",
    supplierName: "",
    amountUsd: "",
    towerScope: "",
    notes: "",
    isProvision: false,
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createTpl.mutateAsync({
        organizationId, communityId,
        category: form.category,
        customCategory: form.customCategory.trim() || undefined,
        description: form.description,
        supplierName: form.supplierName || undefined,
        amountUsd: Number(form.amountUsd),
        towerScope: form.towerScope || null,
        notes: form.notes || undefined,
        isProvision: form.isProvision,
      });
      setForm({ category: "ELECTRICITY", customCategory: "", description: "", supplierName: "", amountUsd: "", towerScope: "", notes: "", isProvision: false });
      setShowNew(false);
      onMutated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Plantillas de gastos recurrentes</h3>
          <p className="text-sm text-muted-foreground">
            Los gastos marcados como plantilla se pueden aplicar con un clic al inicio de cada mes.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>+ Nueva plantilla</Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2">Alcance</th>
              <th className="px-3 py-2 text-right">Monto USD ref.</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Cargando...</td></tr>
            )}
            {!loading && templates.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                Sin plantillas. Crea una para acelerar el ingreso mensual de gastos.
              </td></tr>
            )}
            {templates.map((tpl) => (
              <tr key={tpl.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">{categoryLabel(tpl.category, tpl.customCategory)}</td>
                <td className="px-3 py-2">
                  {tpl.description}
                  {tpl.isProvision && (
                    <span
                      className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                      title="Plantilla de provisión: genera línea PROVISION + AJUSTE MES ANTERIOR en el recibo"
                    >
                      📊 Provisión
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{tpl.supplierName ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {tpl.towerScope
                    ? <span className="rounded bg-blue-100 px-1 py-0.5 text-blue-800">Torre {tpl.towerScope}</span>
                    : <span className="text-muted-foreground">General</span>
                  }
                </td>
                <td className="px-3 py-2 text-right font-mono">${Number(tpl.amountUsd.toString()).toFixed(2)}</td>
                <td className="px-3 py-2">
                  {tpl.active
                    ? <span className="text-green-700 text-xs">Activa</span>
                    : <span className="text-muted-foreground text-xs">Inactiva</span>
                  }
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <button
                      className="text-xs text-amber-700 hover:text-amber-900"
                      onClick={async () => {
                        await updateTpl.mutateAsync({
                          organizationId, id: tpl.id,
                          isProvision: !tpl.isProvision,
                        });
                        onMutated();
                      }}
                      title="Alternar comportamiento de provisión"
                    >
                      {tpl.isProvision ? "Quitar provisión" : "Marcar provisión"}
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        await updateTpl.mutateAsync({
                          organizationId, id: tpl.id,
                          active: !tpl.active,
                        });
                        onMutated();
                      }}
                    >
                      {tpl.active ? "Desactivar" : "Activar"}
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      className="text-xs text-destructive hover:opacity-80"
                      onClick={async () => {
                        if (!confirm("¿Eliminar esta plantilla?")) return;
                        await deleteTpl.mutateAsync({ organizationId, id: tpl.id });
                        onMutated();
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
            <h3 className="mb-4 font-semibold">Nueva plantilla recurrente</h3>
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Categoría</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as (typeof CATS)[number] }))}
                  >
                    {CATS.map((c) => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Proveedor</Label>
                  <Input value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Subcategoría / Nombre específico <span className="text-muted-foreground text-xs">(opcional — visible en el recibo)</span></Label>
                <Input
                  placeholder="Ej: Piscina, Planta eléctrica, Pintura..."
                  value={form.customCategory}
                  onChange={(e) => setForm((f) => ({ ...f, customCategory: e.target.value }))}
                  maxLength={80}
                />
              </div>
              <div>
                <Label>Descripción</Label>
                <Input required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Monto USD de referencia</Label>
                  <Input type="number" step="0.01" required value={form.amountUsd}
                    onChange={(e) => setForm((f) => ({ ...f, amountUsd: e.target.value }))} />
                </div>
                <div>
                  <Label>Alcance</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.towerScope}
                    onChange={(e) => setForm((f) => ({ ...f, towerScope: e.target.value }))}
                  >
                    <option value="">General (todas las unidades)</option>
                    <option value="A">Torre A</option>
                    <option value="B">Torre B</option>
                  </select>
                </div>
              </div>

              {/* Toggle: Provisión — agrupa gastos reales y calcula ajuste mes anterior */}
              <div className="rounded-lg border border-dashed bg-amber-50/50 p-3 space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isProvision}
                    onChange={(e) => setForm((f) => ({ ...f, isProvision: e.target.checked }))}
                    className="mt-0.5 h-4 w-4"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">📊 Tratar como provisión</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Al aplicar al mes: crea una línea "<strong>Provisión {form.description || "X"}</strong>" con el monto fijo
                      arriba <em>y</em> una línea "<strong>Ajuste Provisión {form.description || "X"} mes anterior</strong>"
                      con el diferencial (real - presupuestado del mes pasado).
                      Los gastos reales del mes vinculados a esta plantilla NO se facturan
                      directamente: se usan solo para calcular el ajuste del siguiente mes.
                    </p>
                  </div>
                </label>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
                <Button type="submit" disabled={createTpl.isPending}>
                  {createTpl.isPending ? "..." : "Guardar plantilla"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Diálogo nuevo gasto ───────────────────────────────────────────────────────

function NewExpenseDialog({
  organizationId,
  communityId,
  defaultYear,
  defaultMonth,
  onClose,
  onCreated,
  create,
  units,
}: {
  organizationId: string;
  communityId: string;
  defaultYear: number;
  defaultMonth: number;
  onClose: () => void;
  onCreated: () => void;
  create: ReturnType<typeof trpc.finance.expenses.create.useMutation>;
  units: Array<{ id: string; code: string; tower?: string | null }>;
}) {
  const [form, setForm] = useState({
    category: "ELECTRICITY" as (typeof CATS)[number],
    customCategory: "",
    description: "",
    amount: "",
    // Bs por defecto (pedido del cliente: "Por defecto TODO en bolivares pero
    // con la posibilidad de pasar a dolares").
    currencyPrimary: "VES" as "USD" | "VES",
    supplierName: "",
    invoiceNumber: "",
    notes: "",
    periodYear: defaultYear,
    periodMonth: defaultMonth,
    towerScope: "",
    isIndividual: false,
    targetUnitId: "",
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        organizationId,
        communityId,
        category: form.category,
        // Subcategoría libre — antes solo se aceptaba si category=OTHER.
        // Ahora cualquier categoría puede llevar customCategory (pedido del cliente:
        // "Crear nuevas categorías en los gastos").
        customCategory: form.customCategory.trim() || undefined,
        description: form.description,
        periodYear: form.periodYear,
        periodMonth: form.periodMonth,
        amount: Number(form.amount),
        currencyPrimary: form.currencyPrimary,
        supplierName: form.supplierName || undefined,
        invoiceNumber: form.invoiceNumber || undefined,
        notes: form.notes || undefined,
        towerScope: form.isIndividual ? null : (form.towerScope || null),
        isIndividual: form.isIndividual,
        targetUnitId: form.isIndividual && form.targetUnitId ? form.targetUnitId : null,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al registrar");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg overflow-y-auto max-h-[90vh]">
        <h3 className="mb-4 text-lg font-semibold">Registrar gasto común</h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoría</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as (typeof CATS)[number], customCategory: "" }))}
              >
                {CATS.map((c) => <option key={c} value={c}>{CAT_LABELS[c] ?? c}</option>)}
              </select>
            </div>
            <div>
              <Label>Proveedor</Label>
              <Input value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label>
              Subcategoría / Nombre específico{" "}
              <span className="text-muted-foreground text-xs">(opcional — se muestra en el recibo en lugar de la categoría genérica)</span>
            </Label>
            <Input
              placeholder={form.category === "OTHER"
                ? "Ej: Piscina, Planta eléctrica, Pintura..."
                : `Ej: subcategoría específica de ${CAT_LABELS[form.category] ?? form.category}...`}
              value={form.customCategory}
              onChange={(e) => setForm((f) => ({ ...f, customCategory: e.target.value }))}
              maxLength={80}
            />
          </div>

          <div>
            <Label>Descripción</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Año</Label>
              <Input type="number" value={form.periodYear} onChange={(e) => setForm((f) => ({ ...f, periodYear: Number(e.target.value) }))} required />
            </div>
            <div>
              <Label>Mes</Label>
              <Input type="number" min={1} max={12} value={form.periodMonth} onChange={(e) => setForm((f) => ({ ...f, periodMonth: Number(e.target.value) }))} required />
            </div>
            <div>
              <Label># Factura</Label>
              <Input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div>
              <Label>Moneda</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.currencyPrimary}
                onChange={(e) => setForm((f) => ({ ...f, currencyPrimary: e.target.value as "USD" | "VES" }))}
              >
                <option value="USD">USD</option>
                <option value="VES">VES (Bs)</option>
              </select>
            </div>
          </div>

          {/* Opciones de alcance */}
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Alcance del gasto</p>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.isIndividual}
                onChange={(e) => setForm((f) => ({ ...f, isIndividual: e.target.checked, towerScope: "" }))}
              />
              <span>Cargo individual a una unidad específica</span>
            </label>

            {form.isIndividual ? (
              <div>
                <Label className="text-xs">Unidad destino</Label>
                <SearchableSelect
                  value={form.targetUnitId}
                  onChange={(v) => setForm((f) => ({ ...f, targetUnitId: v }))}
                  placeholder="Buscar unidad..."
                  options={units.map((u) => ({
                    value: u.id,
                    label: u.code + (u.tower ? ` (Torre ${u.tower})` : ""),
                  }))}
                />
              </div>
            ) : (
              <div>
                <Label className="text-xs">Torre (solo si aplica a una torre)</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.towerScope}
                  onChange={(e) => setForm((f) => ({ ...f, towerScope: e.target.value }))}
                >
                  <option value="">General — todas las unidades</option>
                  <option value="A">Torre A</option>
                  <option value="B">Torre B</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <Label>Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "..." : "Registrar"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
