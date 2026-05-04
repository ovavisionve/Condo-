"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "./ComercialContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function KpiCard({
  label, value, sub, href, color = "text-foreground",
}: { label: string; value: string | number; sub?: string; href?: string; color?: string }) {
  const inner = (
    <Card className="transition-colors hover:bg-accent/30">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">{label}</CardDescription>
        <CardTitle className={`text-3xl font-bold ${color}`}>{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="pt-0 text-xs text-muted-foreground">{sub}</CardContent>}
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function ComercialDashboard() {
  const { selectedOrgId, selectedOrg } = useComercial();
  const [showNewMall, setShowNewMall] = useState(false);

  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const malls = mallsQ.data ?? [];

  // Tomar el primer mall para métricas (la mayoría de los CC tiene uno)
  const mainMall = malls[0];
  const metricsQ = trpc.comercial.metrics.useQuery(
    { organizationId: selectedOrgId, mallId: mainMall?.id ?? "" },
    { enabled: !!mainMall },
  );
  const m = metricsQ.data;

  // Métricas avanzadas del mall (Feature 2)
  const mallMetricsQ = trpc.comercial.malls.metrics.useQuery(
    { organizationId: selectedOrgId, mallId: mainMall?.id ?? "" },
    { enabled: !!mainMall },
  );
  const mm = mallMetricsQ.data;

  // Contratos por vencer (Feature 1)
  const expiringQ = trpc.comercial.tenancies.expiring.useQuery(
    { organizationId: selectedOrgId, mallId: mainMall?.id ?? "", daysAhead: 90 },
    { enabled: !!mainMall },
  );
  const expiring = expiringQ.data ?? [];
  const exp30 = expiring.filter((t) => t.bucket === "30");
  const exp60 = expiring.filter((t) => t.bucket === "60");
  const exp90 = expiring.filter((t) => t.bucket === "90");

  const now = new Date();
  const createMallMut = trpc.comercial.malls.create.useMutation({
    onSuccess: () => {
      void mallsQ.refetch();
      setShowNewMall(false);
      setMallForm({ name: "", address: "", city: "", rif: "", phone: "", email: "" });
    },
  });
  const [mallForm, setMallForm] = useState({ name: "", address: "", city: "", rif: "", phone: "", email: "" });

  if (mallsQ.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Centro Comercial</h1>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="h-24" /></Card>
          ))}
        </div>
      </div>
    );
  }

  // Sin malls configurados
  if (malls.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">🏬 {selectedOrg.name}</h1>
            <p className="text-muted-foreground text-sm">Centro Comercial — Sin galería configurada</p>
          </div>
        </div>

        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-12 text-center space-y-4">
          <div className="text-5xl">🏬</div>
          <h2 className="text-xl font-semibold">Registra tu primera galería</h2>
          <p className="text-muted-foreground max-w-md mx-auto text-sm">
            Configura los datos del centro comercial para comenzar a gestionar locales, arrendatarios y facturas de canon.
          </p>
          <Button onClick={() => setShowNewMall(true)} className="bg-blue-600 hover:bg-blue-700">
            + Registrar galería / mall
          </Button>
        </div>

        {showNewMall && (
          <NewMallDialog
            orgId={selectedOrgId}
            form={mallForm}
            setForm={setMallForm}
            onSubmit={async (e) => {
              e.preventDefault();
              await createMallMut.mutateAsync({ organizationId: selectedOrgId, ...mallForm });
            }}
            isPending={createMallMut.isPending}
            onClose={() => setShowNewMall(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">🏬 {selectedOrg.name}</h1>
          <p className="text-muted-foreground text-sm">
            {malls.length === 1 ? malls[0]!.name : `${malls.length} galerías`} · Centro Comercial
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowNewMall(true)}>+ Nueva galería</Button>
        </div>
      </div>

      {/* Si hay múltiples malls, mostrar lista */}
      {malls.length > 1 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">🏬 Galerías</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {malls.map((mall) => (
              <Link key={mall.id} href={`/comercial/locales?mallId=${mall.id}`}>
                <Card className="hover:bg-accent/30 transition-colors cursor-pointer">
                  <CardContent className="pt-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{mall.name}</p>
                      <p className="text-xs text-muted-foreground">{mall.city} · {mall._count.locales} locales</p>
                    </div>
                    <span className="text-muted-foreground">→</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* KPIs del mall principal */}
      {mainMall && m && (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">🏪 Locales — {mainMall.name}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Total locales" value={m.totalLocales} sub="Registrados en el sistema" href="/comercial/locales" />
              <KpiCard label="Locales activos" value={m.activeLocales} sub="Con contrato vigente" color="text-blue-600" href="/comercial/locales" />
              <KpiCard
                label="Ocupación"
                value={`${m.totalLocales > 0 ? Math.round(m.occupiedLocales / m.totalLocales * 100) : 0}%`}
                sub={`${m.occupiedLocales} de ${m.totalLocales} ocupados`}
                color={m.occupiedLocales / Math.max(m.totalLocales, 1) >= 0.8 ? "text-green-600" : "text-orange-600"}
              />
              <KpiCard
                label="Cobrado este mes"
                value={`$${fmt(m.collectedThisMonthUsd)}`}
                sub={`${now.toLocaleDateString("es-VE", { month: "long", year: "numeric" })}`}
                color="text-green-600"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">⚠️ Cobranza pendiente</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <KpiCard
                label="Facturas pendientes"
                value={m.pendingInvoicesCount}
                sub="ISSUED + PARTIAL + OVERDUE"
                color={m.pendingInvoicesCount > 0 ? "text-orange-600" : "text-green-600"}
                href="/comercial/facturas"
              />
              <KpiCard
                label="Deuda pendiente"
                value={`$${fmt(m.pendingDebtUsd)}`}
                sub="Total por cobrar (neto de abonos)"
                color={m.pendingDebtUsd > 0 ? "text-red-600" : "text-green-600"}
                href="/comercial/facturas"
              />
              <KpiCard
                label="Facturas vencidas"
                value={m.overdueCount}
                sub="Con fecha de vencimiento pasada"
                color={m.overdueCount > 0 ? "text-red-600" : "text-green-600"}
                href="/comercial/facturas"
              />
            </div>
          </section>
        </>
      )}

      {/* Feature 2: Métricas avanzadas del mall */}
      {mainMall && mm && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">📈 Métricas del mall</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Ocupación con barra de progreso */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wide">🏪 Ocupación</CardDescription>
                <CardTitle className="text-2xl font-bold text-blue-600">
                  {mm.occupiedLocals}/{mm.totalLocals} locales
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                <Progress value={mm.occupancyRate} className="h-2" />
                <p className="text-xs text-muted-foreground">{mm.occupancyRate}% ocupado · {mm.vacantLocals} vacante{mm.vacantLocals !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wide">📐 Renta/m²</CardDescription>
                <CardTitle className="text-2xl font-bold">${mm.rentPerM2}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">USD/m² · {mm.totalAreaM2} m² totales</CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wide">💰 Deuda pendiente</CardDescription>
                <CardTitle className={`text-2xl font-bold ${Number(mm.pendingDebtUsd) > 0 ? "text-red-600" : "text-green-600"}`}>
                  ${fmt(Number(mm.pendingDebtUsd))}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">Total por cobrar</CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wide">📊 Ventas del mes</CardDescription>
                <CardTitle className="text-2xl font-bold text-green-600">${fmt(Number(mm.monthlySalesUsd))}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                Declaraciones {now.toLocaleDateString("es-VE", { month: "long" })}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Feature 1: Alertas de vencimiento de contratos */}
      {mainMall && expiring.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">⚠️ Contratos por vencer</h2>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Contratos próximos a vencer</CardTitle>
                <div className="flex gap-2">
                  {exp30.length > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {exp30.length} vencen en 30d
                    </Badge>
                  )}
                  {exp60.length > 0 && (
                    <Badge className="text-xs bg-yellow-500 hover:bg-yellow-500 text-white">
                      {exp60.length} en 60d
                    </Badge>
                  )}
                  {exp90.length > 0 && (
                    <Badge className="text-xs bg-green-600 hover:bg-green-600 text-white">
                      {exp90.length} en 90d
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {expiring.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <div>
                    <span className="font-medium">{t.localCode}</span>
                    {t.localName !== t.localCode && <span className="text-muted-foreground"> — {t.localName}</span>}
                    <span className="ml-2 text-xs text-muted-foreground">{t.tenantName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(t.endDate).toLocaleDateString("es-VE")}
                    </span>
                    <Badge
                      variant={t.bucket === "30" ? "destructive" : "outline"}
                      className={`text-xs ${t.bucket === "60" ? "border-yellow-500 text-yellow-700" : t.bucket === "90" ? "border-green-500 text-green-700" : ""}`}
                    >
                      {t.daysLeft}d
                    </Badge>
                  </div>
                </div>
              ))}
              {expiring.length > 5 && (
                <p className="text-xs text-muted-foreground pt-1">
                  y {expiring.length - 5} contratos más...
                </p>
              )}
              <div className="pt-2">
                <Link href="/comercial/arrendatarios" className="text-xs text-blue-600 hover:underline">
                  Ver todos los arrendatarios →
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Sin contratos por vencer (y hay mall) — mostrar mensaje positivo */}
      {mainMall && !expiringQ.isLoading && expiring.length === 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">⚠️ Contratos por vencer</h2>
          <Card>
            <CardContent className="py-4 text-center text-sm text-muted-foreground">
              No hay contratos próximos a vencer en los próximos 90 días.
            </CardContent>
          </Card>
        </section>
      )}

      {/* Acciones rápidas */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">⚡ Acciones rápidas</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "🏪 Gestionar locales", href: "/comercial/locales", desc: "Ver, crear y editar locales" },
            { label: "🧾 Emitir facturas", href: "/comercial/facturas", desc: "Canon mensual y cargos extras" },
            { label: "💰 Registrar pago", href: "/comercial/pagos", desc: "Pagos de canon recibidos" },
            { label: "📊 Declaración de ventas", href: "/comercial/ventas", desc: "Canon variable (Decreto 929)" },
          ].map((a) => (
            <Link key={a.href} href={a.href}>
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

      {showNewMall && (
        <NewMallDialog
          orgId={selectedOrgId}
          form={mallForm}
          setForm={setMallForm}
          onSubmit={async (e) => {
            e.preventDefault();
            await createMallMut.mutateAsync({ organizationId: selectedOrgId, ...mallForm });
          }}
          isPending={createMallMut.isPending}
          onClose={() => setShowNewMall(false)}
        />
      )}
    </div>
  );
}

function NewMallDialog({
  form, setForm, onSubmit, isPending, onClose,
}: {
  orgId: string;
  form: { name: string; address: string; city: string; rif: string; phone: string; email: string };
  setForm: (f: typeof form) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  isPending: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-lg">🏬 Registrar galería / centro comercial</h2>
        </div>
        <form onSubmit={(e) => { void onSubmit(e); }} className="p-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Nombre del centro comercial *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Centro Comercial Las Vegas"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Ciudad *</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Caracas" required />
            </div>
            <div className="space-y-1">
              <Label>RIF</Label>
              <Input value={form.rif} onChange={(e) => setForm({ ...form, rif: e.target.value })} placeholder="J-12345678-9" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Dirección *</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Av. Libertador, Municipio Chacao" required />
            </div>
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+58 212-0000000" />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@cc.com" />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isPending || !form.name || !form.city || !form.address} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? "Creando..." : "✓ Crear galería"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
