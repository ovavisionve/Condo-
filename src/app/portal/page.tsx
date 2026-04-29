import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth/config";
import { Button } from "@/components/ui/button";

export default async function ResidentPortal() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Portal del residente</h1>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button variant="outline" size="sm" type="submit">Salir</Button>
          </form>
        </div>
        <p className="text-muted-foreground">
          Hola {session.user.email}. Próximamente: facturas, pagos, tickets de mantenimiento, reservas.
        </p>
      </div>
    </div>
  );
}
