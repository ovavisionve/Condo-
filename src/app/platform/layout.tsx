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
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/platform" className="text-lg font-semibold">
              Condominios <span className="text-muted-foreground text-sm">/ Platform</span>
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/platform" className="hover:underline">Resumen</Link>
              <Link href="/platform/organizations" className="hover:underline">Organizaciones</Link>
              <Link href="/platform/plans" className="hover:underline">Planes</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
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
  );
}
