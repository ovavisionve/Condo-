import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/server/auth/config";
import { isPlatform } from "@/server/auth/permissions";
import { Button } from "@/components/ui/button";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.memberships?.some((m) => isPlatform(m.role))) redirect("/");

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="border-b bg-white shadow-sm sticky top-0 z-40">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            {/* Logo / marca */}
            <Link href="/platform" className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground">R</div>
              <span className="font-semibold text-base">ResidIA</span>
              <span className="text-xs text-muted-foreground border border-muted rounded px-1.5 py-0.5 ml-1">Platform</span>
            </Link>

            {/* Nav items */}
            <nav className="hidden md:flex items-center gap-1">
              {[
                { href: "/platform", label: "🏠 Resumen" },
                { href: "/platform/organizations", label: "🏢 Organizaciones" },
                { href: "/platform/plans", label: "💼 Planes" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-medium">{session.user.name ?? session.user.email}</span>
              <span className="text-xs text-muted-foreground">Platform Owner</span>
            </div>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
              {(session.user.name ?? session.user.email ?? "P").charAt(0).toUpperCase()}
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button variant="outline" size="sm" type="submit" className="text-xs">Salir</Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
