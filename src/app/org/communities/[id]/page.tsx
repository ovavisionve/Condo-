"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../OrgContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CommunityOverview() {
  const { id } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const community = trpc.org.communities.byId.useQuery({ organizationId, id });
  const units = trpc.org.units.list.useQuery({ organizationId, communityId: id });
  const aging = trpc.finance.aging.useQuery({ organizationId, communityId: id });
  const rate = trpc.finance.exchange.current.useQuery({ organizationId });

  const sumAliquot = units.data?.reduce((s, u) => s + Number(u.aliquot.toString()), 0) ?? 0;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardDescription>Unidades</CardDescription>
          <CardTitle className="text-3xl">{units.data?.length ?? "-"}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Suma de alícuotas: {sumAliquot.toFixed(4)}%
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Tasa BCV (USD→VES)</CardDescription>
          <CardTitle className="text-3xl">
            {rate.data ? Number(rate.data.vesPerUsd).toFixed(2) : "..."}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {rate.data ? `${rate.data.source} · ${new Date(rate.data.date).toLocaleDateString("es-VE")}` : ""}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Cartera vencida</CardDescription>
          <CardTitle className="text-3xl">
            ${aging.data ? sumAgingUsd(aging.data) : "0.00"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {aging.data
            ? `${aging.data.d_0_30.count + aging.data.d_31_60.count + aging.data.d_61_90.count + aging.data.d_90_plus.count} factura(s)`
            : ""}
        </CardContent>
      </Card>

      {community.data && (
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">Información del edificio</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <Field label="RIF" value={community.data.rif ?? "—"} />
            <Field label="Estado" value={community.data.state ?? "—"} />
            <Field label="País" value={community.data.country} />
            <Field label="Activo" value={community.data.active ? "Sí" : "No"} />
            <Field label="Torres" value={String(community.data.towersCount ?? 1)} />
            <Field label="Pisos" value={community.data.floorsCount != null ? String(community.data.floorsCount) : "—"} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function sumAgingUsd(data: Record<string, { usd: string }>): string {
  const sum = Object.values(data).reduce((s, b) => s + Number(b.usd), 0);
  return sum.toFixed(2);
}
