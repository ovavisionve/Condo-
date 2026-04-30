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
  const list = trpc.finance.invoices.list.useQuery({ organizationId, communityId, year, month });
  const issue = trpc.finance.invoices.issueMonth.useMutation();
  const sendEmail = trpc.finance.invoices.sendByEmail.useMutation();
  const downloadPdf = trpc.finance.invoices.downloadPdf.useMutation();
  const rate = trpc.finance.exchange.current.useQuery({ organizationId });
  const todayRate = Number(rate.data?.vesPerUsd ?? 0);
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emailStates, setEmailStates] = useState<Record<string, "sending" | "ok" | "err">>({});
  const [pdfStates, setPdfStates] = useState<Record<string, boolean>>({});

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
        setSuccess(`✅ ${r.invoicesCount} factura(s) emitidas a partir de ${r.expensesCount} gasto(s).`);
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
          <h2 className="text-lg font-semibold">Facturas</h2>
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
          <Button variant="outline" onClick={() => onIssue(true)} disabled={issue.isPending} title="Crea las facturas en borrador. Se publicarán y enviarán por email el día 1 del mes siguiente automáticamente.">
            {issue.isPending ? "..." : "📋 Preparar borrador"}
          </Button>
          <Button onClick={() => onIssue(false)} disabled={issue.isPending}>
            {issue.isPending ? "Emitiendo..." : "Emitir ahora"}
          </Button>
        </div>
      </div>

      {error && <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
      {success && <p className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-800">{success}</p>}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2"># Factura</th>
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
              return (
                <tr key={inv.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
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
              );
            })}
            {list.data?.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Sin facturas. Emite el mes para generarlas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT:   "Borrador",
  ISSUED:  "Emitida",
  PARTIAL: "Pago parcial",
  PAID:    "Pagada",
  OVERDUE: "Vencida",
  VOIDED:  "Anulada",
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
