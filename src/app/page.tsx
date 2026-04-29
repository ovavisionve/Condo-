import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { isPlatform, canManageOrganization } from "@/server/auth/permissions";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const memberships = session.user.memberships ?? [];
  if (memberships.some((m) => isPlatform(m.role))) redirect("/platform");
  if (memberships.some((m) => canManageOrganization(m.role))) redirect("/org");
  redirect("/portal");
}
