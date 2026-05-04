"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewOrganizationDialog } from "./NewOrganizationDialog";

type StatusFilter = "ALL" | "ACTIVE" | "TRIAL" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activo", TRIAL: "Trial", PAST_DUE: "Vencido",
  SUSPENDED: "Suspendido", CANCELLED: "Cancelado",
};
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 border-green-200",
  TRIAL: "bg-yellow-100 text-yellow-700 border-yellow-200",
  PAST_DUE: "bg-orange-100 text-orange-700 border-orange-200",
  SUSPENDED: "bg-red-100 text-red-700 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};

const TABS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "ACTIVE", label: "✅ Activos" },
  { key: "TRIAL", label: "🟡 Trial" },
  { key: "PAST_DUE", label: "🟠 Vencidos" },
  { key: "SUSPENDED", label: "🔴 Suspendidos" },
  { key: "CANCELLED", label: "⚫ Cancelados" },
];

export default function OrganizationsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, refetch } = trpc.platform.organizations.list.useQuery({ search, status });
  const { data: plans } = trpc.platform.plans.list.useQuery();

  const totalMrr = data?.reduce((sum, org) => {
    if (!org.subscription) return sum;
    if (!["ACTIVE", "TRIAL"].includes(org.subscription.status)) return sum;
    return sum + Number(org.subscription.plan.priceUsd);
  }, 0) ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Organizaciones</h1>
          <p className="text-muted-foreground text-sm">
            {data ? `${data.length} cliente(s)` : "Cargando..."}
            {totalMrr > 0 && <span className="ml-2 text-green-600 font-medium">· MRR ${totalMrr.toFixed(2)}</span>}
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ Nueva organización</Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar nombre, slug, RIF, email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-1 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                status === t.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : data?.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No hay organizaciones con ese filtro.</p>
          <Button className="mt-4" onClick={() => setShowNew(true)}>+ Crear primera organización</Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Organización</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Plan</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Edif.</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Usuarios</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">$/mes</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Trial / Período</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.map((org) => {
                const sub = org.subscription;
                const trialDaysLeft = sub?.trialEndsAt
                  ? Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000)
                  : null;
                const isExpiringSoon = sub?.status === "TRIAL" && trialDaysLeft !== null && trialDaysLeft <= 7;

                return (
                  <tr
                    key={org.id}
                    className={`hover:bg-accent/30 transition-colors ${isExpiringSoon ? "bg-yellow-50/50" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          ("type" in org && (org as { type?: string }).type === "COMMERCIAL")
                            ? "bg-blue-100 text-blue-700"
                            : "bg-primary/10 text-primary"
                        }`}>
                          {("type" in org && (org as { type?: string }).type === "COMMERCIAL") ? "CC" : org.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium">{org.name}</p>
                            {("type" in org && (org as { type?: string }).type === "COMMERCIAL") && (
                              <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 py-0.5">CC</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">/{org.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm">{sub?.plan.name ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      {sub ? (
                        <div className="flex flex-col gap-0.5">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium w-fit ${STATUS_COLOR[sub.status] ?? ""}`}>
                            {STATUS_LABEL[sub.status] ?? sub.status}
                          </span>
                          {isExpiringSoon && (
                            <span className="text-xs text-orange-600">⚠ {trialDaysLeft}d</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">Sin suscripción</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell text-muted-foreground">
                      {org._count.communities}
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell text-muted-foreground">
                      {org._count.memberships}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      {sub && ["ACTIVE", "TRIAL"].includes(sub.status) ? (
                        <span className="font-medium text-green-700">${sub.plan.priceUsd.toString()}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell text-xs text-muted-foreground">
                      {sub?.status === "TRIAL" && sub.trialEndsAt
                        ? `Trial hasta ${new Date(sub.trialEndsAt).toLocaleDateString("es-VE")}`
                        : sub
                          ? `${new Date(sub.currentPeriodEnd).toLocaleDateString("es-VE")}`
                          : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/platform/organizations/${org.id}`}
                        className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors"
                      >
                        Ver →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewOrganizationDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => {
          setShowNew(false);
          void refetch();
        }}
        plans={plans ?? []}
      />
    </div>
  );
}
