"use client";

import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function PlansPage() {
  const { data, isLoading } = trpc.platform.plans.list.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Planes</h1>
        <p className="text-muted-foreground">Catálogo global de planes que ofreces a tus clientes.</p>
      </div>

      {isLoading && <p className="text-muted-foreground">Cargando...</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {data?.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <CardDescription>${plan.priceUsd.toString()} / mes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{plan.description}</p>
              <ul className="space-y-1">
                <li>· {plan.maxCommunities} edificio(s)</li>
                <li>· hasta {plan.maxUnits} unidades</li>
              </ul>
              <div className="flex flex-wrap gap-1 pt-2">
                {Object.entries(plan.features as Record<string, boolean>)
                  .filter(([, v]) => v)
                  .map(([k]) => (
                    <span
                      key={k}
                      className="rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground"
                    >
                      {k}
                    </span>
                  ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
