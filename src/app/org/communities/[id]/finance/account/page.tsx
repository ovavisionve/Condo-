"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/SearchableSelect";

const MONTHS_ES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

type ViewMode = "statement" | "accounting" | "debt-breakdown";

export default function AccountStatementPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [unitId, setUnitId]     = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("statement");

  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const invoices = trpc.finance.invoices.list.useQuery(
    { organizationId, communityId, unitId },
    { enabled: Boolean(unitId) },
  );
  const payments = trpc.finance.payments.list.useQuery(
    { organizationId, communityId, unitId },
    { enabled: Boolean(unitId) },
  );
  const balance = trpc.finance.unitBalance.useQuery(
    { organizationId, unitId },
    { enabled: Boolean(unitId) },
  );
  const rate     = trpc.finance.exchange.current.useQuery({ organizationId });
  const todayRate = Number(rate.data?.vesPerUsd ?? 0);
  const unit = units.data?.find((u) => u.id === unitId);
  const utils = trpc.useUtils();
  const applyCredit = trpc.finance.applyUnitCredit.useMutation();
  const creditUsd = Number(balance.data?.creditUsd ?? 0);
  const debtUsd = Number(balance.data?.usd ?? 0);

  const onApplyCredit = async () => {
    if (creditUsd <= 0.005) return;
    if (debtUsd <= 0.005) {
      window.alert("Esta unidad no tiene deudas pendientes — el saldo a favor permanece como anticipo para recibos futuros.");
      return;
    }
    if (!window.confirm(
      `Aplicar saldo a favor ($${creditUsd.toFixed(2)}) a las facturas pendientes más antiguas de la unidad ${unit?.code}?`,
    )) return;
    try {
      const r = await applyCredit.mutateAsync({ organizationId, unitId });
      window.alert(`✅ Saldo aplicado a ${r.applied.length} factura(s):\n\n` +
        r.applied.map(a => `• ${a.invoiceNumber} — ${a.usd !== "—" ? "$" + a.usd : a.bss + " Bs"}`).join("\n"));
      void utils.finance.unitBalance.invalidate();
      void utils.finance.invoices.list.invalidate();
      void utils.finance.payments.list.invalidate();
    } catch (e: unknown) {
      window.alert("Error: " + (e instanceof Error ? e.message : "desconocido"));
    }
  };

  // Desglose de deuda por mes (solo recibos con pendiente)
  const debtByMonth = (invoices.data ?? [])
    .filter((inv) => inv.status !== "VOIDED")
    .map((inv) => ({
      ...inv,
      pending: Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString()),
    }))
    .filter((inv) => inv.pending > 0.005)
    .sort((a, b) => a.periodYear !== b.periodYear
      ? a.periodYear - b.periodYear
      : a.periodMonth - b.periodMonth
    );

  // Formato contable: combinar facturas + pagos en una línea de tiempo Debe/Haber/Saldo
  const accountingRows = (() => {
    type Row = {
      date: Date;
      concept: string;
      debe: number;
      haber: number;
      ref?: string;
    };
    const rows: Row[] = [];

    for (const inv of invoices.data ?? []) {
      if (inv.status === "VOIDED") continue;
      rows.push({
        date: new Date(inv.issuedAt),
        concept: `Recibo ${inv.invoiceNumber} — ${MONTHS_ES[(inv.periodMonth - 1)] ?? inv.periodMonth}/${inv.periodYear}`,
        debe: Number(inv.totalUsd.toString()),
        haber: 0,
        ref: inv.invoiceNumber,
      });
    }
    for (const pay of payments.data ?? []) {
      if (pay.voidedAt) continue;
      rows.push({
        date: new Date(pay.paidAt),
        concept: `Pago — ${pay.method}${pay.reference ? ` #${pay.reference}` : ""}`,
        debe: 0,
        haber: Number(pay.amountUsd.toString()),
        ref: pay.reference ?? undefined,
      });
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calcular saldo acumulado
    let saldo = 0;
    return rows.map((r) => {
      saldo = saldo + r.debe - r.haber;
      return { ...r, saldo };
    });
  })();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Estado de cuenta del propietario</h2>
        <p className="text-sm text-muted-foreground">Historial de recibos y pagos por unidad</p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="max-w-xs flex-1">
          <Label>Seleccionar unidad</Label>
          <SearchableSelect
            value={unitId}
            onChange={setUnitId}
            placeholder="Buscar unidad (ej. 101A, B-16)..."
            options={(units.data ?? []).map((u) => {
              const owner = u.ownerships[0]?.person;
              return {
                value: u.id,
                label: u.code + (owner ? ` — ${owner.firstName} ${owner.lastName}` : ""),
              };
            })}
          />
        </div>

        {unitId && (
          <div className="flex gap-1 rounded-lg border p-1">
            {(["statement", "debt-breakdown", "accounting"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`rounded px-3 py-1.5 text-sm transition-colors ${
                  viewMode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "statement"      ? "Estado de cuenta"
                 : m === "debt-breakdown" ? "Deuda por mes"
                 : "Libro contable"}
              </button>
            ))}
          </div>
        )}
      </div>

      {unitId && (
        <>
          {/* KPI: Saldo (Bs primario) */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">Saldo pendiente (Bs)</div>
              <div className={`text-3xl font-bold ${debtUsd > 0.005 ? "text-destructive" : "text-green-600"}`}>
                Bs {(debtUsd * todayRate).toLocaleString("es-VE", { maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {todayRate > 0 ? `Tasa BCV: ${todayRate.toFixed(4)} Bs/$` : "Cargando tasa..."}
              </div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">Equivalente USD</div>
              <div className={`text-3xl font-bold ${debtUsd > 0.005 ? "text-destructive" : "text-green-600"}`}>
                ${debtUsd.toFixed(2)}
              </div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">Meses con deuda pendiente</div>
              <div className={`text-3xl font-bold ${debtByMonth.length > 0 ? "text-destructive" : "text-green-600"}`}>
                {debtByMonth.length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {debtByMonth.length === 0 ? "Solvente ✓" : "meses sin saldar"}
              </div>
            </div>
          </div>

          {/* Banner: Saldo a favor (anticipo) */}
          {creditUsd > 0.005 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  💰 Saldo a favor: ${creditUsd.toFixed(2)} USD
                  <span className="ml-2 text-xs font-normal text-amber-700">
                    (Bs {Number(balance.data?.creditBss ?? 0).toLocaleString("es-VE", { maximumFractionDigits: 2 })} reales)
                  </span>
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Pagos recibidos de esta unidad sin asignar a recibos. Se pueden aplicar a recibos pendientes ordenados por antigüedad.
                </p>
              </div>
              {debtUsd > 0.005 && (
                <button
                  onClick={onApplyCredit}
                  disabled={applyCredit.isPending}
                  className="shrink-0 rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  {applyCredit.isPending ? "Aplicando…" : "✨ Aplicar a recibos pendientes"}
                </button>
              )}
            </div>
          )}

          {/* Vista: Estado de cuenta clásico */}
          {viewMode === "statement" && (
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Recibos — {unit?.code}</h3>
                <div className="overflow-hidden rounded-lg border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2"># Recibo</th>
                        <th className="px-3 py-2">Período</th>
                        <th className="px-3 py-2 text-right">Total USD</th>
                        <th className="px-3 py-2 text-right">Pagado USD</th>
                        <th className="px-3 py-2 text-right">Pendiente USD</th>
                        <th className="px-3 py-2 text-right">Pendiente Bs (hoy)</th>
                        <th className="px-3 py-2">Estado</th>
                        <th className="px-3 py-2">Vence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.data?.map((inv) => {
                        const pending = Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString());
                        return (
                          <tr key={inv.id} className={`border-t ${inv.status === "VOIDED" ? "opacity-50" : ""}`}>
                            <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {MONTHS_ES[(inv.periodMonth - 1)] ?? inv.periodMonth} {inv.periodYear}
                            </td>
                            <td className="px-3 py-2 text-right">${Number(inv.totalUsd.toString()).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-green-700">${Number(inv.paidUsd.toString()).toFixed(2)}</td>
                            <td className={`px-3 py-2 text-right ${pending > 0.005 ? "font-medium text-destructive" : "text-green-600"}`}>
                              ${pending.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                              {pending > 0.005 && todayRate > 0
                                ? `Bs ${(pending * todayRate).toLocaleString("es-VE", { maximumFractionDigits: 2 })}`
                                : "—"}
                            </td>
                            <td className="px-3 py-2"><StatusBadge status={inv.status} /></td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                            </td>
                          </tr>
                        );
                      })}
                      {(invoices.data?.length ?? 0) === 0 && (
                        <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Sin recibos</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Pagos recibidos — {unit?.code}</h3>
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
                      {payments.data?.map((p) => (
                        <tr key={p.id} className={`border-t ${p.voidedAt ? "opacity-40 line-through" : ""}`}>
                          <td className="px-3 py-2">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                          <td className="px-3 py-2 text-xs">{p.method}</td>
                          <td className="px-3 py-2 text-muted-foreground">{p.reference ?? "—"}</td>
                          <td className="px-3 py-2 text-right">${Number(p.amountUsd.toString()).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{Number(p.amountBss.toString()).toFixed(2)}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {p.allocations.length > 0
                              ? p.allocations.map((a) => a.invoice.invoiceNumber).join(", ")
                              : <span className="text-amber-700">anticipo</span>
                            }
                          </td>
                        </tr>
                      ))}
                      {(payments.data?.length ?? 0) === 0 && (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Sin pagos</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Vista: Desglose de deuda por mes */}
          {viewMode === "debt-breakdown" && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Deuda pendiente por mes — {unit?.code}
              </h3>
              {debtByMonth.length === 0 ? (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-8 text-center text-green-800">
                  <p className="text-2xl mb-2">✅</p>
                  <p className="font-medium">Propietario solvente</p>
                  <p className="text-sm text-green-600 mt-1">Sin deuda pendiente en ningún período</p>
                </div>
              ) : (
                <>
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-sm text-red-800">
                      <strong>Total adeudado:</strong> ${debtByMonth.reduce((s, d) => s + d.pending, 0).toFixed(2)} USD
                      {todayRate > 0 && (
                        <span className="ml-2 text-red-600">
                          (Bs {(debtByMonth.reduce((s, d) => s + d.pending, 0) * todayRate).toLocaleString("es-VE", { maximumFractionDigits: 2 })} hoy)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-red-600 mt-1">{debtByMonth.length} mes(es) sin saldar</p>
                  </div>
                  <div className="overflow-hidden rounded-lg border bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-3 py-2">Período</th>
                          <th className="px-3 py-2"># Recibo</th>
                          <th className="px-3 py-2 text-right">Total USD</th>
                          <th className="px-3 py-2 text-right">Pagado USD</th>
                          <th className="px-3 py-2 text-right font-semibold text-destructive">Pendiente USD</th>
                          <th className="px-3 py-2 text-right">Pendiente Bs (hoy)</th>
                          <th className="px-3 py-2">Estado</th>
                          <th className="px-3 py-2">Venció</th>
                          <th className="px-3 py-2">Días mora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debtByMonth.map((inv) => {
                          const today = new Date();
                          const daysOverdue = Math.max(0, Math.floor(
                            (today.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
                          ));
                          return (
                            <tr key={inv.id} className="border-t">
                              <td className="px-3 py-2 font-medium">
                                {MONTHS_ES[(inv.periodMonth - 1)] ?? inv.periodMonth} {inv.periodYear}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{inv.invoiceNumber}</td>
                              <td className="px-3 py-2 text-right">${Number(inv.totalUsd.toString()).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-green-700">${Number(inv.paidUsd.toString()).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-bold text-destructive">
                                ${inv.pending.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                                {todayRate > 0
                                  ? `Bs ${(inv.pending * todayRate).toLocaleString("es-VE", { maximumFractionDigits: 2 })}`
                                  : "—"
                                }
                              </td>
                              <td className="px-3 py-2"><StatusBadge status={inv.status} /></td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {daysOverdue > 0
                                  ? <span className={`font-medium ${daysOverdue > 90 ? "text-red-700" : daysOverdue > 30 ? "text-orange-600" : "text-amber-600"}`}>
                                      {daysOverdue} días
                                    </span>
                                  : <span className="text-green-600">Al día</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t bg-muted/30 font-semibold">
                        <tr>
                          <td colSpan={4} className="px-3 py-2 text-right">TOTAL ADEUDADO</td>
                          <td className="px-3 py-2 text-right text-destructive">
                            ${debtByMonth.reduce((s, d) => s + d.pending, 0).toFixed(2)}
                          </td>
                          <td colSpan={4} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Vista: Libro contable Debe/Haber/Saldo */}
          {viewMode === "accounting" && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Libro contable — {unit?.code}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (Debe = recibos emitidos · Haber = pagos recibidos · Saldo = deuda acumulada)
                </span>
              </h3>
              <div className="overflow-hidden rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Concepto</th>
                      <th className="px-3 py-2 text-right text-red-700">Debe (USD)</th>
                      <th className="px-3 py-2 text-right text-green-700">Haber (USD)</th>
                      <th className="px-3 py-2 text-right font-semibold">Saldo (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountingRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          Sin movimientos
                        </td>
                      </tr>
                    )}
                    {accountingRows.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`border-t ${
                          row.haber > 0 ? "bg-green-50/40" : ""
                        }`}
                      >
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.date.toLocaleDateString("es-VE")}
                        </td>
                        <td className="px-3 py-2">{row.concept}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.debe > 0
                            ? <span className="text-red-700">${row.debe.toFixed(2)}</span>
                            : <span className="text-muted-foreground">—</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.haber > 0
                            ? <span className="text-green-700">${row.haber.toFixed(2)}</span>
                            : <span className="text-muted-foreground">—</span>
                          }
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${
                          row.saldo > 0.005 ? "text-destructive"
                          : row.saldo < -0.005 ? "text-green-600"
                          : "text-muted-foreground"
                        }`}>
                          ${row.saldo.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {accountingRows.length > 0 && (
                    <tfoot className="border-t bg-muted/30 font-semibold">
                      <tr>
                        <td colSpan={2} className="px-3 py-2 text-right">TOTALES</td>
                        <td className="px-3 py-2 text-right text-red-700">
                          ${accountingRows.reduce((s, r) => s + r.debe, 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right text-green-700">
                          ${accountingRows.reduce((s, r) => s + r.haber, 0).toFixed(2)}
                        </td>
                        <td className={`px-3 py-2 text-right ${
                          (accountingRows.at(-1)?.saldo ?? 0) > 0.005 ? "text-destructive" : "text-green-700"
                        }`}>
                          ${(accountingRows.at(-1)?.saldo ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT:   "Borrador",
  ISSUED:  "Emitido",
  PARTIAL: "Pago parcial",
  PAID:    "Pagado",
  OVERDUE: "Vencido",
  VOIDED:  "Anulado",
};

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT:   "bg-gray-100 text-gray-700",
    ISSUED:  "bg-blue-100 text-blue-700",
    PARTIAL: "bg-amber-100 text-amber-700",
    PAID:    "bg-green-100 text-green-700",
    OVERDUE: "bg-red-100 text-red-700",
    VOIDED:  "bg-zinc-200 text-zinc-600 line-through",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100"}`}>
      {INVOICE_STATUS_LABELS[status] ?? status}
    </span>
  );
}
