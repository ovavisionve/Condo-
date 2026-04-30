import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/server/auth/config";
import { canManageOrganization, isPlatform } from "@/server/auth/permissions";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { OrgContextProvider } from "./OrgContext";
import { db } from "@/server/db/client";

export default async function OrgLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const memberships = session.user.memberships ?? [];
  const isPlat = memberships.some((m) => isPlatform(m.role));
  // Permitir ORG_ADMIN, COMMUNITY_ADMIN (personal con cargo) y PLATFORM roles
  const canManage = memberships.some((m) => canManageOrganization(m.role));
  if (!canManage) redirect("/");
  // Solo ORG_ADMIN+ puede gestionar personal
  const isOrgAdmin = memberships.some((m) => isPlatform(m.role) || m.role === "ORG_ADMIN");

  const orgs = isPlat
    ? await db.organization.findMany({
        where: { deletedAt: null, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true },
      })
    : await db.organization.findMany({
        where: {
          id: { in: memberships.filter((m) => m.organizationId).map((m) => m.organizationId!) },
          deletedAt: null,
          active: true,
        },
        select: { id: true, name: true, slug: true },
      });

  if (orgs.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">No tienes acceso a ninguna organización.</p>
      </div>
    );
  }

  return (
    <OrgContextProvider orgs={orgs}>
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-6">
              <Link href="/org" className="text-lg font-semibold">
                Condominios <span className="text-sm text-muted-foreground">/ Org</span>
              </Link>
              <nav className="flex gap-4 text-sm">
                <Link href="/org" className="hover:underline">Edificios</Link>
                {isOrgAdmin && (
                  <Link href="/org/members" className="hover:underline">Personal</Link>
                )}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <span className="text-sm text-muted-foreground">{session.user.email}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <Button variant="outline" size="sm" type="submit">Salir</Button>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </div>
    </OrgContextProvider>
  );
}
