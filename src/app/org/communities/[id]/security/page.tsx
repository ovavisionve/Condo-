"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const today = new Date().toISOString().slice(0, 10);

const VISITOR_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  CHECKED_IN: "Adentro",
  CHECKED_OUT: "Salió",
  DENIED: "Denegado",
  EXPIRED: "Vencido",
};
const VISITOR_STATUS_COLOR: Record<string, string> = {
  PENDING:     "bg-amber-100 text-amber-800",
  CHECKED_IN:  "bg-green-100 text-green-800",
  CHECKED_OUT: "bg-slate-100 text-slate-700",
  DENIED:      "bg-red-100 text-red-700",
  EXPIRED:     "bg-zinc-100 text-zinc-600",
};

const VIOLATION_TYPE_LABEL: Record<string, string> = {
  NOISE: "Ruido",
  PARKING: "Estacionamiento",
  PETS: "Mascotas",
  COMMON_AREAS: "Áreas comunes",
  ELEVATOR_MISUSE: "Mal uso del ascensor",
  GARBAGE: "Basura",
  OTHER: "Otro",
};

type Tab = "visitors" | "access-log" | "violations";

export default function SecurityPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [tab, setTab] = useState<Tab>("visitors");
  const [showNewVisitor, setShowNewVisitor] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [showViolation, setShowViolation] = useState(false);
  const [filterDate, setFilterDate] = useState(today);

  const visitors    = trpc.security.visitors.list.useQuery({ organizationId, communityId });
  const accessLog   = trpc.security.accessLog.list.useQuery({ organizationId, communityId, date: new Date(filterDate), take: 100 });
  const violations  = trpc.security.violations.list.useQuery({ organizationId, communityId });
  const utils = trpc.useUtils();

  const checkIn  = trpc.security.visitors.checkIn.useMutation({ onSuccess: () => void utils.security.visitors.list.invalidate() });
  const checkOut = trpc.security.visitors.checkOut.useMutation({ onSuccess: () => void utils.security.visitors.list.invalidate() });
  const deny     = trpc.security.visitors.deny.useMutation({ onSuccess: () => void utils.security.visitors.list.invalidate() });
  const resolve  = trpc.security.violations.resolve.useMutation({ onSuccess: () => void utils.security.violations.list.invalidate() });

  const pendingVisitors = visitors.data?.filter((v) => v.status === "PENDING") ?? [];
  const allVisitors     = visitors.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Seguridad y Acceso</h2>
        <div className="flex gap-2">
          {tab === "visitors" && (
            <Button size="sm" onClick={() => setShowNewVisitor(true)}>+ Pre-autorizar visitante</Button>
          )}
          {tab === "access-log" && (
            <Button size="sm" variant="outline" onClick={() => setShowWalkIn(true)}>+ Registro manual</Button>
          )}
          {tab === "violations" && (
            <Button size="sm" variant="outline" onClick={() => setShowViolation(true)}>+ Reportar violación</Button>
          )}
        </div>
      </div>

      {/* ── Stats rápidas ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Visitantes dentro" value={visitors.data?.filter((v) => v.status === "CHECKED_IN").length ?? 0} color="green" />
        <StatCard label="Pendientes hoy" value={pendingVisitors.length} color="amber" />
        <StatCard label="Violaciones abiertas" value={violations.data?.filter((v) => !v.resolvedAt).length ?? 0} color="red" />
      </div>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div className="flex gap-1 border-b">
        {(["visitors", "access-log", "violations"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t === "visitors" ? "Visitantes" : t === "access-log" ? "Log de accesos" : "Violaciones"}
          </button>
        ))}
      </div>

      {/* ── Visitantes ────────────────────────────────────── */}
      {tab === "visitors" && (
        <div className="space-y-3">
          {/* Verificador de QR */}
          <VerificarQr organizationId={organizationId} communityId={communityId} />

          {showNewVisitor && (
            <NewVisitorForm
              organizationId={organizationId}
              communityId={communityId}
              onCreated={() => { setShowNewVisitor(false); void utils.security.visitors.list.invalidate(); }}
              onCancel={() => setShowNewVisitor(false)}
            />
          )}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-2">Visitante</th>
                  <th className="px-4 py-2">Unidad</th>
                  <th className="px-4 py-2">Válido</th>
                  <th className="px-4 py-2">Motivo</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visitors.isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Cargando...</td></tr>
                ) : allVisitors.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Sin visitantes registrados</td></tr>
                ) : allVisitors.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="px-4 py-2">
                      <div className="font-medium">{v.firstName} {v.lastName}</div>
                      {v.idNumber && <div className="text-xs text-muted-foreground">{v.idType}-{v.idNumber}</div>}
                      {v.vehiclePlate && <div className="text-xs text-muted-foreground">🚗 {v.vehiclePlate}</div>}
                    </td>
                    <td className="px-4 py-2 font-medium">{v.unit.code}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(v.validFrom).toLocaleDateString("es-VE")}
                      {" → "}
                      {new Date(v.validUntil).toLocaleDateString("es-VE")}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{v.purpose ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${VISITOR_STATUS_COLOR[v.status] ?? "bg-gray-100"}`}>
                        {VISITOR_STATUS_LABEL[v.status] ?? v.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {v.status === "PENDING" && (
                          <>
                            <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700"
                              onClick={() => checkIn.mutate({ organizationId, communityId, visitorId: v.id })}>
                              Ingreso
                            </Button>
                            <Button size="sm" variant="destructive" className="h-7 text-xs"
                              onClick={() => { const r = prompt("Motivo de denegación:"); if (r) deny.mutate({ organizationId, communityId, visitorId: v.id, reason: r }); }}>
                              Denegar
                            </Button>
                          </>
                        )}
                        {v.status === "CHECKED_IN" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => checkOut.mutate({ organizationId, communityId, visitorId: v.id })}>
                            Salida
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Log de accesos ────────────────────────────────── */}
      {tab === "access-log" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="text-sm">Fecha:</Label>
            <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="h-9 w-48" />
          </div>
          {showWalkIn && (
            <WalkInForm
              organizationId={organizationId}
              communityId={communityId}
              onCreated={() => { setShowWalkIn(false); void utils.security.accessLog.list.invalidate(); }}
              onCancel={() => setShowWalkIn(false)}
            />
          )}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-2">Hora</th>
                  <th className="px-4 py-2">Dirección</th>
                  <th className="px-4 py-2">Persona</th>
                  <th className="px-4 py-2">Cédula</th>
                  <th className="px-4 py-2">Placa</th>
                  <th className="px-4 py-2">Unidad</th>
                  <th className="px-4 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {accessLog.isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Cargando...</td></tr>
                ) : (accessLog.data?.length === 0) ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Sin registros para esta fecha</td></tr>
                ) : accessLog.data?.map((log) => (
                  <tr key={log.id} className="border-t">
                    <td className="px-4 py-2 text-xs">{new Date(log.createdAt).toLocaleTimeString("es-VE")}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${log.direction === "IN" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"}`}>
                        {log.direction === "IN" ? "↓ Ingreso" : "↑ Salida"}
                      </span>
                      {log.deniedReason && <div className="text-xs text-red-600 mt-0.5">Denegado: {log.deniedReason}</div>}
                    </td>
                    <td className="px-4 py-2 font-medium">{log.personName}</td>
                    <td className="px-4 py-2 text-muted-foreground">{log.personId_doc ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{log.vehiclePlate ?? "—"}</td>
                    <td className="px-4 py-2">{log.unit?.code ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{log.purpose ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Violaciones ───────────────────────────────────── */}
      {tab === "violations" && (
        <div className="space-y-3">
          {showViolation && (
            <ViolationForm
              organizationId={organizationId}
              communityId={communityId}
              onCreated={() => { setShowViolation(false); void utils.security.violations.list.invalidate(); }}
              onCancel={() => setShowViolation(false)}
            />
          )}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Unidad</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Descripción</th>
                  <th className="px-4 py-2">Multa</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {violations.isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Cargando...</td></tr>
                ) : violations.data?.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-green-600 font-medium">✓ Sin violaciones registradas</td></tr>
                ) : violations.data?.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleDateString("es-VE")}</td>
                    <td className="px-4 py-2 font-medium">{v.unit.code}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className="rounded bg-orange-100 text-orange-700 px-2 py-0.5">
                        {VIOLATION_TYPE_LABEL[v.type] ?? v.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 max-w-xs truncate">{v.description}</td>
                    <td className="px-4 py-2 text-xs">
                      {v.fineInvoice
                        ? <span className="text-amber-700">{v.fineInvoice.invoiceNumber}</span>
                        : <ApplyFineToViolation organizationId={organizationId} communityId={communityId} violationId={v.id} onDone={() => void utils.security.violations.list.invalidate()} />
                      }
                    </td>
                    <td className="px-4 py-2">
                      {v.resolvedAt
                        ? <span className="text-xs text-green-600">✓ Resuelta</span>
                        : <span className="text-xs text-amber-700">Abierta</span>}
                    </td>
                    <td className="px-4 py-2">
                      {!v.resolvedAt && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => { const n = prompt("Notas de resolución (opcional):"); resolve.mutate({ organizationId, communityId, violationId: v.id, notes: n ?? undefined }); }}>
                          Resolver
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: "green" | "amber" | "red" | "blue" }) {
  const colors = {
    green: "border-green-200 bg-green-50 text-green-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red:   "border-red-200 bg-red-50 text-red-700",
    blue:  "border-blue-200 bg-blue-50 text-blue-700",
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium opacity-70">{label}</div>
    </div>
  );
}

function NewVisitorForm({
  organizationId, communityId, onCreated, onCancel,
}: { organizationId: string; communityId: string; onCreated: () => void; onCancel: () => void }) {
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const preAuth = trpc.security.visitors.preAuthorize.useMutation();
  const [form, setForm] = useState({
    firstName: "", lastName: "", idNumber: "", idType: "V",
    phone: "", vehiclePlate: "",
    validFrom: today, validUntil: today,
    unitId: "", purpose: "", notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await preAuth.mutateAsync({
        organizationId, communityId,
        unitId: form.unitId,
        firstName: form.firstName, lastName: form.lastName,
        idNumber: form.idNumber || undefined, idType: form.idType,
        phone: form.phone || undefined,
        vehiclePlate: form.vehiclePlate || undefined,
        validFrom: new Date(form.validFrom),
        validUntil: new Date(form.validUntil + "T23:59:59"),
        purpose: form.purpose || undefined,
        notes: form.notes || undefined,
      });
      onCreated();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-lg border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold">Pre-autorizar visitante</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><Label>Nombre</Label><Input aria-label="Nombre" value={form.firstName} onChange={set("firstName")} required /></div>
        <div><Label>Apellido</Label><Input aria-label="Apellido" value={form.lastName} onChange={set("lastName")} required /></div>
        <div><Label>Cédula</Label><Input aria-label="Cédula" value={form.idNumber} onChange={set("idNumber")} placeholder="12345678" /></div>
        <div>
          <Label>Unidad</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.unitId} onChange={set("unitId")} required>
            <option value="">Seleccionar...</option>
            {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
          </select>
        </div>
        <div><Label>Teléfono</Label><Input value={form.phone} onChange={set("phone")} placeholder="0414..." /></div>
        <div><Label>Placa vehículo</Label><Input value={form.vehiclePlate} onChange={set("vehiclePlate")} placeholder="ABC-123" /></div>
        <div><Label>Válido desde</Label><Input type="date" value={form.validFrom} onChange={set("validFrom")} required /></div>
        <div><Label>Válido hasta</Label><Input type="date" value={form.validUntil} onChange={set("validUntil")} required /></div>
        <div className="col-span-2 md:col-span-4"><Label>Motivo de visita</Label><Input aria-label="Motivo" value={form.purpose} onChange={set("purpose")} placeholder="Ej: Reparación plomería" /></div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={preAuth.isPending}>{preAuth.isPending ? "..." : "Pre-autorizar"}</Button>
      </div>
    </form>
  );
}

function WalkInForm({
  organizationId, communityId, onCreated, onCancel,
}: { organizationId: string; communityId: string; onCreated: () => void; onCancel: () => void }) {
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const register = trpc.security.accessLog.registerWalkIn.useMutation();
  const [form, setForm] = useState({ personName: "", personId_doc: "", vehiclePlate: "", purpose: "", unitId: "", direction: "IN" as "IN" | "OUT" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await register.mutateAsync({ organizationId, communityId, personName: form.personName, personId_doc: form.personId_doc || undefined, vehiclePlate: form.vehiclePlate || undefined, purpose: form.purpose || undefined, unitId: form.unitId || undefined, direction: form.direction });
      onCreated();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-lg border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold">Registro manual de acceso</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2"><Label>Nombre completo</Label><Input aria-label="Nombre completo" value={form.personName} onChange={set("personName")} required /></div>
        <div><Label>Cédula</Label><Input aria-label="Cédula" value={form.personId_doc} onChange={set("personId_doc")} /></div>
        <div><Label>Placa</Label><Input value={form.vehiclePlate} onChange={set("vehiclePlate")} /></div>
        <div>
          <Label>Dirección</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.direction} onChange={set("direction")}>
            <option value="IN">↓ Ingreso</option>
            <option value="OUT">↑ Salida</option>
          </select>
        </div>
        <div>
          <Label>Unidad (opcional)</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.unitId} onChange={set("unitId")}>
            <option value="">Sin unidad</option>
            {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
          </select>
        </div>
        <div className="col-span-2"><Label>Motivo</Label><Input aria-label="Motivo" value={form.purpose} onChange={set("purpose")} /></div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={register.isPending}>{register.isPending ? "..." : "Registrar"}</Button>
      </div>
    </form>
  );
}

function ViolationForm({
  organizationId, communityId, onCreated, onCancel,
}: { organizationId: string; communityId: string; onCreated: () => void; onCancel: () => void }) {
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const report = trpc.security.violations.report.useMutation();
  const [form, setForm] = useState({ unitId: "", type: "ELEVATOR_MISUSE" as const, description: "" });
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await report.mutateAsync({ organizationId, communityId, unitId: form.unitId, type: form.type, description: form.description });
      onCreated();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-lg border bg-orange-50 border-orange-200 p-4 space-y-3">
      <p className="text-sm font-semibold text-orange-800">Reportar violación al reglamento</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Unidad</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.unitId} onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))} required>
            <option value="">Seleccionar...</option>
            {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
          </select>
        </div>
        <div>
          <Label>Tipo de infracción</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as typeof form.type }))}>
            {Object.entries(VIOLATION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <Label>Descripción</Label>
          <Input aria-label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Describe la infracción observada" required />
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={report.isPending} className="bg-orange-600 hover:bg-orange-700">
          {report.isPending ? "..." : "Reportar"}
        </Button>
      </div>
    </form>
  );
}

function VerificarQr({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const [code, setCode] = useState("");
  const [queryCode, setQueryCode] = useState<string | null>(null);
  const checkIn = trpc.security.visitors.checkIn.useMutation({
    onSuccess: () => { setQueryCode(null); setCode(""); },
  });

  const result = trpc.security.verifyAccessCode.useQuery(
    { organizationId, communityId, accessCode: queryCode ?? "" },
    { enabled: !!queryCode },
  );

  const onVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setQueryCode(code.trim());
  };

  const onRegisterEntry = (visitorId: string) => {
    checkIn.mutate({ organizationId, communityId, visitorId });
  };

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-blue-800">🔍 Verificar código QR</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onVerify} className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-blue-700">Código escaneado o ingresado manualmente</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Pega o escribe el código del visitante"
              className="font-mono text-sm"
              required
            />
          </div>
          <Button type="submit" size="sm" disabled={!code.trim()}>
            Verificar
          </Button>
          {queryCode && (
            <Button type="button" size="sm" variant="ghost" onClick={() => { setQueryCode(null); setCode(""); }}>
              ✕
            </Button>
          )}
        </form>

        {result.isLoading && <p className="text-sm text-blue-600">Verificando...</p>}

        {result.data && !result.isLoading && (
          <div className={`rounded-lg border p-4 space-y-2 ${result.data.found && result.data.valid ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
            {!result.data.found && (
              <p className="text-sm font-semibold text-red-700">❌ Código no encontrado. El visitante no está registrado.</p>
            )}
            {result.data.found && !result.data.valid && (
              <>
                <p className="text-sm font-semibold text-red-700">⚠️ Código inválido o vencido</p>
                {result.data.visitor && (
                  <div className="text-xs text-red-600 space-y-0.5">
                    <p>Visitante: <strong>{result.data.visitor.firstName} {result.data.visitor.lastName}</strong></p>
                    <p>Estado: <strong>{VISITOR_STATUS_LABEL[result.data.visitor.status] ?? result.data.visitor.status}</strong></p>
                    <p>Válido: {new Date(result.data.visitor.validFrom).toLocaleDateString("es-VE")} → {new Date(result.data.visitor.validUntil).toLocaleDateString("es-VE")}</p>
                    <p>Unidad: <strong>{result.data.visitor.unitCode}</strong></p>
                  </div>
                )}
              </>
            )}
            {result.data.found && result.data.valid && result.data.visitor && (
              <>
                <p className="text-sm font-semibold text-green-700">✅ Visitante autorizado</p>
                <div className="text-xs text-green-800 space-y-0.5">
                  <p>Nombre: <strong>{result.data.visitor.firstName} {result.data.visitor.lastName}</strong></p>
                  <p>Unidad: <strong>{result.data.visitor.unitCode}</strong></p>
                  {result.data.visitor.purpose && <p>Motivo: {result.data.visitor.purpose}</p>}
                  <p>Válido hasta: {new Date(result.data.visitor.validUntil).toLocaleDateString("es-VE")}</p>
                  {result.data.visitor.checkInAt && (
                    <p className="text-amber-700">⚠️ Ya registró ingreso: {new Date(result.data.visitor.checkInAt).toLocaleString("es-VE")}</p>
                  )}
                </div>
                {result.data.visitor.status === "PENDING" && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 mt-2"
                    onClick={() => onRegisterEntry(result.data!.visitor!.id)}
                    disabled={checkIn.isPending}
                  >
                    {checkIn.isPending ? "Registrando..." : "✓ Registrar ingreso"}
                  </Button>
                )}
                {checkIn.isSuccess && (
                  <p className="text-xs text-green-700 font-medium">✓ Ingreso registrado correctamente.</p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApplyFineToViolation({
  organizationId, communityId, violationId, onDone,
}: { organizationId: string; communityId: string; violationId: string; onDone: () => void }) {
  const applyFine = trpc.security.violations.applyFineToViolation.useMutation({ onSuccess: onDone });
  const [show, setShow] = useState(false);
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  if (!show) {
    return (
      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setShow(true)}>
        + Multa
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input type="number" step="0.01" min="0.01" placeholder="USD" value={amount}
        onChange={(e) => setAmount(e.target.value)} className="h-7 w-20 text-xs" />
      <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-7 w-32 text-xs" />
      <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
        disabled={applyFine.isPending || !amount}
        onClick={() => applyFine.mutate({ organizationId, communityId, violationId, amountUsd: Number(amount), dueDate: new Date(dueDate) })}>
        ✓
      </Button>
      <Button size="sm" variant="ghost" className="h-7 w-7 text-xs" onClick={() => setShow(false)}>✕</Button>
    </div>
  );
}
