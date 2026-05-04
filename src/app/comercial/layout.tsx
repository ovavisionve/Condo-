import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { canManageOrganization, isPlatform } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { ComercialContextProvider } from "./ComercialContext";
import { ComercialSidebar } from "./ComercialSidebar";

export default async function ComercialLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const memberships = session.user.memberships ?? [];
  const isPlat = memberships.some((m) => isPlatform(m.role));
  const canManage = memberships.some((m) => canManageOrganization(m.role));
  if (!canManage && !isPlat) redirect("/");

  // Solo organizaciones COMMERCIAL
  const orgs = isPlat
    ? await db.organization.findMany({
        where: { deletedAt: null, active: true, type: "COMMERCIAL" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true },
      })
    : await db.organization.findMany({
        where: {
          id: { in: memberships.filter((m) => m.organizationId).map((m) => m.organizationId!) },
          deletedAt: null,
          active: true,
          type: "COMMERCIAL",
        },
        select: { id: true, name: true, slug: true },
      });

  if (orgs.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4">
        <p className="text-muted-foreground text-lg">No tienes acceso a ningún centro comercial.</p>
        <a href="/org" className="text-sm text-primary underline">← Ir al panel residencial</a>
      </div>
    );
  }

  return (
    <ComercialContextProvider orgs={orgs}>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <ComercialSidebar userEmail={session.user.email ?? ""} isOrgAdmin={memberships.some((m) => isPlatform(m.role) || m.role === "ORG_ADMIN")} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-5xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </ComercialContextProvider>
  );
}
