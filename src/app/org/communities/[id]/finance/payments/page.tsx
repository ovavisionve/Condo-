"use client";

import { useParams } from "next/navigation";
import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/SearchableSelect";

const MONTHS = [
  "Ene","Feb","Mar","Abr","May","Jun",
  "Jul","Ago","Sep","Oct","Nov","Dic",
];

const METHODS = [
  "CASH_BSS","CASH_USD","TRANSFER_BSS","TRANSFER_USD",
  "ZELLE","PAGO_MOVIL","CRYPTO","CHECK","OTHER",
] as const;

const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD",
  TRANSFER_BSS: "Transfer. Bs", TRANSFER_USD: "Transfer. USD",
  ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil",
  CRYPTO: "Cripto", CHECK: "Cheque", OTHER: "Otro",
};

function periodLabel(year: number, month: number) {
  return `${MONTHS[month - 1] ?? "?"} ${year}`;
}

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

const METHODS_PAY = [
  "CASH_BSS","CASH_USD","TRANSFER_BSS","TRANSFER_USD",
  "ZELLE","PAGO_MOVIL","CRYPTO","CHECK","OTHER",
] as const;

function guessMethodFromBanco(banco: string): string {
  const b = banco.toLowerCase();
  if (b.includes("zelle")) return "ZELLE";
  if (b.includes("pago m")) return "PAGO_MOVIL";
  if (b.includes("usd") || b.includes("dollar")) return "TRANSFER_USD";
  if (b.includes("bs") || b.includes("bolivar")) return "TRANSFER_BSS";
  if (b.includes("efectivo")) return "CASH_USD";
  return "TRANSFER_USD";
}

// ─── Sección "Por aprobar" ────────────────────────────────────────────────────
function PorAprobarSection({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const reportsQ = trpc.notifications.listPaymentReports.useQuery({ organizationId, communityId });
  const approvePayment = trpc.finance.payments.approve.useMutation();
  const utils = trpc.useUtils();

  type Report = {
    id: string; unitCode: string; unitId: string; personName: string; banco: string;
    referencia: string; monto: number; moneda: string; fechaPago: string;
    tipoPago: string; notas: string | null; notifiedAt: Date; communityId: string;
  };

  const reports = (reportsQ.data ?? []) as Report[];
  const [confirmRep, setConfirmRep] = useState<Report | null>(null);
  const [confirmMethod, setConfirmMethod] = useState("TRANSFER_BSS");
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  // Campos editables antes de aprobar (pedido cliente: "antes de aprobar, poder editar
  // cualquier dato, tipo la referencia, el monto, el banco, etc.")
  const [editAmount, setEditAmount] = useState<string>("");
  const [editCurrency, setEditCurrency] = useState<"USD" | "VES">("VES");
  const [editReference, setEditReference] = useState<string>("");
  const [editBanco, setEditBanco] = useState<string>("");
  const [editPaidAt, setEditPaidAt] = useState<string>("");

  const pending = reports.filter(r => !registered.has(r.id));
  if (pending.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-200">
        <span className="text-amber-700 font-semibold text-sm">🔔 Pagos reportados por residentes — Por aprobar</span>
        <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{pending.length}</span>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-amber-100/50 text-left text-xs">
              <th className="px-3 py-2">Notificado</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Residente</th>
              <th className="px-3 py-2">Banco / Ref.</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2">Fecha pago</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((r, i) => (
              <tr key={r.id} className={`border-t border-amber-100 ${i % 2 === 0 ? "" : "bg-amber-50/50"}`}>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(r.notifiedAt).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="px-3 py-2 font-semibold">{r.unitCode}</td>
                <td className="px-3 py-2 text-sm">{r.personName}</td>
                <td className="px-3 py-2 text-xs">
                  <div>{r.banco}</div>
                  <div className="font-mono text-muted-foreground">{r.referencia}</div>
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {r.moneda === "USD" ? "$" : "Bs."}{r.monto.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(r.fechaPago).toLocaleDateString("es-VE")}
                </td>
                <td className="px-3 py-2">
                  <button
                    className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 whitespace-nowrap"
                    onClick={() => {
                      setConfirmRep(r);
                      setConfirmMethod(guessMethodFromBanco(r.banco));
                      setConfirmErr(null);
                      // Pre-cargar campos editables con lo que reportó el residente
                      setEditAmount(r.monto.toString());
                      setEditCurrency((r.moneda as "USD" | "VES") || "VES");
                      setEditReference(r.referencia);
                      setEditBanco(r.banco);
                      setEditPaidAt(new Date(r.fechaPago).toISOString().slice(0, 10));
                    }}
                  >
                    ✅ Aprobar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-xs text-amber-700 border-t border-amber-200">
        Verifica en el banco que el depósito exista antes de aprobar. El saldo del residente se actualizará al instante.
      </p>

      {/* Dialog confirmación — TODOS los campos son editables antes de aprobar */}
      {confirmRep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">✅ Aprobar pago reportado</h3>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
              <strong>Unidad:</strong> {confirmRep.unitCode} — {confirmRep.personName}<br />
              <strong>Reportado por residente.</strong> Verifica y corrige cualquier dato antes de aprobar.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Monto *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Moneda</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value as "USD" | "VES")}
                >
                  <option value="VES">Bs — Bolívares</option>
                  <option value="USD">USD — Dólares</option>
                </select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Referencia (solo números)</Label>
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                value={editReference}
                onChange={(e) => setEditReference(e.target.value.replace(/\D/g, ""))}
              />
            </div>

            <div>
              <Label className="text-xs">Banco / Origen</Label>
              <Input
                value={editBanco}
                onChange={(e) => setEditBanco(e.target.value)}
                placeholder="Ej: Banesco, Mercantil, Zelle..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Fecha del pago</Label>
                <Input
                  type="date"
                  value={editPaidAt}
                  onChange={(e) => setEditPaidAt(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Método de pago</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={confirmMethod}
                  onChange={(e) => setConfirmMethod(e.target.value)}
                >
                  {METHODS_PAY.map(m => (
                    <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                  ))}
                </select>
              </div>
            </div>

            {confirmRep.tipoPago === "ANTICIPO" && (
              <p className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-800">
                💰 El residente eligió ANTICIPO — pero si tiene deuda, se aplicará FIFO a la más antigua.
              </p>
            )}

            {confirmErr && <p className="text-sm text-destructive">{confirmErr}</p>}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmRep(null)}>Cancelar</Button>
              <Button
                disabled={approvePayment.isPending}
                className="bg-green-600 hover:bg-green-700"
                onClick={async () => {
                  setConfirmErr(null);
                  const amount = Number(editAmount);
                  if (!amount || amount <= 0) {
                    setConfirmErr("El monto debe ser mayor a 0");
                    return;
                  }
                  if (!editPaidAt) {
                    setConfirmErr("La fecha del pago es obligatoria");
                    return;
                  }
                  try {
                    await approvePayment.mutateAsync({
                      organizationId,
                      communityId,
                      unitId: confirmRep.unitId,
                      notificationId: confirmRep.id,
                      amount,
                      currencyPrimary: editCurrency,
                      method: confirmMethod as typeof METHODS_PAY[number],
                      reference: editReference,
                      paidAt: new Date(editPaidAt + "T12:00:00"),
                      notes: `Pago notificado por residente · Banco: ${editBanco}${confirmRep.notas ? ` · ${confirmRep.notas}` : ""}`,
                    });
                    setRegistered(prev => new Set([...prev, confirmRep.id]));
                    setConfirmRep(null);
                    void utils.finance.payments.list.invalidate();
                    void utils.notifications.listPaymentReports.invalidate();
                  } catch (err) {
                    setConfirmErr(err instanceof Error ? err.message : "Error");
                  }
                }}
              >
                {approvePayment.isPending ? "Registrando..." : "Aprobar y registrar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const list = trpc.finance.payments.list.useQuery({ organizationId, communityId });
  const utils = trpc.useUtils();
  const [showNew, setShowNew] = useState(false);

  const totalUsd = list.data?.reduce((s, p) => s + (p.voidedAt ? 0 : Number(p.amountUsd.toString())), 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Pagos por aprobar — arriba del todo */}
      <PorAprobarSection organizationId={organizationId} communityId={communityId} />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pagos recibidos</h2>
          <p className="text-sm text-muted-foreground">Total recibido: ${totalUsd.toFixed(2)}</p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ Registrar pago</Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Método</th>
              <th className="px-3 py-2">Referencia</th>
              <th className="px-3 py-2 text-right">USD</th>
              <th className="px-3 py-2 text-right">Bs</th>
              <th className="px-3 py-2">Aplicado a</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((p) => (
              <PaymentRow key={p.id} payment={p} organizationId={organizationId} />
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Sin pagos registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewPaymentDialog
          organizationId={organizationId}
          communityId={communityId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void list.refetch();
            void utils.finance.invoices.list.invalidate();
            void utils.finance.aging.invalidate();
          }}
        />
      )}
    </div>
  );
}

function PaymentRow({
  payment,
  organizationId,
}: {
  payment: {
    id: string;
    paidAt: Date | string;
    amountUsd: { toString(): string };
    amountBss: { toString(): string };
    method: string;
    reference?: string | null;
    voidedAt?: Date | string | null;
    unit: { code: string };
    allocations: { invoice: { invoiceNumber: string } }[];
  };
  organizationId: string;
}) {
  const getVoucher = trpc.finance.payments.getVoucherPdf.useMutation();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await getVoucher.mutateAsync({ organizationId, paymentId: payment.id });
      downloadBase64Pdf(res.base64, `bauche-${payment.id.slice(-8)}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <tr className={`border-t ${payment.voidedAt ? "text-muted-foreground line-through" : ""}`}>
      <td className="px-3 py-2">{new Date(payment.paidAt).toLocaleDateString("es-VE")}</td>
      <td className="px-3 py-2">{payment.unit.code}</td>
      <td className="px-3 py-2 text-xs">{METHOD_LABEL[payment.method] ?? payment.method}</td>
      <td className="px-3 py-2 text-muted-foreground">{payment.reference ?? "—"}</td>
      <td className="px-3 py-2 text-right">${Number(payment.amountUsd.toString()).toFixed(2)}</td>
      <td className="px-3 py-2 text-right">
        {Number(payment.amountBss.toString()).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td className="px-3 py-2 text-xs">
        {payment.allocations.length > 0
          ? payment.allocations.map((a) => a.invoice.invoiceNumber).join(", ")
          : <span className="text-amber-700">anticipo</span>}
      </td>
      <td className="px-3 py-2">
        {!payment.voidedAt && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap"
          >
            {downloading ? "..." : "📄 Bauche"}
          </button>
        )}
      </td>
    </tr>
  );
}

function NewPaymentDialog({
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

  const [unitId, setUnitId] = useState<string>("");
  const invoices = trpc.finance.invoices.list.useQuery(
    { organizationId, communityId, unitId, status: undefined },
    { enabled: Boolean(unitId) },
  );
  const record = trpc.finance.payments.record.useMutation();

  const [form, setForm] = useState({
    amount: "",
    // Por defecto Bs (el cliente factura en Bs como moneda primaria del país).
    currencyPrimary: "VES" as "USD" | "VES",
    method: "TRANSFER_BSS" as (typeof METHODS)[number],
    reference: "",
    paidAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  // #BUG TASA — Tasa de la fecha del pago seleccionada (no la de hoy).
  const exchangeRate = trpc.finance.exchange.byDate.useQuery(
    { organizationId, date: new Date(form.paidAt) },
    { enabled: Boolean(form.paidAt) },
  );
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Feature 7: también registrar como ingreso con la misma referencia
  const [alsoCreateIncome, setAlsoCreateIncome]             = useState(false);
  const [incomeDescription, setIncomeDescription]           = useState("");

  // Facturas pendientes ordenadas de más antigua a más reciente
  const pendingInvoices = useMemo(() => {
    return (
      invoices.data
        ?.filter((i) => i.status !== "PAID" && i.status !== "VOIDED")
        .sort((a, b) =>
          a.periodYear !== b.periodYear
            ? a.periodYear - b.periodYear
            : a.periodMonth - b.periodMonth,
        ) ?? []
    );
  }, [invoices.data]);

  // Deuda total de la unidad seleccionada
  const totalDebt = useMemo(
    () =>
      pendingInvoices.reduce(
        (s, inv) => s + (Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString())),
        0,
      ),
    [pendingInvoices],
  );

  const sumAllocs = Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0);

  // Equivalente en Bs del monto ingresado
  const rate = exchangeRate.data ? Number(exchangeRate.data.vesPerUsd) : null;
  const amountNum = Number(form.amount) || 0;
  const bsEquiv = useMemo(() => {
    if (!rate || !amountNum) return null;
    if (form.currencyPrimary === "USD") return amountNum * rate;
    return amountNum; // ya es Bs
  }, [rate, amountNum, form.currencyPrimary]);
  const usdEquiv = useMemo(() => {
    if (!rate || !amountNum) return null;
    if (form.currencyPrimary === "VES") return amountNum / rate;
    return amountNum;
  }, [rate, amountNum, form.currencyPrimary]);

  // Auto-distribuir: aplica el monto a las facturas pendientes desde la más antigua.
  // CRÍTICO: las allocations se envían al backend en la MONEDA PRIMARIA del pago
  // (no siempre en USD), porque el server las interpreta usando `currencyPrimary`.
  // Si se mandaban en USD pero la moneda primaria era VES, el server las trataba como Bs
  // y solo aplicaba centavos → el resto quedaba como anticipo. Bug reportado por cliente.
  const handleAutoDistribute = () => {
    const rawAmount = Number(form.amount) || 0;
    if (rawAmount <= 0 || pendingInvoices.length === 0) {
      setAllocs({});
      return;
    }
    const isVes = form.currencyPrimary === "VES";
    if (isVes && (!rate || rate <= 0)) {
      // Sin tasa no podemos convertir el saldo de las facturas a Bs. Limpiar.
      setAllocs({});
      return;
    }
    let remaining = rawAmount; // en la moneda primaria del pago
    const newAllocs: Record<string, string> = {};
    for (const inv of pendingInvoices) {
      if (remaining <= 0.005) break;
      // Saldo pendiente en la moneda primaria del pago
      const pendingUsd = Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString());
      const pending = isVes ? pendingUsd * (rate as number) : pendingUsd;
      if (pending <= 0) continue;
      const apply = Math.min(remaining, pending);
      if (apply > 0) {
        newAllocs[inv.id] = apply.toFixed(2);
        remaining -= apply;
      }
    }
    setAllocs(newAllocs);
  };

  // Auto-distribuir SIEMPRE que cambie el monto, la moneda, la unidad o la tasa.
  // El cliente pidió: "por defecto a la más antigua SIEMPRE, que no sea opcional".
  useEffect(() => {
    handleAutoDistribute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.amount, form.currencyPrimary, unitId, rate, pendingInvoices.length]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const allocations = Object.entries(allocs)
      .filter(([, v]) => v && Number(v) > 0)
      .map(([invoiceId, v]) => ({ invoiceId, amount: Number(v) }));
    try {
      await record.mutateAsync({
        organizationId,
        communityId,
        unitId,
        amount: Number(form.amount),
        currencyPrimary: form.currencyPrimary,
        method: form.method,
        reference: form.reference || undefined,
        paidAt: new Date(form.paidAt),
        notes: form.notes || undefined,
        allocations: allocations.length > 0 ? allocations : undefined,
        alsoCreateIncome,
        incomeDescription: alsoCreateIncome && incomeDescription ? incomeDescription : undefined,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  // Propietario de la unidad seleccionada
  const selectedUnit = units.data?.find((u) => u.id === unitId);
  const ownerName = selectedUnit?.ownerships?.[0]?.person
    ? `${selectedUnit.ownerships[0].person.firstName} ${selectedUnit.ownerships[0].person.lastName}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Registrar pago</h3>
        <form onSubmit={onSubmit} className="space-y-4">

          {/* ── Tasa de cambio según fecha del pago ── */}
          {rate ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              💱 Tasa BCV de la fecha del pago:{" "}
              <span className="font-semibold">
                Bs {rate.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / USD
              </span>
              {exchangeRate.data?.date && (
                <span className="ml-2 text-blue-600 text-xs">
                  (cotización del {new Date(exchangeRate.data.date).toLocaleDateString("es-VE")})
                </span>
              )}
            </div>
          ) : exchangeRate.error ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⚠️ No hay tasa BCV disponible para esta fecha del pago. Ve a <strong>Finanzas → General</strong> y registra una tasa manual, o presiona "Actualizar BCV", antes de continuar.
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Cargando tasa de la fecha…
            </div>
          )}

          {/* ── Unidad ── */}
          <div>
            <Label>Unidad</Label>
            <SearchableSelect
              value={unitId}
              onChange={(v) => { setUnitId(v); setAllocs({}); }}
              placeholder="Buscar unidad (ej. 101A, B-16)..."
              options={(units.data ?? []).map((u) => {
                const owner = u.ownerships?.[0]?.person;
                return {
                  value: u.id,
                  label: owner ? `${u.code} — ${owner.firstName} ${owner.lastName}` : u.code,
                };
              })}
            />
            {ownerName && (
              <p className="mt-1 text-xs text-muted-foreground">👤 Propietario: {ownerName}</p>
            )}
          </div>

          {/* ── Deuda total ── */}
          {unitId && !invoices.isLoading && (
            <div className={`rounded-md border px-3 py-2 text-sm font-medium ${
              totalDebt > 0
                ? "border-orange-200 bg-orange-50 text-orange-800"
                : "border-green-200 bg-green-50 text-green-800"
            }`}>
              {totalDebt > 0 ? (
                <>
                  ⚠️ Deuda total: <span className="font-bold">${totalDebt.toFixed(2)}</span>
                  {rate && (
                    <span className="ml-1 text-orange-600 font-normal">
                      (≈ Bs {(totalDebt * rate).toLocaleString("es-VE", { maximumFractionDigits: 0 })})
                    </span>
                  )}
                  <span className="ml-2 font-normal text-orange-600">
                    · {pendingInvoices.length} {pendingInvoices.length === 1 ? "recibo" : "recibos"} pendiente{pendingInvoices.length !== 1 ? "s" : ""}
                  </span>
                </>
              ) : (
                <>✅ Sin deuda pendiente</>
              )}
            </div>
          )}

          {/* ── Monto + Moneda ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto recibido</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                required
              />
              {/* Equivalencia en la otra moneda */}
              {form.amount && rate && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.currencyPrimary === "USD"
                    ? `≈ Bs ${(amountNum * rate).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : `≈ $${(amountNum / rate).toFixed(2)}`}
                </p>
              )}
            </div>
            <div>
              <Label>Moneda</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.currencyPrimary}
                onChange={(e) => setForm({ ...form, currencyPrimary: e.target.value as "USD" | "VES" })}
              >
                <option value="USD">USD</option>
                <option value="VES">VES (Bs)</option>
              </select>
            </div>
          </div>

          {/* ── Método + Referencia ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Método de pago</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value as (typeof METHODS)[number] })}
              >
                {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>)}
              </select>
            </div>
            <div>
              <Label>
                Referencia
                {["TRANSFER_BSS", "TRANSFER_USD", "ZELLE", "PAGO_MOVIL", "CHECK"].includes(form.method) ? (
                  <span className="text-destructive"> *</span>
                ) : (
                  <span className="text-muted-foreground"> (opcional)</span>
                )}
              </Label>
              <Input
                value={form.reference}
                // Solo dígitos: el cliente pidió "En referencia o comprobante solo número"
                onChange={(e) => setForm({ ...form, reference: e.target.value.replace(/\D/g, "") })}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ej: 00123456789 (solo números)"
                required={["TRANSFER_BSS", "TRANSFER_USD", "ZELLE", "PAGO_MOVIL", "CHECK"].includes(form.method)}
              />
            </div>
          </div>

          {/* ── Fecha ── */}
          <div>
            <Label>Fecha del pago</Label>
            <Input
              type="date"
              value={form.paidAt}
              onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
              required
            />
          </div>

          {/* ── Aplicar a facturas ── */}
          {pendingInvoices.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Aplicar a Recibos de Condominio pendientes</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAutoDistribute}
                  disabled={!form.amount || Number(form.amount) <= 0}
                  title="Distribuye el monto desde la factura más antigua"
                >
                  ⚡ Auto-distribuir (más antigua primero)
                </Button>
              </div>
              <div className="rounded-md border">
                {(() => {
                  const isVes = form.currencyPrimary === "VES";
                  const symbol = isVes ? "Bs " : "$";
                  return (
                <>
                {/* Cabecera */}
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <span>Período · Aplicado a</span>
                  <span className="text-right w-24">Pendiente</span>
                  <span className="text-right w-20">{isVes ? "Equivalente USD" : "Equivalente Bs"}</span>
                  <span className="text-right w-24">Aplicar ({symbol.trim()})</span>
                </div>
                <div className="divide-y">
                  {pendingInvoices.map((inv) => {
                    const pendingUsd = Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString());
                    // Saldo pendiente en la moneda primaria del pago
                    const pending = isVes && rate ? pendingUsd * rate : pendingUsd;
                    const applied = Number(allocs[inv.id] ?? 0) || 0;
                    const remaining = pending - applied;
                    return (
                      <div key={inv.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2">
                        <div>
                          <span className="font-medium text-sm">
                            {periodLabel(inv.periodYear, inv.periodMonth)}
                          </span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {inv.invoiceNumber}
                          </span>
                          {remaining > 0.005 && applied > 0 && (
                            <span className="ml-1 text-xs text-amber-600">
                              (queda {symbol}{remaining.toFixed(2)})
                            </span>
                          )}
                          {remaining <= 0.005 && applied > 0 && (
                            <span className="ml-1 text-xs text-green-600">✓ cubierta</span>
                          )}
                        </div>
                        <span className="w-24 text-right text-sm font-medium text-orange-700">
                          {symbol}{pending.toFixed(2)}
                        </span>
                        <span className="w-20 text-right text-xs text-muted-foreground">
                          {isVes
                            ? `$${pendingUsd.toFixed(2)}`
                            : rate
                              ? `Bs ${(pendingUsd * rate).toLocaleString("es-VE", { maximumFractionDigits: 0 })}`
                              : "—"}
                        </span>
                        <div className="flex w-24 items-center gap-1">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max={pending}
                            className="h-8 w-16 text-right text-xs px-2"
                            placeholder="0.00"
                            value={allocs[inv.id] ?? ""}
                            onChange={(e) => setAllocs({ ...allocs, [inv.id]: e.target.value })}
                          />
                          <button
                            type="button"
                            className="text-[10px] text-blue-600 hover:underline whitespace-nowrap"
                            onClick={() => setAllocs({ ...allocs, [inv.id]: pending.toFixed(2) })}
                            title="Aplicar monto completo"
                          >
                            Todo
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Resumen de asignación — ahora sumAllocs ya está en la moneda primaria */}
                {(() => {
                  // sumAllocs YA está en la moneda primaria del pago (no en USD).
                  const sumAllocsInPrimary = sumAllocs;
                  const sumAllocsInUsd = isVes && rate ? sumAllocs / rate : sumAllocs;
                  const overAssigned = sumAllocsInPrimary > amountNum + 0.005;
                  const remaining = amountNum - sumAllocsInPrimary;
                  return (
                    <div className="border-t bg-muted/30 px-3 py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Suma asignada:{" "}
                          <span className={`font-medium ${
                            overAssigned
                              ? "text-destructive"
                              : sumAllocsInPrimary > 0
                              ? "text-green-700"
                              : "text-muted-foreground"
                          }`}>
                            {symbol}{sumAllocsInPrimary.toFixed(2)}
                          </span>
                          {isVes && sumAllocs > 0 && (
                            <span className="text-muted-foreground"> (= ${sumAllocsInUsd.toFixed(2)})</span>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          Monto total:{" "}
                          <span className="font-medium">
                            {symbol}{form.amount || "0.00"}
                          </span>
                          {usdEquiv !== null && isVes && (
                            <span className="text-muted-foreground"> (≈ ${usdEquiv.toFixed(2)})</span>
                          )}
                        </span>
                      </div>
                      {overAssigned && (
                        <p className="mt-1 text-xs text-destructive">
                          ⚠️ La suma asignada supera el monto ingresado.
                        </p>
                      )}
                      {amountNum > 0 && remaining > 0.005 && (
                        <p className="mt-1 text-xs text-amber-700">
                          ℹ️ Saldo a favor: {symbol}{remaining.toFixed(2)} se registrarán como anticipo.
                        </p>
                      )}
                      {/* Preview "Aplicado a:" — pedido del cliente */}
                      {sumAllocsInPrimary > 0 && (
                        <p className="mt-1 text-xs text-green-700">
                          ✅ Aplicado a:{" "}
                          {pendingInvoices
                            .filter((inv) => Number(allocs[inv.id] ?? 0) > 0)
                            .map((inv) => `${periodLabel(inv.periodYear, inv.periodMonth)}`)
                            .join(" + ")}
                        </p>
                      )}
                    </div>
                  );
                })()}
                </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── Feature 7: También crear ingreso con misma referencia ── */}
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={alsoCreateIncome}
                onChange={(e) => setAlsoCreateIncome(e.target.checked)}
              />
              <span className="text-sm">
                <span className="font-medium">También registrar como ingreso</span>
                <br />
                <span className="text-muted-foreground text-xs">
                  Crea una entrada de ingreso adicional con la misma referencia bancaria.
                  Útil cuando el mismo depósito corresponde a un pago de cuota Y a un ingreso extra (ej: alquiler de salón).
                </span>
              </span>
            </label>
            {alsoCreateIncome && (
              <div className="pl-6">
                <Label>Descripción del ingreso</Label>
                <Input
                  value={incomeDescription}
                  onChange={(e) => setIncomeDescription(e.target.value)}
                  placeholder={`Ingreso vinculado a ref ${form.reference || "—"}`}
                />
              </div>
            )}
          </div>

          {/* ── Notas ── */}
          <div>
            <Label>Notas (opcional)</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Observaciones..."
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? "Guardando..." : "Registrar pago"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
