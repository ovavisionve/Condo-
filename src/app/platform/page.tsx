"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const fmt = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function KpiCard({
  label, value, sub, href, color = "text-foreground",
}: { label: string; value: string | number; sub?: string; href?: string; color?: string }) {
  const inner = (
    <Card className="transition-colors hover:bg-accent/30 cursor-pointer">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">{label}</CardDescription>
        <CardTitle className={`text-3xl font-bold ${color}`}>{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="pt-0 text-xs text-muted-foreground">{sub}</CardContent>}
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function PlatformDashboard() {
  const { data: m, isLoading } = trpc.platform.metrics.useQuery();
  const { data: orgs } = trpc.platform.organizations.list.useQuery({ status: "ALL" });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Panel de plataforma</h1>
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="h-24" /></Card>
          ))}
        </div>
      </div>
    );
  }

  const totalActive = (m?.byStatus.active ?? 0) + (m?.byStatus.trial ?? 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Panel de plataforma</h1>
          <p className="text-muted-foreground text-sm">Visión global del SaaS — ResidIA</p>
        </div>
        <Link
          href="/platform/organizations"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Nueva organización
        </Link>
      </div>

      {/* Métricas de ingresos */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">💰 Ingresos</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="MRR" value={`$${fmt(m?.mrr ?? 0)}`} sub="Ingresos mensuales recurrentes" color="text-green-600" />
          <KpiCard label="ARR" value={`$${fmt(m?.arr ?? 0)}`} sub="Proyección anual (MRR × 12)" color="text-green-700" />
          <KpiCard label="Clientes activos" value={totalActive} sub={`${m?.byStatus.active ?? 0} activos + ${m?.byStatus.trial ?? 0} en trial`} href="/platform/organizations" />
          <KpiCard label="Unidades en plataforma" value={(m?.totalUnits ?? 0).toLocaleString()} sub="Apartamentos / locales gestionados" />
        </div>
      </section>

      {/* Estado de clientes */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">📊 Estado de clientes</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard label="✅ Activos" value={m?.byStatus.active ?? 0} color="text-green-600" href="/platform/organizations" />
          <KpiCard label="🟡 En trial" value={m?.byStatus.trial ?? 0} color="text-yellow-600" href="/platform/organizations" />
          <KpiCard label="🟠 Vencidos" value={m?.byStatus.pastDue ?? 0} color="text-orange-600" href="/platform/organizations" />
          <KpiCard label="🔴 Suspendidos" value={m?.byStatus.suspended ?? 0} color="text-red-600" href="/platform/organizations" />
          <KpiCard label="⚫ Cancelados" value={m?.byStatus.canceled ?? 0} color="text-muted-foreground" href="/platform/organizations" />
        </div>
      </section>

      {/* Alertas */}
      {((m?.expiringSoon ?? 0) > 0 || (m?.byStatus.pastDue ?? 0) > 0) && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">🚨 Atención requerida</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(m?.expiringSoon ?? 0) > 0 && (
              <Link href="/platform/organizations">
                <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
                  <span className="text-2xl">⏳</span>
                  <div>
                    <p className="font-semibold text-yellow-800">{m?.expiringSoon} trial(s) expira en menos de 14 días</p>
                    <p className="text-sm text-yellow-700">Contacta a estos clientes para convertirlos antes de que pierdan acceso.</p>
                  </div>
                </div>
              </Link>
            )}
            {(m?.byStatus.pastDue ?? 0) > 0 && (
              <Link href="/platform/organizations">
                <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 p-4">
                  <span className="text-2xl">💳</span>
                  <div>
                    <p className="font-semibold text-orange-800">{m?.byStatus.pastDue} organización(es) con pago vencido</p>
                    <p className="text-sm text-orange-700">Gestiona el cobro antes de suspender el acceso.</p>
                  </div>
                </div>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Últimos clientes */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">🏢 Clientes recientes</h2>
          <Link href="/platform/organizations" className="text-xs text-primary hover:underline">Ver todos →</Link>
        </div>
        <Card>
          <div className="divide-y">
            {orgs?.slice(0, 6).map((org) => {
              const sub = org.subscription;
              const STATUS_COLOR: Record<string, string> = {
                ACTIVE: "bg-green-100 text-green-700",
                TRIAL: "bg-yellow-100 text-yellow-700",
                PAST_DUE: "bg-orange-100 text-orange-700",
                SUSPENDED: "bg-red-100 text-red-700",
                CANCELLED: "bg-gray-100 text-gray-500",
              };
              const STATUS_LABEL: Record<string, string> = {
                ACTIVE: "Activo", TRIAL: "Trial", PAST_DUE: "Vencido",
                SUSPENDED: "Suspendido", CANCELLED: "Cancelado",
              };
              return (
                <Link key={org.id} href={`/platform/organizations/${org.id}`}>
                  <div className="flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                        {org.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{org.name}</p>
                        <p className="text-xs text-muted-foreground">/{org.slug} · {org._count.communities} edif. · {org._count.memberships} usuarios</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <div className="hidden sm:block text-xs text-muted-foreground">
                        {sub ? `$${sub.plan.priceUsd.toString()}/mes` : "—"}
                      </div>
                      {sub && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[sub.status] ?? "bg-gray-100 text-gray-500"}`}>
                          {STATUS_LABEL[sub.status] ?? sub.status}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      </section>

      {/* Mes en curso */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">📅 Este mes</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard label="Nuevas organizaciones" value={m?.newThisMonth ?? 0} sub="Creadas en el mes actual" color="text-blue-600" />
          <KpiCard label="Trials activos" value={m?.byStatus.trial ?? 0} sub="Esperando conversión" color="text-yellow-600" />
          <KpiCard label="Trials expirando" value={m?.expiringSoon ?? 0} sub="En los próximos 14 días" color={m?.expiringSoon ? "text-orange-600" : "text-foreground"} />
        </div>
      </section>

      {/* Acciones rápidas */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">⚡ Acciones rápidas</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "🏢 Nueva organización", href: "/platform/organizations", desc: "Registrar nuevo cliente" },
            { label: "📋 Ver todos los clientes", href: "/platform/organizations", desc: "Lista completa con filtros" },
            { label: "💼 Gestionar planes", href: "/platform/plans", desc: "Crear o editar planes" },
            { label: "⚠️ Clientes vencidos", href: "/platform/organizations", desc: "Cobrar o suspender" },
          ].map((a) => (
            <Link key={a.href + a.label} href={a.href}>
              <Card className="h-full hover:bg-accent/30 transition-colors cursor-pointer">
                <CardContent className="pt-4">
                  <p className="font-medium text-sm">{a.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{a.desc}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
