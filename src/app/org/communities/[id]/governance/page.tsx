"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Tab = "board" | "assemblies" | "documents" | "certificates";

const BOARD_ROLE_LABEL: Record<string, string> = {
  PRESIDENT: "Presidente",
  VICE_PRESIDENT: "Vicepresidente",
  TREASURER: "Tesorero",
  SECRETARY: "Secretario",
  VOCAL_1: "Vocal 1",
  VOCAL_2: "Vocal 2",
  VOCAL_3: "Vocal 3",
  ALTERNATE: "Suplente",
};

const ASSEMBLY_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Convocada",
  IN_PROGRESS: "En curso",
  CLOSED: "Cerrada",
  CANCELLED: "Cancelada",
};

const ASSEMBLY_STATUS_COLOR: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-green-100 text-green-700",
  CLOSED: "bg-slate-100 text-slate-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const DOC_CATEGORY_LABEL: Record<string, string> = {
  REGULATION: "Reglamento",
  MINUTES: "Acta",
  CERTIFICATE: "Certificado",
  BUDGET: "Presupuesto",
  CONTRACT: "Contrato",
  LEGAL: "Legal",
  OTHER: "Otro",
};

export default function GovernancePage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [tab, setTab] = useState<Tab>("board");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Gobernanza</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["board", "assemblies", "documents", "certificates"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t === "board" ? "Junta Directiva" : t === "assemblies" ? "Asambleas" : t === "documents" ? "Documentos" : "Certificados"}
          </button>
        ))}
      </div>

      {tab === "board"        && <BoardTab organizationId={organizationId} communityId={communityId} />}
      {tab === "assemblies"   && <AssembliesTab organizationId={organizationId} communityId={communityId} />}
      {tab === "documents"    && <DocumentsTab organizationId={organizationId} communityId={communityId} />}
      {tab === "certificates" && <CertificatesTab organizationId={organizationId} communityId={communityId} />}
    </div>
  );
}

// ─── Junta Directiva ────────────────────────────────────────────────────────

function BoardTab({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const board = trpc.governance.board.list.useQuery({ organizationId, communityId });
  const persons = trpc.org.persons.list.useQuery({ organizationId }); // sin communityId → array plano
  const setMember = trpc.governance.board.set.useMutation();
  const removeMember = trpc.governance.board.remove.useMutation();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ personId: "", role: "PRESIDENT", startDate: new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      await setMember.mutateAsync({ organizationId, communityId, personId: form.personId, role: form.role as "PRESIDENT", startDate: new Date(form.startDate) });
      setShowForm(false);
      setForm({ personId: "", role: "PRESIDENT", startDate: new Date().toISOString().slice(0, 10) });
      void utils.governance.board.list.invalidate();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancelar" : "+ Asignar miembro"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onSubmit} className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">Asignar a la junta directiva</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Persona</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.personId} onChange={(e) => setForm((f) => ({ ...f, personId: e.target.value }))} required>
                <option value="">Seleccionar...</option>
                {Array.isArray(persons.data) && persons.data.map((p) => (
                  <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Cargo</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {Object.entries(BOARD_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <Label>Inicio del período</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
            </div>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={setMember.isPending}>{setMember.isPending ? "..." : "Asignar"}</Button>
          </div>
        </form>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {board.isLoading ? (
          <p className="text-muted-foreground text-sm col-span-4">Cargando...</p>
        ) : board.data?.length === 0 ? (
          <p className="text-muted-foreground text-sm col-span-4">Junta directiva no configurada. Asigna los miembros.</p>
        ) : board.data?.map((m) => (
          <div key={m.id} className="rounded-lg border bg-card p-4 relative">
            <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">{BOARD_ROLE_LABEL[m.role] ?? m.role}</div>
            <div className="font-semibold">{m.person.firstName} {m.person.lastName}</div>
            {m.person.email && <div className="text-xs text-muted-foreground mt-1">{m.person.email}</div>}
            {m.person.phone && <div className="text-xs text-muted-foreground">{m.person.phone}</div>}
            <div className="text-xs text-muted-foreground mt-2">Desde {new Date(m.startDate).toLocaleDateString("es-VE")}</div>
            <button
              onClick={() => { if (confirm("¿Finalizar mandato?")) removeMember.mutate({ organizationId, communityId, memberId: m.id }, { onSuccess: () => void utils.governance.board.list.invalidate() }); }}
              className="absolute top-3 right-3 text-xs text-muted-foreground hover:text-destructive">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Asambleas ──────────────────────────────────────────────────────────────

function AssembliesTab({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const assemblies = trpc.governance.assemblies.list.useQuery({ organizationId, communityId });
  const createAssembly = trpc.governance.assemblies.create.useMutation();
  const updateAssembly = trpc.governance.assemblies.update.useMutation();
  const closeAssembly = trpc.governance.assemblies.close.useMutation();
  const addItem = trpc.governance.assemblies.addAgendaItem.useMutation();
  const recordResult = trpc.governance.assemblies.recordResult.useMutation();
  const vote = trpc.governance.assemblies.vote.useMutation();
  const generatePdf = trpc.governance.assemblies.generateMinutesPdf.useMutation();
  const utils = trpc.useUtils();

  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newForm, setNewForm] = useState({ title: "", description: "", scheduledAt: "", location: "", quorumRequired: "50" });
  const [err, setErr] = useState<string | null>(null);

  const selectedAssembly = assemblies.data?.find((a) => a.id === selectedId);

  const onCreateAssembly = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      const a = await createAssembly.mutateAsync({
        organizationId, communityId,
        title: newForm.title,
        description: newForm.description || undefined,
        scheduledAt: new Date(newForm.scheduledAt),
        location: newForm.location || undefined,
        quorumRequired: Number(newForm.quorumRequired),
      });
      setShowNew(false);
      setSelectedId(a.id);
      void utils.governance.assemblies.list.invalidate();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  };

  const onDownloadPdf = async (assemblyId: string) => {
    try {
      const result = await generatePdf.mutateAsync({ organizationId, assemblyId });
      const link = document.createElement("a");
      link.href = `data:application/pdf;base64,${result.base64}`;
      link.download = result.fileName;
      link.click();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : "Error generando PDF"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setShowNew((v) => !v); setSelectedId(null); }}>{showNew ? "Cancelar" : "+ Nueva asamblea"}</Button>
      </div>

      {showNew && (
        <form onSubmit={onCreateAssembly} className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">Convocar asamblea</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Tipo / Título</Label><Input aria-label="Tipo / Título" value={newForm.title} onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ej: Asamblea Ordinaria 2026" required /></div>
            <div><Label>Fecha y hora</Label><Input type="datetime-local" value={newForm.scheduledAt} onChange={(e) => setNewForm((f) => ({ ...f, scheduledAt: e.target.value }))} required /></div>
            <div><Label>Lugar</Label><Input aria-label="Lugar" value={newForm.location} onChange={(e) => setNewForm((f) => ({ ...f, location: e.target.value }))} placeholder="Salón de usos múltiples" /></div>
            <div><Label>Quórum requerido (%)</Label><Input type="number" min="1" max="100" value={newForm.quorumRequired} onChange={(e) => setNewForm((f) => ({ ...f, quorumRequired: e.target.value }))} /></div>
            <div><Label>Descripción</Label><Input value={newForm.description} onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))} /></div>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={createAssembly.isPending}>{createAssembly.isPending ? "..." : "Convocar"}</Button>
          </div>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {/* Lista de asambleas */}
        <div className="space-y-2">
          {assemblies.isLoading ? <p className="text-sm text-muted-foreground">Cargando...</p>
            : assemblies.data?.length === 0 ? <p className="text-sm text-muted-foreground">Sin asambleas registradas.</p>
            : assemblies.data?.map((a) => (
              <button key={a.id} onClick={() => setSelectedId(a.id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${selectedId === a.id ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/30"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm truncate">{a.title}</span>
                  <span className={`text-xs rounded px-1.5 py-0.5 ml-1 shrink-0 ${ASSEMBLY_STATUS_COLOR[a.status] ?? "bg-gray-100"}`}>
                    {ASSEMBLY_STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{new Date(a.scheduledAt).toLocaleDateString("es-VE")}</div>
                <div className="text-xs text-muted-foreground">{a.agendaItems.length} puntos en agenda</div>
              </button>
            ))}
        </div>

        {/* Detalle de asamblea */}
        <div className="md:col-span-2">
          {!selectedAssembly ? (
            <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground text-sm">
              Selecciona una asamblea para ver el detalle
            </div>
          ) : (
            <AssemblyDetail
              assembly={selectedAssembly}
              organizationId={organizationId}
              communityId={communityId}
              onAddItem={(title, desc, requiresVote) =>
                addItem.mutateAsync({ organizationId, assemblyId: selectedAssembly.id, title, description: desc, requiresVote })
                  .then(() => utils.governance.assemblies.list.invalidate())}
              onRecordResult={(itemId, result, approved) =>
                recordResult.mutateAsync({ organizationId, agendaItemId: itemId, result, approved })
                  .then(() => utils.governance.assemblies.list.invalidate())}
              onClose={(attendees, quorum) =>
                closeAssembly.mutateAsync({ organizationId, assemblyId: selectedAssembly.id, attendeesCount: attendees, quorumReached: quorum })
                  .then(() => utils.governance.assemblies.list.invalidate())}
              onDownloadPdf={() => onDownloadPdf(selectedAssembly.id)}
              pdfLoading={generatePdf.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type AgendaItem = {
  id: string; order: number; title: string; description: string | null;
  requiresVote: boolean; result: string | null;
  votesFor: number; votesAgainst: number; votesAbstain: number;
  approved: boolean | null;
};

type AssemblyData = {
  id: string; title: string; description: string | null;
  scheduledAt: Date; location: string | null;
  quorumRequired: number; quorumReached: boolean | null;
  attendeesCount: number | null;
  status: string;
  agendaItems: AgendaItem[];
};

function AssemblyDetail({ assembly, organizationId, communityId, onAddItem, onRecordResult, onClose, onDownloadPdf, pdfLoading }: {
  assembly: AssemblyData;
  organizationId: string;
  communityId: string;
  onAddItem: (title: string, desc: string, vote: boolean) => Promise<unknown>;
  onRecordResult: (itemId: string, result: string | undefined, approved: boolean | undefined) => Promise<unknown>;
  onClose: (attendees: number, quorum: boolean) => Promise<unknown>;
  onDownloadPdf: () => void;
  pdfLoading: boolean;
}) {
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({ title: "", description: "", requiresVote: false });
  const [closingForm, setClosingForm] = useState({ show: false, attendees: "", quorum: true });
  const [editingResult, setEditingResult] = useState<string | null>(null);
  const [resultText, setResultText] = useState("");

  const isClosed = assembly.status === "CLOSED" || assembly.status === "CANCELLED";

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{assembly.title}</h3>
          <div className="text-sm text-muted-foreground mt-0.5">
            {new Date(assembly.scheduledAt).toLocaleDateString("es-VE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            {assembly.location && ` · ${assembly.location}`}
          </div>
          <div className="text-sm text-muted-foreground">Quórum requerido: {assembly.quorumRequired}%</div>
          {assembly.attendeesCount != null && (
            <div className="text-sm text-muted-foreground">
              Asistentes: {assembly.attendeesCount} ·
              <span className={assembly.quorumReached ? " text-green-600" : " text-red-600"}>
                {assembly.quorumReached ? " ✓ Quórum alcanzado" : " ✗ Sin quórum"}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {assembly.status === "CLOSED" && (
            <Button size="sm" variant="outline" onClick={onDownloadPdf} disabled={pdfLoading}>
              {pdfLoading ? "..." : "↓ Acta PDF"}
            </Button>
          )}
          {!isClosed && (
            <Button size="sm" variant="outline" onClick={() => setClosingForm((f) => ({ ...f, show: !f.show }))}>
              Cerrar asamblea
            </Button>
          )}
        </div>
      </div>

      {closingForm.show && (
        <div className="rounded border bg-muted/30 p-3 space-y-2">
          <p className="text-sm font-medium">Cerrar y registrar asistencia</p>
          <div className="flex gap-3 items-end">
            <div><Label>Nº de unidades asistentes</Label><Input type="number" min="0" value={closingForm.attendees} onChange={(e) => setClosingForm((f) => ({ ...f, attendees: e.target.value }))} className="w-32" /></div>
            <div className="flex items-center gap-2 pb-2">
              <input type="checkbox" id="quorum" checked={closingForm.quorum} onChange={(e) => setClosingForm((f) => ({ ...f, quorum: e.target.checked }))} />
              <label htmlFor="quorum" className="text-sm">Quórum alcanzado</label>
            </div>
            <Button size="sm" onClick={async () => {
              await onClose(Number(closingForm.attendees), closingForm.quorum);
              setClosingForm({ show: false, attendees: "", quorum: true });
            }}>Confirmar cierre</Button>
          </div>
        </div>
      )}

      {/* Agenda */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Orden del día</p>
          {!isClosed && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddItem((v) => !v)}>
              {showAddItem ? "Cancelar" : "+ Agregar punto"}
            </Button>
          )}
        </div>

        {showAddItem && (
          <div className="rounded border bg-muted/20 p-3 mb-3 space-y-2">
            <Input placeholder="título del punto" value={newItem.title} onChange={(e) => setNewItem((f) => ({ ...f, title: e.target.value }))} />
            <Input placeholder="Descripción (opcional)" value={newItem.description} onChange={(e) => setNewItem((f) => ({ ...f, description: e.target.value }))} />
            <div className="flex items-center gap-2">
              <input type="checkbox" id="req-vote" checked={newItem.requiresVote} onChange={(e) => setNewItem((f) => ({ ...f, requiresVote: e.target.checked }))} />
              <label htmlFor="req-vote" className="text-sm">Requiere votación</label>
            </div>
            <Button size="sm" onClick={async () => {
              await onAddItem(newItem.title, newItem.description, newItem.requiresVote);
              setNewItem({ title: "", description: "", requiresVote: false });
              setShowAddItem(false);
            }}>Agregar</Button>
          </div>
        )}

        <div className="space-y-2">
          {assembly.agendaItems.length === 0 && <p className="text-sm text-muted-foreground">Sin puntos en agenda.</p>}
          {assembly.agendaItems.map((item) => (
            <div key={item.id} className="rounded border p-3 space-y-1">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs text-muted-foreground mr-2">{item.order}.</span>
                  <span className="font-medium text-sm">{item.title}</span>
                  {item.requiresVote && <span className="ml-2 text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">votación</span>}
                </div>
                {item.approved != null && (
                  <span className={`text-xs font-semibold ${item.approved ? "text-green-600" : "text-red-600"}`}>
                    {item.approved ? "✓ Aprobado" : "✗ Rechazado"}
                  </span>
                )}
              </div>
              {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
              {item.requiresVote && (
                <div className="text-xs flex gap-4 text-muted-foreground mt-1">
                  <span className="text-green-600">✓ {item.votesFor} a favor</span>
                  <span className="text-red-600">✗ {item.votesAgainst} en contra</span>
                  <span className="text-amber-600">— {item.votesAbstain} abstención</span>
                </div>
              )}
              {item.result && <p className="text-xs italic text-muted-foreground mt-1">Decisión: {item.result}</p>}
              {!isClosed && editingResult !== item.id && (
                <Button size="sm" variant="ghost" className="h-6 text-xs mt-1"
                  onClick={() => { setEditingResult(item.id); setResultText(item.result ?? ""); }}>
                  Registrar decisión
                </Button>
              )}
              {editingResult === item.id && (
                <div className="flex gap-2 mt-1">
                  <Input value={resultText} onChange={(e) => setResultText(e.target.value)} placeholder="Texto de la decisión" className="text-xs h-8" />
                  <div className="flex gap-1">
                    <Button size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700"
                      onClick={async () => { await onRecordResult(item.id, resultText, true); setEditingResult(null); }}>
                      Aprobado
                    </Button>
                    <Button size="sm" variant="destructive" className="h-8 text-xs"
                      onClick={async () => { await onRecordResult(item.id, resultText, false); setEditingResult(null); }}>
                      Rechazado
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs"
                      onClick={async () => { await onRecordResult(item.id, resultText, undefined); setEditingResult(null); }}>
                      Sin voto
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Documentos ─────────────────────────────────────────────────────────────

function DocumentsTab({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const docs = trpc.governance.documents.list.useQuery({ organizationId, communityId });
  const createDoc = trpc.governance.documents.create.useMutation();
  const deleteDoc = trpc.governance.documents.delete.useMutation();
  const utils = trpc.useUtils();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "REGULATION", fileUrl: "", fileName: "" });
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      await createDoc.mutateAsync({ organizationId, communityId, category: form.category as "REGULATION", title: form.title, description: form.description || undefined, fileUrl: form.fileUrl, fileName: form.fileName });
      setShowForm(false);
      setForm({ title: "", description: "", category: "REGULATION", fileUrl: "", fileName: "" });
      void utils.governance.documents.list.invalidate();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancelar" : "+ Agregar documento"}</Button>
      </div>

      {showForm && (
        <form onSubmit={onSubmit} className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">Registrar documento</p>
          <p className="text-xs text-muted-foreground">Sube el archivo a tu almacenamiento (MinIO/S3) y pega la URL pública aquí.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Título</Label><Input aria-label="Título" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required /></div>
            <div>
              <Label>Categoría</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {Object.entries(DOC_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="col-span-2"><Label>URL del archivo</Label><Input aria-label="URL del archivo" value={form.fileUrl} onChange={(e) => setForm((f) => ({ ...f, fileUrl: e.target.value }))} placeholder="https://..." required /></div>
            <div><Label>Nombre del archivo</Label><Input aria-label="Nombre del archivo" value={form.fileName} onChange={(e) => setForm((f) => ({ ...f, fileName: e.target.value }))} placeholder="reglamento-2026.pdf" required /></div>
            <div><Label>Descripción</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={createDoc.isPending}>{createDoc.isPending ? "..." : "Guardar"}</Button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-4 py-2">Título</th>
              <th className="px-4 py-2">Categoría</th>
              <th className="px-4 py-2">Subido por</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {docs.isLoading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Cargando...</td></tr>
            ) : docs.data?.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Sin documentos registrados</td></tr>
            ) : docs.data?.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="px-4 py-2">
                  <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline text-primary">
                    {d.title}
                  </a>
                  {d.description && <div className="text-xs text-muted-foreground">{d.description}</div>}
                </td>
                <td className="px-4 py-2">
                  <span className="text-xs rounded bg-slate-100 text-slate-700 px-2 py-0.5">{DOC_CATEGORY_LABEL[d.category] ?? d.category}</span>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{d.uploadedBy?.name ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString("es-VE")}</td>
                <td className="px-4 py-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => { if (confirm("¿Eliminar este documento?")) deleteDoc.mutate({ organizationId, documentId: d.id }, { onSuccess: () => void utils.governance.documents.list.invalidate() }); }}>
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Certificados ────────────────────────────────────────────────────────────

function CertificatesTab({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const genCert = trpc.governance.nonDebtCert.useMutation();

  const [form, setForm] = useState({ unitId: "", validDays: "30" });
  const [result, setResult] = useState<{ hasDebt: boolean; balanceUsd: string } | null>(null);

  const onGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    const data = await genCert.mutateAsync({ organizationId, communityId, unitId: form.unitId, validDays: Number(form.validDays) });
    setResult({ hasDebt: data.hasDebt, balanceUsd: data.balanceUsd });
    // Descarga automática
    const link = document.createElement("a");
    link.href = `data:application/pdf;base64,${data.base64}`;
    link.download = data.fileName;
    link.click();
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h3 className="text-sm font-semibold mb-1">Certificado de solvencia (no-adeudo)</h3>
        <p className="text-sm text-muted-foreground">
          Genera un PDF firmable con el estado de deuda actual de la unidad. Válido para notarías y transacciones.
        </p>
      </div>

      <form onSubmit={onGenerate} className="space-y-4">
        <div>
          <Label>Unidad</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.unitId} onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))} required>
            <option value="">Seleccionar unidad...</option>
            {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code}{u.floor != null ? ` — Piso ${u.floor}` : ""}</option>)}
          </select>
        </div>
        <div>
          <Label>Validez del certificado</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.validDays} onChange={(e) => setForm((f) => ({ ...f, validDays: e.target.value }))}>
            <option value="7">7 días</option>
            <option value="15">15 días</option>
            <option value="30">30 días</option>
            <option value="60">60 días</option>
            <option value="90">90 días</option>
          </select>
        </div>
        <Button type="submit" disabled={genCert.isPending || !form.unitId} className="w-full">
          {genCert.isPending ? "Generando PDF..." : "↓ Generar y descargar certificado"}
        </Button>
      </form>

      {result && (
        <div className={`rounded-lg border p-4 ${result.hasDebt ? "border-red-300 bg-red-50" : "border-green-300 bg-green-50"}`}>
          <p className={`font-semibold ${result.hasDebt ? "text-red-700" : "text-green-700"}`}>
            {result.hasDebt ? `⚠ Unidad con deuda: $${result.balanceUsd} USD` : "✓ Unidad solvente — sin deuda pendiente"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">El PDF se descargó automáticamente.</p>
        </div>
      )}
    </div>
  );
}
