import Link from "next/link";
import { db } from "@/server/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PlatformDashboard() {
  const [orgsCount, activeSubsCount, plansCount] = await Promise.all([
    db.organization.count({ where: { deletedAt: null } }),
    db.subscription.count({ where: { status: { in: ["TRIAL", "ACTIVE"] } } }),
    db.plan.count({ where: { active: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Resumen de la plataforma</h1>
        <p className="text-muted-foreground">Vista general del SaaS de condominios.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Organizaciones" value={orgsCount} href="/platform/organizations" />
        <StatCard label="Suscripciones activas" value={activeSubsCount} />
        <StatCard label="Planes" value={plansCount} href="/platform/plans" />
      </div>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const content = (
    <Card className="transition-colors hover:bg-accent/40">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent />
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
