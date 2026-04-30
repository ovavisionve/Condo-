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
  const utils = trpc.useUtils();
  const [manualVal, setManualVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [bcvErr, setBcvErr] = useState<string | null>(null);
  const [bcvOk, setBcvOk] = useState<string | null>(null);
  const [feeVal, setFeeVal] = useState("");
  const [feeErr, setFeeErr] = useState<string | null>(null);
  const [feeOk, setFeeOk] = useState(false);

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
