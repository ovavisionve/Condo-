"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableSelect } from "@/components/SearchableSelect";

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

const NOTE_CATEGORY_INFO: Record<string, { label: string; icon: string; color: string }> = {
  PATROL:        { label: "Recorrido",          icon: "🚶", color: "bg-blue-100 text-blue-800" },
  UTILITY_VISIT: { label: "Visita empresa",     icon: "🔌", color: "bg-yellow-100 text-yellow-800" },
  MAINTENANCE:   { label: "Mantenimiento",      icon: "🔧", color: "bg-orange-100 text-orange-800" },
  INCIDENT:      { label: "Incidente",          icon: "⚠️", color: "bg-red-100 text-red-800" },
  DELIVERY:      { label: "Entrega/Paquetería", icon: "📦", color: "bg-purple-100 text-purple-800" },
  MEETING:       { label: "Reunión",            icon: "👥", color: "bg-indigo-100 text-indigo-800" },
  OTHER:         { label: "Otro",               icon: "📝", color: "bg-slate-100 text-slate-700" },
};

type Tab = "visitors" | "access-log" | "violations" | "novedades";

export default function SecurityPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [tab, setTab] = useState<Tab>("visitors");
  const [showNewVisitor, setShowNewVisitor] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [showWalkInLog, setShowWalkInLog] = useState(false);
  const [showViolation, setShowViolation] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [filterDate, setFilterDate] = useState(today);
  const [noteFilterDate, setNoteFilterDate] = useState(today);

  const visitors   = trpc.security.visitors.list.useQuery({ organizationId, communityId });
  const todayLog   = trpc.security.accessLog.list.useQuery({ organizationId, communityId, date: new Date(today), take: 100 });
  const accessLog  = trpc.security.accessLog.list.useQuery({ organizationId, communityId, date: new Date(filterDate), take: 100 });
  const violations = trpc.security.violations.list.useQuery({ organizationId, communityId });
  const notes      = trpc.security.notes.list.useQuery({ organizationId, communityId, date: new Date(noteFilterDate) });
  const utils = trpc.useUtils();

  const checkIn  = trpc.security.visitors.checkIn.useMutation({ onSuccess: () => void utils.security.visitors.list.invalidate() });
  const checkOut = trpc.security.visitors.checkOut.useMutation({ onSuccess: () => void utils.security.visitors.list.invalidate() });
  const deny     = trpc.security.visitors.deny.useMutation({ onSuccess: () => void utils.security.visitors.list.invalidate() });
  const resolve  = trpc.security.violations.resolve.useMutation({ onSuccess: () => void utils.security.violations.list.invalidate() });

  const pendingVisitors = visitors.data?.filter((v) => v.status === "PENDING") ?? [];
  // Orden para el vigilante: PENDING primero (los que están por llegar), después
  // CHECKED_IN (los que están adentro), después el resto. Dentro de cada grupo,
  // por fecha de creación descendente (más recientes arriba).
  const allVisitors = (visitors.data ?? []).slice().sort((a, b) => {
    const order: Record<string, number> = { PENDING: 0, CHECKED_IN: 1, CHECKED_OUT: 2, DENIED: 3, EXPIRED: 4 };
    const oa = order[a.status] ?? 9;
    const ob = order[b.status] ?? 9;
    if (oa !== ob) return oa - ob;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Reloj en tiempo real para el vigilante (pedido del cliente)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clockTime = now.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const clockDate = now.toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  // Visitas del día sin pre-autorización (walk-ins con unidad asignada)
  const todayWalkIns    = todayLog.data?.filter((l) => !l.visitor && l.direction === "IN") ?? [];

  const invalidateVisitorsAndLog = () => {
    void utils.security.visitors.list.invalidate();
    void utils.security.accessLog.list.invalidate();
  };

  return (
    <div className="space-y-4">
      {/* Reloj en tiempo real para el vigilante */}
      <div className="rounded-lg border bg-gradient-to-r from-slate-900 to-slate-700 text-white px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-80">Hora actual del servidor</p>
          <p className="text-2xl font-mono font-bold tabular-nums">{clockTime}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide opacity-80">Fecha</p>
          <p className="text-sm font-medium capitalize">{clockDate}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Seguridad y Acceso</h2>
        <div className="flex gap-2">
          {tab === "visitors" && (
            <>
              <Button size="sm" variant="outline" onClick={() => { setShowWalkIn(true); setShowNewVisitor(false); }}>
                👤 Registrar visita
              </Button>
              <Button size="sm" onClick={() => { setShowNewVisitor(true); setShowWalkIn(false); }}>
                + Pre-autorizar visitante
              </Button>
            </>
          )}
          {tab === "access-log" && (
            <Button size="sm" variant="outline" onClick={() => setShowWalkInLog(true)}>+ Registro manual</Button>
          )}
          {tab === "violations" && (
            <Button size="sm" variant="outline" onClick={() => setShowViolation(true)}>+ Reportar violación</Button>
          )}
          {tab === "novedades" && (
            <Button size="sm" onClick={() => setShowNote(true)}>+ Nueva novedad</Button>
          )}
        </div>
      </div>

      {/* ── Stats rápidas ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Visitantes dentro" value={visitors.data?.filter((v) => v.status === "CHECKED_IN").length ?? 0} color="green" />
        <StatCard label="Pendientes hoy" value={pendingVisitors.length} color="amber" />
        <StatCard label="Violaciones abiertas" value={violations.data?.filter((v) => !v.resolvedAt).length ?? 0} color="red" />
        <StatCard label="Novedades hoy" value={notes.data?.length ?? 0} color="blue" />
      </div>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {(["visitors", "access-log", "violations", "novedades"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap px-3 py-2 text-sm border-b-2 transition-colors ${tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t === "visitors" ? "👤 Visitantes"
              : t === "access-log" ? "🚪 Log de accesos"
              : t === "violations" ? "⚠️ Violaciones"
              : "📋 Novedades"}
          </button>
        ))}
      </div>

      {/* ── Visitantes ────────────────────────────────────── */}
      {tab === "visitors" && (
        <div className="space-y-4">
          {/* Formulario registrar visita sin pre-autorización */}
          {showWalkIn && (
            <WalkInForm
              organizationId={organizationId}
              communityId={communityId}
              requireUnit
              onCreated={() => { setShowWalkIn(false); invalidateVisitorsAndLog(); }}
              onCancel={() => setShowWalkIn(false)}
            />
          )}

          {/* Formulario pre-autorizar */}
          {showNewVisitor && (
            <NewVisitorForm
              organizationId={organizationId}
              communityId={communityId}
              onCreated={() => { setShowNewVisitor(false); void utils.security.visitors.list.invalidate(); }}
              onCancel={() => setShowNewVisitor(false)}
            />
          )}

          {/* Verificador de QR */}
          <VerificarQr organizationId={organizationId} communityId={communityId} />

          {/* Visitas del día sin pre-autorización */}
          {todayWalkIns.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">Visitas de hoy sin pre-autorización ({todayWalkIns.length})</p>
              <div className="space-y-2">
                {todayWalkIns.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 rounded-xl border bg-card p-3">
                    <div className="flex flex-col items-center min-w-[44px]">
                      <span className="text-lg">👤</span>
                      <span className="text-[10px] text-muted-foreground font-mono mt-1">
                        {new Date(log.createdAt).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{log.personName}</span>
                        {log.unit?.code && (
                          <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                            Apt {log.unit.code}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {log.personId_doc && <span className="text-xs text-muted-foreground">🪪 {log.personId_doc}</span>}
                        {log.vehiclePlate && <span className="text-xs text-muted-foreground">🚗 {log.vehiclePlate}</span>}
                        {log.purpose && <span className="text-xs text-muted-foreground">📌 {log.purpose}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Visitantes pre-autorizados — PENDING primero para el vigilante */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-muted-foreground">
                Pre-autorizados — Solicitados por residentes
              </p>
              {pendingVisitors.length > 0 && (
                <span className="rounded-full bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5">
                  {pendingVisitors.length} POR LLEGAR
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              💡 Cuando el visitante llegue, preguntá su nombre, buscalo abajo y aprieta <strong>✓ Ingreso</strong>.
            </p>
            {visitors.isLoading ? (
              <div className="text-center py-6 text-muted-foreground text-sm">Cargando...</div>
            ) : allVisitors.length === 0 ? (
              <div className="rounded-xl border border-dashed py-8 text-center text-muted-foreground text-sm">
                Sin visitantes pre-autorizados
              </div>
            ) : (
              <div className="space-y-2">
                {allVisitors.map((v) => (
                  <div
                    key={v.id}
                    className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center gap-3 ${
                      v.status === "PENDING"
                        ? "bg-amber-50 border-amber-300 shadow-sm"
                        : v.status === "CHECKED_IN"
                        ? "bg-emerald-50/40 border-emerald-200"
                        : "bg-card"
                    }`}
                  >
                    {/* Info visitante */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{v.firstName} {v.lastName}</span>
                        <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                          Apt {v.unit.code}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${VISITOR_STATUS_COLOR[v.status] ?? "bg-gray-100"}`}>
                          {VISITOR_STATUS_LABEL[v.status] ?? v.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {v.idNumber && <span className="text-xs text-muted-foreground">🪪 {v.idType}-{v.idNumber}</span>}
                        {v.vehiclePlate && <span className="text-xs text-muted-foreground">🚗 {v.vehiclePlate}</span>}
                        {v.purpose && <span className="text-xs text-muted-foreground">📌 {v.purpose}</span>}
                        <span className="text-xs text-muted-foreground">
                          📅 {new Date(v.validFrom).toLocaleDateString("es-VE")} → {new Date(v.validUntil).toLocaleDateString("es-VE")}
                        </span>
                      </div>
                    </div>
                    {/* Acciones */}
                    <div className="flex gap-2 flex-shrink-0">
                      {v.status === "PENDING" && (
                        <>
                          <Button size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700"
                            onClick={() => checkIn.mutate({ organizationId, communityId, visitorId: v.id })}>
                            ✓ Ingreso
                          </Button>
                          <Button size="sm" variant="destructive" className="h-8 text-xs"
                            onClick={() => { const r = prompt("Motivo de denegación:"); if (r) deny.mutate({ organizationId, communityId, visitorId: v.id, reason: r }); }}>
                            Denegar
                          </Button>
                        </>
                      )}
                      {v.status === "CHECKED_IN" && (
                        <Button size="sm" variant="outline" className="h-8 text-xs"
                          onClick={() => checkOut.mutate({ organizationId, communityId, visitorId: v.id })}>
                          Salida ↑
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
          {showWalkInLog && (
            <WalkInForm
              organizationId={organizationId}
              communityId={communityId}
              onCreated={() => { setShowWalkInLog(false); void utils.security.accessLog.list.invalidate(); }}
              onCancel={() => setShowWalkInLog(false)}
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
                      {log.visitor && <div className="text-xs text-blue-600 mt-0.5">Pre-autorizado</div>}
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

      {/* ── Novedades del día ─────────────────────────────── */}
      {tab === "novedades" && (
        <div className="space-y-4">
          {/* Selector de fecha */}
          <div className="flex flex-wrap items-center gap-3">
            <Label className="text-sm text-muted-foreground">Fecha:</Label>
            <Input
              type="date"
              value={noteFilterDate}
              onChange={(e) => setNoteFilterDate(e.target.value)}
              className="h-9 w-44"
            />
            <span className="text-xs text-muted-foreground">
              {notes.data?.length ?? 0} {notes.data?.length === 1 ? "novedad" : "novedades"}
            </span>
          </div>

          {/* Formulario nueva novedad */}
          {showNote && (
            <NoteForm
              organizationId={organizationId}
              communityId={communityId}
              onCreated={() => { setShowNote(false); void utils.security.notes.list.invalidate(); }}
              onCancel={() => setShowNote(false)}
            />
          )}

          {/* Lista de novedades */}
          {notes.isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Cargando...</div>
          ) : notes.data?.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 py-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-sm font-medium text-muted-foreground">Sin novedades registradas</p>
              <p className="text-xs text-muted-foreground mt-1">Registra recorridos, visitas de empresas, incidentes y cualquier evento del día.</p>
              {!showNote && (
                <Button size="sm" className="mt-4" onClick={() => setShowNote(true)}>
                  + Registrar primera novedad
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {notes.data?.map((note) => {
                const info = NOTE_CATEGORY_INFO[note.category] ?? NOTE_CATEGORY_INFO.OTHER!;
                return (
                  <div key={note.id} className="flex gap-3 rounded-xl border bg-card p-4">
                    {/* Hora + icono */}
                    <div className="flex flex-col items-center gap-1 min-w-[52px]">
                      <span className="text-xl">{info.icon}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(note.createdAt).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {/* Contenido */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${info.color}`}>
                          {info.label}
                        </span>
                        {note.reportedBy && (
                          <span className="text-xs text-muted-foreground">
                            Vigilante: <span className="font-medium">{note.reportedBy}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">{note.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
          <SearchableSelect
            value={form.unitId}
            onChange={(v) => setForm((f) => ({ ...f, unitId: v }))}
            placeholder="Buscar unidad..."
            options={(units.data ?? []).map((u) => ({ value: u.id, label: u.code }))}
          />
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
  organizationId, communityId, requireUnit = false, onCreated, onCancel,
}: { organizationId: string; communityId: string; requireUnit?: boolean; onCreated: () => void; onCancel: () => void }) {
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const register = trpc.security.accessLog.registerWalkIn.useMutation();
  const [form, setForm] = useState({
    personName: "", personId_doc: "", vehiclePlate: "", purpose: "",
    unitId: "", direction: "IN" as "IN" | "OUT",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await register.mutateAsync({
        organizationId, communityId,
        personName: form.personName,
        personId_doc: form.personId_doc || undefined,
        vehiclePlate: form.vehiclePlate || undefined,
        purpose: form.purpose || undefined,
        unitId: form.unitId || undefined,
        direction: form.direction,
      });
      onCreated();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">👤</span>
        <p className="text-sm font-semibold text-blue-900">Registrar visita sin pre-autorización</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2">
          <Label>Nombre completo <span className="text-destructive">*</span></Label>
          <Input aria-label="Nombre completo" value={form.personName} onChange={set("personName")} placeholder="Juan Pérez" required />
        </div>
        <div>
          <Label>Cédula</Label>
          <Input aria-label="Cédula" value={form.personId_doc} onChange={set("personId_doc")} placeholder="V-12345678" />
        </div>
        <div>
          <Label>Placa vehículo</Label>
          <Input value={form.vehiclePlate} onChange={set("vehiclePlate")} placeholder="ABC-123" />
        </div>
        <div>
          <Label>Unidad que visita {requireUnit && <span className="text-destructive">*</span>}</Label>
          <SearchableSelect
            value={form.unitId}
            onChange={(v) => setForm((f) => ({ ...f, unitId: v }))}
            placeholder={requireUnit ? "Buscar unidad..." : "Sin unidad (opcional)"}
            options={(units.data ?? []).map((u) => ({ value: u.id, label: u.code }))}
          />
        </div>
        <div>
          <Label>Dirección</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.direction} onChange={set("direction")}>
            <option value="IN">↓ Ingreso</option>
            <option value="OUT">↑ Salida</option>
          </select>
        </div>
        <div className="col-span-2">
          <Label>Motivo de visita</Label>
          <Input aria-label="Motivo" value={form.purpose} onChange={set("purpose")} placeholder="Ej: Visita familiar, Delivery, Técnico..." />
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={register.isPending} className="bg-blue-600 hover:bg-blue-700">
          {register.isPending ? "..." : "✓ Registrar ingreso"}
        </Button>
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
          <SearchableSelect
            value={form.unitId}
            onChange={(v) => setForm((f) => ({ ...f, unitId: v }))}
            placeholder="Buscar unidad..."
            options={(units.data ?? []).map((u) => ({ value: u.id, label: u.code }))}
          />
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

function NoteForm({
  organizationId, communityId, onCreated, onCancel,
}: { organizationId: string; communityId: string; onCreated: () => void; onCancel: () => void }) {
  const create = trpc.security.notes.create.useMutation();
  const [form, setForm] = useState({
    category: "OTHER" as keyof typeof NOTE_CATEGORY_INFO,
    description: "",
    reportedBy: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({
        organizationId, communityId,
        category: form.category as "PATROL" | "UTILITY_VISIT" | "MAINTENANCE" | "INCIDENT" | "DELIVERY" | "MEETING" | "OTHER",
        description: form.description,
        reportedBy: form.reportedBy || undefined,
      });
      onCreated();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-lg">{NOTE_CATEGORY_INFO[form.category]?.icon ?? "📋"}</span>
        <p className="text-sm font-semibold">Registrar novedad del día</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Categoría */}
        <div>
          <Label className="text-xs mb-1.5 block">Tipo de novedad</Label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(NOTE_CATEGORY_INFO).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => setForm((f) => ({ ...f, category: k as keyof typeof NOTE_CATEGORY_INFO }))}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                  form.category === k
                    ? `${v.color} border-transparent shadow-sm scale-105`
                    : "border-border text-muted-foreground hover:border-foreground/30"
                }`}
              >
                <span>{v.icon}</span>
                <span>{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Vigilante */}
        <div>
          <Label className="text-xs">Vigilante de turno (opcional)</Label>
          <Input
            value={form.reportedBy}
            onChange={(e) => setForm((f) => ({ ...f, reportedBy: e.target.value }))}
            placeholder="Nombre del vigilante"
            className="mt-1.5"
          />
        </div>
      </div>

      {/* Descripción */}
      <div>
        <Label className="text-xs">Descripción <span className="text-destructive">*</span></Label>
        <textarea
          required
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder={
            form.category === "PATROL" ? "Ej: Recorrido completo del edificio, sin novedades. Piso 1–10 revisados." :
            form.category === "UTILITY_VISIT" ? "Ej: Visita de técnicos de Corpoelec para revisión de medidores. Ingresaron a las 9:00 am." :
            form.category === "INCIDENT" ? "Ej: Fuga de agua en la planta baja frente al ascensor. Se notificó al encargado." :
            "Describe la novedad con el mayor detalle posible..."
          }
          rows={3}
          className="mt-1.5 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
        />
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={create.isPending || !form.description.trim()}>
          {create.isPending ? "Guardando..." : "✓ Guardar novedad"}
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
