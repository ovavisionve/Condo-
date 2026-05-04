import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { isPlatform, canManageOrganization } from "@/server/auth/permissions";
import { db } from "@/server/db/client";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const memberships = session.user.memberships ?? [];
  if (memberships.some((m) => isPlatform(m.role))) redirect("/platform");

  if (memberships.some((m) => canManageOrganization(m.role))) {
    // Verificar si el usuario pertenece a una org COMMERCIAL
    const orgIds = memberships
      .filter((m) => m.organizationId)
      .map((m) => m.organizationId!);

    if (orgIds.length > 0) {
      const orgs = await db.organization.findMany({
        where: { id: { in: orgIds }, deletedAt: null, active: true },
        select: { id: true, type: true },
      });

      const hasResidential = orgs.some((o) => o.type === "RESIDENTIAL");
      const hasCommercial = orgs.some((o) => o.type === "COMMERCIAL");

      // Si solo tiene comerciales → directo al módulo comercial
      if (hasCommercial && !hasResidential) redirect("/comercial");
    }

    redirect("/org");
  }

  redirect("/portal");
}
