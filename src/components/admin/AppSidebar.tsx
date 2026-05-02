"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";
import { useOrgs } from "@/app/org/OrgContext";
import { NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  userEmail: string;
  isOrgAdmin: boolean;
}

// ─── Nav item ────────────────────────────────────────────────────────────────
function NavItem({
  href,
  label,
  icon,
  exact = false,
  indent = false,
}: {
  href: string;
  label: string;
  icon?: string;
  exact?: boolean;
  indent?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : (pathname === href || pathname.startsWith(href + "/"));

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        indent && "ml-2",
        active
          ? "bg-blue-600/20 text-blue-300 font-medium"
          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
      )}
    >
      {icon && <span className="text-base leading-none">{icon}</span>}
      <span>{label}</span>
    </Link>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </p>
  );
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────
export function AppSidebar({ userEmail, isOrgAdmin }: AppSidebarProps) {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const communityId = params?.id;
  const { orgs, selectedOrgId, setSelectedOrgId } = useOrgs();

  // Detect if we're inside a community route
  const inCommunity = Boolean(communityId) && pathname.includes("/communities/");

  // Fetch community name when inside a community route
  const { data: community } = trpc.org.communities.byId.useQuery(
    { organizationId: selectedOrgId, id: communityId! },
    { enabled: Boolean(inCommunity && communityId && selectedOrgId) },
  );

  const base = `/org/communities/${communityId}`;

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col bg-slate-900 border-r border-slate-800">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-bold flex-shrink-0">
          C
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">Condominios</p>
          <p className="text-[10px] text-slate-500 leading-tight">Panel de admin</p>
        </div>
      </div>

      {/* Org selector */}
      {orgs.length > 0 && (
        <div className="px-3 py-3 border-b border-slate-800">
          {orgs.length === 1 ? (
            <div className="px-1">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Organización</p>
              <p className="text-sm font-medium text-slate-300 truncate">{orgs[0]!.name}</p>
            </div>
          ) : (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 px-1">Organización</p>
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {inCommunity && communityId ? (
          <>
            {/* Back to buildings */}
            <Link
              href="/org"
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-2"
            >
              <span>←</span>
              <span>Todos los edificios</span>
            </Link>

            {/* Community name */}
            <div className="px-3 pb-2 mb-1 border-b border-slate-800">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Edificio</p>
              <p className="text-sm font-semibold text-slate-200 truncate">
                {community?.name ?? "..."}
              </p>
              {community && (
                <p className="text-[10px] text-slate-500 truncate">{community.city}</p>
              )}
            </div>

            {/* Community nav */}
            <NavItem href={base} label="Resumen" icon="📊" exact />
            <NavItem href={`${base}/units`} label="Unidades" icon="🏠" />
            <NavItem href={`${base}/residents`} label="Propietarios" icon="👥" />

            <SectionLabel>Finanzas</SectionLabel>
            <NavItem href={`${base}/finance`} label="General" icon="💰" exact />
            <NavItem href={`${base}/finance/expenses`} label="Gastos Comunes" icon="📋" exact />
            <NavItem href={`${base}/finance/income`} label="Ingresos" icon="💵" exact />
            <NavItem href={`${base}/finance/invoices`} label="Recibos" icon="📄" exact />
            <NavItem href={`${base}/finance/payments`} label="Pagos" icon="💳" exact />
            <NavItem href={`${base}/finance/account`} label="Estado de cuenta" icon="📊" exact />
            <NavItem href={`${base}/finance/conciliacion`} label="Conciliación" icon="🏦" exact />

            <SectionLabel>Gestión</SectionLabel>
            <NavItem href={`${base}/maintenance`} label="Mantenimiento" icon="🔧" />
            <NavItem href={`${base}/security`} label="Seguridad" icon="🔒" />
            <NavItem href={`${base}/governance`} label="Junta de Condominio" icon="🏛️" />
            <NavItem href={`${base}/communication`} label="Comunicación" icon="📢" />
            <NavItem href={`${base}/reports`} label="Reportes" icon="📈" />
            <NavItem href={`${base}/import`} label="Importar datos" icon="⬆️" />

            <SectionLabel>Soporte</SectionLabel>
            <NavItem href="/org/help" label="Guía de ayuda" icon="🎓" />
          </>
        ) : (
          <>
            <SectionLabel>Principal</SectionLabel>
            <NavItem href="/org" label="Edificios" icon="🏢" exact />
            {isOrgAdmin && (
              <>
                <NavItem href="/org/members" label="Personal" icon="👥" />
                <NavItem href="/org/settings" label="Configuración" icon="⚙️" />
              </>
            )}
          </>
        )}
      </nav>

      {/* Bottom: notifications + user + sign out */}
      <div className="border-t border-slate-800 px-3 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <NotificationBell />
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-md px-2.5 py-1.5 text-xs text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200 transition-colors"
          >
            Salir
          </button>
        </div>
        <p className="text-[10px] text-slate-600 truncate px-0.5" title={userEmail}>
          {userEmail}
        </p>
      </div>
    </aside>
  );
}
