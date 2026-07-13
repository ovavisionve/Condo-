"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SearchableSelect } from "@/components/SearchableSelect";

const STATUS_LABEL: Record<string, string> = { OPEN: "Abierto", RESOLVED: "Resuelto" };
const STATUS_COLOR: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-slate-100 text-slate-700",
};

export default function LegalPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [tab, setTab] = useState<"cases" | "lawyers">("cases");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">⚖️ Legal</h1>
        <p className="text-sm text-muted-foreground">
          Casos de cobranza judicial/extrajudicial: asigna un abogado a un residente moroso y cóbrale un
          honorario legal aparte de su cuota normal.
        </p>
      </div>

      <div className="flex gap-2 border-b">
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === "cases" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          onClick={() => setTab("cases")}
        >
          Casos legales
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === "lawyers" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          onClick={() => setTab("lawyers")}
        >
          Abogados
        </button>
      </div>

      {tab === "cases" ? (
        <CasesTab organizationId={organizationId} communityId={communityId} />
      ) : (
        <LawyersTab organizationId={organizationId} />
      )}
    </div>
  );
}

// ─── Casos legales ─────────────────────────────────────────────────────────

function CasesTab({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const utils = trpc.useUtils();
  const units = trpc.org.units.list.useQuery({ organizationId, communityId });
  const lawyers = trpc.legal.lawyers.list.useQuery({ organizationId });
  const cases = trpc.legal.cases.list.useQuery({ organizationId, communityId });
  const createCase = trpc.legal.cases.create.useMutation({
    onSuccess: () => {
      setShowForm(false);
      setForm({ unitId: "", lawyerId: "", description: "" });
      void utils.legal.cases.list.invalidate();
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ unitId: "", lawyerId: "", description: "" });

  const lawyerOptions = (lawyers.data ?? []).map((l) => ({ value: l.id, label: l.name }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!showForm && <Button onClick={() => setShowForm(true)}>+ Nuevo caso</Button>}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nuevo caso legal</CardTitle>
            <CardDescription>Selecciona la unidad morosa y, si ya lo sabes, el abogado asignado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
              <Label>Abogado (opcional, se puede asignar después)</Label>
              <SearchableSelect
                value={form.lawyerId}
                onChange={(v) => setForm((f) => ({ ...f, lawyerId: v }))}
                placeholder="Buscar abogado..."
                options={lawyerOptions}
              />
            </div>
            <div>
              <Label>Motivo del caso</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Ej: cobro judicial de deuda acumulada"
              />
            </div>
            {createCase.error && <p className="text-sm text-destructive">{createCase.error.message}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button
                disabled={!form.unitId || form.description.trim().length < 5 || createCase.isPending}
                onClick={() =>
                  createCase.mutate({
                    organizationId, communityId,
                    unitId: form.unitId,
                    lawyerId: form.lawyerId || undefined,
                    description: form.description.trim(),
                  })
                }
              >
                {createCase.isPending ? "Creando..." : "Crear caso"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="rounded-lg border bg-card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Propietario</th>
              <th className="px-3 py-2">Abogado</th>
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Honorario</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {cases.isLoading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Cargando...</td></tr>
            ) : !cases.data || cases.data.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sin casos legales registrados</td></tr>
            ) : (
              cases.data.map((c) => {
                const ownerName = c.unit.ownerships[0]?.person
                  ? `${c.unit.ownerships[0].person.firstName} ${c.unit.ownerships[0].person.lastName}`
                  : "—";
                return (
                  <tr key={c.id} className="border-t hover:bg-muted/30 align-top">
                    <td className="px-3 py-2 font-medium">{c.unit.code}</td>
                    <td className="px-3 py-2 text-muted-foreground">{ownerName}</td>
                    <td className="px-3 py-2">
                      <LawyerAssign
                        organizationId={organizationId}
                        caseId={c.id}
                        currentLawyerId={c.lawyer?.id ?? ""}
                        currentLawyerName={c.lawyer?.name ?? null}
                        lawyerOptions={lawyerOptions}
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[220px]">{c.description}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {c.feeInvoice ? (
                        <div className="text-xs">
                          <div className="font-semibold text-green-700">${Number(c.feeInvoice.totalUsd).toFixed(2)}</div>
                          <div className="text-muted-foreground font-mono">{c.feeInvoice.invoiceNumber}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin cobrar</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1 items-end">
                        {!c.feeInvoice && (
                          <ChargeFee organizationId={organizationId} communityId={communityId} caseId={c.id} />
                        )}
                        {c.status === "OPEN" && (
                          <ResolveCase organizationId={organizationId} caseId={c.id} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LawyerAssign({
  organizationId, caseId, currentLawyerId, currentLawyerName, lawyerOptions,
}: {
  organizationId: string; caseId: string; currentLawyerId: string;
  currentLawyerName: string | null; lawyerOptions: { value: string; label: string }[];
}) {
  const utils = trpc.useUtils();
  const assign = trpc.legal.cases.assignLawyer.useMutation({
    onSuccess: () => void utils.legal.cases.list.invalidate(),
  });
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button className="text-left hover:underline" onClick={() => setEditing(true)}>
        {currentLawyerName ?? <span className="text-amber-700 text-xs">Sin asignar</span>}
      </button>
    );
  }

  return (
    <div className="w-40">
      <SearchableSelect
        value={currentLawyerId}
        onChange={(v) => {
          assign.mutate({ organizationId, caseId, lawyerId: v || null });
          setEditing(false);
        }}
        placeholder="Buscar abogado..."
        options={lawyerOptions}
      />
    </div>
  );
}

function ChargeFee({ organizationId, communityId, caseId }: { organizationId: string; communityId: string; caseId: string }) {
  const utils = trpc.useUtils();
  const chargeFee = trpc.legal.cases.chargeFee.useMutation({
    onSuccess: () => void utils.legal.cases.list.invalidate(),
  });
  const [show, setShow] = useState(false);
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  if (!show) {
    return (
      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setShow(true)}>
        💰 Cobrar honorario
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input type="number" step="0.01" min="0.01" placeholder="USD" value={amount}
        onChange={(e) => setAmount(e.target.value)} className="h-7 w-20 text-xs" />
      <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-7 w-32 text-xs" />
      <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
        disabled={chargeFee.isPending || !amount}
        onClick={() => chargeFee.mutate({ organizationId, communityId, caseId, amountUsd: Number(amount), dueDate: new Date(dueDate) })}>
        ✓
      </Button>
      <Button size="sm" variant="ghost" className="h-7 w-7 text-xs" onClick={() => setShow(false)}>✕</Button>
    </div>
  );
}

function ResolveCase({ organizationId, caseId }: { organizationId: string; caseId: string }) {
  const utils = trpc.useUtils();
  const resolve = trpc.legal.cases.resolve.useMutation({
    onSuccess: () => void utils.legal.cases.list.invalidate(),
  });
  return (
    <Button
      size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground"
      disabled={resolve.isPending}
      onClick={() => {
        if (!confirm("¿Marcar este caso como resuelto?")) return;
        resolve.mutate({ organizationId, caseId });
      }}
    >
      ✓ Resolver
    </Button>
  );
}

// ─── Abogados ────────────────────────────────────────────────────────────

function LawyersTab({ organizationId }: { organizationId: string }) {
  const utils = trpc.useUtils();
  const lawyers = trpc.legal.lawyers.list.useQuery({ organizationId, includeInactive: true });
  const createLawyer = trpc.legal.lawyers.create.useMutation({
    onSuccess: () => {
      setShowForm(false);
      setForm({ name: "", specialty: "", phone: "", email: "", notes: "" });
      void utils.legal.lawyers.list.invalidate();
    },
  });
  const updateLawyer = trpc.legal.lawyers.update.useMutation({
    onSuccess: () => void utils.legal.lawyers.list.invalidate(),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", specialty: "", phone: "", email: "", notes: "" });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!showForm && <Button onClick={() => setShowForm(true)}>+ Agregar abogado</Button>}
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Nuevo abogado / despacho</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Nombre *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div><Label>Especialidad</Label><Input value={form.specialty} onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))} placeholder="Cobranza judicial, civil..." /></div>
              <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <div><Label>Notas</Label><Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            {createLawyer.error && <p className="text-sm text-destructive">{createLawyer.error.message}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button
                disabled={form.name.trim().length < 2 || createLawyer.isPending}
                onClick={() => createLawyer.mutate({
                  organizationId,
                  name: form.name.trim(),
                  specialty: form.specialty || undefined,
                  phone: form.phone || undefined,
                  email: form.email || undefined,
                  notes: form.notes || undefined,
                })}
              >
                {createLawyer.isPending ? "Guardando..." : "Crear"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="rounded-lg border bg-card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Especialidad</th>
              <th className="px-3 py-2">Contacto</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!lawyers.data || lawyers.data.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sin abogados registrados</td></tr>
            ) : (
              lawyers.data.map((l) => (
                <tr key={l.id} className={`border-t hover:bg-muted/30 ${!l.active ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 font-medium">{l.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.specialty ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {l.phone ?? "—"}{l.email ? ` · ${l.email}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm" variant="outline" className="h-6 text-xs"
                      onClick={() => updateLawyer.mutate({ organizationId, id: l.id, active: !l.active })}
                    >
                      {l.active ? "Desactivar" : "Activar"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
