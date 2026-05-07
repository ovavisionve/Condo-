import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { canManageOrganization, isPlatform } from "@/server/auth/permissions";
import { OrgContextProvider } from "./OrgContext";
import { AppSidebar } from "@/components/admin/AppSidebar";
import { OrgAiChat } from "@/components/OrgAiChat";
import { InactivityGuard } from "@/components/InactivityGuard";
import { db } from "@/server/db/client";

export default async function OrgLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const memberships = session.user.memberships ?? [];
  const isPlat = memberships.some((m) => isPlatform(m.role));
  const canManage = memberships.some((m) => canManageOrganization(m.role));
  if (!canManage) redirect("/");
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
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <AppSidebar userEmail={session.user.email ?? ""} isOrgAdmin={isOrgAdmin} />
        <main className="flex-1 overflow-y-auto min-w-0">
          {/* pt-16 on mobile gives room for the floating hamburger button */}
          <div className="pt-16 px-4 pb-6 md:pt-6 md:px-6 max-w-5xl mx-auto">
            {children}
          </div>
        </main>
      </div>
      <OrgAiChat />
      <InactivityGuard />
    </OrgContextProvider>
  );
}
