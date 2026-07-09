"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function FinanceDashboard() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const rate = trpc.finance.exchange.current.useQuery({ organizationId });
  const aging = trpc.finance.aging.useQuery({ organizationId, communityId });
  const recent = trpc.finance.exchange.recent.useQuery({ organizationId, limit: 10 });
  const community = trpc.org.communities.byId.useQuery({ organizationId, id: communityId });
  const setManual = trpc.finance.exchange.setManual.useMutation();
  const refreshBcv = trpc.finance.exchange.refreshBcv.useMutation();
  const setFee = trpc.org.communities.setMonthlyFee.useMutation();
  const updateCommunity = trpc.org.communities.update.useMutation();
  const utils = trpc.useUtils();
  const [manualVal, setManualVal] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [bcvErr, setBcvErr] = useState<string | null>(null);
  const [bcvOk, setBcvOk] = useState<string | null>(null);
  const [feeVal, setFeeVal] = useState("");
  const [feeErr, setFeeErr] = useState<string | null>(null);
  const [feeOk, setFeeOk] = useState(false);
  const [dueDaysVal, setDueDaysVal] = useState("");
  const [dueDaysErr, setDueDaysErr] = useState<string | null>(null);
  const [dueDaysOk, setDueDaysOk] = useState(false);

  // Cierre de mes
  const today = new Date();
  const [closeYear, setCloseYear]   = useState(today.getFullYear());
  const [closeMonth, setCloseMonth] = useState(today.getMonth() + 1);
  const [closeNotes, setCloseNotes] = useState("");
  const [showCloseModal, setShowCloseModal] = useState(false);
  const monthCloseList = trpc.finance.monthClose.list.useQuery({ organizationId, communityId });
  const monthCloseStatus = trpc.finance.monthClose.isOpen.useQuery({ organizationId, communityId, year: closeYear, month: closeMonth });
  const closeMonthMut   = trpc.finance.monthClose.close.useMutation({
    onSuccess: () => {
      setShowCloseModal(false);
      setCloseNotes("");
      void monthCloseList.refetch();
      void monthCloseStatus.refetch();
    },
  });

  const onSetFee = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeeErr(null);
    setFeeOk(false);
    try {
      await setFee.mutateAsync({ organizationId, communityId, monthlyFeeUsd: Number(feeVal) });
      setFeeOk(true);
      // Optimistic update: actualizar el cache localmente sin esperar el refetch
      const { Decimal } = await import("decimal.js");
      utils.org.communities.byId.setData(
        { organizationId, id: communityId },
        (old) => old ? { ...old, monthlyFeeUsd: new Decimal(feeVal), monthlyFeeSetAt: new Date() } : old,
      );
      setFeeVal("");
      void utils.org.communities.byId.invalidate();
    } catch (e: unknown) {
      setFeeErr(e instanceof Error ? e.message : "Error");
    }
  };

  const onRefreshBcv = async () => {
    setBcvErr(null);
    setBcvOk(null);
    try {
      const r = await refreshBcv.mutateAsync({ organizationId });
      setBcvOk(`✓ Tasa actualizada: ${Number(r.vesPerUsd).toFixed(4)} VES/USD`);
      void utils.finance.exchange.current.invalidate();
      void utils.finance.exchange.recent.invalidate();
    } catch (e: unknown) {
      setBcvErr(e instanceof Error ? e.message : "Error al conectar con el BCV");
    }
  };

  const onSetManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await setManual.mutateAsync({
        organizationId,
        vesPerUsd: Number(manualVal),
        date: manualDate ? new Date(`${manualDate}T12:00:00`) : undefined,
      });
      setManualVal("");
      setManualDate("");
      void utils.finance.exchange.current.invalidate();
      void utils.finance.exchange.recent.invalidate();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  };

  const currentFee = community.data?.monthlyFeeUsd ? Number(community.data.monthlyFeeUsd).toFixed(2) : null;
  const currentDueDays = (community.data as { dueDaysAfterIssue?: number } | undefined)?.dueDaysAfterIssue ?? 5;

  const onSetDueDays = async (e: React.FormEvent) => {
    e.preventDefault();
    setDueDaysErr(null);
    setDueDaysOk(false);
    try {
      await updateCommunity.mutateAsync({
        organizationId,
        id: communityId,
        dueDaysAfterIssue: Number(dueDaysVal),
      });
      setDueDaysOk(true);
      setDueDaysVal("");
      void utils.org.communities.byId.invalidate();
    } catch (e: unknown) {
      setDueDaysErr(e instanceof Error ? e.message : "Error");
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Cierre de Mes ──────────────────────────────────────── */}
      <MonthCloseCard organizationId={organizationId} communityId={communityId} />

      {/* ── Cuota mensual ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cuota mensual del condominio</CardTitle>
          <CardDescription>
            {currentFee
              ? `Cuota actual: $${currentFee} USD por unidad · Vigente desde ${community.data?.monthlyFeeSetAt ? new Date(community.data.monthlyFeeSetAt).toLocaleDateString("es-VE") : "–"}`
              : "Sin cuota mensual configurada. Las facturas se generarán solo en base a gastos."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSetFee} className="flex items-end gap-2 max-w-sm">
            <div className="flex-1">
              <Label>Nueva cuota (USD por unidad)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={currentFee ?? "Ej: 15.00"}
                value={feeVal}
                onChange={(e) => { setFeeVal(e.target.value); setFeeOk(false); }}
                required
              />
            </div>
            <Button type="submit" disabled={setFee.isPending}>
              {setFee.isPending ? "..." : "Actualizar"}
            </Button>
          </form>
          {feeErr && <p className="mt-2 text-sm text-destructive">{feeErr}</p>}
          {feeOk && <p className="mt-2 text-sm text-green-600">✓ Cuota de condominio actualizada. Se aplicará en la próxima emisión de Recibos de Condominio.</p>}
        </CardContent>
      </Card>

      {/* ── Días de vencimiento ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Días de vencimiento de Recibos de Condominio</CardTitle>
          <CardDescription>
            Actualmente: <strong>{currentDueDays} días</strong> después de la fecha de emisión.
            {" "}Los recibos emitidos hoy vencerían el día {new Date(new Date().setDate(new Date().getDate() + currentDueDays)).toLocaleDateString("es-VE")}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSetDueDays} className="flex items-end gap-2 max-w-sm">
            <div className="flex-1">
              <Label>Nuevo valor (días)</Label>
              <Input
                type="number"
                min="1"
                max="365"
                placeholder={String(currentDueDays)}
                value={dueDaysVal}
                onChange={(e) => { setDueDaysVal(e.target.value); setDueDaysOk(false); }}
                required
              />
            </div>
            <Button type="submit" disabled={updateCommunity.isPending}>
              {updateCommunity.isPending ? "..." : "Actualizar"}
            </Button>
          </form>
          {dueDaysErr && <p className="mt-2 text-sm text-destructive">{dueDaysErr}</p>}
          {dueDaysOk && <p className="mt-2 text-sm text-green-600">✓ Actualizado. Se aplicará en la próxima emisión de Recibos de Condominio.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Tasa actual BCV</CardDescription>
            <CardTitle className="text-2xl">
              {rate.data ? `${Number(rate.data.vesPerUsd).toFixed(4)} VES/USD` : "..."}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {rate.data && (
                <>{rate.data.source} · {new Date(rate.data.date).toLocaleDateString("es-VE")}</>
              )}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={onRefreshBcv}
              disabled={refreshBcv.isPending}
            >
              {refreshBcv.isPending ? "Consultando BCV..." : "🔄 Actualizar desde BCV"}
            </Button>
            {bcvOk && <p className="text-xs text-green-600 font-medium">{bcvOk}</p>}
            {bcvErr && (
              <div className="text-xs text-destructive space-y-1">
                <p>{bcvErr}</p>
                <p className="text-muted-foreground">Ingresa la tasa manualmente en el formulario de la derecha.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Corregir tasa</CardTitle>
            <CardDescription>
              Si la tasa automática está incorrecta, ingresa aquí la tasa oficial del BCV. Por defecto corrige la de hoy — si necesitas corregir un día anterior ya guardado, indícalo abajo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSetManual} className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-[140px]">
                <Label>VES por 1 USD</Label>
                <Input
                  type="number"
                  step="0.0001"
                  min="1"
                  placeholder="ej. 52.30"
                  value={manualVal}
                  onChange={(e) => setManualVal(e.target.value)}
                  required
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label>Fecha (opcional — por defecto hoy)</Label>
                <Input
                  type="date"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <Button type="submit" disabled={setManual.isPending}>
                {setManual.isPending ? "Guardando..." : "✓ Aplicar tasa"}
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Fuente: <a href="https://www.bcv.org.ve" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">bcv.org.ve</a> → Tipo de cambio oficial
            </p>
            {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
            {setManual.isSuccess && (
              <p className="mt-2 text-sm text-green-600 font-medium">✓ Tasa corregida.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Canales de pago ──────────────────────────────────────── */}
      <PaymentChannelsCard organizationId={organizationId} communityId={communityId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cartera por antigüedad</CardTitle>
          <CardDescription>Saldo pendiente agrupado por días vencidos.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5">
            <AgingCell label="Por vencer" data={aging.data?.current} />
            <AgingCell label="0-30 días" data={aging.data?.d_0_30} />
            <AgingCell label="31-60" data={aging.data?.d_31_60} />
            <AgingCell label="61-90" data={aging.data?.d_61_90} />
            <AgingCell label="90+" data={aging.data?.d_90_plus} alarm />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico reciente de tasas</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-1">Fecha</th>
                <th className="px-2 py-1">Fuente</th>
                <th className="px-2 py-1">VES/USD</th>
              </tr>
            </thead>
            <tbody>
              {recent.data?.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1">{new Date(r.date).toLocaleDateString("es-VE")}</td>
                  <td className="px-2 py-1">{r.source}</td>
                  <td className="px-2 py-1">{Number(r.vesPerUsd).toFixed(4)}</td>
                </tr>
              ))}
              {recent.data?.length === 0 && (
                <tr><td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">Sin tasas registradas</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Cierre de mes ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">🔒 Cierre de mes</CardTitle>
              <CardDescription>
                Congela el período contable. Una vez cerrado queda registrado con un snapshot financiero.
              </CardDescription>
            </div>
            <button
              onClick={() => setShowCloseModal(true)}
              className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium hover:bg-slate-100 transition-colors"
            >
              Cerrar mes
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {monthCloseList.data && monthCloseList.data.length > 0 ? (
            <div className="overflow-hidden rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Período</th>
                    <th className="px-3 py-2 text-right">Gastos</th>
                    <th className="px-3 py-2 text-right">Facturado</th>
                    <th className="px-3 py-2 text-right">Cobrado</th>
                    <th className="px-3 py-2 text-right">% Cobro</th>
                    <th className="px-3 py-2 text-left">Cerrado por</th>
                    <th className="px-3 py-2 text-left">Fecha cierre</th>
                  </tr>
                </thead>
                <tbody>
                  {monthCloseList.data.map((c: { id: string; month: number; year: number; summary: unknown; closedBy: { name: string | null; email: string }; closedAt: Date | string }) => {
                    const s = c.summary as Record<string, string | number>;
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2 font-medium">{["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][c.month-1]} {c.year}</td>
                        <td className="px-3 py-2 text-right">${s.totalExpensesUsd}</td>
                        <td className="px-3 py-2 text-right">${s.totalInvoicedUsd}</td>
                        <td className="px-3 py-2 text-right text-green-700">${s.totalCollectedUsd}</td>
                        <td className="px-3 py-2 text-right">{s.collectionRate}%</td>
                        <td className="px-3 py-2 text-muted-foreground">{c.closedBy.name ?? c.closedBy.email}</td>
                        <td className="px-3 py-2 text-muted-foreground">{new Date(c.closedAt).toLocaleDateString("es-VE")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin meses cerrados aún.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Índice INPC ───────────────────────────────────────────── */}
      <InpcSection organizationId={organizationId} />

      {/* Modal de cierre */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Cerrar mes</h2>
            {monthCloseStatus.data?.closed ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                ⚠️ El período seleccionado ya fue cerrado el {monthCloseStatus.data.closedAt ? new Date(monthCloseStatus.data.closedAt).toLocaleDateString("es-VE") : "—"}.
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Año</label>
                <input type="number" value={closeYear} onChange={e => setCloseYear(Number(e.target.value))}
                  className="w-full mt-1 rounded border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Mes</label>
                <select value={closeMonth} onChange={e => setCloseMonth(Number(e.target.value))}
                  className="w-full mt-1 rounded border px-3 py-2 text-sm">
                  {["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"].map((m,i) => (
                    <option key={i} value={i+1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Observaciones (opcional)</label>
              <textarea value={closeNotes} onChange={e => setCloseNotes(e.target.value)} rows={2}
                className="w-full mt-1 rounded border px-3 py-2 text-sm"
                placeholder="Ej: Conciliado con estado de cuenta Banesco 30/04" />
            </div>
            {closeMonthMut.isError && (
              <p className="text-sm text-destructive">{closeMonthMut.error.message}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCloseModal(false)} className="rounded border px-4 py-2 text-sm hover:bg-muted">Cancelar</button>
              <button
                onClick={() => closeMonthMut.mutate({ organizationId, communityId, year: closeYear, month: closeMonth, notes: closeNotes })}
                disabled={closeMonthMut.isPending || monthCloseStatus.data?.closed}
                className="rounded bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                {closeMonthMut.isPending ? "Cerrando..." : "🔒 Confirmar cierre"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tipos de canales ──────────────────────────────────────────────────────────
const CHANNEL_TYPES = [
  { value: "CORRIENTE",  label: "Cuenta Corriente (Bs)",  currency: "VES", needsAccount: true  },
  { value: "AHORRO",     label: "Cuenta de Ahorro (Bs)",  currency: "VES", needsAccount: true  },
  { value: "USD",        label: "Cuenta en Divisas (USD)", currency: "USD", needsAccount: true  },
  { value: "PAGO_MOVIL", label: "Pago Móvil",              currency: "VES", needsAccount: false },
  { value: "ZELLE",      label: "Zelle",                   currency: "USD", needsAccount: false },
  { value: "OTRO",       label: "Otro",                    currency: "USD", needsAccount: true  },
] as const;

function PaymentChannelsCard({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const list    = trpc.finance.bankAccounts.list.useQuery({ organizationId, communityId });
  const create  = trpc.finance.bankAccounts.create.useMutation();
  const update  = trpc.finance.bankAccounts.update.useMutation();
  const utils   = trpc.useUtils();

  const [showForm, setShowForm] = useState(false);
  const [chanType, setChanType] = useState("CORRIENTE");
  const [form, setForm] = useState({ bankName: "", accountNumber: "", accountHolder: "", notes: "" });
  const [err, setErr] = useState<string | null>(null);

  const meta = CHANNEL_TYPES.find((c) => c.value === chanType) ?? CHANNEL_TYPES[0]!;

  const placeholders: Record<string, { account: string; notes: string; bank: string }> = {
    CORRIENTE:  { bank: "Banesco, BDV, Mercantil...", account: "01340000001234567890", notes: "RIF o CI del titular (opcional)" },
    AHORRO:     { bank: "Banesco, BDV, Mercantil...", account: "01340000001234567890", notes: "RIF o CI del titular (opcional)" },
    USD:        { bank: "Bancamiga, Banesco USD...",  account: "Número de cuenta",      notes: "RIF o información adicional" },
    PAGO_MOVIL: { bank: "Banesco, BDV, Bicentenario...", account: "0412-1234567",       notes: "CI del titular (ej: V-12345678)" },
    ZELLE:      { bank: "Zelle",                     account: "correo@email.com",        notes: "Nombre completo del titular" },
    OTRO:       { bank: "Nombre del canal",           account: "Datos de contacto/cuenta", notes: "Instrucciones adicionales" },
  };
  const ph = placeholders[chanType] ?? placeholders.OTRO!;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({
        organizationId,
        communityId,
        bankName:      form.bankName,
        accountType:   chanType,
        accountNumber: form.accountNumber,
        accountHolder: form.accountHolder,
        currency:      meta.currency as "VES" | "USD",
        notes:         form.notes || undefined,
      });
      setForm({ bankName: "", accountNumber: "", accountHolder: "", notes: "" });
      setShowForm(false);
      void list.refetch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    await update.mutateAsync({ organizationId, id, active: !active });
    void list.refetch();
  };

  const typeLabel = (t: string) => CHANNEL_TYPES.find((c) => c.value === t)?.label ?? t;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">💳 Canales de pago</CardTitle>
            <CardDescription>
              Aparecen en todos los Recibos de Condominio PDF bajo "Instrucciones de pago". Agrega todos los métodos que aceptas.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "+ Agregar canal"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Lista de canales */}
        {list.data && list.data.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {list.data.map((acc) => (
              <div key={acc.id} className={`flex items-center justify-between px-4 py-3 ${!acc.active ? "opacity-50" : ""}`}>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{typeLabel(acc.accountType)}</span>
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{acc.currency}</span>
                    {!acc.active && <span className="text-xs text-muted-foreground">(inactivo)</span>}
                  </div>
                  <p className="text-sm">{acc.bankName} — {acc.accountHolder}</p>
                  <p className="text-xs text-muted-foreground">{acc.accountNumber}{acc.notes ? ` · ${acc.notes}` : ""}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void toggleActive(acc.id, acc.active)}
                  title={acc.active ? "Desactivar (no aparece en facturas)" : "Activar"}
                >
                  {acc.active ? "🟢" : "⚪"}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4 rounded-lg border border-dashed">
            Sin canales configurados. Los Recibos de Condominio mostrarán "Contacte a la Junta de Condominio".
          </p>
        )}

        {/* Formulario nuevo canal */}
        {showForm && (
          <form onSubmit={onSubmit} className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium">Nuevo canal de pago</p>

            <div>
              <Label>Tipo de canal</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm mt-1"
                value={chanType}
                onChange={(e) => setChanType(e.target.value)}
              >
                {CHANNEL_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{chanType === "ZELLE" ? "Alias Zelle" : chanType === "PAGO_MOVIL" ? "Banco" : "Banco / Entidad"}</Label>
                <Input
                  placeholder={ph.bank}
                  value={form.bankName}
                  onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>{chanType === "PAGO_MOVIL" ? "Teléfono" : chanType === "ZELLE" ? "Email o teléfono" : "Número de cuenta"}</Label>
                <Input
                  placeholder={ph.account}
                  value={form.accountNumber}
                  onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Titular de la cuenta</Label>
                <Input
                  placeholder="Nombre del propietario de la cuenta"
                  value={form.accountHolder}
                  onChange={(e) => setForm((f) => ({ ...f, accountHolder: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>{chanType === "PAGO_MOVIL" ? "CI del titular" : chanType === "ZELLE" ? "Nombre completo" : "RIF / CI (opcional)"}</Label>
                <Input
                  placeholder={ph.notes}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                {create.isPending ? "Guardando..." : "Guardar canal"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const MONTHS_ES_FINANCE = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

function InpcSection({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  // Tabla INPC
  const list = trpc.finance.inpc.list.useQuery({ organizationId, limit: 36 });

  // Form nuevo registro
  const now = new Date();
  const [form, setForm] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    indexValue: "",
    source: "BCV",
    notes: "",
  });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [formOk, setFormOk] = useState(false);
  const setMut = trpc.finance.inpc.set.useMutation({
    onSuccess: () => {
      setFormOk(true);
      setForm(f => ({ ...f, indexValue: "", notes: "" }));
      void utils.finance.inpc.list.invalidate();
      setTimeout(() => setFormOk(false), 3000);
    },
    onError: (e) => setFormErr(e.message),
  });

  const onSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    setFormOk(false);
    await setMut.mutateAsync({
      organizationId,
      year: form.year,
      month: form.month,
      indexValue: parseFloat(form.indexValue),
      source: form.source || "BCV",
      notes: form.notes || undefined,
    });
  };

  // Calculadora
  const [calcFrom, setCalcFrom] = useState({ year: now.getFullYear() - 1, month: now.getMonth() + 1 });
  const [calcTo,   setCalcTo]   = useState({ year: now.getFullYear(),     month: now.getMonth() + 1 });
  const [runCalc,  setRunCalc]  = useState(false);
  const calcResult = trpc.finance.inpc.calcFactor.useQuery(
    {
      organizationId,
      fromYear:  calcFrom.year,
      fromMonth: calcFrom.month,
      toYear:    calcTo.year,
      toMonth:   calcTo.month,
    },
    { enabled: runCalc },
  );

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group rounded-xl border bg-white shadow-sm"
    >
      <summary className="flex cursor-pointer items-center justify-between px-5 py-4 select-none list-none">
        <div>
          <span className="text-base font-semibold">📈 Índice INPC</span>
          <span className="ml-2 text-sm text-muted-foreground">Corrección monetaria de deudas vencidas</span>
        </div>
        <span className="text-muted-foreground text-sm">{open ? "▲ Ocultar" : "▼ Expandir"}</span>
      </summary>

      <div className="px-5 pb-6 space-y-6 border-t pt-4">

        {/* Nota explicativa */}
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          <p className="font-semibold mb-1">ℹ️ ¿Para qué sirve el INPC?</p>
          <p>El INPC se usa para corregir monetariamente deudas vencidas según sentencias del TSJ venezolano. Cargue los valores mensuales publicados por el BCV/INE.</p>
        </div>

        {/* Tabla de tasas */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Tasas INPC cargadas</h3>
          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">Año</th>
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2 text-right">Valor del índice</th>
                  <th className="px-3 py-2">Fuente</th>
                  <th className="px-3 py-2">Notas</th>
                </tr>
              </thead>
              <tbody>
                {list.isLoading ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Cargando...</td></tr>
                ) : list.data?.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Sin tasas cargadas aún</td></tr>
                ) : list.data?.map((r, i) => (
                  <tr key={`${r.year}-${r.month}`} className={`border-t ${i % 2 === 0 ? "" : "bg-slate-50"}`}>
                    <td className="px-3 py-2">{r.year}</td>
                    <td className="px-3 py-2">{MONTHS_ES_FINANCE[(r.month - 1)] ?? r.month}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(r.indexValue).toLocaleString("es-VE", { minimumFractionDigits: 6, maximumFractionDigits: 6 })}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.source}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Formulario agregar tasa */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Agregar / actualizar tasa mensual</h3>
          <form onSubmit={onSubmitForm} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end max-w-3xl">
            <div>
              <Label className="text-xs">Año</Label>
              <input
                type="number"
                min={2000}
                max={2035}
                value={form.year}
                onChange={(e) => setForm(f => ({ ...f, year: Number(e.target.value) }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
              />
            </div>
            <div>
              <Label className="text-xs">Mes</Label>
              <select
                value={form.month}
                onChange={(e) => setForm(f => ({ ...f, month: Number(e.target.value) }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
              >
                {MONTHS_ES_FINANCE.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Valor del índice</Label>
              <input
                type="number"
                step="0.000001"
                min="0.000001"
                placeholder="Ej: 1234567.890123"
                value={form.indexValue}
                onChange={(e) => setForm(f => ({ ...f, indexValue: e.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
              />
            </div>
            <div>
              <Label className="text-xs">Fuente</Label>
              <input
                type="text"
                placeholder="BCV"
                value={form.source}
                onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Notas (opcional)</Label>
              <input
                type="text"
                placeholder="Fuente o referencia"
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="md:col-span-5 flex gap-2 items-center">
              <Button type="submit" size="sm" disabled={setMut.isPending}>
                {setMut.isPending ? "Guardando..." : "💾 Guardar tasa"}
              </Button>
              {formOk && <span className="text-sm text-green-600 font-medium">✓ Tasa guardada</span>}
              {formErr && <span className="text-sm text-destructive">{formErr}</span>}
            </div>
          </form>
        </div>

        {/* Calculadora de factor */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Calculadora de factor de indexación</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end max-w-2xl">
            <div>
              <Label className="text-xs">Desde — Año</Label>
              <input
                type="number"
                min={2000}
                max={2035}
                value={calcFrom.year}
                onChange={(e) => { setCalcFrom(f => ({ ...f, year: Number(e.target.value) })); setRunCalc(false); }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Desde — Mes</Label>
              <select
                value={calcFrom.month}
                onChange={(e) => { setCalcFrom(f => ({ ...f, month: Number(e.target.value) })); setRunCalc(false); }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {MONTHS_ES_FINANCE.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Hasta — Año</Label>
              <input
                type="number"
                min={2000}
                max={2035}
                value={calcTo.year}
                onChange={(e) => { setCalcTo(f => ({ ...f, year: Number(e.target.value) })); setRunCalc(false); }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Hasta — Mes</Label>
              <select
                value={calcTo.month}
                onChange={(e) => { setCalcTo(f => ({ ...f, month: Number(e.target.value) })); setRunCalc(false); }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {MONTHS_ES_FINANCE.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4">
              <Button size="sm" onClick={() => setRunCalc(true)} disabled={calcResult.isLoading}>
                {calcResult.isLoading ? "Calculando..." : "🧮 Calcular factor"}
              </Button>
            </div>
          </div>

          {runCalc && calcResult.data === null && !calcResult.isLoading && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⚠️ No se encontraron tasas INPC para uno o ambos períodos seleccionados. Cargue primero los valores mensuales.
            </div>
          )}
          {runCalc && calcResult.data && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
              <div className="rounded-lg border bg-white p-3 text-center">
                <p className="text-xs text-muted-foreground">Índice inicial</p>
                <p className="text-base font-bold text-[#1e3a5f]">
                  {Number(calcResult.data.fromIndex).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="rounded-lg border bg-white p-3 text-center">
                <p className="text-xs text-muted-foreground">Índice final</p>
                <p className="text-base font-bold text-[#1e3a5f]">
                  {Number(calcResult.data.toIndex).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="rounded-lg border bg-[#1e7a5f]/10 p-3 text-center">
                <p className="text-xs text-muted-foreground">Factor multiplicador</p>
                <p className="text-xl font-bold text-[#1e7a5f]">
                  {Number(calcResult.data.factor).toFixed(6)}
                </p>
              </div>
              <div className="rounded-lg border bg-amber-50 p-3 text-center">
                <p className="text-xs text-muted-foreground">% de aumento</p>
                <p className="text-xl font-bold text-amber-700">
                  {calcResult.data.percentageIncrease}%
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function AgingCell({
  label,
  data,
  alarm = false,
}: {
  label: string;
  data?: { bss: string; usd: string; count: number };
  alarm?: boolean;
}) {
  return (
    <div className={`rounded border p-3 ${alarm ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">${Number(data?.usd ?? 0).toFixed(2)}</div>
      <div className="text-xs text-muted-foreground">
        Bs {Number(data?.bss ?? 0).toFixed(2)} · {data?.count ?? 0} recibo(s)
      </div>
    </div>
  );
}

// ─── Cierre de Mes ──────────────────────────────────────────────
const MONTHS_LABEL = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function MonthCloseCard({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const status = trpc.finance.monthClose.isOpen.useQuery({ organizationId, communityId, year, month });
  const history = trpc.finance.monthClose.list.useQuery({ organizationId, communityId });
  const close = trpc.finance.monthClose.close.useMutation();
  const reopen = trpc.finance.monthClose.reopen.useMutation();

  const handleClose = async () => {
    setError(null);
    try {
      await close.mutateAsync({ organizationId, communityId, year, month, notes: notes || undefined });
      setNotes("");
      await Promise.all([
        utils.finance.monthClose.isOpen.invalidate(),
        utils.finance.monthClose.list.invalidate(),
        utils.finance.invoices.previewReceiptPdf.invalidate(),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  };

  const handleReopen = async (y: number, m: number) => {
    if (!confirm(`¿Reabrir ${MONTHS_LABEL[m - 1]} ${y}? Permitirá modificar gastos/ingresos de ese mes.`)) return;
    setError(null);
    try {
      await reopen.mutateAsync({ organizationId, communityId, year: y, month: m });
      await Promise.all([
        utils.finance.monthClose.isOpen.invalidate(),
        utils.finance.monthClose.list.invalidate(),
        utils.finance.invoices.previewReceiptPdf.invalidate(),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  };

  const isClosed = status.data?.closed;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🔒 Cierre de mes</CardTitle>
        <CardDescription>
          Cerrar un mes bloquea modificaciones de gastos e ingresos para garantizar la integridad de los recibos emitidos. Reabrible en caso de necesidad.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Mes</Label>
            <select
              className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS_LABEL.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Año</Label>
            <select
              className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Cierre con auditoría pendiente"
              disabled={isClosed}
            />
          </div>
        </div>

        {status.isLoading ? (
          <div className="text-sm text-muted-foreground">Verificando estado...</div>
        ) : isClosed ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
            <div className="font-semibold text-amber-900">
              🔒 {MONTHS_LABEL[month - 1]} {year} está CERRADO
            </div>
            <div className="text-xs text-amber-700 mt-1">
              Cerrado el {status.data?.closedAt ? new Date(status.data.closedAt).toLocaleString("es-VE") : ""}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => handleReopen(year, month)}
              disabled={reopen.isPending}
            >
              🔓 Reabrir mes
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm">
            <div className="font-semibold text-emerald-900">
              ✏️ {MONTHS_LABEL[month - 1]} {year} está ABIERTO
            </div>
            <div className="text-xs text-emerald-700 mt-1">
              Se pueden registrar gastos e ingresos para este mes.
            </div>
            <Button
              size="sm"
              className="mt-2 bg-amber-600 hover:bg-amber-700"
              onClick={handleClose}
              disabled={close.isPending}
            >
              {close.isPending ? "Cerrando..." : `🔒 Cerrar ${MONTHS_LABEL[month - 1]} ${year}`}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Historial de cierres */}
        {history.data && history.data.length > 0 && (
          <div className="mt-2">
            <Label className="text-xs">Historial de cierres</Label>
            <div className="mt-1 max-h-48 overflow-y-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">Período</th>
                    <th className="px-2 py-1 text-left">Cerrado por</th>
                    <th className="px-2 py-1 text-left">Fecha</th>
                    <th className="px-2 py-1 text-right">% Cobro</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((h) => {
                    const sum = h.summary as { collectionRate?: number; totalInvoicedUsd?: string };
                    return (
                      <tr key={h.id} className="border-t">
                        <td className="px-2 py-1 font-medium">{MONTHS_LABEL[h.month - 1]} {h.year}</td>
                        <td className="px-2 py-1 text-muted-foreground">{h.closedBy?.name ?? h.closedBy?.email ?? "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground">{new Date(h.closedAt).toLocaleDateString("es-VE")}</td>
                        <td className="px-2 py-1 text-right">{sum?.collectionRate ?? 0}%</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            onClick={() => handleReopen(h.year, h.month)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            🔓 Reabrir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
