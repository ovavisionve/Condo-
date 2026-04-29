"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NewOrganizationDialog } from "./NewOrganizationDialog";

export default function OrganizationsPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading, refetch } = trpc.platform.organizations.list.useQuery({ search });
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Organizaciones</h1>
          <p className="text-muted-foreground">Clientes del SaaS y sus suscripciones.</p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ Nueva organización</Button>
      </div>

      <Input
        placeholder="Buscar por nombre, slug o RIF..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      {isLoading && <p className="text-muted-foreground">Cargando...</p>}

      <div className="grid gap-3">
        {data?.length === 0 && (
          <p className="text-muted-foreground">No hay organizaciones todavía.</p>
        )}
        {data?.map((org) => (
          <Link key={org.id} href={`/platform/organizations/${org.id}`}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg">{org.name}</CardTitle>
                  <CardDescription>
                    /{org.slug} · {org._count.communities} edificio(s) · {org._count.memberships} usuario(s)
                  </CardDescription>
                </div>
                <span className="text-xs text-muted-foreground">
                  {org.subscription
                    ? `${org.subscription.plan.name} · ${org.subscription.status}`
                    : "sin suscripción"}
                </span>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {org.email} {org.phone ? `· ${org.phone}` : ""}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <NewOrganizationDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => {
          setShowNew(false);
          void refetch();
        }}
      />
    </div>
  );
}
