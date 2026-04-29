"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Label } from "@/components/ui/label";

export default function AccountStatementPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [unitId, setUnitId] = useState<string>("");

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

  const unit = units.data?.find((u) => u.id === unitId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Estado de cuenta</h2>
        <p className="text-sm text-muted-foreground">Historial de facturas y pagos por unidad</p>
      </div>

      <div className="max-w-xs">
        <Label>Seleccionar unidad</Label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
        >
          <option value="">Seleccionar...</option>
          {units.data?.map((u) => {
            const owner = u.ownerships[0]?.person;
            return (
              <option key={u.id} value={u.id}>
                {u.code}{owner ? ` — ${owner.firstName} ${owner.lastName}` : ""}
              </option>
            );
          })}
        </select>
      </div>

      {unitId && (
        <>
          {/* Saldo actual */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">Saldo pendiente USD</div>
              <div className={`text-3xl font-bold ${Number(balance.data?.usd ?? 0) > 0 ? "text-destructive" : "text-green-600"}`}>
                ${Number(balance.data?.usd ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">Saldo pendiente Bs</div>
              <div className={`text-3xl font-bold ${Number(balance.data?.bss ?? 0) > 0 ? "text-destructive" : "text-green-600"}`}>
                Bs {Number(balance.data?.bss ?? 0).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Facturas */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Facturas — {unit?.code}
            </h3>
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2"># Factura</th>
                    <th className="px-3 py-2">Período</th>
                    <th className="px-3 py-2 text-right">Total USD</th>
                    <th className="px-3 py-2 text-right">Total Bs</th>
                    <th className="px-3 py-2 text-right">Pagado USD</th>
                    <th className="px-3 py-2 text-right">Pendiente USD</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.data?.map((inv) => {
                    const pending = Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString());
                    return (
                      <tr key={inv.id} className="border-t">
                        <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
                        <td className="px-3 py-2 text-muted-foreground">{inv.periodMonth}/{inv.periodYear}</td>
                        <td className="px-3 py-2 text-right">${Number(inv.totalUsd.toString()).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{Number(inv.totalBss.toString()).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-green-700">${Number(inv.paidUsd.toString()).toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right ${pending > 0 ? "font-medium text-destructive" : "text-green-600"}`}>
                          ${pending.toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                        </td>
                      </tr>
                    );
                  })}
                  {invoices.data?.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                        Sin facturas para esta unidad
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagos */}
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
                    <tr key={p.id} className={`border-t ${p.voidedAt ? "text-muted-foreground line-through" : ""}`}>
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
                  {payments.data?.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        Sin pagos registrados
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
      {status}
    </span>
  );
}
