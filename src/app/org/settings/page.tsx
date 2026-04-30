"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OrgSettingsPage() {
  const organizationId = useOrgId();
  const { data: smtp, isLoading, refetch } = trpc.org.communities.getSmtp.useQuery({ organizationId });
  const setSmtpMut = trpc.org.communities.setSmtp.useMutation();

  const [host, setHost] = useState("smtp.gmail.com");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [secure, setSecure] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Pre-llenar cuando lleguen los datos
  useEffect(() => {
    if (smtp) {
      setHost(smtp.smtpHost ?? "smtp.gmail.com");
      setPort(String(smtp.smtpPort ?? 587));
      setUser(smtp.smtpUser ?? "");
      setFrom(smtp.smtpFrom ?? "");
      setSecure(smtp.smtpSecure ?? false);
      // No pre-llenamos la contraseña por seguridad
    }
  }, [smtp]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await setSmtpMut.mutateAsync({
        organizationId,
        smtpHost: host.trim(),
        smtpPort: Number(port),
        smtpUser: user.trim(),
        smtpPass: pass.trim() || undefined, // vacío = mantener contraseña actual en BD
        smtpFrom: from.trim() || user.trim(),
        smtpSecure: secure,
      });
      setMsg({ type: "success", text: "✓ Configuración guardada y verificada. Se envió un email de prueba a tu dirección." });
      setPass(""); // limpiar por seguridad
      void refetch();
    } catch (err: unknown) {
      setMsg({ type: "error", text: err instanceof Error ? err.message : "Error al guardar" });
    }
  };

  if (isLoading) return <p className="text-muted-foreground">Cargando...</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración de la organización</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configura el correo electrónico desde el que se envían las notificaciones a los residentes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            📧 Correo emisor (SMTP)
            {smtp?.configured && (
              <span className="text-xs font-normal text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Configurado</span>
            )}
          </CardTitle>
          <CardDescription>
            Usa un Gmail con <strong>Contraseña de aplicación</strong> (App Password). El correo ingresado recibe un mensaje de prueba al guardar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Guía Gmail */}
          <div className="mb-5 rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800 space-y-1">
            <p className="font-semibold">¿Cómo obtener una App Password de Gmail?</p>
            <ol className="list-decimal pl-4 space-y-0.5 text-xs">
              <li>Ve a <strong>myaccount.google.com → Seguridad</strong></li>
              <li>Activa la <strong>Verificación en 2 pasos</strong></li>
              <li>Ve a <strong>Contraseñas de aplicaciones</strong></li>
              <li>Nombre: "condominios" → Crear → Copia los <strong>16 caracteres</strong></li>
            </ol>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="smtp-user">Dirección Gmail</Label>
                <Input
                  id="smtp-user"
                  type="email"
                  placeholder="losarrayanes@gmail.com"
                  value={user}
                  onChange={(e) => {
                    setUser(e.target.value);
                    if (!from) setFrom(e.target.value);
                  }}
                  required
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="smtp-pass">
                  App Password (16 caracteres)
                  {smtp?.hasPass && <span className="ml-2 text-xs text-muted-foreground">— dejar vacío para mantener la actual</span>}
                </Label>
                <Input
                  id="smtp-pass"
                  type="password"
                  placeholder={smtp?.hasPass ? "••••••••••••••••" : "xxxx xxxx xxxx xxxx"}
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="smtp-from">Nombre del remitente (aparece en el email)</Label>
                <Input
                  id="smtp-from"
                  placeholder='Los Arrayanes <losarrayanes@gmail.com>'
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Si lo dejas vacío, se usa la dirección Gmail directamente.
                </p>
              </div>

              {/* Campos avanzados colapsados */}
              <details className="col-span-2">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Configuración avanzada (host, puerto)
                </summary>
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="space-y-1.5">
                    <Label>Servidor SMTP</Label>
                    <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Puerto</Label>
                    <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
                  </div>
                  <div className="flex items-center gap-2 col-span-2">
                    <input
                      type="checkbox"
                      id="smtp-secure"
                      checked={secure}
                      onChange={(e) => setSecure(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="smtp-secure" className="font-normal">Usar SSL/TLS (puerto 465)</Label>
                  </div>
                </div>
              </details>
            </div>

            {msg && (
              <div className={`rounded-md border px-3 py-2 text-sm ${
                msg.type === "success"
                  ? "border-green-300 bg-green-50 text-green-800"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}>
                {msg.text}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={setSmtpMut.isPending}>
                {setSmtpMut.isPending ? "Verificando y guardando..." : "Guardar y verificar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
