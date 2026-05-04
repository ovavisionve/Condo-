"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const fmt = (n: number | string) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

const STATUS_LABEL: Record<string, string> = {
  ISSUED: "Emitida", PARTIAL: "Pago parcial", PAID: "Pagada", OVERDUE: "Vencida", VOIDED: "Anulada",
};
const STATUS_COLOR: Record<string, string> = {
  ISSUED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  VOIDED: "bg-gray-100 text-gray-400",
};
const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD",
  TRANSFER_BSS: "Trans. Bs", TRANSFER_USD: "Trans. USD",
  ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil", CRYPTO: "Cripto", CHECK: "Cheque", OTHER: "Otro",
};

function PortalContent({ token }: { token: string }) {
  const portalQ = trpc.comercial.portal.getByToken.useQuery({ token }, { retry: false });

  if (portalQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Cargando portal...</p>
        </div>
      </div>
    );
  }

  if (portalQ.isError) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Card className="w-full max-w-md">
          <CardContent className="py-10 text-center">
            <p className="text-4xl mb-4">🔒</p>
            <p className="font-semibold text-red-600 mb-2">Enlace inválido o expirado</p>
            <p className="text-sm text-muted-foreground">
              Este enlace no es válido o ha expirado. Solicite a la administración del centro comercial un nuevo enlace.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = portalQ.data!;
  const { tenancy, local, mall, invoices, payments, summary } = data;

  const pendingInvoices = invoices.filter((i) => ["ISSUED", "PARTIAL", "OVERDUE"].includes(i.status));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-xl p-6">
        <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">Portal del Arrendatario</p>
        <h1 className="text-2xl font-bold">{mall.name}</h1>
        {mall.address && <p className="text-sm text-slate-300 mt-1">{mall.address}</p>}
        <div className="mt-4 pt-4 border-t border-slate-600 flex flex-wrap gap-4 text-sm">
          <div>
            <p className="text-slate-400 text-xs">Arrendatario</p>
            <p className="font-semibold">{tenancy.tenantName}</p>
          </div>
          {tenancy.tenantRif && (
            <div>
              <p className="text-slate-400 text-xs">RIF</p>
              <p className="font-semibold">{tenancy.tenantRif}</p>
            </div>
          )}
          <div>
            <p className="text-slate-400 text-xs">Local</p>
            <p className="font-semibold">{local.code}{local.name ? ` — ${local.name}` : ""}</p>
          </div>
          <div>
            <p className="text-slate-400 text-xs">Desde</p>
            <p className="font-semibold">{new Date(tenancy.startDate).toLocaleDateString("es-VE")}</p>
          </div>
        </div>
      </div>

      {/* Resumen de deuda */}
      {summary.totalPendingUsd > 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-red-800">Saldo pendiente</p>
            <p className="text-xs text-red-600">{summary.pendingCount} factura(s) por pagar</p>
          </div>
          <div className="text-2xl font-bold text-red-700">${fmt(summary.totalPendingUsd)}</div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <p className="text-2xl">✅</p>
          <p className="font-semibold text-green-800">Sin deuda pendiente</p>
        </div>
      )}

      {/* Facturas pendientes */}
      {pendingInvoices.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">⚠️ Facturas pendientes</h2>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">N° Factura</th>
                  <th className="text-left px-4 py-3">Período</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-right px-4 py-3">Total</th>
                  <th className="text-right px-4 py-3">Pendiente</th>
                  <th className="text-right px-4 py-3">Vence</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pendingInvoices.map((inv) => {
                  const pending = Number(inv.totalUsd) - Number(inv.paidUsd);
                  const isOverdue = new Date(inv.dueDate) < new Date() && inv.status !== "PAID";
                  return (
                    <tr key={inv.id} className={isOverdue && inv.status === "OVERDUE" ? "bg-red-50" : ""}>
                      <td className="px-4 py-3 font-mono text-xs font-medium">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3">{MESES[(inv.periodMonth - 1)] ?? ""} {inv.periodYear}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[inv.status] ?? ""}`}>
                          {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">${fmt(inv.totalUsd)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${isOverdue ? "text-red-700" : "text-orange-600"}`}>
                        ${fmt(pending)}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs ${isOverdue ? "text-red-700 font-semibold" : "text-muted-foreground"}`}>
                        {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Historial completo de facturas */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">🧾 Historial de facturas</h2>
        {invoices.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No hay facturas registradas</CardContent></Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">N° Factura</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Período</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-right px-4 py-3">Total USD</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Abonado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-accent/20">
                    <td className="px-4 py-2.5 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground text-xs">
                      {MESES[(inv.periodMonth - 1)] ?? ""} {inv.periodYear}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[inv.status] ?? ""}`}>
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">${fmt(inv.totalUsd)}</td>
                    <td className="px-4 py-2.5 text-right hidden md:table-cell text-green-700">
                      {Number(inv.paidUsd) > 0 ? `$${fmt(inv.paidUsd)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Historial de pagos */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">💰 Historial de pagos</h2>
        {payments.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No hay pagos registrados</CardContent></Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Fecha</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Método</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Referencia</th>
                  <th className="text-right px-4 py-3">Monto USD</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Facturas</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-accent/20">
                    <td className="px-4 py-2.5 text-xs">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell text-xs text-muted-foreground">
                      {METHOD_LABEL[p.method] ?? p.method}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell font-mono text-xs text-muted-foreground">
                      {p.reference ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-green-700">${fmt(p.amountUsd)}</td>
                    <td className="px-4 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">
                      {p.invoiceNumbers.join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Contacto */}
      {(mall.phone || mall.email) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">📞 Contacto de la administración</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4 text-sm">
            {mall.phone && <p>📱 {mall.phone}</p>}
            {mall.email && <p>✉️ <a href={`mailto:${mall.email}`} className="text-blue-600 hover:underline">{mall.email}</a></p>}
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground pb-4">
        Portal de {mall.name} · Acceso exclusivo para arrendatarios
      </p>
    </div>
  );
}

export default function PortalCcPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-64">
            <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <TokenLoader />
        </Suspense>
      </div>
    </div>
  );
}

function TokenLoader() {
  const params = useSearchParams();
  const token = params.get("token");

  if (!token) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-4xl mb-4">🔗</p>
          <p className="font-semibold mb-2">Enlace incompleto</p>
          <p className="text-sm text-muted-foreground">
            Acceda a este portal mediante el enlace proporcionado por la administración del centro comercial.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <PortalContent token={token} />;
}
