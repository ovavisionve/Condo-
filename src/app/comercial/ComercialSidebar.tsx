"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useComercial } from "./ComercialContext";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/comercial", label: "🏬 Dashboard", exact: true },
  { href: "/comercial/locales", label: "🏪 Locales" },
  { href: "/comercial/arrendatarios", label: "🤝 Arrendatarios" },
  { href: "/comercial/facturas", label: "🧾 Facturas / Canon" },
  { href: "/comercial/pagos", label: "💰 Pagos" },
  { href: "/comercial/gastos", label: "📋 Gastos" },
  { href: "/comercial/ingresos", label: "💵 Recaudación" },
  { href: "/comercial/ventas", label: "📊 Declaración de Ventas" },
  { href: "/comercial/reportes", label: "📈 Reportes" },
  { href: "/comercial/marketing", label: "🎯 Marketing" },
  { href: "/comercial/conciliacion", label: "🏦 Conciliación" },
  { href: "/comercial/importar", label: "📥 Importar datos" },
  { href: "/comercial/configuracion", label: "⚙️ Configuración" },
];

export function ComercialSidebar({
  userEmail,
  isOrgAdmin,
}: {
  userEmail: string;
  isOrgAdmin: boolean;
}) {
  const pathname = usePathname();
  const { orgs, selectedOrgId, setSelectedOrgId, selectedOrg } = useComercial();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-white shadow-sm flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b px-4 py-4">
        <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold text-white">CC</div>
        <div>
          <p className="font-semibold text-sm leading-tight">Centro Comercial</p>
          <p className="text-xs text-muted-foreground">Gestión comercial</p>
        </div>
      </div>

      {/* Selector de organización */}
      {orgs.length > 1 && (
        <div className="border-b px-3 py-2">
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Mall nombre actual */}
      <div className="px-3 py-2 border-b bg-blue-50">
        <p className="text-xs text-muted-foreground">Organización activa</p>
        <p className="text-sm font-medium truncate">{selectedOrg.name}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors ${
              isActive(item.href, item.exact)
                ? "bg-blue-50 text-blue-700 font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Links extra */}
      <div className="border-t px-2 py-2 space-y-0.5">
        {isOrgAdmin && (
          <Link
            href="/org"
            className="flex items-center rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
          >
            🏠 Ir al módulo residencial
          </Link>
        )}
        <Link
          href="/platform"
          className="flex items-center rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          ⚙️ Panel de plataforma
        </Link>
      </div>

      {/* Usuario */}
      <div className="border-t px-3 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{userEmail}</p>
          <p className="text-xs text-muted-foreground">{isOrgAdmin ? "Administrador" : "Staff"}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7 px-2 flex-shrink-0"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          Salir
        </Button>
      </div>
    </aside>
  );
}
