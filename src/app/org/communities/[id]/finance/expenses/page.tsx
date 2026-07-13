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
  "REPAIRS", "RESERVE_FUND", "TAXES", "LEGAL", "OTHER",
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
  LEGAL:          "Legal / Honorarios profesionales",
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
  const updateExpense = trpc.finance.expenses.update.useMutation();
  const voidExpense = trpc.finance.expenses.voidOne.useMutation();
  const issueDirectCharge = trpc.finance.expenses.issueDirectCharge.useMutation();

  // Estado para diálogo de edición de gasto
  type ExpenseRow = NonNullable<typeof list.data>[number];
  const [editExpense, setEditExpense] = useState<ExpenseRow | null>(null);

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

  // Torres ÚNICAS reales del edificio. Si solo hay 1 (o ninguna), todos los gastos
  // se tratan como "General" automáticamente — no tiene sentido elegir torre.
  // Pedido del cliente: "En los castaños es una sola torre, es la Torre B".
  const towers = Array.from(
    new Set(
      (units.data ?? [])
        .map((u) => (u as { tower?: string | null }).tower)
        .filter((t): t is string => !!t),
    ),
  ).sort();
  const multipleTowers = towers.length > 1;

  const totalUsd  = list.data?.reduce((s, e) => s + Number(e.amountUsd.toString()), 0) ?? 0;
  const pendingUsd = list.data?.filter(e => !e.invoicedAt && !e.voidedAt)
    .reduce((s, e) => s + Number(e.amountUsd.toString()), 0) ?? 0;

  // ¿Hay recibos ya emitidos del período? → si el admin agregó gastos extraordinarios
  // después de emitir, mostramos banner sugiriendo "Re-emitir período".
  const issuedQ = trpc.finance.invoices.list.useQuery({ organizationId, communityId, year: filterYear, month: filterMonth });
  const issuedActive = (issuedQ.data ?? []).filter(i => i.status !== "VOIDED" && i.status !== "DRAFT");
  const hasPendingAfterIssue = issuedActive.length > 0 && (list.data ?? []).some(
    e => !e.invoicedAt && !e.voidedAt && !(e as { recurringTemplate?: { isProvision: boolean } | null }).recurringTemplate?.isProvision,
  );

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
          {/* Banner: gastos pendientes en período con recibos emitidos */}
          {hasPendingAfterIssue && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900">
                  Tienes gastos pendientes en un período con recibos ya emitidos
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  Los recibos actuales NO incluyen estos gastos. Para cobrarlos a los residentes ve
                  a <strong>Recibos de Condominio</strong> y pulsá <strong>🔄 Re-emitir período</strong>
                  {" "}(solo funciona si nadie ha pagado todavía).
                </p>
              </div>
              <a
                href={`/org/communities/${communityId}/finance/invoices`}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 whitespace-nowrap"
              >
                Ir a Recibos →
              </a>
            </div>
          )}

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
            {multipleTowers && (
              <div>
                <Label className="text-xs">Torre / Alcance</Label>
                <select
                  className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={filterTower}
                  onChange={(e) => setFilterTower(e.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="__general__">Solo generales</option>
                  {towers.map((t) => (
                    <option key={t} value={t}>Torre {t}</option>
                  ))}
                </select>
              </div>
            )}
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
                void list.refetch();
                void utils.finance.invoices.previewReceiptPdf.invalidate();
                if (r.created > 0) {
                  alert(`✅ ${r.created} gasto(s) creados desde plantillas${r.adjustments ? ` + ${r.adjustments} ajuste(s) mes anterior` : ""}`);
                } else if (r.adjustments && r.adjustments > 0) {
                  alert(`✅ ${r.adjustments} ajuste(s) de provisión del mes anterior creados`);
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
                  <th className="px-3 py-2 text-xs">Fecha registro</th>
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
                    recurringTemplate?: { description: string; isProvision: boolean } | null;
                  };
                  const linkedToProvision = !!exp.recurringTemplate?.isProvision;
                  return (
                    <tr key={e.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2">{categoryLabel(e.category, exp.customCategory)}</td>
                      <td className="px-3 py-2">
                        {e.description}
                        {linkedToProvision && (
                          <span
                            className="ml-2 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
                            title={`Vinculado a la provisión "${exp.recurringTemplate?.description}". Este monto REAL se cobra al residente y reemplaza el estimado de la provisión.`}
                          >
                            🔗 Real de {exp.recurringTemplate?.description} (se cobra)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {e.supplierName ?? "—"}
                        {exp.retentionPct != null && (
                          <span
                            className="ml-1.5 inline-block rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium text-violet-800"
                            title="Este gasto tiene retención de ISLR registrada"
                          >
                            🧾 {Number(exp.retentionPct.toString())}%
                          </span>
                        )}
                      </td>
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
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleDateString("es-VE")}
                        <div className="text-[10px] opacity-70">
                          {new Date(e.createdAt).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {e.voidedAt
                          ? <span className="text-red-600">Anulado</span>
                          : e.invoicedAt
                          ? <span className="text-green-700">Facturado</span>
                          : <span className="text-amber-700">Pendiente</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {!e.invoicedAt && !e.voidedAt && (
                            <button
                              className="text-xs text-blue-700 hover:text-blue-900 font-medium"
                              onClick={() => setEditExpense(e)}
                              title="Editar gasto"
                            >
                              ✏️ Editar
                            </button>
                          )}
                          {!e.invoicedAt && !e.voidedAt && (
                            <button
                              className="text-xs text-destructive hover:opacity-80"
                              onClick={async () => {
                                if (!confirm("¿Anular este gasto?")) return;
                                await voidExpense.mutateAsync({ organizationId, id: e.id });
                                void list.refetch();
                              }}
                              title="Anular gasto"
                            >
                              🗑️
                            </button>
                          )}
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {list.data?.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
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
          towers={towers}
          onMutated={() => {
            void templates.refetch();
            void list.refetch();
            // Pedido cliente: "Si elimino una plantilla el recibo no se actualiza"
            // → invalidamos el preview para que se regenere con las plantillas vigentes.
            void utils.finance.invoices.previewReceiptPdf.invalidate();
            void utils.finance.recurringTemplates.customCategories.invalidate();
          }}
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
            // Invalidar el preview del recibo para que refleje el nuevo gasto en vivo
            void utils.finance.invoices.previewReceiptPdf.invalidate();
            void utils.finance.recurringTemplates.customCategories.invalidate();
            void utils.finance.recurringTemplates.subCategories.invalidate();
          }}
          create={create}
          units={units.data ?? []}
          towers={towers}
        />
      )}

      {/* Dialog editar gasto */}
      {editExpense && (
        <EditExpenseDialog
          organizationId={organizationId}
          communityId={communityId}
          expense={editExpense}
          onClose={() => setEditExpense(null)}
          onSaved={() => {
            setEditExpense(null);
            void list.refetch();
            void utils.finance.invoices.previewReceiptPdf.invalidate();
            void utils.finance.recurringTemplates.customCategories.invalidate();
            void utils.finance.recurringTemplates.subCategories.invalidate();
          }}
          updateExpense={updateExpense}
          towers={towers}
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
  towers,
}: {
  organizationId: string;
  communityId: string;
  templates: TplRecord[];
  loading: boolean;
  createTpl: ReturnType<typeof trpc.finance.recurringTemplates.create.useMutation>;
  deleteTpl: ReturnType<typeof trpc.finance.recurringTemplates.delete.useMutation>;
  updateTpl: ReturnType<typeof trpc.finance.recurringTemplates.update.useMutation>;
  onMutated: () => void;
  towers: string[];
}) {
  const multipleTowers = towers.length > 1;
  const [showNew, setShowNew] = useState(false);
  // Edición de plantillas existentes
  const [editingId, setEditingId] = useState<string | null>(null);
  const blankForm = {
    category: "ELECTRICITY" as (typeof CATS)[number],
    customCategory: "",
    subCategory: "",
    description: "",
    supplierName: "",
    // Renombrado: ahora "amount" puede ser USD o VES según currencyPrimary.
    amountUsd: "",
    currencyPrimary: "VES" as "USD" | "VES",
    towerScope: "",
    notes: "",
    isProvision: false,
  };
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (tpl: TplRecord) => {
    setEditingId(tpl.id);
    const t = tpl as unknown as {
      category: typeof CATS[number]; customCategory?: string | null; subCategory?: string | null;
      description: string; supplierName?: string | null; amountUsd: { toString(): string };
      amountBss?: { toString(): string } | null; currencyPrimary?: "USD" | "VES";
      towerScope?: string | null; notes?: string | null; isProvision: boolean;
    };
    const cp = (t.currencyPrimary ?? "USD") as "USD" | "VES";
    const amount = cp === "VES" && t.amountBss
      ? Number(t.amountBss.toString()).toString()
      : Number(t.amountUsd.toString()).toString();
    setForm({
      category: t.category,
      customCategory: t.customCategory ?? "",
      subCategory: t.subCategory ?? "",
      description: t.description,
      supplierName: t.supplierName ?? "",
      amountUsd: amount,
      currencyPrimary: cp,
      towerScope: t.towerScope ?? "",
      notes: t.notes ?? "",
      isProvision: t.isProvision,
    });
    setShowNew(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(blankForm);
    setShowNew(false);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) {
        await updateTpl.mutateAsync({
          organizationId, id: editingId,
          // Cliente pidió poder editar categoría también
          category: form.category,
          customCategory: form.customCategory.trim() || null,
          subCategory: form.subCategory.trim() || null,
          description: form.description,
          supplierName: form.supplierName || undefined,
          amount: Number(form.amountUsd),
          currencyPrimary: form.currencyPrimary,
          towerScope: form.towerScope || null,
          notes: form.notes || undefined,
          isProvision: form.isProvision,
        });
      } else {
        await createTpl.mutateAsync({
          organizationId, communityId,
          category: form.category,
          customCategory: form.customCategory.trim() || undefined,
          subCategory: form.subCategory.trim() || null,
          description: form.description,
          supplierName: form.supplierName || undefined,
          amount: Number(form.amountUsd),
          currencyPrimary: form.currencyPrimary,
          towerScope: form.towerScope || null,
          notes: form.notes || undefined,
          isProvision: form.isProvision,
        });
      }
      setForm(blankForm);
      setEditingId(null);
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

      {/* Explicación del modelo Provisión + Ajuste mes siguiente (Modelo A) */}
      <details className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-blue-900">
          📖 ¿Cómo funcionan las provisiones? (modelo de Arrayanes)
        </summary>
        <div className="mt-3 space-y-3 text-blue-900/90">
          <p>
            Las plantillas marcadas como <strong>📊 Provisión</strong> usan el modelo estándar de contabilidad
            de condominios venezolanos: <strong>provisión fija mensual + ajuste al mes siguiente</strong>.
          </p>
          <div className="rounded bg-white/70 p-3 text-xs">
            <p className="font-semibold mb-2">Ejemplo concreto — Hidrocapital con provisión Bs 20.000:</p>
            <table className="w-full">
              <thead>
                <tr className="border-b border-blue-200 text-left">
                  <th className="pb-1 font-medium">Mes</th>
                  <th className="pb-1 font-medium">Provisión cobrada</th>
                  <th className="pb-1 font-medium">Real gastado</th>
                  <th className="pb-1 font-medium">Ajuste mes siguiente</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-b border-blue-100">
                  <td className="py-1">Enero</td>
                  <td className="py-1">Bs 20.000</td>
                  <td className="py-1">Bs 25.000</td>
                  <td className="py-1 text-amber-700">→ Febrero: +Bs 5.000</td>
                </tr>
                <tr className="border-b border-blue-100">
                  <td className="py-1">Febrero</td>
                  <td className="py-1">Bs 20.000 +5.000 ajuste</td>
                  <td className="py-1">Bs 18.000</td>
                  <td className="py-1 text-emerald-700">→ Marzo: −Bs 2.000</td>
                </tr>
                <tr>
                  <td className="py-1">Marzo</td>
                  <td className="py-1">Bs 20.000 −2.000 ajuste</td>
                  <td className="py-1">Bs 22.000</td>
                  <td className="py-1 text-amber-700">→ Abril: +Bs 2.000</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            <strong>¿Por qué este modelo y no cobrar el real directo?</strong> Porque el recibo se emite el día 1 del
            mes (necesitas cobrar para pagar facturas durante el mes) y las facturas reales (Hidrocapital, Luz, etc.)
            llegan después. La provisión garantiza liquidez; el ajuste corrige al mes siguiente cuando ya se conoce el
            costo real.
          </p>
          <div className="rounded bg-white/70 p-3 text-xs">
            <p className="font-semibold mb-1">Flujo operativo:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Crear la plantilla con monto fijo (ej. Bs 20.000) y marcar <strong>📊 Tratar como provisión</strong>.</li>
              <li>Cada mes, apretar <strong>"⚡ Aplicar plantillas recurrentes"</strong> → genera la línea
                <em> "Provisión X"</em> + la línea <em>"Ajuste Provisión X mes anterior"</em> automáticamente.</li>
              <li>Cuando llegue la factura real del mes (ej. Hidrocapital), registrar el gasto y
                <strong> elegir la plantilla en el selector "📊 ¿Es el gasto real de alguna provisión?"</strong>.
                Este gasto NO se factura al residente — solo sirve para calcular el ajuste del mes siguiente.</li>
              <li>El próximo mes, al aplicar plantillas, el sistema usa el real registrado para calcular el ajuste.</li>
            </ol>
          </div>
          <p className="text-xs italic">
            Si una plantilla NO está marcada como provisión, el sistema simplemente cobra el monto fijo cada mes sin ajustes.
          </p>
        </div>
      </details>

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
                      className="text-xs text-blue-700 hover:text-blue-900 font-medium"
                      onClick={() => startEdit(tpl)}
                      title="Editar todos los campos de la plantilla"
                    >
                      ✏️ Editar
                    </button>
                    <span className="text-muted-foreground">·</span>
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
            <h3 className="mb-4 font-semibold">
              {editingId ? "✏️ Editar plantilla recurrente" : "+ Nueva plantilla recurrente"}
            </h3>
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Categoría</Label>
                  <CategoryCombobox
                    organizationId={organizationId}
                    communityId={communityId}
                    category={form.category}
                    customCategory={form.customCategory}
                    onChange={(category, customCategory) =>
                      setForm((f) => ({ ...f, category, customCategory }))
                    }
                  />
                </div>
                <div>
                  <Label>Proveedor</Label>
                  <Input value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Descripción</Label>
                <Input required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <Label>Subcategoría <span className="text-muted-foreground text-xs">(opcional — agrupa en el recibo)</span></Label>
                <Input value={form.subCategory} onChange={(e) => setForm((f) => ({ ...f, subCategory: e.target.value }))} maxLength={80} placeholder="Ej: Ascensores, Nómina..." />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Monto</Label>
                  <Input type="number" step="0.01" required value={form.amountUsd}
                    onChange={(e) => setForm((f) => ({ ...f, amountUsd: e.target.value }))} />
                </div>
                <div>
                  <Label>Moneda</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.currencyPrimary}
                    onChange={(e) => setForm((f) => ({ ...f, currencyPrimary: e.target.value as "USD" | "VES" }))}
                  >
                    <option value="VES">Bs — Bolívares (fijo)</option>
                    <option value="USD">USD — Dólares</option>
                  </select>
                </div>
                {multipleTowers ? (
                  <div>
                    <Label>Alcance</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.towerScope}
                      onChange={(e) => setForm((f) => ({ ...f, towerScope: e.target.value }))}
                    >
                      <option value="">General</option>
                      {towers.map((t) => (
                        <option key={t} value={t}>Torre {t}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground flex items-end pb-2">
                    Alcance: General (1 torre)
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                💡 Si eliges <strong>Bs</strong>, el monto se mantiene fijo en bolívares cada mes
                (sin variar con la tasa). Si eliges <strong>USD</strong>, se convierte a Bs con la tasa del mes.
              </p>

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
                <Button type="button" variant="outline" onClick={cancelEdit}>Cancelar</Button>
                <Button type="submit" disabled={createTpl.isPending || updateTpl.isPending}>
                  {(createTpl.isPending || updateTpl.isPending) ? "..." : (editingId ? "💾 Guardar cambios" : "+ Crear plantilla")}
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
  towers,
}: {
  organizationId: string;
  communityId: string;
  defaultYear: number;
  defaultMonth: number;
  onClose: () => void;
  onCreated: () => void;
  create: ReturnType<typeof trpc.finance.expenses.create.useMutation>;
  units: Array<{ id: string; code: string; tower?: string | null }>;
  towers: string[];
}) {
  const multipleTowers = towers.length > 1;
  // Default date: hoy en formato YYYY-MM-DD para input type="date"
  const todayStr = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    category: "ELECTRICITY" as (typeof CATS)[number],
    customCategory: "",
    subCategory: "",
    description: "",
    amount: "",
    // Bs por defecto (pedido del cliente: "Por defecto TODO en bolivares pero
    // con la posibilidad de pasar a dolares").
    currencyPrimary: "VES" as "USD" | "VES",
    supplierName: "",
    supplierRif: "",
    invoiceNumber: "",
    notes: "",
    // Retención de ISLR sobre honorarios pagados a un profesional (pedido cliente
    // 12-jul-2026 vía Reinaldo: "hacer el reporte de las retenciones").
    applyRetention: false,
    retentionPct: "",
    // Fecha completa del comprobante — calendario. Año y mes del período se derivan.
    receiptDate: todayStr,
    periodYear: defaultYear,
    periodMonth: defaultMonth,
    towerScope: "",
    isIndividual: false,
    targetUnitId: "",
    // CRÍTICO: vinculación de gasto REAL contra plantilla de provisión.
    // El admin elige aquí cuál provisión cubre este gasto (Hidrocapital, Luz, etc.)
    // → el sistema calcula automáticamente el AJUSTE PROVISION del mes siguiente.
    recurringTemplateId: "",
  });
  const [error, setError] = useState<string | null>(null);

  // Lista de plantillas de PROVISIÓN activas — para vincular el gasto real
  // contra el cargo de provisión existente.
  const provisionTemplatesQ = trpc.finance.recurringTemplates.list.useQuery({
    organizationId, communityId,
  });
  const provisionTemplates = (provisionTemplatesQ.data ?? [])
    .filter((t) => t.isProvision && t.active);
  // TODAS las plantillas activas — se ofrecen como "concepto guardado" para
  // prellenar el gasto (pedido Reinaldo: "que mis plantillas aparezcan al
  // registrar un gasto"). Elegir una NO la cobra: solo copia sus datos al form.
  const allTemplates = (provisionTemplatesQ.data ?? []).filter((t) => t.active);
  const subCatsQ = trpc.finance.recurringTemplates.subCategories.useQuery(
    { organizationId, communityId }, { staleTime: 30_000 },
  );
  const subCats = subCatsQ.data ?? [];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      // El período (year/month) se deriva de la fecha del comprobante
      // — el gasto se factura en el mes del comprobante.
      const d = new Date(form.receiptDate + "T12:00:00");
      const py = d.getFullYear();
      const pm = d.getMonth() + 1;
      await create.mutateAsync({
        organizationId,
        communityId,
        category: form.category,
        // Subcategoría libre — antes solo se aceptaba si category=OTHER.
        // Ahora cualquier categoría puede llevar customCategory (pedido del cliente:
        // "Crear nuevas categorías en los gastos").
        customCategory: form.customCategory.trim() || undefined,
        subCategory: form.subCategory.trim() || null,
        description: form.description,
        periodYear: py,
        periodMonth: pm,
        receiptDate: d,
        amount: Number(form.amount),
        currencyPrimary: form.currencyPrimary,
        supplierName: form.supplierName || undefined,
        supplierRif: form.supplierRif || undefined,
        invoiceNumber: form.invoiceNumber || undefined,
        notes: form.notes || undefined,
        towerScope: form.isIndividual ? null : (form.towerScope || null),
        isIndividual: form.isIndividual,
        targetUnitId: form.isIndividual && form.targetUnitId ? form.targetUnitId : null,
        recurringTemplateId: form.recurringTemplateId || null,
        retentionPct: form.applyRetention && Number(form.retentionPct) > 0 ? Number(form.retentionPct) : undefined,
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
          {/* Atajo: prellenar el gasto desde una plantilla/concepto guardado.
              Elegir una plantilla NO la cobra — solo copia sus datos a este form,
              y puedes editar todo antes de guardar (pedido de Reinaldo). */}
          {allTemplates.length > 0 && (
            <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
              <Label className="font-semibold text-sky-900">📋 Usar una plantilla / concepto guardado</Label>
              <p className="mb-2 text-[11px] text-sky-700">
                Opcional. Copia el concepto y el monto de una plantilla a este gasto. Puedes editarlo todo antes de guardar.
              </p>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value=""
                onChange={(e) => {
                  const t = allTemplates.find((x) => x.id === e.target.value);
                  if (!t) return;
                  const cp = ((t.currencyPrimary as "USD" | "VES") ?? "USD");
                  const amt = cp === "VES" && t.amountBss
                    ? Number(t.amountBss.toString())
                    : Number(t.amountUsd.toString());
                  setForm((f) => ({
                    ...f,
                    category: t.category as (typeof CATS)[number],
                    customCategory: t.customCategory ?? "",
                    subCategory: (t as { subCategory?: string | null }).subCategory ?? "",
                    description: t.description,
                    supplierName: t.supplierName ?? f.supplierName,
                    currencyPrimary: cp,
                    amount: amt > 0 ? String(amt) : "",
                    // Si es provisión, vincular el gasto real contra ella automáticamente.
                    recurringTemplateId: t.isProvision ? t.id : "",
                  }));
                }}
              >
                <option value="">— Elegir plantilla para prellenar —</option>
                {allTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.isProvision ? "🔒 provisión · " : ""}{t.description}{t.customCategory ? ` · ${t.customCategory}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoría</Label>
              <CategoryCombobox
                organizationId={organizationId}
                communityId={communityId}
                category={form.category}
                customCategory={form.customCategory}
                onChange={(category, customCategory) =>
                  setForm((f) => ({ ...f, category, customCategory }))
                }
              />
            </div>
            <div>
              <Label>Proveedor</Label>
              <Input value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label>
              Subcategoría{" "}
              <span className="text-muted-foreground text-xs">(opcional — agrupa dentro de la categoría en el recibo)</span>
            </Label>
            <Input
              list="expense-subcats"
              placeholder="Ej: Ascensores, Tornillos, 2da quincena..."
              value={form.subCategory}
              onChange={(e) => setForm((f) => ({ ...f, subCategory: e.target.value }))}
              maxLength={80}
            />
            <datalist id="expense-subcats">
              {subCats.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>

          <div>
            <Label>Descripción</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>📅 Fecha del comprobante</Label>
              <Input
                type="date"
                value={form.receiptDate}
                onChange={(e) => setForm((f) => ({ ...f, receiptDate: e.target.value }))}
                required
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                El gasto se carga al mes de esta fecha
                {form.receiptDate && (() => {
                  const dt = new Date(form.receiptDate + "T12:00:00");
                  const MONTHS_LBL = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
                  return ` (${MONTHS_LBL[dt.getMonth()]} ${dt.getFullYear()})`;
                })()}
              </p>
            </div>
            <div>
              <Label># Factura del proveedor</Label>
              <Input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>

          {/* CRÍTICO: vincular gasto real contra plantilla de provisión */}
          <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3">
            <Label className="font-semibold text-amber-900">
              📊 ¿Es el gasto real de alguna provisión?
            </Label>
            <p className="mb-2 text-[11px] text-amber-700">
              Si este gasto es el cobro real de un servicio que ya tienes provisionado (Hidrocapital, Luz, etc.),
              vincúlalo aquí. El sistema cobrará el <strong>monto REAL de este gasto</strong> en lugar del
              estimado de la provisión — así el recibo refleja lo que de verdad se gastó (sin cobrar dos veces).
            </p>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.recurringTemplateId}
              onChange={(e) => setForm((f) => ({ ...f, recurringTemplateId: e.target.value }))}
            >
              <option value="">— No es contra provisión (gasto normal) —</option>
              {provisionTemplates.map((t) => {
                const cp = t.currencyPrimary;
                const amount = cp === "VES" && t.amountBss
                  ? `Bs ${Number(t.amountBss.toString()).toLocaleString("es-VE", { maximumFractionDigits: 0 })}`
                  : `$${Number(t.amountUsd.toString()).toFixed(2)}`;
                return (
                  <option key={t.id} value={t.id}>
                    {t.description} (provisión {amount}/mes)
                  </option>
                );
              })}
            </select>
            {provisionTemplates.length === 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground italic">
                No hay plantillas de provisión activas. Crealas en la pestaña "Plantillas Recurrentes".
              </p>
            )}
            {form.recurringTemplateId && (
              <p className="mt-1 text-[11px] text-emerald-700">
                ✓ Se cobrará este monto REAL en el recibo, y NO el estimado de la provisión.
              </p>
            )}
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
            ) : multipleTowers ? (
              <div>
                <Label className="text-xs">Torre (solo si aplica a una torre)</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.towerScope}
                  onChange={(e) => setForm((f) => ({ ...f, towerScope: e.target.value }))}
                >
                  <option value="">General — todas las unidades</option>
                  {towers.map((t) => (
                    <option key={t} value={t}>Torre {t}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                ℹ️ Este edificio tiene una sola torre — el gasto se aplica a todas las unidades.
              </p>
            )}
          </div>

          {/* Retención de ISLR sobre honorarios (contador, administrador, abogado, etc.) */}
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.applyRetention}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  applyRetention: e.target.checked,
                  // Reinaldo confirmó que la retención siempre es 25% — se precarga
                  // pero se puede editar si algún caso puntual es distinto.
                  retentionPct: e.target.checked && !f.retentionPct ? "25" : f.retentionPct,
                }))}
              />
              <span className="font-medium">🧾 Este pago tiene retención de ISLR (honorarios profesionales)</span>
            </label>
            {form.applyRetention && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <Label className="text-xs">RIF del proveedor</Label>
                  <Input
                    value={form.supplierRif}
                    onChange={(e) => setForm((f) => ({ ...f, supplierRif: e.target.value }))}
                    placeholder="J-12345678-9"
                  />
                </div>
                <div>
                  <Label className="text-xs">% de retención</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={form.retentionPct}
                    onChange={(e) => setForm((f) => ({ ...f, retentionPct: e.target.value }))}
                    placeholder="Ej: 3"
                  />
                </div>
                {form.applyRetention && Number(form.retentionPct) > 0 && Number(form.amount) > 0 && (
                  <p className="col-span-2 text-[11px] text-muted-foreground">
                    Se retendrán {(Number(form.amount) * Number(form.retentionPct) / 100).toFixed(2)}{" "}
                    {form.currencyPrimary === "USD" ? "USD" : "Bs"} — neto a pagar:{" "}
                    {(Number(form.amount) * (1 - Number(form.retentionPct) / 100)).toFixed(2)}{" "}
                    {form.currencyPrimary === "USD" ? "USD" : "Bs"}
                  </p>
                )}
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

// ─── CategoryCombobox ──────────────────────────────────────────────
// Combobox que muestra:
//   • Las 15 categorías base del enum (Electricidad, Agua, …)
//   • Las categorías personalizadas ya en uso en esta comunidad
//   • Opción "+ Crear nueva categoría…" que abre input libre
// Internamente sigue mapeando a (category enum + customCategory string).
function CategoryCombobox({
  organizationId,
  communityId,
  category,
  customCategory,
  disabled,
  onChange,
}: {
  organizationId: string;
  communityId: string;
  category: (typeof CATS)[number];
  customCategory: string;
  disabled?: boolean;
  onChange: (category: (typeof CATS)[number], customCategory: string) => void;
}) {
  const customCatsQ = trpc.finance.recurringTemplates.customCategories.useQuery(
    { organizationId, communityId },
    { staleTime: 30_000 },
  );
  const [mode, setMode] = useState<"select" | "create">("select");
  const [newName, setNewName] = useState("");

  // Valor mostrado en el select: si hay customCategory, ese es el valor "virtual"
  const selectValue = customCategory
    ? `custom:${customCategory}`
    : `base:${category}`;

  // Lista de categorías personalizadas = las ya usadas + la actual (aunque aún no
  // esté guardada en la BD, para que una recién creada quede visible/seleccionada).
  const customList = (() => {
    const names = (customCatsQ.data ?? []).map((c) => c.customCategory);
    if (customCategory && !names.includes(customCategory)) names.unshift(customCategory);
    return names;
  })();

  if (mode === "create") {
    return (
      <div className="flex gap-1">
        <Input
          autoFocus
          placeholder="Nombre de la nueva categoría"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={80}
        />
        <button
          type="button"
          className="text-xs rounded border px-2 hover:bg-emerald-50"
          onClick={() => {
            if (newName.trim()) {
              // Guardar como OTHER + customCategory para que aparezca el nombre nuevo
              onChange("OTHER", newName.trim());
            }
            setMode("select");
            setNewName("");
          }}
          title="Confirmar nueva categoría"
        >
          ✓
        </button>
        <button
          type="button"
          className="text-xs rounded border px-2 hover:bg-slate-50"
          onClick={() => { setMode("select"); setNewName(""); }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <select
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={selectValue}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__new__") {
          setMode("create");
          return;
        }
        if (v.startsWith("custom:")) {
          const name = v.slice(7);
          // Buscar la categoría enum original de esta custom (si existe)
          const found = customCatsQ.data?.find((c) => c.customCategory === name);
          onChange((found?.category as (typeof CATS)[number]) ?? "OTHER", name);
        } else if (v.startsWith("base:")) {
          onChange(v.slice(5) as (typeof CATS)[number], "");
        }
      }}
    >
      <optgroup label="Categorías base">
        {CATS.map((c) => (
          <option key={c} value={`base:${c}`}>{CAT_LABELS[c]}</option>
        ))}
      </optgroup>
      {customList.length > 0 && (
        <optgroup label="Categorías personalizadas">
          {customList.map((name) => (
            <option key={name} value={`custom:${name}`}>
              ✨ {name}
            </option>
          ))}
        </optgroup>
      )}
      {!disabled && (
        <option value="__new__">➕ Crear nueva categoría…</option>
      )}
    </select>
  );
}

// ─── Editar gasto ──────────────────────────────────────────────
type EditExpenseRow = {
  id: string;
  category: string;
  description: string;
  amountUsd: { toString(): string };
  amountBss: { toString(): string };
  currencyPrimary: string;
  receiptDate: Date | null;
  supplierName?: string | null;
  supplierRif?: string | null;
  invoiceNumber?: string | null;
  notes?: string | null;
  towerScope?: string | null;
  recurringTemplateId?: string | null;
  customCategory?: string | null;
  subCategory?: string | null;
  isIndividual?: boolean;
  retentionPct?: { toString(): string } | null;
};

function EditExpenseDialog({
  organizationId,
  communityId,
  expense,
  onClose,
  onSaved,
  updateExpense,
  towers,
}: {
  organizationId: string;
  communityId: string;
  expense: EditExpenseRow;
  onClose: () => void;
  onSaved: () => void;
  updateExpense: ReturnType<typeof trpc.finance.expenses.update.useMutation>;
  towers: string[];
}) {
  const multipleTowers = towers.length > 1;
  const cp = (expense.currencyPrimary === "VES" ? "VES" : "USD") as "USD" | "VES";
  const initialAmount = cp === "VES"
    ? Number(expense.amountBss.toString())
    : Number(expense.amountUsd.toString());
  const initialDate = expense.receiptDate
    ? new Date(expense.receiptDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    category: (CATS.includes(expense.category as (typeof CATS)[number]) ? expense.category : "OTHER") as (typeof CATS)[number],
    description: expense.description,
    customCategory: expense.customCategory ?? "",
    subCategory: expense.subCategory ?? "",
    supplierName: expense.supplierName ?? "",
    supplierRif: expense.supplierRif ?? "",
    invoiceNumber: expense.invoiceNumber ?? "",
    notes: expense.notes ?? "",
    amount: initialAmount.toString(),
    currencyPrimary: cp,
    receiptDate: initialDate,
    towerScope: expense.towerScope ?? "",
    recurringTemplateId: expense.recurringTemplateId ?? "",
    applyRetention: Boolean(expense.retentionPct),
    retentionPct: expense.retentionPct ? Number(expense.retentionPct.toString()).toString() : "",
  });
  const [error, setError] = useState<string | null>(null);

  // Plantillas de provisión activas (para re-vincular)
  const provisionTemplatesQ = trpc.finance.recurringTemplates.list.useQuery({
    organizationId, communityId,
  });
  const provisionTemplates = (provisionTemplatesQ.data ?? [])
    .filter((t) => t.isProvision && t.active);
  const subCatsQ = trpc.finance.recurringTemplates.subCategories.useQuery(
    { organizationId, communityId }, { staleTime: 30_000 },
  );
  const subCats = subCatsQ.data ?? [];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await updateExpense.mutateAsync({
        organizationId,
        id: expense.id,
        category: form.category,
        description: form.description,
        customCategory: form.customCategory.trim() || null,
        subCategory: form.subCategory.trim() || null,
        supplierName: form.supplierName || null,
        supplierRif: form.supplierRif || null,
        invoiceNumber: form.invoiceNumber || null,
        notes: form.notes || null,
        amount: Number(form.amount),
        currencyPrimary: form.currencyPrimary,
        receiptDate: new Date(form.receiptDate + "T12:00:00"),
        towerScope: form.towerScope || null,
        recurringTemplateId: form.recurringTemplateId || null,
        retentionPct: form.applyRetention && Number(form.retentionPct) > 0 ? Number(form.retentionPct) : null,
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg overflow-y-auto max-h-[90vh]">
        <h3 className="mb-4 text-lg font-semibold">✏️ Editar gasto</h3>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoría</Label>
              <CategoryCombobox
                organizationId={organizationId}
                communityId={communityId}
                category={form.category}
                customCategory={form.customCategory}
                onChange={(category, customCategory) =>
                  setForm((f) => ({ ...f, category, customCategory }))
                }
              />
            </div>
            <div>
              <Label>Subcategoría <span className="text-muted-foreground text-xs">(agrupa en el recibo)</span></Label>
              <Input list="edit-subcats" value={form.subCategory} onChange={(e) => setForm((f) => ({ ...f, subCategory: e.target.value }))} maxLength={80} placeholder="Ej: Ascensores, 2da quincena..." />
              <datalist id="edit-subcats">{subCats.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
          </div>
          <div>
            <Label>Descripción</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Proveedor</Label>
              <Input value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
            </div>
            <div>
              <Label>RIF del proveedor</Label>
              <Input value={form.supplierRif} onChange={(e) => setForm((f) => ({ ...f, supplierRif: e.target.value }))} placeholder="J-12345678-9" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>📅 Fecha</Label>
              <Input type="date" value={form.receiptDate} onChange={(e) => setForm((f) => ({ ...f, receiptDate: e.target.value }))} required />
            </div>
            <div>
              <Label># Factura</Label>
              <Input value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto</Label>
              <Input type="number" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Moneda</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.currencyPrimary}
                onChange={(e) => setForm((f) => ({ ...f, currencyPrimary: e.target.value as "USD" | "VES" }))}
              >
                <option value="VES">Bs — Bolívares</option>
                <option value="USD">USD — Dólares</option>
              </select>
            </div>
          </div>
          {!expense.isIndividual && multipleTowers && (
            <div>
              <Label>Alcance</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.towerScope}
                onChange={(e) => setForm((f) => ({ ...f, towerScope: e.target.value }))}
              >
                <option value="">🏢 General (todas las unidades)</option>
                {towers.map((t) => (
                  <option key={t} value={t}>🏗️ Torre {t}</option>
                ))}
              </select>
            </div>
          )}
          <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3">
            <Label className="font-semibold text-amber-900 text-sm">
              📊 ¿Contra qué provisión?
            </Label>
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.recurringTemplateId}
              onChange={(e) => setForm((f) => ({ ...f, recurringTemplateId: e.target.value }))}
            >
              <option value="">— No es contra provisión (gasto normal) —</option>
              {provisionTemplates.map((t) => {
                const amt = t.currencyPrimary === "VES" && t.amountBss
                  ? `Bs ${Number(t.amountBss.toString()).toLocaleString("es-VE", { maximumFractionDigits: 0 })}`
                  : `$${Number(t.amountUsd.toString()).toFixed(2)}`;
                return <option key={t.id} value={t.id}>{t.description} ({amt}/mes)</option>;
              })}
            </select>
          </div>
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.applyRetention}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  applyRetention: e.target.checked,
                  retentionPct: e.target.checked && !f.retentionPct ? "25" : f.retentionPct,
                }))}
              />
              <span className="font-medium">🧾 Este pago tiene retención de ISLR (honorarios profesionales)</span>
            </label>
            {form.applyRetention && (
              <div className="pl-6">
                <Label className="text-xs">% de retención</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.retentionPct}
                  onChange={(e) => setForm((f) => ({ ...f, retentionPct: e.target.value }))}
                  placeholder="Ej: 3"
                />
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
            <Button type="submit" disabled={updateExpense.isPending}>
              {updateExpense.isPending ? "..." : "💾 Guardar cambios"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
