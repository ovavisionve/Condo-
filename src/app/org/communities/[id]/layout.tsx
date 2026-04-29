"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../OrgContext";
import { cn } from "@/lib/utils";

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const organizationId = useOrgId();
  const { data: community } = trpc.org.communities.byId.useQuery(
    { organizationId, id },
    { enabled: Boolean(organizationId && id) },
  );

  const tabs = [
    { href: `/org/communities/${id}`, label: "Resumen" },
    { href: `/org/communities/${id}/units`, label: "Unidades" },
    { href: `/org/communities/${id}/residents`, label: "Residentes" },
    { href: `/org/communities/${id}/finance`, label: "Finanzas" },
    { href: `/org/communities/${id}/finance/expenses`, label: "Gastos" },
    { href: `/org/communities/${id}/finance/income`, label: "Ingresos" },
    { href: `/org/communities/${id}/finance/invoices`, label: "Facturas" },
    { href: `/org/communities/${id}/finance/payments`, label: "Pagos" },
    { href: `/org/communities/${id}/finance/account`, label: "Estado de cuenta" },
    { href: `/org/communities/${id}/maintenance`, label: "Mantenimiento" },
    { href: `/org/communities/${id}/security`, label: "Seguridad" },
    { href: `/org/communities/${id}/governance`, label: "Gobernanza" },
    { href: `/org/communities/${id}/communication`, label: "Comunicación" },
    { href: `/org/communities/${id}/reports`, label: "Reportes" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/org" className="text-sm text-muted-foreground hover:underline">
          ← Edificios
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {community?.name ?? "..."}
        </h1>
        {community && (
          <p className="text-sm text-muted-foreground">
            {community.address}, {community.city} · {community._count.units} unidad(es) · moneda {community.primaryCurrency}
          </p>
        )}
      </div>

      <nav className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => {
          const exact = pathname === t.href;
          const startsWith = pathname.startsWith(t.href + "/");
          // Para que sub-rutas no activen el padre simultáneamente
          const isFinance = t.href.endsWith("/finance");
          const active = exact || (startsWith && !isFinance && !t.href.match(/communities\/[^/]+$/));
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
}
