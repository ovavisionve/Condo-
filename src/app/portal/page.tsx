"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MONTHS_ES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT:   "bg-gray-100 text-gray-700",
  ISSUED:  "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID:    "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  VOIDED:  "bg-zinc-200 text-zinc-600 line-through",
};

// ──────────────────────────────────────────────────────────────────────────────
// Formulario de login para residentes
// ──────────────────────────────────────────────────────────────────────────────
function ResidentLoginForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Email o contraseña incorrectos. Si olvidaste tu contraseña, contacta a la administración.");
      return;
    }
    // Recargar la página para que getBySession lea la nueva sesión del cookie
    window.location.href = "/portal";
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>
          Ingresa el email y contraseña que te envió la administración.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Verificando..." : "Entrar al portal"}
          </Button>
          <Button variant="ghost" type="button" className="w-full text-xs" onClick={onBack}>
            ← Volver / solicitar enlace de acceso
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Formulario para solicitar acceso por magic link
// ──────────────────────────────────────────────────────────────────────────────
function RequestAccessForm({ onShowLogin }: { onShowLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const request = trpc.portal.requestAccess.useMutation();
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await request.mutateAsync({ email });
      setSent(true);
    } catch {
      setErr("Error al procesar la solicitud. Intenta de nuevo.");
    }
  };

  if (sent) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-green-700">✉️ Revisa tu correo</CardTitle>
          <CardDescription>
            Si tu email está registrado, recibirás un enlace de acceso en los próximos minutos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            El enlace es válido por 7 días. Revisa también tu carpeta de spam.
          </p>
          <Button variant="outline" className="mt-4 w-full" onClick={() => setSent(false)}>
            Usar otro email
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Portal del residente</CardTitle>
        <CardDescription>
          Si la administración te asignó una contraseña, usa el botón de abajo. Si no, ingresa tu email y te enviaremos un enlace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" onClick={onShowLogin}>
          🔑 Tengo usuario y contraseña
        </Button>
        <div className="relative flex items-center gap-2">
          <div className="flex-1 border-t" />
          <span className="text-xs text-muted-foreground">o</span>
          <div className="flex-1 border-t" />
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="email">Enviarme un enlace de acceso</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="tu@email.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" variant="outline" className="w-full" disabled={request.isPending}>
            {request.isPending ? "Enviando..." : "Enviar enlace de acceso"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Botón de descarga de PDF
// ──────────────────────────────────────────────────────────────────────────────
function PdfDownloadButton({ invoiceId, token }: { invoiceId: string; token?: string }) {
  const download = trpc.portal.downloadInvoicePdf.useMutation();
  const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
    setBusy(true);
    try {
      const result = await download.mutateAsync({ invoiceId, token });
      const byteCharacters = atob(result.base64);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Error al generar el PDF. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={busy}
      title="Descargar recibo PDF"
      className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap"
    >
      {busy ? "..." : "⬇ PDF"}
    </button>
  );
}

// Tipo compartido del dashboard (getByToken y getBySession devuelven la misma forma)
type PortalData = {
  person: {
    firstName: string; lastName: string; email: string | null;
    idType: string; idNumber: string; phone: string | null; whatsapp: string | null;
  };
  units: Array<{
    unitId: string; unitCode: string; communityName: string;
    communityAddress: string | null; role: "Propietario" | "Inquilino";
    invoices: Array<{
      id: string; invoiceNumber: string; type: string; typeLabel: string;
      periodYear: number | null; periodMonth: number | null;
      issuedAt: Date; dueDate: Date;
      totalUsd: string; paidUsd: string; pendingUsd: string;
      status: string; statusLabel: string;
    }>;
    payments: Array<{
      id: string; paidAt: Date; method: string; methodLabel: string;
      amountUsd: string; amountBss: string; reference: string | null; invoices: string[];
    }>;
    pendingUsd: string; pendingBsHoy: string;
  }>;
  todayRate: string;
  tokenExpiresAt: Date | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Dashboard del residente (token O sesión)
// ──────────────────────────────────────────────────────────────────────────────
function ResidentDashboardByToken({ token }: { token: string }) {
  const { data, isLoading, error } = trpc.portal.getByToken.useQuery({ token });
  return <ResidentDashboardView data={data as PortalData | undefined} isLoading={isLoading} error={error?.message} token={token} />;
}

function ResidentDashboardBySession() {
  // getBySession es publicProcedure: devuelve null si no hay sesión o el user no es residente
  const { data, isLoading } = trpc.portal.getBySession.useQuery();
  // null = sin sesión activa de residente → no renderizar (el padre ya maneja esto)
  if (!isLoading && !data) return null;
  return <ResidentDashboardView data={data as PortalData | undefined} isLoading={isLoading} />;
}

function ResidentDashboardView({
  data,
  isLoading,
  error,
  token,
}: {
  data: PortalData | undefined;
  isLoading: boolean;
  error?: string;
  token?: string;
}) {
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Cargando tu información...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-destructive">Sin acceso</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/portal">
              <Button className="w-full">Volver al portal</Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const totalPendingUsd = data.units.reduce((acc, u) => acc + Number(u.pendingUsd), 0);
  const totalPendingBs  = data.units.reduce((acc, u) => acc + Number(u.pendingBsHoy), 0);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Portal del Residente</h1>
            <p className="text-sm text-blue-200">{data.person.firstName} {data.person.lastName}</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-blue-300">Tasa BCV hoy</p>
              <p className="text-lg font-semibold">{Number(data.todayRate).toFixed(2)} Bs/$</p>
            </div>
            {/* Botón cerrar sesión (solo si acceso por sesión, no por token) */}
            {!token && (
              <a
                href="/api/auth/signout"
                className="text-xs text-blue-300 hover:text-white border border-blue-400 hover:border-white px-3 py-1.5 rounded transition-colors"
              >
                Cerrar sesión
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        {/* Resumen general */}
        <div className="grid grid-cols-2 gap-4">
          <Card className={totalPendingUsd > 0.005 ? "border-destructive/40 bg-destructive/5" : "border-green-200 bg-green-50"}>
            <CardHeader className="pb-2">
              <CardDescription>Saldo pendiente (USD)</CardDescription>
              <CardTitle className={`text-2xl ${totalPendingUsd > 0.005 ? "text-destructive" : "text-green-700"}`}>
                ${totalPendingUsd.toFixed(2)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Monto fijo en dólares</p>
            </CardContent>
          </Card>
          <Card className={totalPendingUsd > 0.005 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}>
            <CardHeader className="pb-2">
              <CardDescription>Equivalente en Bolívares hoy</CardDescription>
              <CardTitle className={`text-2xl ${totalPendingUsd > 0.005 ? "text-amber-700" : "text-green-700"}`}>
                Bs {totalPendingBs.toLocaleString("es-VE", { maximumFractionDigits: 2 })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Al cambio de hoy: {Number(data.todayRate).toFixed(2)} Bs por $. Cambia diariamente.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Por cada unidad */}
        {data.units.map((unit) => (
          <div key={unit.unitId} className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {unit.communityName} · Unidad {unit.unitCode} · {unit.role}
              </h2>
              <div className="h-px flex-1 bg-border" />
            </div>

            {Number(unit.pendingUsd) > 0.005 ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-destructive">Saldo pendiente</p>
                  <p className="text-xs text-muted-foreground">
                    Bs equivalente al cambio de hoy ({Number(data.todayRate).toFixed(2)} Bs/$)
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-destructive">${Number(unit.pendingUsd).toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">
                    Bs {Number(unit.pendingBsHoy).toLocaleString("es-VE", { maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <p className="text-sm font-medium text-green-700">✓ Solvente — sin deuda pendiente</p>
              </div>
            )}

            {/* Facturas */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Facturas</h3>
              <div className="overflow-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2"># Factura</th>
                      <th className="px-3 py-2">Período</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2 text-right">Total $</th>
                      <th className="px-3 py-2 text-right">Pagado $</th>
                      <th className="px-3 py-2 text-right">Pendiente $</th>
                      <th className="px-3 py-2 text-right">Bs hoy</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Vence</th>
                      <th className="px-3 py-2">Recibo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unit.invoices.map((inv) => {
                      const pendingBsHoy = Number(inv.pendingUsd) * Number(data.todayRate);
                      return (
                        <tr key={inv.id} className="border-t">
                          <td className="px-3 py-2 font-medium text-xs">{inv.invoiceNumber}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {MONTHS_ES[(inv.periodMonth ?? 1) - 1]} {inv.periodYear}
                          </td>
                          <td className="px-3 py-2 text-xs">{inv.typeLabel}</td>
                          <td className="px-3 py-2 text-right">${Number(inv.totalUsd).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-green-700">${Number(inv.paidUsd).toFixed(2)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${Number(inv.pendingUsd) > 0.005 ? "text-destructive" : "text-green-600"}`}>
                            ${Number(inv.pendingUsd).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {Number(inv.pendingUsd) > 0.005
                              ? `Bs ${pendingBsHoy.toLocaleString("es-VE", { maximumFractionDigits: 2 })}`
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100"}`}>
                              {inv.statusLabel}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {new Date(inv.dueDate).toLocaleDateString("es-VE")}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <PdfDownloadButton invoiceId={inv.id} token={token} />
                          </td>
                        </tr>
                      );
                    })}
                    {unit.invoices.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Sin facturas</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagos */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Historial de pagos</h3>
              <div className="overflow-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Método</th>
                      <th className="px-3 py-2">Referencia</th>
                      <th className="px-3 py-2 text-right">USD</th>
                      <th className="px-3 py-2 text-right">Bs pagados</th>
                      <th className="px-3 py-2">Aplicado a</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unit.payments.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                        <td className="px-3 py-2 text-xs">{p.methodLabel}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{p.reference ?? "—"}</td>
                        <td className="px-3 py-2 text-right">${Number(p.amountUsd).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          Bs {Number(p.amountBss).toLocaleString("es-VE", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {p.invoices.length > 0
                            ? p.invoices.join(", ")
                            : <span className="text-amber-700">anticipo</span>}
                        </td>
                      </tr>
                    ))}
                    {unit.payments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Sin pagos registrados</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}

        {/* Nota sobre el tipo de cambio */}
        <div className="rounded-lg border bg-blue-50 border-blue-200 px-4 py-3">
          <p className="text-xs text-blue-700">
            ℹ️ <strong>Sobre el tipo de cambio:</strong> El saldo en USD es fijo. El equivalente en Bolívares
            se actualiza diariamente con la tasa oficial del BCV ({Number(data.todayRate).toFixed(2)} Bs/$
            al {new Date().toLocaleDateString("es-VE")}). El monto en Bs que ves hoy puede ser diferente mañana.
          </p>
        </div>

        {/* Datos personales */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mis datos registrados</CardTitle>
            <CardDescription>Si hay algún error, comunícate con la administración.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Nombre</p>
              <p>{data.person.firstName} {data.person.lastName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Identificación</p>
              <p>{data.person.idType}: {data.person.idNumber}</p>
            </div>
            {data.person.email && (
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p>{data.person.email}</p>
              </div>
            )}
            {data.person.phone && (
              <div>
                <p className="text-xs text-muted-foreground">Teléfono</p>
                <p>{data.person.phone}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Componente raíz
// ──────────────────────────────────────────────────────────────────────────────
function PortalContent() {
  const params = useSearchParams();
  const token = params.get("t");
  const [showLogin, setShowLogin] = useState(false);

  // getBySession: null = sin sesión/no residente, data = residente autenticado
  const { data: sessionData, isLoading: sessionLoading } = trpc.portal.getBySession.useQuery(
    undefined,
    { retry: false }, // no reintentar si falla
  );

  // 1. Token mágico en URL → modo legacy (sin verificar sesión)
  if (token) return <ResidentDashboardByToken token={token} />;

  // 2. Cargando sesión
  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  // 3. Hay sesión de residente activa → mostrar dashboard
  if (sessionData) {
    return <ResidentDashboardView data={sessionData as PortalData} isLoading={false} />;
  }

  // 4. Sin sesión → formulario de acceso
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Portal del Residente</h1>
          <p className="text-sm text-muted-foreground mt-1">Consulta tu saldo y facturas en línea</p>
        </div>
        {showLogin
          ? <ResidentLoginForm onBack={() => setShowLogin(false)} />
          : <RequestAccessForm onShowLogin={() => setShowLogin(true)} />
        }
      </div>
    </div>
  );
}

export default function PortalPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    }>
      <PortalContent />
    </Suspense>
  );
}
