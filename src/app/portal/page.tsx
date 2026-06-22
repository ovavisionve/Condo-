"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import QRCode from "react-qr-code";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from "recharts";

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

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador", ISSUED: "Emitida", PARTIAL: "Pago parcial",
  PAID: "Pagada", OVERDUE: "Vencida", VOIDED: "Anulada",
};

const PIE_COLORS = ["#a8d5c2", "#1e7a5f", "#f59e0b", "#f97316", "#6b7280", "#dc2626"];

// ─── TIPOS ────────────────────────────────────────────────────────────────────
type InvoiceItem = {
  id: string; invoiceNumber: string; type: string; typeLabel: string;
  periodYear: number | null; periodMonth: number | null;
  issuedAt: Date; dueDate: Date;
  totalUsd: string; totalBss: string; paidUsd: string;
  pendingUsd: string; status: string; statusLabel: string;
};
type PendingInvoiceItem = {
  id: string; invoiceNumber: string;
  periodYear: number | null; periodMonth: number | null;
  issuedAt: Date; dueDate: Date; typeLabel: string;
  pendingUsd: string; daysOverdue: number; monthsOverdue: number; status: string;
};
type PaymentItem = {
  id: string; paidAt: Date; method: string; methodLabel: string;
  amountUsd: string; amountBss: string; reference: string | null; notes: string | null;
  invoices: string[]; isHistorical: boolean;
  saldoAnteriorUsd: string | null; quedaPendienteUsd: string | null;
};
type UnitData = {
  unitId: string; unitCode: string; communityId: string;
  communityName: string; communityAddress: string | null;
  role: "Propietario" | "Inquilino";
  invoices: InvoiceItem[];
  pendingInvoices: PendingInvoiceItem[];
  payments: PaymentItem[];
  pendingUsd: string; pendingBsHoy: string;
  creditAvailableUsd: string;
  lastInvoice: { id: string; totalUsd: string; totalBss: string; periodYear: number | null; periodMonth: number | null } | null;
  lastPayment: { amountUsd: string; amountBss: string; paidAt: Date } | null;
  agingBuckets: { label: string; usd: number }[];
  monthlyPaymentTotals: { yearMonth: string; label: string; totalUsd: number }[];
};
type PortalData = {
  person: { firstName: string; lastName: string; email: string | null; idType: string; idNumber: string; phone: string | null; whatsapp: string | null; portalConfirmedAt: Date | string | null; hasPassword: boolean };
  units: UnitData[];
  todayRate: string;
  tokenExpiresAt: Date | null;
};

// ─── AUTH FORMS ───────────────────────────────────────────────────────────────
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
    if (res?.error) { setError("Email o contraseña incorrectos."); return; }
    window.location.href = "/portal";
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Ingresa el email y contraseña que te envió la Junta de Condominio.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div><Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>{loading ? "Verificando..." : "Entrar al portal"}</Button>
          <Button variant="ghost" type="button" className="w-full text-xs" onClick={onBack}>← Volver</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RequestAccessForm({ onShowLogin }: { onShowLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const request = trpc.portal.requestAccess.useMutation();
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try { await request.mutateAsync({ email }); setSent(true); }
    catch { setErr("Error al procesar la solicitud."); }
  };

  if (sent) return (
    <Card className="w-full max-w-sm">
      <CardHeader><CardTitle className="text-green-700">✉️ Revisa tu correo</CardTitle>
        <CardDescription>Si tu email está registrado, recibirás un enlace de acceso en los próximos minutos.</CardDescription></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">El enlace es válido por 7 días. Revisa también tu carpeta de spam.</p>
        <Button variant="outline" className="mt-4 w-full" onClick={() => setSent(false)}>Usar otro email</Button>
      </CardContent>
    </Card>
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader><CardTitle>Portal del Propietario</CardTitle>
        <CardDescription>Si la Junta de Condominio te asignó contraseña úsala abajo. Si no, envíate un enlace de acceso.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" onClick={onShowLogin}>🔑 Tengo usuario y contraseña</Button>
        <div className="relative flex items-center gap-2"><div className="flex-1 border-t" /><span className="text-xs text-muted-foreground">o</span><div className="flex-1 border-t" /></div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div><Label htmlFor="email">Enviarme un enlace de acceso</Label>
            <Input id="email" type="email" autoComplete="email" placeholder="tu@email.com" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" variant="outline" className="w-full" disabled={request.isPending}>{request.isPending ? "Enviando..." : "Enviar enlace de acceso"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── PDF DOWNLOAD ─────────────────────────────────────────────────────────────
function PdfDownloadButton({ invoiceId, token }: { invoiceId: string; token?: string }) {
  const download = trpc.portal.downloadInvoicePdf.useMutation();
  const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
    setBusy(true);
    try {
      const result = await download.mutateAsync({ invoiceId, token });
      const byteCharacters = atob(result.base64);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteArray[i] = byteCharacters.charCodeAt(i);
      const blob = new Blob([byteArray], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = result.fileName; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Error al generar el PDF."); }
    finally { setBusy(false); }
  };

  return (
    <button onClick={handleDownload} disabled={busy} title="Descargar recibo PDF"
      className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap">
      {busy ? "..." : "⬇ PDF"}
    </button>
  );
}

// ─── AVISO DE COBRO MODAL ─────────────────────────────────────────────────────
function AvisoCobro({ invoiceId, token, onClose }: { invoiceId: string; token?: string; onClose: () => void }) {
  const { data, isLoading } = trpc.portal.getInvoiceDetail.useQuery({ invoiceId, token });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-2 py-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <span className="font-semibold text-[#1e3a5f]">Aviso de cobro</span>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="rounded border px-3 py-1 text-sm hover:bg-muted">🖨️ Imprimir</button>
            <button onClick={onClose} className="rounded border px-3 py-1 text-sm hover:bg-muted">✕ Cerrar</button>
          </div>
        </div>
        {isLoading && <div className="py-12 text-center text-muted-foreground">Cargando aviso de cobro…</div>}
        {data && <AvisoCobroContent data={data} />}
      </div>
    </div>
  );
}

type InvoiceDetailData = {
  communityName: string; communityAddress: string | null;
  communityRif: string | null; communityPhone: string | null; communityEmail: string | null;
  /** Single invoice (legacy getInvoiceDetail) */
  invoiceNumber?: string;
  /** Multi-invoice combined (getInvoicesByMonth) */
  invoiceNumbers?: string[];
  primaryInvoiceId?: string;
  periodYear: number | null; periodMonth: number | null;
  issuedAt: Date; dueDate: Date; status: string;
  unitCode: string; unitFloor: number | null; unitTower: string | null; aliquot: string;
  ownerName: string | null; ownerIdNumber: string | null;
  exchangeRate: string; exchangeSource: string;
  items: { invoiceNumber?: string; description: string; aliquot: string | null; amountUsd: string; amountBss: string }[];
  totalUsd: string; totalBss: string; paidUsd: string; paidBss: string;
  prevDebtUsd: string; thisPendingUsd: string; totalToPayUsd: string; totalToPayBss: string;
};

function AvisoCobroContent({ data }: { data: InvoiceDetailData }) {
  return (
    <div className="p-5 space-y-4 text-sm print:p-2">
      <div className="text-center">
        <p className="font-bold text-base uppercase tracking-wide text-[#1e3a5f]">JUNTA DE CONDOMINIO {data.communityName.toUpperCase()}</p>
        {data.communityRif && <p className="text-xs text-muted-foreground">R.I.F.: {data.communityRif}</p>}
        {data.communityAddress && <p className="text-xs text-muted-foreground">{data.communityAddress}</p>}
      </div>
      {/* Número(s) de aviso */}
      <div className="text-center text-base font-bold text-[#1e3a5f]">
        {data.invoiceNumbers && data.invoiceNumbers.length > 1
          ? `Avisos de Cobro: ${data.invoiceNumbers.join(" · ")}`
          : `Aviso de Cobro Nro. ${data.invoiceNumbers?.[0] ?? data.invoiceNumber}`}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        {/* Izquierda: ítems */}
        <div>
          <div className="grid grid-cols-2 mb-2 gap-2">
            <div className="rounded border">
              <div className="bg-[#1e3a5f] px-3 py-1 text-center text-xs font-semibold text-white uppercase">Condominio</div>
              <div className="px-3 py-2 text-center font-medium">{data.communityName}</div>
            </div>
            <div className="rounded border">
              <div className="bg-[#1e3a5f] px-3 py-1 text-center text-xs font-semibold text-white uppercase">Unidad</div>
              <div className="px-3 py-2 text-center font-medium text-xs">
                {data.ownerName ? `${data.ownerName} | ` : ""}{data.unitCode}
                {data.unitTower && ` · Torre ${data.unitTower}`}
                {data.unitFloor != null && ` · Piso ${data.unitFloor}`}
              </div>
            </div>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                <th className="px-3 py-1.5 text-left font-semibold">GASTOS COMUNES</th>
                <th className="px-3 py-1.5 text-right font-semibold">BS.</th>
                <th className="px-3 py-1.5 text-right font-semibold">CUOTA</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Si hay múltiples recibos, agrupar con separadores por número de factura
                const multiInvoice = data.invoiceNumbers && data.invoiceNumbers.length > 1;
                const rows: React.ReactNode[] = [];
                let lastInvoiceNum = "";
                data.items.forEach((item, i) => {
                  if (multiInvoice && item.invoiceNumber && item.invoiceNumber !== lastInvoiceNum) {
                    lastInvoiceNum = item.invoiceNumber;
                    rows.push(
                      <tr key={`sep-${i}`} className="bg-[#1e3a5f]/5">
                        <td colSpan={3} className="px-3 py-0.5 text-[10px] font-medium text-[#1e3a5f]/60 italic">
                          Recibo {item.invoiceNumber}
                        </td>
                      </tr>
                    );
                  }
                  rows.push(
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-1 border-b border-slate-100">{item.description}</td>
                      <td className="px-3 py-1 border-b border-slate-100 text-right">
                        {Number(item.amountBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-1 border-b border-slate-100 text-right text-muted-foreground">
                        {item.aliquot ? `${Number(item.aliquot).toFixed(4)}%` : "—"}
                      </td>
                    </tr>
                  );
                });
                return rows;
              })()}
              {data.items.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-3 text-center text-muted-foreground italic">Sin ítems registrados</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-[#1e3a5f]/10 font-semibold">
                <td className="px-3 py-1.5">TOTAL</td>
                <td className="px-3 py-1.5 text-right">
                  {Number(data.totalBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {data.aliquot ? `${Number(data.aliquot).toFixed(4)}%` : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Derecha: resumen */}
        <div className="w-full lg:w-72 space-y-3 shrink-0">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                <th className="px-2 py-1 font-semibold">MES</th>
                <th className="px-2 py-1 font-semibold">FECHA</th>
                <th className="px-2 py-1 font-semibold">PERÍODO</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-center">
                <td className="border px-2 py-1">{data.periodMonth && data.periodYear ? `${String(data.periodMonth).padStart(2,"0")}/${data.periodYear}` : "—"}</td>
                <td className="border px-2 py-1">{new Date(data.issuedAt).toLocaleDateString("es-VE")}</td>
                <td className="border px-2 py-1 text-xs">{data.periodMonth && data.periodYear ? `${MONTHS_ES[data.periodMonth - 1]} ${data.periodYear}` : "—"}</td>
              </tr>
            </tbody>
          </table>

          <div className="rounded border overflow-hidden">
            <div className="bg-[#1e3a5f] px-3 py-1 text-center text-xs font-semibold text-white uppercase">Total del mes</div>
            <div className="grid grid-cols-2 divide-x text-center">
              <div className="px-3 py-2">
                <p className="text-xs text-muted-foreground">US$</p>
                <p className="font-bold text-[#1e3a5f]">{Number(data.totalUsd).toFixed(2)}</p>
              </div>
              <div className="px-3 py-2">
                <p className="text-xs text-muted-foreground">BS.</p>
                <p className="font-bold">{Number(data.totalBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>

          <div className="rounded border overflow-hidden">
            <div className="bg-slate-100 px-3 py-1 text-center text-xs font-semibold uppercase text-slate-600">Tasa de cambio ({data.exchangeSource})</div>
            <div className="px-3 py-2 text-center">
              <p className="font-bold text-[#1e3a5f]">BS. {Number(data.exchangeRate).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="text-xs text-muted-foreground">por 1 USD</p>
            </div>
          </div>

          <div className="rounded border overflow-hidden">
            <div className="bg-[#1e3a5f] px-3 py-1 text-center text-xs font-semibold text-white uppercase">Total a pagar</div>
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b">
                  <td className="px-3 py-1 text-muted-foreground">Total del mes</td>
                  <td className="px-3 py-1 text-right font-medium">${Number(data.totalUsd).toFixed(2)}</td>
                  <td className="px-3 py-1 text-right text-muted-foreground">{Number(data.totalBss).toLocaleString("es-VE", { maximumFractionDigits: 0 })}</td>
                </tr>
                {Number(data.paidUsd) > 0 && (
                  <tr className="border-b">
                    <td className="px-3 py-1 text-green-700">Pagado</td>
                    <td className="px-3 py-1 text-right font-medium text-green-700">−${Number(data.paidUsd).toFixed(2)}</td>
                    <td className="px-3 py-1 text-right text-green-700">{Number(data.paidBss).toLocaleString("es-VE", { maximumFractionDigits: 0 })}</td>
                  </tr>
                )}
                {Number(data.prevDebtUsd) > 0 && (
                  <tr className="border-b">
                    <td className="px-3 py-1 text-amber-700">Pendiente anterior</td>
                    <td className="px-3 py-1 text-right font-medium text-amber-700">+${Number(data.prevDebtUsd).toFixed(2)}</td>
                    <td className="px-3 py-1 text-right text-amber-700">—</td>
                  </tr>
                )}
                <tr className="bg-[#1e3a5f]/10 font-bold">
                  <td className="px-3 py-2">TOTAL</td>
                  <td className="px-3 py-2 text-right text-[#1e3a5f]">${Number(data.totalToPayUsd).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-[#1e3a5f]">{Number(data.totalToPayBss).toLocaleString("es-VE", { maximumFractionDigits: 0 })}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded border px-3 py-2 text-center text-xs">
            <span className="text-muted-foreground">Estado: </span>
            <span className={`font-semibold ${data.status === "PAID" ? "text-green-700" : data.status === "OVERDUE" ? "text-red-600" : data.status === "PARTIAL" ? "text-amber-700" : "text-blue-700"}`}>
              {STATUS_LABELS[data.status] ?? data.status}
            </span>
            <span className="ml-3 text-muted-foreground">Vence: </span>
            <span className="font-medium">{new Date(data.dueDate).toLocaleDateString("es-VE")}</span>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground pt-2 border-t">
        {data.communityName}{data.communityPhone ? ` · Tel: ${data.communityPhone}` : ""}{data.communityEmail ? ` · ${data.communityEmail}` : ""}
      </p>
    </div>
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = [
  { key: "principal",  label: "Principal" },
  { key: "pendientes", label: "Pendientes" },
  { key: "pagos",      label: "Pagos" },
  { key: "aviso",      label: "Aviso de cobro" },
  { key: "notificar",  label: "Notificar pago" },
  { key: "deuda",      label: "Deuda general" },
  { key: "reservas",   label: "🏊 Reservas" },
  { key: "seguridad",  label: "🔐 Visitantes" },
] as const;
type TabKey = typeof TABS[number]["key"];

// ─── TARJETA: crear/cambiar contraseña propia ─────────────────────────────────
// Acceso híbrido: el residente entra la 1ª vez con el enlace mágico y acá crea
// su propia clave para entrar con email+contraseña la próxima vez. Nunca se
// envía una clave por correo.
function AccessPasswordCard({ token, email, hasPassword }: { token?: string; email: string | null; hasPassword: boolean }) {
  const [open, setOpen] = useState(!hasPassword);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setPassword = trpc.portal.setOwnPassword.useMutation();

  if (!email) return null; // sin email no se puede crear cuenta

  const ok = pw.length >= 8 && pw === pw2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) { setError(pw.length < 8 ? "La contraseña debe tener al menos 8 caracteres." : "Las contraseñas no coinciden."); return; }
    setError(null);
    try {
      await setPassword.mutateAsync({ token, password: pw });
      setDone(true);
      setPw(""); setPw2("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la contraseña.");
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        ✅ <strong>Contraseña guardada.</strong> La próxima vez entrá en el portal con <strong>"🔑 Tengo usuario y contraseña"</strong> usando tu email <strong>{email}</strong> y esta clave — sin esperar el enlace.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-[#1e3a5f]">🔒 {hasPassword ? "Cambiar mi contraseña" : "Crear una contraseña"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasPassword
              ? "Ya podés entrar con tu email y contraseña. Acá la podés cambiar."
              : "Creá una clave para entrar con tu email la próxima vez, sin esperar el enlace por correo."}
          </p>
        </div>
        {hasPassword && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-blue-700 hover:underline whitespace-nowrap">
            {open ? "Cerrar" : "Cambiar"}
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <div className="text-xs text-muted-foreground">Usuario: <strong>{email}</strong></div>
          <input
            type="password" autoComplete="new-password" placeholder="Nueva contraseña (mín. 8)"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={pw} onChange={(e) => setPw(e.target.value)}
          />
          <input
            type="password" autoComplete="new-password" placeholder="Repetí la contraseña"
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={pw2} onChange={(e) => setPw2(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit" disabled={!ok || setPassword.isPending}
            className="h-10 px-4 rounded-md bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#15294a] disabled:opacity-50"
          >
            {setPassword.isPending ? "Guardando..." : hasPassword ? "Guardar nueva contraseña" : "Crear contraseña"}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── PRINCIPAL TAB ────────────────────────────────────────────────────────────
function PrincipalTab({ unit, todayRate, onTab }: { unit: UnitData; todayRate: string; onTab: (t: TabKey) => void }) {
  const pendingBs = Number(unit.pendingBsHoy);
  const pendingUsd = Number(unit.pendingUsd);
  const creditUsd = Number(unit.creditAvailableUsd ?? 0);
  const lastInv = unit.lastInvoice;
  const lastPay = unit.lastPayment;

  return (
    <div className="space-y-6">
      {/* Hero deuda */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 border px-8 py-10 text-center space-y-2">
        <p className="text-lg font-medium text-slate-500">Deuda neta</p>
        <p className={`text-5xl font-bold tracking-tight ${pendingBs > 0 ? "text-slate-800" : "text-green-700"}`}>
          {pendingBs > 0
            ? `Bs. ${pendingBs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "Bs. 0,00"}
        </p>
        {creditUsd > 0 && (
          <p className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-4 py-1 inline-block">
            💰 Anticipo disponible: US$ {creditUsd.toFixed(2)} (ya descontado de tu deuda)
          </p>
        )}
        <div className="pt-2">
          <Button
            className="bg-[#1e7a5f] hover:bg-[#15604a] text-white px-8 py-2.5 rounded-full text-base font-semibold"
            onClick={() => onTab("notificar")}
          >
            Notificar Pago
          </Button>
        </div>
        <p className={`text-lg font-semibold ${pendingUsd > 0 ? "text-[#1e7a5f]" : "text-green-700"}`}>
          Deuda neta en US$: {pendingUsd.toFixed(2)}
        </p>
        <p className="text-xs text-slate-500">
          Calculado a la tasa BCV del día: {new Date().toLocaleDateString("es-VE")} / Bs. {Number(todayRate).toFixed(8)}
        </p>
      </div>

      {/* Último mes + Último pago */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {lastInv && (
          <div className="rounded-xl border bg-white px-6 py-5 text-center space-y-1 shadow-sm">
            <p className="text-sm text-muted-foreground font-medium">Ultimo mes</p>
            <p className="text-3xl font-bold text-slate-800">
              Bs. {(Number(lastInv.totalBss) * Number(todayRate) / Number(todayRate)).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-sm font-medium text-[#1e7a5f]">
              US$ {Number(lastInv.totalUsd).toFixed(2)}
            </p>
            {lastInv.periodMonth && lastInv.periodYear && (
              <p className="text-sm font-semibold text-[#1e7a5f]">
                {MONTHS_ES[lastInv.periodMonth - 1]} / {lastInv.periodYear}
              </p>
            )}
            <button
              className="mt-2 text-xs border border-[#1e7a5f] text-[#1e7a5f] px-4 py-1.5 rounded hover:bg-[#1e7a5f] hover:text-white transition-colors"
              onClick={() => onTab("aviso")}
            >
              Ver recibo
            </button>
          </div>
        )}
        {lastPay && (
          <div className="rounded-xl border bg-white px-6 py-5 text-center space-y-1 shadow-sm">
            <p className="text-sm text-muted-foreground font-medium">Ultimo pago</p>
            <p className="text-3xl font-bold text-slate-800">
              Bs. {Number(lastPay.amountBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-sm font-medium text-[#1e7a5f]">US$ {Number(lastPay.amountUsd).toFixed(2)}</p>
            <p className="text-sm font-semibold text-[#1e7a5f]">{new Date(lastPay.paidAt).toLocaleDateString("es-VE")}</p>
            <button
              className="mt-2 text-xs border border-[#1e7a5f] text-[#1e7a5f] px-4 py-1.5 rounded hover:bg-[#1e7a5f] hover:text-white transition-colors"
              onClick={() => onTab("pagos")}
            >
              Ver pagos
            </button>
          </div>
        )}
        {!lastInv && !lastPay && (
          <div className="col-span-2 rounded-xl border bg-white px-6 py-8 text-center text-muted-foreground">
            Sin movimientos registrados aún.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PENDIENTES TAB ───────────────────────────────────────────────────────────
function PendientesTab({ unit, todayRate }: { unit: UnitData; todayRate: string }) {
  const creditUsd = Number(unit.creditAvailableUsd ?? 0);
  const grossPendingUsd = unit.pendingInvoices.reduce((acc, inv) => acc + Number(inv.pendingUsd), 0);
  const totalPendingUsd = Number(unit.pendingUsd);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Pendientes</h2>
        <div className="mt-1 h-0.5 w-16 bg-[#1e7a5f]" />
        <p className="text-sm text-[#1e7a5f] mt-1">Agrupado por cantidad de días.</p>
      </div>

      {/* Aging bar chart */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={unit.agingBuckets} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}`} />
            <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, "Pendiente"]} />
            <Bar dataKey="usd" fill="#a8d5c2" radius={[4, 4, 0, 0]} name="Pendiente" />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-1">
          <span className="font-semibold">Gráfico de análisis de vencimientos:</span> Se muestran los montos vencidos agrupados por la cantidad de días de vencimiento.
        </p>
      </div>

      {/* Tabla cuotas pendientes */}
      <div>
        <h3 className="text-xl font-bold">Cuotas Pendientes</h3>
        <p className="text-sm text-[#1e7a5f]">Expresado en US$</p>
        <div className="text-right text-sm mb-2 space-y-0.5">
          {creditUsd > 0 && (
            <>
              <div><span className="text-muted-foreground">Deuda bruta: </span><span className="font-medium">US$ {grossPendingUsd.toFixed(2)}</span></div>
              <div><span className="text-amber-700">Anticipo disponible: </span><span className="font-medium text-amber-700">- US$ {creditUsd.toFixed(2)}</span></div>
            </>
          )}
          <div>
            <span className="text-muted-foreground">Deuda neta: </span>
            <span className="font-semibold">US$ {totalPendingUsd.toFixed(2)}</span>
          </div>
        </div>
        <div className="overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1e3a5f] text-white text-left">
                <th className="px-4 py-2 font-semibold">Mes</th>
                <th className="px-4 py-2 font-semibold">Descripción</th>
                <th className="px-4 py-2 font-semibold text-right">Pendiente</th>
                <th className="px-4 py-2 font-semibold text-right">Meses Vencida</th>
                <th className="px-4 py-2 font-semibold text-right">Total Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {unit.pendingInvoices.map((inv, i) => (
                <tr key={inv.id} className={`border-t ${i % 2 === 0 ? "" : "bg-slate-50"}`}>
                  <td className="px-4 py-2 text-muted-foreground">
                    {inv.periodMonth && inv.periodYear
                      ? `${String(inv.periodMonth).padStart(2,"0")}/${inv.periodYear}`
                      : new Date(inv.issuedAt).toLocaleDateString("es-VE")}
                  </td>
                  <td className="px-4 py-2">{inv.typeLabel}</td>
                  <td className="px-4 py-2 text-right font-medium">{Number(inv.pendingUsd).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{inv.monthsOverdue}</td>
                  <td className="px-4 py-2 text-right font-semibold">{Number(inv.pendingUsd).toFixed(2)}</td>
                </tr>
              ))}
              {creditUsd > 0 && (
                <tr className="border-t bg-amber-50">
                  <td className="px-4 py-2 text-amber-700 font-medium" colSpan={2}>💰 Anticipo disponible (no aplicado a Recibo de Condominio)</td>
                  <td className="px-4 py-2 text-right text-amber-700 font-semibold">-{creditUsd.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right text-amber-700">—</td>
                  <td className="px-4 py-2 text-right text-amber-700 font-semibold">-{creditUsd.toFixed(2)}</td>
                </tr>
              )}
              {unit.pendingInvoices.length === 0 && creditUsd === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-green-700 font-medium">✓ Sin cuotas pendientes</td></tr>
              )}
              {unit.pendingInvoices.length > 0 || creditUsd > 0 ? (
                <tr className="border-t bg-[#1e3a5f]/5 font-bold">
                  <td colSpan={2} className="px-4 py-2 text-right text-sm">Deuda neta total:</td>
                  <td colSpan={3} className="px-4 py-2 text-right text-[#1e3a5f]">US$ {totalPendingUsd.toFixed(2)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota */}
      <p className="text-xs text-muted-foreground border rounded px-3 py-2 bg-slate-50">
        Los montos en bolívares se calculan al tipo de cambio BCV de hoy: {Number(todayRate).toFixed(2)} Bs/$
      </p>
    </div>
  );
}

// ─── PAGOS TAB ────────────────────────────────────────────────────────────────
function DownloadBaucheButton({ paymentId, token }: { paymentId: string; token?: string }) {
  const dl = trpc.portal.downloadPaymentVoucher.useMutation();
  const [state, setState] = useState<"idle"|"loading"|"ok"|"err">("idle");

  const handleDownload = async () => {
    setState("loading");
    try {
      const res = await dl.mutateAsync({ paymentId, token });
      const link = document.createElement("a");
      link.href = `data:${res.mimeType};base64,${res.base64}`;
      link.download = res.fileName;
      link.click();
      setState("ok");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("err");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={state === "loading"}
      className="rounded border px-2 py-0.5 text-xs text-[#1e7a5f] border-[#1e7a5f] hover:bg-[#e8f5f0] transition-colors disabled:opacity-50"
      title="Descargar comprobante de pago"
    >
      {state === "loading" ? "⏳" : state === "ok" ? "✅" : state === "err" ? "❌" : "⬇️ Bauche"}
    </button>
  );
}

function PagosTab({ unit, token }: { unit: UnitData; token?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Pagos de los Últimos 6 Meses</h2>
        <div className="mt-1 h-0.5 w-16 bg-[#1e7a5f]" />
        <p className="text-sm text-[#1e7a5f] mt-1">Agrupado por mes.</p>
      </div>

      {/* Area chart */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={unit.monthlyPaymentTotals} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="colorPago" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1e7a5f" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#1e7a5f" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}`} />
            <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, "Pagado"]} />
            <Area type="monotone" dataKey="totalUsd" stroke="#1e7a5f" strokeWidth={2}
              fill="url(#colorPago)" name="Pagado" />
          </AreaChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-1">
          <span className="font-semibold">Gráfico de pagos:</span> Muestra una relación de los pagos realizados en los últimos 6 meses.
        </p>
      </div>

      {/* Tabla pagos */}
      <div>
        <h3 className="text-xl font-bold">Últimos Pagos Realizados</h3>
        <p className="text-sm text-[#1e7a5f]">Expresado en US$</p>
        <div className="mt-2 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1e3a5f] text-white text-left">
                <th className="px-4 py-2 font-semibold">Fecha</th>
                <th className="px-4 py-2 font-semibold">Referencia</th>
                <th className="px-4 py-2 font-semibold">Notas</th>
                <th className="px-4 py-2 font-semibold text-right">Saldo anterior</th>
                <th className="px-4 py-2 font-semibold text-right">Pagado</th>
                <th className="px-4 py-2 font-semibold text-right">Queda pendiente</th>
                <th className="px-4 py-2 font-semibold text-center">Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {unit.payments.map((p, i) => (
                <tr key={p.id} className={`border-t ${i % 2 === 0 ? "" : "bg-slate-50"}`}>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(p.paidAt).toLocaleDateString("es-VE")}
                    {p.isHistorical && (
                      <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="Pago registrado en el sistema anterior">histórico</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{p.reference ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{p.notes ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{p.saldoAnteriorUsd ? Number(p.saldoAnteriorUsd).toFixed(2) : "—"}</td>
                  <td className="px-4 py-2 text-right text-[#1e7a5f] font-semibold">{Number(p.amountUsd).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-medium">{p.quedaPendienteUsd ? Number(p.quedaPendienteUsd).toFixed(2) : "—"}</td>
                  <td className="px-4 py-2 text-center">
                    {p.isHistorical
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : <DownloadBaucheButton paymentId={p.id} token={token} />}
                  </td>
                </tr>
              ))}
              {unit.payments.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Sin pagos registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── AVISO TAB ────────────────────────────────────────────────────────────────
function DownloadAvisoButton({ invoiceId, token, invoiceNumber }: { invoiceId: string; token?: string; invoiceNumber: string }) {
  const dl = trpc.portal.downloadInvoicePdf.useMutation();
  const [state, setState] = useState<"idle"|"loading"|"ok"|"err">("idle");

  const handleDownload = async () => {
    setState("loading");
    try {
      const res = await dl.mutateAsync({ invoiceId, token });
      const link = document.createElement("a");
      link.href = `data:${res.mimeType};base64,${res.base64}`;
      link.download = res.fileName;
      link.click();
      setState("ok");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("err");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={state === "loading"}
      className="rounded border px-3 py-1 text-sm text-[#1e3a5f] border-[#1e3a5f] hover:bg-slate-100 transition-colors disabled:opacity-50"
      title={`Descargar PDF — ${invoiceNumber}`}
    >
      {state === "loading" ? "⏳ Descargando..." : state === "ok" ? "✅ Listo" : state === "err" ? "❌ Error" : "⬇️ Descargar PDF"}
    </button>
  );
}

function AvisoTab({ unit, token }: { unit: UnitData; token?: string }) {
  // Agrupar facturas por mes (año-mes) — sin anuladas
  const invoiceOptions = unit.invoices.filter(inv => inv.status !== "VOIDED");

  // Meses únicos ordenados de más reciente a más antiguo
  type MonthKey = { key: string; label: string; year: number; month: number };
  const monthGroups: MonthKey[] = [];
  const seen = new Set<string>();
  for (const inv of invoiceOptions) {
    if (!inv.periodYear || !inv.periodMonth) continue;
    const k = `${inv.periodYear}-${String(inv.periodMonth).padStart(2,"0")}`;
    if (!seen.has(k)) {
      seen.add(k);
      monthGroups.push({
        key: k,
        label: `Mes: ${String(inv.periodMonth).padStart(2,"0")}/${inv.periodYear}`,
        year: inv.periodYear,
        month: inv.periodMonth,
      });
    }
  }

  const [selectedKey, setSelectedKey] = useState(monthGroups[0]?.key ?? "");
  const selectedGroup = monthGroups.find(g => g.key === selectedKey);

  // Query combinada: todas las facturas del mes seleccionado en un solo aviso
  const { data, isLoading } = trpc.portal.getInvoicesByMonth.useQuery(
    {
      unitId: unit.unitId,
      year:   selectedGroup?.year  ?? 0,
      month:  selectedGroup?.month ?? 0,
      token,
    },
    { enabled: !!selectedGroup },
  );

  // El primaryInvoiceId se usa para la descarga PDF (usamos el recibo principal del mes)
  const primaryInvoiceId = data?.primaryInvoiceId ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Avisos de cobro</h2>
          <div className="mt-1 h-0.5 w-16 bg-[#1e7a5f]" />
        </div>
        {monthGroups.length > 0 && (
          <select
            className="rounded-lg border px-3 py-2 text-sm bg-white font-medium"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            {monthGroups.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
        )}
      </div>

      {!selectedGroup && <p className="py-8 text-center text-muted-foreground">Sin Recibos de Condominio disponibles.</p>}
      {isLoading && <div className="py-8 text-center text-muted-foreground">Cargando aviso de cobro…</div>}
      {data && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="flex justify-end gap-2 p-3 border-b">
            {primaryInvoiceId && (
              <DownloadAvisoButton
                invoiceId={primaryInvoiceId}
                token={token}
                invoiceNumber={data.invoiceNumbers.join("+")}
              />
            )}
            <button onClick={() => window.print()} className="rounded border px-3 py-1 text-sm hover:bg-muted">🖨️ Imprimir</button>
          </div>
          <div className="p-4">
            <AvisoCobroContent data={data as InvoiceDetailData} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COMMUNITY MONTH SUMMARY ──────────────────────────────────────────────────
function CommunityMonthSummary({ communityId }: { communityId: string }) {
  const now = new Date();
  const { data } = trpc.portal.getCommunityMonthSummary.useQuery({
    communityId,
    year:  now.getFullYear(),
    month: now.getMonth() + 1,
  });

  if (!data || data.invoiceCount === 0) return null;

  const pct = data.collectionRate;
  const monthLabel = MONTHS_ES[now.getMonth()];

  return (
    <div className="rounded-xl border bg-white shadow-sm p-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Estado del condominio — {monthLabel} {now.getFullYear()}
      </p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] text-muted-foreground">A cobrar</p>
          <p className="font-bold text-[#1e3a5f] text-sm">Bs {Number(data.totalInvoicedBss ?? 0).toLocaleString("es-VE", { maximumFractionDigits: 0 })}</p>
          <p className="text-[9px] text-muted-foreground">${Number(data.totalInvoicedUsd).toFixed(0)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Cobrado</p>
          <p className="font-bold text-green-700 text-sm">Bs {Number(data.totalCollectedBss ?? 0).toLocaleString("es-VE", { maximumFractionDigits: 0 })}</p>
          <p className="text-[9px] text-muted-foreground">${Number(data.totalCollectedUsd).toFixed(0)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Pendiente</p>
          <p className="font-bold text-amber-700 text-sm">Bs {Number(data.pendingBss ?? 0).toLocaleString("es-VE", { maximumFractionDigits: 0 })}</p>
          <p className="text-[9px] text-muted-foreground">${Number(data.pendingUsd).toFixed(0)}</p>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Nivel de cobro</span>
          <span>{pct}% · {data.paidUnits}/{data.totalUnits} unidades al día</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── NOTIFICAR PAGO TAB ───────────────────────────────────────────────────────
function NotificarPagoTab({ unit, token, todayRate }: { unit: UnitData; token?: string; todayRate: string }) {
  const notify = trpc.portal.notificarPago.useMutation();
  const [form, setForm] = useState({
    // Bs por defecto (pedido cliente: "Por defecto TODO en bolivares")
    banco: "", referencia: "", monto: "", moneda: "VES" as "USD" | "VES",
    fechaPago: new Date().toISOString().split("T")[0]!,
    notas: "",
  });
  const [done, setDone] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  const onScreenshotChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setScreenshotError(null);
    const file = e.target.files?.[0];
    if (!file) { setScreenshot(null); return; }
    if (!file.type.startsWith("image/")) {
      setScreenshotError("Solo se aceptan imágenes (JPG, PNG, WebP).");
      return;
    }
    if (file.size > 2_500_000) {
      setScreenshotError("La imagen es muy grande (máx 2.5 MB). Comprimila antes de subir.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setScreenshot(reader.result as string);
    reader.readAsDataURL(file);
  };

  const pendingUsd  = Number(unit.pendingUsd);
  const hasPending  = pendingUsd > 0.005;
  // El tipo se determina automáticamente: si hay deuda → GENERAL, si no → ANTICIPO
  const tipoPago: "GENERAL" | "ANTICIPO" = hasPending ? "GENERAL" : "ANTICIPO";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await notify.mutateAsync({
      token,
      unitId: unit.unitId,
      banco: form.banco,
      referencia: form.referencia,
      monto: parseFloat(form.monto),
      moneda: form.moneda,
      fechaPago: new Date(form.fechaPago + "T12:00:00"),
      tipoPago,
      notas: form.notas || undefined,
      screenshot: screenshot ?? undefined,
    });
    setDone(true);
  };

  const resetForm = () => {
    setDone(false);
    setForm({ banco: "", referencia: "", monto: "", moneda: "VES", fechaPago: new Date().toISOString().split("T")[0]!, notas: "" });
  };

  if (done) return (
    <div className="rounded-xl border bg-green-50 border-green-200 px-6 py-10 text-center space-y-3">
      <p className="text-4xl">✅</p>
      <p className="text-xl font-semibold text-green-800">Pago notificado correctamente</p>
      <p className="text-sm text-green-700">La Junta de Condominio recibió tu notificación y verificará tu pago a la brevedad posible.</p>
      {tipoPago === "ANTICIPO" && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-2 inline-block">
          💰 Tu pago quedará registrado como anticipo y se descontará de tu próxima cuota.
        </p>
      )}
      <button onClick={resetForm} className="mt-4 text-sm underline text-green-800">Notificar otro pago</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Notificar un pago realizado</h2>
        <div className="mt-1 h-0.5 w-16 bg-[#1e7a5f]" />
        <p className="text-sm text-muted-foreground mt-1">
          Ingresa los datos de tu transacción para notificar a la Junta de Condominio.
        </p>
      </div>

      {/* Estado del condominio */}
      <CommunityMonthSummary communityId={unit.communityId} />

      {/* Contexto según estado de cuenta — Bs primario */}
      <div className={`rounded-lg border px-4 py-3 text-sm ${hasPending ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
        {hasPending ? (
          <>
            <span className="font-semibold">
              Deuda actual: Bs {(pendingUsd * Number(todayRate)).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-amber-700 text-xs"> (≈ US$ {pendingUsd.toFixed(2)})</span>
            <br />
            <span className="text-amber-700">Tu pago se aplicará a las cuotas pendientes más antiguas.</span>
          </>
        ) : (
          <>
            <span className="font-semibold">✓ Estás al día.</span>
            <span className="text-green-700"> Tu pago se registrará como anticipo para la próxima cuota.</span>
          </>
        )}
      </div>

      <div className="rounded-xl border bg-white shadow-sm p-6 max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Banco / método de pago *</Label>
            <Input placeholder="Ej: Banesco, Mercantil, Zelle, Efectivo USD..." required
              value={form.banco} onChange={(e) => setForm(f => ({ ...f, banco: e.target.value }))} />
          </div>
          <div>
            <Label>Número de referencia / comprobante *</Label>
            <Input
              placeholder="Ej: 00123456789 (solo números)"
              required
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.referencia}
              // Solo dígitos — pedido del cliente
              onChange={(e) => setForm(f => ({ ...f, referencia: e.target.value.replace(/\D/g, "") }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto *</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="0.00" required
                value={form.monto} onChange={(e) => setForm(f => ({ ...f, monto: e.target.value }))} />
            </div>
            <div>
              <Label>Moneda</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.moneda} onChange={(e) => setForm(f => ({ ...f, moneda: e.target.value as "USD" | "VES" }))}>
                <option value="VES">Bs — Bolívares</option>
                <option value="USD">USD — Dólares</option>
              </select>
            </div>
          </div>
          <div>
            <Label>Fecha del pago *</Label>
            <Input type="date" required
              value={form.fechaPago} onChange={(e) => setForm(f => ({ ...f, fechaPago: e.target.value }))} />
          </div>
          <div>
            <Label>Observaciones (opcional)</Label>
            <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={2}
              placeholder="Ej: pago de mayo y junio, transferencia en dos partes..."
              value={form.notas} onChange={(e) => setForm(f => ({ ...f, notas: e.target.value }))} />
          </div>

          {/* Subir captura de pantalla del comprobante */}
          <div>
            <Label>Captura del comprobante (opcional)</Label>
            <input
              type="file"
              accept="image/*"
              onChange={onScreenshotChange}
              className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-[#1e7a5f]/10 file:text-[#1e7a5f] hover:file:bg-[#1e7a5f]/20"
            />
            {screenshotError && <p className="mt-1 text-xs text-destructive">{screenshotError}</p>}
            {screenshot && (
              <div className="mt-2 inline-block rounded border border-emerald-300 bg-emerald-50 p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={screenshot} alt="Comprobante" className="max-h-40 rounded" />
                <button
                  type="button"
                  onClick={() => setScreenshot(null)}
                  className="block w-full text-[10px] text-red-600 mt-1 hover:underline"
                >
                  ✕ Quitar captura
                </button>
              </div>
            )}
          </div>

          {notify.isError && (
            <p className="text-sm text-destructive">Error al enviar la notificación. Por favor intenta de nuevo.</p>
          )}

          <Button type="submit" disabled={notify.isPending}
            className="w-full bg-[#1e7a5f] hover:bg-[#15604a] text-white py-3 text-base font-semibold">
            {notify.isPending ? "Enviando..." : "Notificar pago"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ─── DEUDA GENERAL TAB ────────────────────────────────────────────────────────
function DeudaGeneralTab({ communityId, token, unit }: { communityId: string; token?: string; unit: UnitData }) {
  const { data, isLoading } = trpc.portal.getDeudaGeneral.useQuery({ communityId, token });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Cargando deuda general…</div>;
  if (!data) return null;

  const totalUsd = Number(data.totalPendingUsd);
  const myPendingUsd = Number(unit.pendingUsd);
  const myShare = totalUsd > 0 ? (myPendingUsd / totalUsd) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Deuda general US$ {totalUsd.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
        <div className="mt-1 h-0.5 w-16 bg-[#1e7a5f]" />
        <p className="text-sm text-[#1e7a5f] mt-1">Agrupado por meses.</p>
      </div>

      {/* Card: mi parte en la deuda total del condominio */}
      {totalUsd > 0 && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Tu participación — Unidad {unit.unitCode}
          </p>
          <div className="grid grid-cols-3 gap-3 text-center mb-4">
            <div className="rounded-lg bg-[#1e3a5f]/5 p-3">
              <p className="text-xs text-muted-foreground mb-1">Deuda total cond.</p>
              <p className="text-lg font-bold text-[#1e3a5f]">
                US$ {totalUsd.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-lg bg-[#1e7a5f]/5 p-3">
              <p className="text-xs text-muted-foreground mb-1">Tu deuda</p>
              <p className="text-lg font-bold text-[#1e7a5f]">US$ {myPendingUsd.toFixed(2)}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-xs text-muted-foreground mb-1">Tu alícuota efectiva</p>
              <p className="text-lg font-bold text-amber-700">{myShare.toFixed(4)}%</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Tu parte del total ({myShare.toFixed(2)}%)</span>
              <span>US$ {myPendingUsd.toFixed(2)} / US$ {totalUsd.toFixed(2)}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-2.5 rounded-full bg-[#1e7a5f] transition-all"
                style={{ width: `${Math.min(myShare, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1 text-right">
              El resto de la deuda ({(100 - myShare).toFixed(2)}%) corresponde a las demás unidades
            </p>
          </div>
        </div>
      )}

      {/* Pie chart */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data.agingBuckets}
              dataKey="usd"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={110}
              label={({ name, value }: { name?: string; value?: number }) =>
                (value ?? 0) > 0 ? `${name ?? ""} (${Number(value ?? 0).toFixed(2)})` : ""}
              labelLine={false}
            >
              {data.agingBuckets.map((_: unknown, index: number) => (
                <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, ""]} />
            <Legend
              formatter={(value: string, entry: { payload?: { usd?: number } }) =>
                `${value} (${Number(entry.payload?.usd ?? 0).toFixed(2)})`}
            />
          </PieChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-1">
          <span className="font-semibold">Gráfico de deuda:</span> Muestra la deuda general agrupada por meses en porcentajes y montos.
        </p>
      </div>

      {/* Tabla deuda por unidad — privacidad: solo apartamento, monto y meses,
          sin nombres de propietarios (pedido cliente 8/jun/2026). */}
      <div>
        <h3 className="text-xl font-bold">Deuda General por Condominio</h3>
        <p className="text-sm text-[#1e7a5f]">Expresado en US$ — sin identificación personal</p>
        <div className="mt-2 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1e3a5f] text-white text-left">
                <th className="px-4 py-2 font-semibold">Unidad</th>
                <th className="px-4 py-2 font-semibold text-right">Deuda US$</th>
                <th className="px-4 py-2 font-semibold text-right">Meses vencida</th>
              </tr>
            </thead>
            <tbody>
              {data.unidades.filter((u: { pendingUsd: string }) => Number(u.pendingUsd) > 0.005).map((u: { unitCode: string; pendingUsd: string; overdueMonths: number }, i: number) => (
                <tr key={u.unitCode} className={`border-t ${i % 2 === 0 ? "" : "bg-slate-50"}`}>
                  <td className="px-4 py-2 font-medium">{u.unitCode}</td>
                  <td className="px-4 py-2 text-right font-semibold">{Number(u.pendingUsd).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{u.overdueMonths}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── RESERVAS TAB ─────────────────────────────────────────────────────────────
function ReservasTab({ communityId }: { communityId: string }) {
  const [form, setForm] = useState({
    area: "",
    fecha: "",
    horaInicio: "",
    horaFin: "",
    invitados: "",
    proposito: "",
  });
  const [sent, setSent] = useState(false);

  const buildWhatsAppText = () => {
    const lines = [
      "📋 *Solicitud de Reserva de Área Común*",
      "",
      `🏊 Área: ${form.area}`,
      `📅 Fecha: ${form.fecha}`,
      `🕐 Horario: ${form.horaInicio} – ${form.horaFin}`,
      `👥 Invitados: ${form.invitados || "0"}`,
      `📝 Propósito: ${form.proposito}`,
    ];
    return encodeURIComponent(lines.join("\n"));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = buildWhatsAppText();
    window.open(`https://wa.me/?text=${text}`, "_blank");
    setSent(true);
  };

  if (sent) return (
    <div className="rounded-xl border bg-green-50 border-green-200 px-6 py-10 text-center space-y-3">
      <p className="text-4xl">✅</p>
      <p className="text-xl font-semibold text-green-800">¡Solicitud enviada por WhatsApp!</p>
      <p className="text-sm text-green-700">La Junta de Condominio revisará tu solicitud y te confirmará la reserva.</p>
      <button onClick={() => setSent(false)} className="mt-4 text-sm underline text-green-800">
        Hacer otra solicitud
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Reservas de Áreas Comunes</h2>
        <div className="mt-1 h-0.5 w-16 bg-[#1e7a5f]" />
        <p className="text-sm text-muted-foreground mt-1">
          Solicita el uso de las instalaciones del condominio.
        </p>
      </div>

      {/* Banner informativo */}
      <div className="rounded-xl border bg-blue-50 border-blue-200 px-5 py-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">ℹ️ ¿Cómo funciona?</p>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li>Completa el formulario con los datos de tu solicitud.</li>
          <li>Al enviar, se abrirá WhatsApp con el mensaje pre-rellenado para la administración.</li>
          <li>La Junta revisará tu solicitud y te confirmará disponibilidad.</li>
          <li>Las reservas están sujetas a las normas del condominio y disponibilidad.</li>
        </ul>
      </div>

      {/* Formulario */}
      <div className="rounded-xl border bg-white shadow-sm p-6 max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Área que deseas reservar *</Label>
            <Input
              required
              placeholder="Ej: Piscina, Salón social, Cancha deportiva..."
              value={form.area}
              onChange={(e) => setForm(f => ({ ...f, area: e.target.value }))}
            />
          </div>
          <div>
            <Label>Fecha *</Label>
            <Input
              type="date"
              required
              min={new Date().toISOString().split("T")[0]}
              value={form.fecha}
              onChange={(e) => setForm(f => ({ ...f, fecha: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Hora inicio *</Label>
              <Input
                type="time"
                required
                value={form.horaInicio}
                onChange={(e) => setForm(f => ({ ...f, horaInicio: e.target.value }))}
              />
            </div>
            <div>
              <Label>Hora fin *</Label>
              <Input
                type="time"
                required
                value={form.horaFin}
                onChange={(e) => setForm(f => ({ ...f, horaFin: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Número de invitados</Label>
            <Input
              type="number"
              min={0}
              placeholder="0"
              value={form.invitados}
              onChange={(e) => setForm(f => ({ ...f, invitados: e.target.value }))}
            />
          </div>
          <div>
            <Label>Propósito / motivo de la reserva *</Label>
            <textarea
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
              placeholder="Ej: Reunión familiar, Cumpleaños, Actividad deportiva..."
              value={form.proposito}
              onChange={(e) => setForm(f => ({ ...f, proposito: e.target.value }))}
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-[#25D366] hover:bg-[#20b858] text-white py-3 text-base font-semibold"
          >
            📲 Enviar solicitud por WhatsApp
          </Button>
        </form>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Tu solicitud se enviará como mensaje de WhatsApp a la administración del condominio.
        No olvides esperar la confirmación antes de utilizar el área.
      </p>
    </div>
  );
}

// ─── QR MODAL ────────────────────────────────────────────────────────────────
function QrModal({ accessCode, visitorName, onClose }: { accessCode: string; visitorName: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4 text-center">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#1e3a5f]">Código QR de acceso</h3>
          <button onClick={onClose} className="rounded border px-2 py-0.5 text-sm hover:bg-muted">✕</button>
        </div>
        <p className="text-sm text-muted-foreground">Visitante: <span className="font-medium text-[#1e3a5f]">{visitorName}</span></p>
        <div className="flex justify-center p-4 bg-white border rounded-xl">
          <QRCode value={accessCode} size={200} />
        </div>
        <div className="rounded-lg bg-slate-50 border px-4 py-3">
          <p className="text-xs text-muted-foreground mb-1">Código alfanumérico (para ingreso manual):</p>
          <p className="font-mono text-sm font-bold text-[#1e3a5f] break-all">{accessCode}</p>
        </div>
        <p className="text-sm text-[#1e7a5f] font-medium">📋 Muestra este código al guardia al llegar</p>
      </div>
    </div>
  );
}

// ─── SEGURIDAD TAB ────────────────────────────────────────────────────────────
type VisitorPortalItem = {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  validFrom: string | Date;
  validUntil: string | Date;
  purpose: string | null;
  accessCode: string | null;
  unit: { code: string };
};

const VISITOR_STATUS_LABEL_PORTAL: Record<string, string> = {
  PENDING:     "Pendiente",
  CHECKED_IN:  "Adentro",
  CHECKED_OUT: "Salió",
  DENIED:      "Denegado",
  EXPIRED:     "Vencido",
};
const VISITOR_STATUS_COLOR_PORTAL: Record<string, string> = {
  PENDING:     "bg-amber-100 text-amber-800",
  CHECKED_IN:  "bg-green-100 text-green-800",
  CHECKED_OUT: "bg-slate-100 text-slate-700",
  DENIED:      "bg-red-100 text-red-700",
  EXPIRED:     "bg-zinc-100 text-zinc-600",
};

function SeguridadTab({ unit, token }: { unit: UnitData; token?: string }) {
  const [qrVisitor, setQrVisitor] = useState<{ accessCode: string; name: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const utils = trpc.useUtils();
  const requestVisitor = trpc.portal.requestVisitor.useMutation();

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    firstName: "", lastName: "", idNumber: "", phone: "", vehiclePlate: "",
    validFrom: today, validUntil: tomorrow, purpose: "", notes: "",
  });

  const { data: visitors, isLoading } = trpc.portal.myVisitors.useQuery({
    unitId: unit.unitId,
    token,
  });

  const onSubmitVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    await requestVisitor.mutateAsync({
      token,
      unitId: unit.unitId,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      idNumber: form.idNumber || undefined,
      idType: "V",
      phone: form.phone || undefined,
      vehiclePlate: form.vehiclePlate || undefined,
      validFrom: new Date(form.validFrom + "T00:00:00"),
      validUntil: new Date(form.validUntil + "T23:59:59"),
      purpose: form.purpose || undefined,
      notes: form.notes || undefined,
    });
    setForm({ firstName: "", lastName: "", idNumber: "", phone: "", vehiclePlate: "", validFrom: today, validUntil: tomorrow, purpose: "", notes: "" });
    setShowForm(false);
    void utils.portal.myVisitors.invalidate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Mis Visitantes Pre-autorizados</h2>
          <div className="mt-1 h-0.5 w-16 bg-[#1e7a5f]" />
          <p className="text-sm text-muted-foreground mt-1">
            Visitantes que autorizaste para acceder al condominio. Muéstrale el código QR al guardia al llegar.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-md bg-[#1e7a5f] hover:bg-[#15604a] text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          + Solicitar visitante
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border bg-white shadow-sm p-5">
          <h3 className="font-semibold mb-3">Nuevo visitante</h3>
          <form onSubmit={onSubmitVisitor} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre *</Label><Input required value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))} /></div>
              <div><Label>Apellido *</Label><Input required value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Cédula</Label><Input value={form.idNumber} onChange={(e) => setForm(f => ({ ...f, idNumber: e.target.value }))} placeholder="V-12345678" /></div>
              <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label>Placa vehículo</Label><Input value={form.vehiclePlate} onChange={(e) => setForm(f => ({ ...f, vehiclePlate: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Válido desde *</Label><Input type="date" required value={form.validFrom} onChange={(e) => setForm(f => ({ ...f, validFrom: e.target.value }))} /></div>
              <div><Label>Válido hasta *</Label><Input type="date" required value={form.validUntil} onChange={(e) => setForm(f => ({ ...f, validUntil: e.target.value }))} /></div>
            </div>
            <div><Label>Motivo</Label><Input value={form.purpose} onChange={(e) => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Ej: cena familiar, mudanza, mantenimiento..." /></div>
            <div><Label>Notas (opcional)</Label><textarea rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            {requestVisitor.isError && (
              <p className="text-sm text-destructive">{requestVisitor.error.message}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" disabled={requestVisitor.isPending} className="bg-[#1e7a5f] hover:bg-[#15604a]">
                {requestVisitor.isPending ? "Solicitando..." : "Solicitar"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {isLoading && <div className="py-8 text-center text-muted-foreground">Cargando visitantes...</div>}

      {!isLoading && (!visitors || visitors.length === 0) && (
        <div className="rounded-xl border bg-white px-6 py-10 text-center text-muted-foreground">
          Sin visitantes pre-autorizados registrados.<br />
          <span className="text-xs">Contacta a la Junta de Condominio para pre-autorizar un visitante.</span>
        </div>
      )}

      {visitors && visitors.length > 0 && (
        <div className="overflow-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1e3a5f] text-white text-left">
                <th className="px-4 py-2 font-semibold">Visitante</th>
                <th className="px-4 py-2 font-semibold">Válido</th>
                <th className="px-4 py-2 font-semibold">Motivo</th>
                <th className="px-4 py-2 font-semibold">Estado</th>
                <th className="px-4 py-2 font-semibold text-center">QR</th>
              </tr>
            </thead>
            <tbody>
              {(visitors as VisitorPortalItem[]).map((v, i) => (
                <tr key={v.id} className={`border-t ${i % 2 === 0 ? "" : "bg-slate-50"}`}>
                  <td className="px-4 py-2 font-medium">{v.firstName} {v.lastName}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(v.validFrom).toLocaleDateString("es-VE")}
                    {" → "}
                    {new Date(v.validUntil).toLocaleDateString("es-VE")}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{v.purpose ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${VISITOR_STATUS_COLOR_PORTAL[v.status] ?? "bg-gray-100"}`}>
                      {VISITOR_STATUS_LABEL_PORTAL[v.status] ?? v.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    {(v.status === "PENDING" || v.status === "CHECKED_IN") && v.accessCode ? (
                      <button
                        onClick={() => setQrVisitor({ accessCode: v.accessCode!, name: `${v.firstName} ${v.lastName}` })}
                        className="rounded border border-[#1e7a5f] text-[#1e7a5f] hover:bg-[#e8f5f0] px-2 py-1 text-xs font-medium transition-colors"
                      >
                        📱 Ver QR
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {qrVisitor && (
        <QrModal
          accessCode={qrVisitor.accessCode}
          visitorName={qrVisitor.name}
          onClose={() => setQrVisitor(null)}
        />
      )}
    </div>
  );
}

// ─── ONBOARDING OBLIGATORIO ──────────────────────────────────────────────────
// Pedido cliente 8/jun/2026: la primera vez que un residente entra al portal,
// debe llenar WhatsApp + email + nombre + apellido SIN poder seguir hasta llenar.
// La data alimenta el sistema (Person) y habilita el bot WhatsApp + envíos masivos.
function OnboardingModal({
  data, token, onComplete,
}: {
  data: PortalData;
  token?: string;
  onComplete: () => void;
}) {
  const [firstName, setFirstName] = useState(data.person.firstName ?? "");
  const [lastName, setLastName] = useState(data.person.lastName ?? "");
  const [whatsapp, setWhatsapp] = useState(data.person.whatsapp ?? data.person.phone ?? "");
  const [email, setEmail] = useState(data.person.email ?? "");
  const [emailSecondary, setEmailSecondary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const updateProfile = trpc.portal.updateOwnProfile.useMutation();

  const unit = data.units[0];
  const ok =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    whatsapp.replace(/\D/g, "").length >= 10 &&
    /^[^@]+@[^@]+\.[^@]+$/.test(email);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) { setError("Completá todos los campos obligatorios correctamente."); return; }
    setError(null);
    try {
      await updateProfile.mutateAsync({
        token,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim(),
        emailSecondary: emailSecondary.trim() || null,
      });
      onComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 my-8">
        <div className="text-center mb-5">
          <div className="text-3xl mb-2">👋</div>
          <h2 className="text-2xl font-bold text-[#1e3a5f]">¡Bienvenido/a al portal!</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Antes de continuar, <strong>revisá y confirmá tus datos</strong>. Corregí lo que haga falta. Solo te lo pediremos esta vez.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
            📍 Unidad: <strong>{unit?.unitCode ?? "—"}</strong> · {unit?.communityName ?? ""}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Nombre *</label>
              <input
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={firstName} onChange={(e) => setFirstName(e.target.value)} required minLength={2}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Apellido *</label>
              <input
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={lastName} onChange={(e) => setLastName(e.target.value)} required minLength={2}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">📱 WhatsApp * <span className="text-muted-foreground">(con código de país, ej. 04141234567)</span></label>
            <input
              type="tel"
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="0414-123-4567"
              required minLength={7}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Por este número te llegarán los recibos y respuestas del asistente.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">📧 Email principal * <span className="text-muted-foreground">(recibos)</span></label>
            <input
              type="email"
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">📧 Email secundario <span className="text-muted-foreground">(opcional)</span></label>
            <input
              type="email"
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={emailSecondary} onChange={(e) => setEmailSecondary(e.target.value)}
              placeholder="opcional@ejemplo.com"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={!ok || updateProfile.isPending}
            className="w-full h-11 rounded-md bg-[#1e3a5f] text-white font-semibold hover:bg-[#15294a] disabled:opacity-50 transition-colors"
          >
            {updateProfile.isPending ? "Guardando..." : "Continuar al portal →"}
          </button>

          <p className="text-[10px] text-center text-muted-foreground">
            Al continuar aceptás que la Junta de Condominio use estos datos para enviarte recibos, avisos y comunicaciones oficiales.
          </p>
        </form>
      </div>
    </div>
  );
}

// ─── DASHBOARD PRINCIPAL ──────────────────────────────────────────────────────
function ResidentDashboard({ data, token }: { data: PortalData; token?: string }) {
  const [tab, setTab] = useState<TabKey>("principal");
  const [needsOnboarding, setNeedsOnboarding] = useState(
    // Pide confirmar datos si: (a) nunca confirmó en el portal (portalConfirmedAt null),
    // aunque ya tenga datos precargados — así revisa/corrige una vez; o (b) le faltan datos.
    !data.person.portalConfirmedAt ||
    !data.person.whatsapp ||
    data.person.whatsapp.trim().length < 7 ||
    !data.person.firstName?.trim() ||
    !data.person.lastName?.trim() ||
    !data.person.email,
  );
  const unit = data.units[0];

  if (!unit) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">No tienes unidades asignadas. Contacta a la Junta de Condominio.</p>
    </div>
  );

  if (needsOnboarding) {
    return (
      <>
        <OnboardingModal
          data={data}
          token={token}
          onComplete={() => {
            setNeedsOnboarding(false);
            // Recargar para que data.person.whatsapp/etc se actualicen
            window.location.reload();
          }}
        />
        {/* Fondo oscuro */}
        <div className="min-h-screen bg-[#1e3a5f]" />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Top bar */}
      <div className="bg-[#1e3a5f] text-white">
        <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-blue-200 uppercase tracking-wider">{unit.communityName}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-blue-200">{data.person.firstName} {data.person.lastName}</span>
            <span className="font-bold">{unit.unitCode}</span>
            <a
              href="/portal/help"
              className="text-blue-300 hover:text-white transition-colors"
              title="Manual del residente"
            >
              ❓ Ayuda
            </a>
            {!token && (
              <a href="/api/auth/signout" className="text-blue-300 hover:text-white transition-colors">Salir</a>
            )}
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="bg-[#1e5c3f] shadow">
        <div className="mx-auto max-w-5xl px-4 flex overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? "border-white text-white bg-white/10"
                  : "border-transparent text-green-200 hover:text-white hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-4 py-6">
        {tab === "principal"  && (
          <div className="space-y-6">
            <PrincipalTab  unit={unit} todayRate={data.todayRate} onTab={setTab} />
            <AccessPasswordCard token={token} email={data.person.email} hasPassword={data.person.hasPassword} />
          </div>
        )}
        {tab === "pendientes" && <PendientesTab unit={unit} todayRate={data.todayRate} />}
        {tab === "pagos"      && <PagosTab      unit={unit} token={token} />}
        {tab === "aviso"      && <AvisoTab      unit={unit} token={token} />}
        {tab === "notificar"  && <NotificarPagoTab unit={unit} token={token} todayRate={data.todayRate} />}
        {tab === "deuda"      && <DeudaGeneralTab communityId={unit.communityId} token={token} unit={unit} />}
        {tab === "reservas"   && <ReservasTab communityId={unit.communityId} />}
        {tab === "seguridad"  && <SeguridadTab unit={unit} token={token} />}
      </div>

      {/* Footer */}
      <div className="border-t bg-white py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} · ResidIA
      </div>
    </div>
  );
}

// ─── WRAPPERS POR MODO DE ACCESO ──────────────────────────────────────────────
function ResidentDashboardByToken({ token }: { token: string }) {
  const { data, isLoading, error } = trpc.portal.getByToken.useQuery({ token });
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Cargando tu información...</p></div>;
  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle className="text-destructive">Sin acceso</CardTitle><CardDescription>{error.message}</CardDescription></CardHeader>
        <CardContent><a href="/portal"><Button className="w-full">Volver al portal</Button></a></CardContent>
      </Card>
    </div>
  );
  if (!data) return null;
  return <ResidentDashboard data={data as unknown as PortalData} token={token} />;
}

function ResidentDashboardBySession() {
  const { data, isLoading } = trpc.portal.getBySession.useQuery();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Cargando...</p></div>;
  if (!data) return null;
  return <ResidentDashboard data={data as unknown as PortalData} />;
}

// ─── PORTAL CONTENT (raíz) ────────────────────────────────────────────────────
function PortalContent() {
  const params = useSearchParams();
  const token = params.get("t");
  const [showLogin, setShowLogin] = useState(false);

  const { data: sessionData, isLoading: sessionLoading } = trpc.portal.getBySession.useQuery(
    undefined, { retry: false },
  );

  if (token) return <ResidentDashboardByToken token={token} />;

  if (sessionLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Cargando...</p>
    </div>
  );

  if (sessionData) return <ResidentDashboard data={sessionData as unknown as PortalData} />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Portal del Propietario</h1>
          <p className="text-sm text-muted-foreground mt-1">Consulta tu saldo y Recibos de Condominio en línea</p>
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
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Cargando...</p></div>}>
      <PortalContent />
    </Suspense>
  );
}
