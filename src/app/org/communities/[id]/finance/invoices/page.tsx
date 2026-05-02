"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const today = new Date();

function downloadBase64Pdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InvoicesPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const community = trpc.org.communities.byId.useQuery({ organizationId, id: communityId });
  const list     = trpc.finance.invoices.list.useQuery({ organizationId, communityId, year, month });
  const preview  = trpc.finance.invoices.previewMonth.useQuery({ organizationId, communityId, year, month });
  const [showWizard, setShowWizard] = useState(false);
  const emailProgress = trpc.finance.invoices.emailProgress.useQuery(
    { organizationId, communityId, year, month },
    { refetchInterval: 60_000 }, // refresca cada 60 s
  );
  const issue        = trpc.finance.invoices.issueMonth.useMutation();
  const publishDrafts = trpc.finance.invoices.publishDrafts.useMutation();
  const sendBatch    = trpc.finance.invoices.sendEmailBatch.useMutation();
  const sendEmail    = trpc.finance.invoices.sendByEmail.useMutation();
  const downloadPdf  = trpc.finance.invoices.downloadPdf.useMutation();
  const rate         = trpc.finance.exchange.current.useQuery({ organizationId });
  const todayRate    = Number(rate.data?.vesPerUsd ?? 0);
  const utils        = trpc.useUtils();
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emailStates, setEmailStates] = useState<Record<string, "sending" | "ok" | "err">>({});
  const [pdfStates, setPdfStates]     = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const invoiceDetail = trpc.finance.invoices.byId.useQuery(
    { organizationId, id: expandedId ?? "" },
    { enabled: !!expandedId },
  );

  const draftCount = list.data?.filter(inv => inv.status === "DRAFT").length ?? 0;

  const onPublishDrafts = async () => {
    setError(null); setSuccess(null);
    try {
      const r = await publishDrafts.mutateAsync({ organizationId, communityId, year, month });
      setSuccess(`✅ ${r.published} borrador(es) publicados como EMITIDOS. Los emails se enviarán con el botón de abajo o automáticamente por el cron.`);
      void list.refetch();
      void emailProgress.refetch();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
  };

  const onSendBatch = async () => {
    setError(null); setSuccess(null);
    try {
      const r = await sendBatch.mutateAsync({ organizationId, communityId, year, month, batchSize: 40 });
      setSuccess(`📧 Lote enviado: ${r.sent} exitosos · ${r.failed} fallidos · ${r.remaining ?? 0} pendientes restantes.`);
      void emailProgress.refetch();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
  };

  const onSendEmail = async (invoiceId: string) => {
    setEmailStates((s) => ({ ...s, [invoiceId]: "sending" }));
    try {
      const r = await sendEmail.mutateAsync({ organizationId, invoiceId });
      setEmailStates((s) => ({ ...s, [invoiceId]: r.success ? "ok" : "err" }));
    } catch {
      setEmailStates((s) => ({ ...s, [invoiceId]: "err" }));
    }
  };

  const onDownloadPdf = async (invoiceId: string, invoiceNumber: string) => {
    setPdfStates((s) => ({ ...s, [invoiceId]: true }));
    try {
      const r = await downloadPdf.mutateAsync({ organizationId, id: invoiceId });
      downloadBase64Pdf(r.base64, `Recibo-${invoiceNumber}.pdf`);
    } finally {
      setPdfStates((s) => ({ ...s, [invoiceId]: false }));
    }
  };

  const onIssue = async (asDraft = false) => {
    setError(null);
    setSuccess(null);
    const dueDays = (community.data as { dueDaysAfterIssue?: number } | undefined)?.dueDaysAfterIssue ?? 5;
    const issuedDate = new Date();
    const dueDate = new Date(issuedDate.getTime() + dueDays * 24 * 60 * 60 * 1000);
    try {
      const r = await issue.mutateAsync({
        organizationId,
        communityId,
        year,
        month,
        dueDate,
        asDraft,
      });
      if (asDraft) {
        setSuccess(`📋 ${r.invoicesCount} borrador(es) preparado(s). Se publicarán y enviarán automáticamente el día 1 del mes siguiente.`);
      } else {
        setSuccess(`✅ ${r.invoicesCount} Recibo(s) de Condominio emitido(s) a partir de ${r.expensesCount} Gasto(s) Común(es).`);
      }
      void list.refetch();
      void utils.finance.expenses.list.invalidate();
      void utils.finance.aging.invalidate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al emitir");
    }
  };

  const totals = list.data?.reduce(
    (acc, inv) => ({
      usd: acc.usd + Number(inv.totalUsd.toString()),
      paidUsd: acc.paidUsd + Number(inv.paidUsd.toString()),
    }),
    { usd: 0, paidUsd: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Recibos de Condominio</h2>
          <p className="text-sm text-muted-foreground">
            Período {month}/{year} ·
            {totals && ` Emitido $${totals.usd.toFixed(2)} · Cobrado $${totals.paidUsd.toFixed(2)} · Pendiente $${(totals.usd - totals.paidUsd).toFixed(2)}`}
            {totals && todayRate > 0 && ` · Bs pendiente hoy: ${((totals.usd - totals.paidUsd) * todayRate).toLocaleString("es-VE", { maximumFractionDigits: 2 })}`}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label>Año</Label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24" />
          </div>
          <div>
            <Label>Mes</Label>
            <Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-20" />
          </div>
          <Button variant="outline" onClick={() => onIssue(true)} disabled={issue.isPending} title="Crea los Recibos de Condominio en borrador. Se publicarán y enviarán por email el día 1 del mes siguiente automáticamente.">
            {issue.isPending ? "..." : "📋 Preparar borrador"}
          </Button>
          <Button onClick={() => setShowWizard(true)} disabled={issue.isPending}>
            ✨ Emitir recibos
          </Button>
        </div>
      </div>

      {error && <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
      {success && <p className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-800">{success}</p>}

      {/* Banner de borradores pendientes */}
      {draftCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-800">
              📋 {draftCount} recibo(s) en BORRADOR
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Están listos pero no son visibles para los propietarios aún. Publícalos para activarlos y luego envía los emails.
            </p>
          </div>
          <Button
            size="sm"
            onClick={onPublishDrafts}
            disabled={publishDrafts.isPending}
            className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
          >
            {publishDrafts.isPending ? "Publicando…" : "🚀 Publicar ahora"}
          </Button>
        </div>
      )}

      {/* Wizard de emisión — se muestra siempre que showWizard sea true */}
      {showWizard && (
        preview.isLoading ? (
          /* Overlay de carga mientras se obtiene el preview */
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-xl bg-white px-8 py-6 shadow-2xl text-center space-y-3">
              <div className="text-3xl animate-pulse">📄</div>
              <p className="font-medium">Cargando datos del período…</p>
              <p className="text-sm text-muted-foreground">Consultando gastos y unidades</p>
            </div>
          </div>
        ) : preview.data ? (
          <IssueWizard
            preview={preview.data}
            year={year}
            month={month}
            onClose={() => setShowWizard(false)}
            onConfirmDraft={() => { setShowWizard(false); void onIssue(true); }}
            onConfirmNow={() => { setShowWizard(false); void onIssue(false); }}
            isPending={issue.isPending}
          />
        ) : (
          /* Error al cargar el preview */
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-xl bg-white px-8 py-6 shadow-2xl text-center space-y-3 max-w-sm">
              <div className="text-3xl">⚠️</div>
              <p className="font-medium">No se pudo cargar el preview</p>
              <p className="text-sm text-muted-foreground">{preview.error?.message ?? "Intenta de nuevo"}</p>
              <Button variant="outline" onClick={() => setShowWizard(false)}>Cerrar</Button>
            </div>
          </div>
        )
      )}

      {/* Panel de progreso de envío masivo */}
      {emailProgress.data && emailProgress.data.total > 0 && (
        <EmailProgressPanel
          data={emailProgress.data}
          onSendBatch={onSendBatch}
          isSending={sendBatch.isPending}
        />
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2"># Recibo</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2 text-right">Total USD</th>
              <th className="px-3 py-2 text-right">Pagado USD</th>
              <th className="px-3 py-2 text-right">Pendiente USD</th>
              <th className="px-3 py-2 text-right">Pendiente Bs (hoy)</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Vence</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((inv) => {
              const es = emailStates[inv.id];
              const isExpanded = expandedId === inv.id;
              return (
                <>
                <tr
                  key={inv.id}
                  className={`border-t cursor-pointer hover:bg-muted/30 ${isExpanded ? "bg-muted/20" : ""}`}
                  onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                >
                  <td className="px-3 py-2 font-medium">
                    <span className="mr-1 text-xs text-muted-foreground">{isExpanded ? "▼" : "▶"}</span>
                    {inv.invoiceNumber}
                  </td>
                  <td className="px-3 py-2">{inv.unit.code}</td>
                  <td className="px-3 py-2 text-right">${Number(inv.totalUsd.toString()).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-green-700">${Number(inv.paidUsd.toString()).toFixed(2)}</td>
                  {(() => {
                    const pending = Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString());
                    const pendingBsHoy = pending * todayRate;
                    return (
                      <>
                        <td className={`px-3 py-2 text-right ${pending > 0.005 ? "font-medium text-destructive" : "text-green-600"}`}>
                          ${pending.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                          {pending > 0.005 && todayRate > 0
                            ? `Bs ${pendingBsHoy.toLocaleString("es-VE", { maximumFractionDigits: 2 })}`
                            : "—"}
                        </td>
                      </>
                    );
                  })()}
                  <td className="px-3 py-2">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{new Date(inv.dueDate).toLocaleDateString("es-VE")}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      {/* Descargar PDF */}
                      <button
                        onClick={() => onDownloadPdf(inv.id, inv.invoiceNumber)}
                        disabled={pdfStates[inv.id]}
                        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 whitespace-nowrap"
                        title="Descargar recibo en PDF"
                      >
                        {pdfStates[inv.id] ? "..." : "📄 PDF"}
                      </button>
                      {/* Enviar por email */}
                      {es === "ok" ? (
                        <span className="text-xs text-green-600 font-medium">✓ Enviado</span>
                      ) : es === "err" ? (
                        <button onClick={() => onSendEmail(inv.id)} className="text-xs text-destructive hover:underline">
                          Error — reintentar
                        </button>
                      ) : (
                        <button
                          onClick={() => onSendEmail(inv.id)}
                          disabled={es === "sending"}
                          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                        >
                          {es === "sending" ? "Enviando..." : "✉️ Email"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {/* Fila expandida: detalle de ítems con total del gasto + alícuota */}
                {isExpanded && (
                  <tr key={`${inv.id}-detail`} className="border-t bg-slate-50/80">
                    <td colSpan={9} className="px-6 py-3">
                      {invoiceDetail.isLoading ? (
                        <p className="text-sm text-muted-foreground">Cargando detalle...</p>
                      ) : invoiceDetail.data ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Detalle del recibo — {invoiceDetail.data.items.length} ítem(s)
                          </p>
                          <table className="w-full text-xs border rounded overflow-hidden">
                            <thead className="bg-slate-100">
                              <tr>
                                <th className="px-2 py-1.5 text-left">Concepto</th>
                                <th className="px-2 py-1.5 text-right">Total gasto</th>
                                <th className="px-2 py-1.5 text-right">Alícuota</th>
                                <th className="px-2 py-1.5 text-right">Parte esta unidad (USD)</th>
                                <th className="px-2 py-1.5 text-right">Parte esta unidad (Bs)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {invoiceDetail.data.items.map((item) => {
                                type ItemWithExpense = typeof item & {
                                  expense?: {
                                    amountUsd: string | number | { toString(): string };
                                    amountBss: string | number | { toString(): string };
                                  } | null;
                                };
                                const it = item as ItemWithExpense;
                                return (
                                  <tr key={item.id} className="border-t">
                                    <td className="px-2 py-1.5">{item.description}</td>
                                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                                      {it.expense
                                        ? `$${Number(it.expense.amountUsd.toString()).toFixed(2)}`
                                        : "—"
                                      }
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                                      {Number(item.aliquot.toString()) > 0
                                        ? `${Number(item.aliquot.toString()).toFixed(4)}%`
                                        : "—"
                                      }
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-medium">
                                      ${Number(item.amountUsd.toString()).toFixed(2)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                                      {Number(item.amountBss.toString()).toFixed(2)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot className="border-t bg-slate-100 font-semibold">
                              <tr>
                                <td colSpan={3} className="px-2 py-1.5 text-right">TOTAL</td>
                                <td className="px-2 py-1.5 text-right">
                                  ${Number(invoiceDetail.data.totalUsd.toString()).toFixed(2)}
                                </td>
                                <td className="px-2 py-1.5 text-right text-muted-foreground">
                                  {Number(invoiceDetail.data.totalBss.toString()).toFixed(2)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )}
                </>
              );
            })}
            {list.data?.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Sin Recibos de Condominio. Emite el mes para generarlos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Wizard de emisión de recibos ─────────────────────────────────────────────
const MONTHS_ES_WIZ = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface PreviewData {
  expenses: { description: string; amountUsd: string; amountBss: string }[];
  totalExpensesUsd: string;
  totalExpensesBss: string;
  unitCount: number;
  unitPreviews: { unitCode: string; aliquot: string; estimatedUsd: string }[];
  alreadyIssued: boolean;
}

function IssueWizard({
  preview, year, month, onClose, onConfirmDraft, onConfirmNow, isPending,
}: {
  preview: PreviewData; year: number; month: number;
  onClose: () => void;
  onConfirmDraft: () => void;
  onConfirmNow: () => void;
  isPending: boolean;
}) {
  const [step, setStep] = useState(1);
  const monthLabel = MONTHS_ES_WIZ[month - 1] ?? String(month);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold">Emitir Recibos de Condominio</p>
            <p className="text-slate-400 text-xs">{monthLabel} {year}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {[1,2,3].map(s => (
              <div key={s} className="flex items-center gap-1">
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${step >= s ? "bg-blue-500 text-white" : "bg-slate-700 text-slate-400"}`}>{s}</div>
                {s < 3 && <div className={`h-0.5 w-6 ${step > s ? "bg-blue-500" : "bg-slate-700"}`} />}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Paso 1: Gastos del período */}
          {step === 1 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Paso 1 — Gastos del período</h3>
              {preview.alreadyIssued && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  ⚠️ Ya existen recibos emitidos para este período. Se ignorarán unidades que ya tienen recibo.
                </div>
              )}
              {preview.expenses.length === 0 ? (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                  ❌ No hay gastos registrados para {monthLabel} {year}. Primero registra los gastos comunes.
                </div>
              ) : (
                <table className="w-full text-sm border rounded overflow-hidden">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-3 py-2 text-left">Gasto</th>
                      <th className="px-3 py-2 text-right">USD</th>
                      <th className="px-3 py-2 text-right">Bs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.expenses.map((e, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5">{e.description}</td>
                        <td className="px-3 py-1.5 text-right">${e.amountUsd}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">{Number(e.amountBss).toLocaleString("es-VE", { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    <tr className="border-t bg-slate-50 font-semibold">
                      <td className="px-3 py-2">TOTAL</td>
                      <td className="px-3 py-2 text-right">${preview.totalExpensesUsd}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{Number(preview.totalExpensesBss).toLocaleString("es-VE", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              <p className="text-xs text-muted-foreground">Se distribuirá entre {preview.unitCount} unidades según alícuota de cada una.</p>
            </div>
          )}

          {/* Paso 2: Preview por unidad */}
          {step === 2 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Paso 2 — Distribución estimada</h3>
              <p className="text-sm text-muted-foreground">Estimado por alícuota (valores exactos calculados al emitir con el algoritmo Hamilton).</p>
              <table className="w-full text-sm border rounded overflow-hidden">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-left">Unidad</th>
                    <th className="px-3 py-2 text-right">Alícuota</th>
                    <th className="px-3 py-2 text-right">Estimado USD</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.unitPreviews.map((u, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-medium">{u.unitCode}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{u.aliquot}%</td>
                      <td className="px-3 py-1.5 text-right">${u.estimatedUsd}</td>
                    </tr>
                  ))}
                  {preview.unitCount > 20 && (
                    <tr className="border-t bg-slate-50">
                      <td colSpan={3} className="px-3 py-2 text-center text-xs text-muted-foreground">
                        … y {preview.unitCount - 20} unidades más
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Paso 3: Confirmar */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Paso 3 — Confirmar emisión</h3>
              <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Período</span><span className="font-medium">{monthLabel} {year}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total gastos</span><span className="font-medium">${preview.totalExpensesUsd}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Unidades</span><span className="font-medium">{preview.unitCount}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={onConfirmDraft}
                  disabled={isPending}
                  className="rounded-lg border-2 border-slate-300 p-4 text-left hover:border-slate-500 transition-colors"
                >
                  <p className="font-semibold text-sm">📋 Preparar borrador</p>
                  <p className="text-xs text-muted-foreground mt-1">Crea los recibos en BORRADOR. El cron los publicará y enviará por email del 1–5 del próximo mes.</p>
                </button>
                <button
                  type="button"
                  onClick={onConfirmNow}
                  disabled={isPending || preview.expenses.length === 0}
                  className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4 text-left hover:bg-blue-100 transition-colors disabled:opacity-50"
                >
                  <p className="font-semibold text-sm text-blue-700">⚡ Emitir ahora</p>
                  <p className="text-xs text-blue-600 mt-1">Publica los recibos inmediatamente como EMITIDOS. Los emails se enviarán en los próximos días.</p>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-between bg-slate-50">
          <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)} className="text-sm text-muted-foreground hover:text-foreground">
            {step === 1 ? "Cancelar" : "← Atrás"}
          </button>
          {step < 3 && (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={step === 1 && preview.expenses.length === 0}
            >
              Siguiente →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Panel de progreso de envío masivo ────────────────────────────────────────
interface EmailProgressData {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  todaySent: number;
  dailyCap: number;
  complete: boolean;
}

function EmailProgressPanel({
  data, onSendBatch, isSending,
}: {
  data: EmailProgressData;
  onSendBatch: () => void;
  isSending: boolean;
}) {
  const pct = data.total > 0 ? Math.round((data.sent / data.total) * 100) : 0;
  const canSendMore = data.pending > 0 && !data.complete;

  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">📧 Envío masivo de emails</span>
          {data.complete && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 uppercase tracking-wide">
              Completado
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Hoy: {data.todaySent}/{data.dailyCap} · Total: {data.sent}/{data.total}
          </span>
          {canSendMore && (
            <button
              onClick={onSendBatch}
              disabled={isSending}
              className="rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 transition-colors"
            >
              {isSending ? "Enviando…" : `📤 Enviar lote (hasta 40)`}
            </button>
          )}
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="text-green-700 font-medium">✓ {data.sent} enviados</span>
        {data.pending > 0 && <span>⏳ {data.pending} pendientes</span>}
        {data.failed > 0  && <span className="text-destructive">✗ {data.failed} sin email registrado</span>}
        <span className="ml-auto">{pct}% completado</span>
      </div>

      {canSendMore && (
        <p className="text-[11px] text-muted-foreground border-t pt-2">
          Puedes enviar manualmente hasta 40 emails por click, o dejar que el cron lo haga automáticamente cada día (8 AM UTC, días 1–5 del mes).
        </p>
      )}
    </div>
  );
}

// ─── Estado de factura ─────────────────────────────────────────────────────────
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
    DRAFT: "bg-gray-100 text-gray-700",
    ISSUED: "bg-blue-100 text-blue-700",
    PARTIAL: "bg-amber-100 text-amber-700",
    PAID: "bg-green-100 text-green-700",
    OVERDUE: "bg-red-100 text-red-700",
    VOIDED: "bg-zinc-200 text-zinc-600 line-through",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100"}`}>
      {INVOICE_STATUS_LABELS[status] ?? status}
    </span>
  );
}
