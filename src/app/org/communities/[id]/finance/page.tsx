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
  const [err, setErr] = useState<string | null>(null);
  const [bcvErr, setBcvErr] = useState<string | null>(null);
  const [bcvOk, setBcvOk] = useState<string | null>(null);
  const [feeVal, setFeeVal] = useState("");
  const [feeErr, setFeeErr] = useState<string | null>(null);
  const [feeOk, setFeeOk] = useState(false);
  const [dueDaysVal, setDueDaysVal] = useState("");
  const [dueDaysErr, setDueDaysErr] = useState<string | null>(null);
  const [dueDaysOk, setDueDaysOk] = useState(false);

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
      await setManual.mutateAsync({ organizationId, vesPerUsd: Number(manualVal) });
      setManualVal("");
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
          {feeOk && <p className="mt-2 text-sm text-green-600">✓ Cuota actualizada. Se aplicará en la próxima emisión de facturas.</p>}
        </CardContent>
      </Card>

      {/* ── Días de vencimiento ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Días de vencimiento de facturas</CardTitle>
          <CardDescription>
            Actualmente: <strong>{currentDueDays} días</strong> después de la fecha de emisión.
            {" "}Las facturas emitidas hoy vencerían el día {new Date(new Date().setDate(new Date().getDate() + currentDueDays)).toLocaleDateString("es-VE")}.
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
          {dueDaysOk && <p className="mt-2 text-sm text-green-600">✓ Actualizado. Se aplicará en la próxima emisión de facturas.</p>}
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
            {bcvErr && <p className="text-xs text-destructive">{bcvErr}</p>}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Tasa manual</CardTitle>
            <CardDescription>
              Si el fetch automático falla o quieres usar paralelo, ingresa la tasa del día.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSetManual} className="flex items-end gap-2">
              <div className="flex-1">
                <Label>VES por 1 USD</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={manualVal}
                  onChange={(e) => setManualVal(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={setManual.isPending}>
                {setManual.isPending ? "..." : "Guardar tasa"}
              </Button>
            </form>
            {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
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
              Aparecen en todas las facturas PDF bajo "Instrucciones de pago". Agrega todos los métodos que aceptas.
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
            Sin canales configurados. Las facturas mostrarán "Contacta a la administración".
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
        Bs {Number(data?.bss ?? 0).toFixed(2)} · {data?.count ?? 0} fact.
      </div>
    </div>
  );
}
