"use client";

import { useParams } from "next/navigation";
import { useRef, useState, useMemo } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/SearchableSelect";

const VEHICLE_TYPES: Record<string, string> = {
  CAR: "Carro", MOTORCYCLE: "Moto", TRUCK: "Camión", VAN: "Van", OTHER: "Otro",
};

/** Parse CSV básico. Soporta comas y punto y coma como delimitador. */
function parseCSV(text: string): string[][] {
  const delimiter = text.includes(";") ? ";" : ",";
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, "")));
}

const CSV_TEMPLATE = `unidad,nombre,apellido,tipo_id,numero_id,email,telefono,whatsapp,rol
A-101,Juan,Pérez,CEDULA_V,12345678,juan@email.com,04141234567,584141234567,OWNER
A-102,María,García,CEDULA_V,87654321,,,584240987654,TENANT`;

type DebtInfo = {
  pendingUsd: string;
  overdueCount: number;
  pendingCount: number;
  lastPaymentAt: Date | string | null;
};

type PersonData = {
  id: string;
  firstName: string;
  lastName: string;
  idType: string;
  idNumber: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  vehicles: Array<{ id: string; type: string; plate?: string | null; brand?: string | null; model?: string | null; color?: string | null }>;
};

// ─── Badge de deuda ────────────────────────────────────────────────────────
function DebtBadge({ debt }: { debt: DebtInfo }) {
  const pending = Number(debt.pendingUsd);
  if (pending <= 0.005) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">✓ Solvente</span>;
  }
  if (debt.overdueCount > 0) {
    return (
      <div className="space-y-0.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          ⚠ ${pending.toFixed(2)} · {debt.overdueCount} vencida{debt.overdueCount !== 1 ? "s" : ""}
        </span>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
      ${pending.toFixed(2)} · {debt.pendingCount} pendiente{debt.pendingCount !== 1 ? "s" : ""}
    </span>
  );
}

export default function ResidentsPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvRows, setCsvRows] = useState<ReturnType<typeof parseCSV>>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const [search, setSearch] = useState("");

  const { data, refetch } = trpc.org.persons.list.useQuery({ organizationId, communityId });
  const bulkImport = trpc.org.persons.bulkImport.useMutation();

  // Marca "⚖️ En abogado" — unidades con un caso legal (LegalCase) OPEN.
  const { data: openLegalCases } = trpc.legal.cases.list.useQuery({ organizationId, communityId, status: "OPEN" });
  const legalUnitCodes = useMemo(
    () => new Set((openLegalCases ?? []).map((c) => c.unit.code)),
    [openLegalCases],
  );

  // --- Formulario manual ---
  const [showForm, setShowForm] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [idType, setIdType] = useState<"CEDULA_V" | "CEDULA_E" | "PASSPORT" | "OTHER">("CEDULA_V");
  const [idNumber, setIdNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [role, setRole] = useState<"OWNER" | "TENANT">("OWNER");
  const [unitId, setUnitId] = useState("");

  // --- Edición de residente ---
  const [editPerson, setEditPerson] = useState<PersonData | null>(null);
  const updatePerson = trpc.org.persons.update.useMutation();

  const { data: unitsData } = trpc.org.units.list.useQuery({ organizationId, communityId });
  const units = Array.isArray(unitsData) ? unitsData : [];

  const createPerson = trpc.org.persons.create.useMutation();
  const assignOwner = trpc.org.persons.assignOwner.useMutation();
  const assignTenant = trpc.org.persons.assignTenant.useMutation();
  const sendCredentials = trpc.org.persons.sendPortalCredentials.useMutation();
  const sendAccessToAll = trpc.org.persons.sendPortalAccessToAll.useMutation();
  const [accessAllMsg, setAccessAllMsg] = useState<string | null>(null);

  const handleSendAccessToAll = async () => {
    const conEmail = residents.ownerships.filter((o) => (o as { person: { email?: string | null } }).person.email).length;
    if (!window.confirm(`Se enviará el correo de acceso/tutorial (con enlace al portal) a todos los propietarios con email registrado (~${conEmail}). ¿Continuar?`)) return;
    setAccessAllMsg("Enviando… esto puede tardar hasta 1-2 minutos, no cierres la pestaña.");
    try {
      const r = await sendAccessToAll.mutateAsync({ organizationId, communityId });
      let msg = `✅ Enviados ${r.enviados} de ${r.conEmail} · ${r.fallidos} fallidos · ${r.sinEmail} sin email (de ${r.totalPropietarios} propietarios).`;
      const detalle = (r as { fallidosDetalle?: { to: string; error: string }[] }).fallidosDetalle ?? [];
      if (detalle.length > 0) {
        msg += `\n\nCorreos que aún fallaron tras los reintentos (revisa que estén bien escritos; vuelve a darle "Enviar tutorial a TODOS" y se reintentarán):\n` +
          detalle.map((f) => `• ${f.to}`).join("\n");
      } else if (r.fallidos === 0) {
        msg += ` 🎉 Todos entregados.`;
      }
      setAccessAllMsg(msg);
    } catch (err) {
      setAccessAllMsg(`❌ ${err instanceof Error ? err.message : "Error al enviar."}`);
    }
  };

  const resetForm = () => {
    setFirstName(""); setLastName(""); setIdType("CEDULA_V"); setIdNumber("");
    setEmail(""); setPhone(""); setWhatsapp(""); setRole("OWNER"); setUnitId("");
    setFormMsg(null);
  };

  const handleAddResident = async () => {
    setFormMsg(null);
    if (!firstName.trim() || !lastName.trim() || !idNumber.trim() || !unitId) {
      setFormMsg({ type: "error", text: "Los campos Nombre, Apellido, Número de ID y Unidad son obligatorios." });
      return;
    }
    setFormLoading(true);
    try {
      const person = await createPerson.mutateAsync({
        organizationId,
        firstName: firstName.trim(), lastName: lastName.trim(),
        idType, idNumber: idNumber.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
      });
      const today = new Date();
      if (role === "OWNER") {
        await assignOwner.mutateAsync({ organizationId, unitId, personId: person.id, sharePercent: 100, startDate: today });
      } else {
        await assignTenant.mutateAsync({ organizationId, unitId, personId: person.id, startDate: today });
      }
      void refetch();
      setFormMsg({ type: "success", text: `${role === "OWNER" ? "Propietario" : "Inquilino"} ${person.firstName} ${person.lastName} agregado correctamente.` });
      resetForm();
      setShowForm(false);
    } catch (err: unknown) {
      setFormMsg({ type: "error", text: err instanceof Error ? err.message : "Error al guardar el residente." });
    } finally {
      setFormLoading(false);
    }
  };

  const residents = data && "ownerships" in data
    ? { ownerships: data.ownerships, tenancies: data.tenancies }
    : { ownerships: [], tenancies: [] };

  // Estadísticas de deuda
  const totalOwners = residents.ownerships.length;
  const totalTenants = residents.tenancies.length;

  // Deduplicar por UNIDAD: las copropiedades aparecen varias veces (una fila por
  // dueño) con la MISMA deuda, porque la deuda es por unidad, no por propietario.
  // Sin deduplicar, el total y los contadores se inflaban (ej. $15.441 en vez de
  // $15.137,95 real). Tomamos la deuda de cada unidad UNA sola vez.
  const unitDebt = new Map<string, DebtInfo | undefined>();
  for (const r of [...residents.ownerships, ...residents.tenancies]) {
    const code = (r as { unit: { code: string } }).unit.code;
    if (!unitDebt.has(code)) unitDebt.set(code, (r as { debt?: DebtInfo }).debt);
  }
  const uniqueUnitDebts = [...unitDebt.values()];
  const deudores = uniqueUnitDebts.filter((d) => Number(d?.pendingUsd ?? "0") > 0.005);
  const morosos = uniqueUnitDebts.filter((d) => (d?.overdueCount ?? 0) > 0);
  const totalDeudaUsd = uniqueUnitDebts.reduce((s, d) => s + Number(d?.pendingUsd ?? "0"), 0);
  // Total de unidades del edificio para "X de Y" (fallback a las que tienen dueño/inquilino).
  const totalUnidades = units.length || unitDebt.size;

  // Filtro por búsqueda
  const filterFn = (r: { person: PersonData; unit: { code: string } }) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.person.firstName.toLowerCase().includes(q) ||
      r.person.lastName.toLowerCase().includes(q) ||
      r.unit.code.toLowerCase().includes(q) ||
      (r.person.idNumber?.toLowerCase().includes(q) ?? false)
    );
  };

  const filteredOwnerships = useMemo(
    () => residents.ownerships.filter(filterFn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [residents.ownerships, search]
  );
  const filteredTenancies = useMemo(
    () => residents.tenancies.filter(filterFn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [residents.tenancies, search]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvRows(parseCSV(text));
      setImportError(null); setImportResult(null);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleImport = async () => {
    if (csvRows.length < 2) { setImportError("El archivo debe tener encabezado + al menos una fila de datos"); return; }
    const [header, ...dataRows] = csvRows;
    if (!header) return;
    const idxUnit  = header.findIndex((h) => h.toLowerCase().includes("unidad") || h.toLowerCase() === "unit");
    const idxFirst = header.findIndex((h) => h.toLowerCase().includes("nombre") || h.toLowerCase().includes("first"));
    const idxLast  = header.findIndex((h) => h.toLowerCase().includes("apellido") || h.toLowerCase().includes("last"));
    const idxIdType= header.findIndex((h) => h.toLowerCase().includes("tipo_id") || h.toLowerCase().includes("id_type"));
    const idxIdNum = header.findIndex((h) => h.toLowerCase().includes("numero_id") || h.toLowerCase().includes("id_number") || h.toLowerCase() === "cedula");
    const idxEmail = header.findIndex((h) => h.toLowerCase().includes("email") || h.toLowerCase().includes("correo"));
    const idxPhone = header.findIndex((h) => h.toLowerCase().includes("telefono") || h.toLowerCase().includes("phone") || h.toLowerCase().includes("tel"));
    const idxWa    = header.findIndex((h) => h.toLowerCase().includes("whatsapp") || h.toLowerCase().includes("wa"));
    const idxRole  = header.findIndex((h) => h.toLowerCase().includes("rol") || h.toLowerCase().includes("role") || h.toLowerCase().includes("tipo"));
    if (idxUnit < 0 || idxFirst < 0 || idxLast < 0 || idxIdNum < 0) {
      setImportError("Columnas requeridas: unidad, nombre, apellido, numero_id"); return;
    }
    const rows = dataRows
      .filter((r) => r.some((c) => c.trim()))
      .map((r) => ({
        unitCode: r[idxUnit] ?? "", firstName: r[idxFirst] ?? "", lastName: r[idxLast] ?? "",
        idType: (idxIdType >= 0 ? r[idxIdType] : "CEDULA_V") as "CEDULA_V" | "CEDULA_E" | "RIF" | "PASSPORT" | "OTHER",
        idNumber: r[idxIdNum] ?? "",
        email:    idxEmail >= 0 && r[idxEmail]  ? r[idxEmail]  : undefined,
        phone:    idxPhone >= 0 && r[idxPhone]  ? r[idxPhone]  : undefined,
        whatsapp: idxWa    >= 0 && r[idxWa]     ? r[idxWa]     : undefined,
        role: ((idxRole >= 0 ? r[idxRole]?.toUpperCase() : "OWNER") === "TENANT" ? "TENANT" : "OWNER") as "OWNER" | "TENANT",
      }))
      .filter((r) => r.unitCode && r.firstName && r.lastName && r.idNumber);
    if (rows.length === 0) { setImportError("No se encontraron filas válidas"); return; }
    try {
      const result = await bulkImport.mutateAsync({ organizationId, communityId, rows });
      setImportResult(result); setCsvRows([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void refetch();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Error al importar");
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantilla_residentes.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Propietarios e Inquilinos</h2>
          <p className="text-sm text-muted-foreground">
            {totalOwners} propietario(s) · {totalTenants} inquilino(s) activos
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={sendAccessToAll.isPending}
            onClick={handleSendAccessToAll}
          >
            {sendAccessToAll.isPending ? "Enviando…" : "📧 Enviar tutorial a TODOS"}
          </Button>
          <Button variant="outline" onClick={downloadTemplate}>Descargar plantilla CSV</Button>
          <label>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            <Button variant="outline" type="button" onClick={() => fileInputRef.current?.click()}>
              Importar CSV
            </Button>
          </label>
          <Button type="button" onClick={() => { setShowForm((v) => !v); setFormMsg(null); }}>
            {showForm ? "Cancelar" : "+ Agregar propietario/inquilino"}
          </Button>
        </div>
      </div>

      {accessAllMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 whitespace-pre-line max-h-64 overflow-y-auto">
          {accessAllMsg}
        </div>
      )}

      {/* ── Tarjetas de resumen financiero ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Deuda total del edificio</p>
          <p className={`text-xl font-bold ${totalDeudaUsd > 0 ? "text-red-600" : "text-green-700"}`}>
            ${totalDeudaUsd.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Unidades con deuda</p>
          <p className={`text-xl font-bold ${deudores.length > 0 ? "text-amber-600" : "text-green-700"}`}>
            {deudores.length} <span className="text-sm font-normal">de {totalUnidades} unidades</span>
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Unidades en mora</p>
          <p className={`text-xl font-bold ${morosos.length > 0 ? "text-red-600" : "text-green-700"}`}>
            {morosos.length} <span className="text-sm font-normal">con recibos vencidos</span>
          </p>
        </div>
      </div>

      {/* ── Buscador ── */}
      <div className="relative max-w-sm">
        <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground text-sm">🔍</span>
        <Input
          className="pl-8"
          placeholder="Buscar por nombre, unidad o cédula..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ── Mensaje de éxito/error tras guardar ── */}
      {formMsg && !showForm && (
        <div className={`rounded-lg border p-4 text-sm ${formMsg.type === "success" ? "border-green-300 bg-green-50 text-green-800" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
          {formMsg.text}
        </div>
      )}

      {/* ── Formulario manual ── */}
      {showForm && (
        <div className="rounded-lg border bg-card p-5 space-y-5">
          <h3 className="font-semibold text-base">Agregar propietario / inquilino manualmente</h3>
          {formMsg && (
            <div className={`rounded-md border px-3 py-2 text-sm ${formMsg.type === "success" ? "border-green-300 bg-green-50 text-green-800" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
              {formMsg.text}
            </div>
          )}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Datos personales</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="res-firstName">Nombre *</Label>
                <Input id="res-firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Juan" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-lastName">Apellido *</Label>
                <Input id="res-lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Pérez" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-idType">Tipo de ID</Label>
                <select id="res-idType" value={idType} onChange={(e) => setIdType(e.target.value as typeof idType)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                  <option value="CEDULA_V">V- (Cédula venezolana)</option>
                  <option value="CEDULA_E">E- (Cédula extranjera)</option>
                  <option value="PASSPORT">Pasaporte</option>
                  <option value="OTHER">Otro</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-idNumber">Número de cédula / ID *</Label>
                <Input id="res-idNumber" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="12345678" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-email">Email <span className="text-muted-foreground text-xs">(para recibos y portal)</span></Label>
                <Input id="res-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="juan@correo.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-phone">Teléfono</Label>
                <Input id="res-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0414-1234567" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="res-whatsapp">WhatsApp <span className="text-muted-foreground text-xs">formato internacional ej. 584141234567</span></Label>
                <Input id="res-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="584141234567" />
              </div>
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Asignación a unidad</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="res-role">Rol</Label>
                <select id="res-role" value={role} onChange={(e) => setRole(e.target.value as "OWNER" | "TENANT")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                  <option value="OWNER">Propietario</option>
                  <option value="TENANT">Inquilino</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-unit">Unidad *</Label>
                <SearchableSelect
                  value={unitId}
                  onChange={setUnitId}
                  placeholder="Buscar unidad (ej. 101A)..."
                  options={units.map((u) => ({
                    value: u.id,
                    label: u.code + (u.floor != null ? ` - Piso ${u.floor}` : "") + (u.tower ? ` - Torre ${u.tower}` : ""),
                  }))}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" type="button" onClick={() => { setShowForm(false); resetForm(); }} disabled={formLoading}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleAddResident} disabled={formLoading}>
              {formLoading ? "Guardando..." : "Guardar residente"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Modal de edición ── */}
      {editPerson && (
        <EditPersonModal
          person={editPerson}
          organizationId={organizationId}
          onSave={async (fields) => {
            await updatePerson.mutateAsync({ organizationId, id: editPerson.id, ...fields });
            void refetch();
            setEditPerson(null);
          }}
          onClose={() => setEditPerson(null)}
          isSaving={updatePerson.isPending}
        />
      )}

      {/* ── Preview de CSV ── */}
      {csvRows.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{csvRows.length - 1} fila(s) detectadas</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setCsvRows([]); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleImport} disabled={bulkImport.isPending}>
                {bulkImport.isPending ? "Importando..." : "Confirmar importación"}
              </Button>
            </div>
          </div>
          {importError && <p className="text-sm text-destructive">{importError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>{csvRows[0]?.map((h, i) => <th key={i} className="px-2 py-1 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {csvRows.slice(1, 6).map((row, i) => (
                  <tr key={i} className="border-t">
                    {row.map((cell, j) => <td key={j} className="px-2 py-1">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Resultado de importación ── */}
      {importResult && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="font-medium text-green-800">
            Importación completada: {importResult.created} registrado(s), {importResult.skipped} omitido(s)
          </p>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-sm text-destructive">
              {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* ── Tabla propietarios ── */}
      <ResidentsTable
        title="Propietarios activos"
        rows={filteredOwnerships}
        communityId={communityId}
        organizationId={organizationId}
        legalUnitCodes={legalUnitCodes}
        onEdit={(p) => setEditPerson(p)}
        onSendCredentials={(personId) =>
          sendCredentials.mutateAsync({ organizationId, personId })
        }
      />

      {/* ── Tabla inquilinos ── */}
      <ResidentsTable
        title="Inquilinos activos"
        rows={filteredTenancies}
        communityId={communityId}
        organizationId={organizationId}
        legalUnitCodes={legalUnitCodes}
        isTenant
        onEdit={(p) => setEditPerson(p)}
        onSendCredentials={(personId) =>
          sendCredentials.mutateAsync({ organizationId, personId })
        }
      />
    </div>
  );
}

// ─── Tabla reutilizable ─────────────────────────────────────────────────────

function ResidentsTable({
  title,
  rows,
  communityId,
  organizationId,
  legalUnitCodes,
  isTenant = false,
  onEdit,
  onSendCredentials,
}: {
  title: string;
  rows: Array<{
    person: PersonData;
    unit: { id: string; code: string; floor?: number | null; tower?: string | null };
    debt?: DebtInfo;
  }>;
  communityId: string;
  organizationId: string;
  legalUnitCodes: Set<string>;
  isTenant?: boolean;
  onEdit: (p: PersonData) => void;
  onSendCredentials: (personId: string) => Promise<{ ok: boolean; email: string }>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Cédula</th>
              <th className="px-3 py-2">Contacto</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Deuda</th>
              <th className="px-3 py-2">Último pago</th>
              <th className="px-3 py-2">Vehículos</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Sin resultados
                </td>
              </tr>
            )}
            {rows.map(({ person, unit, debt }) => (
              <ResidentRow
                key={person.id}
                person={person}
                unit={unit}
                debt={debt}
                communityId={communityId}
                organizationId={organizationId}
                isTenant={isTenant}
                hasLegalCase={legalUnitCodes.has(unit.code)}
                onEdit={() => onEdit(person)}
                onSendCredentials={onSendCredentials}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Fila de residente ──────────────────────────────────────────────────────

function ResidentRow({
  person,
  unit,
  debt,
  communityId,
  organizationId,
  isTenant = false,
  hasLegalCase = false,
  onEdit,
  onSendCredentials,
}: {
  person: PersonData;
  unit: { id: string; code: string; floor?: number | null; tower?: string | null };
  debt?: DebtInfo;
  communityId: string;
  organizationId: string;
  isTenant?: boolean;
  hasLegalCase?: boolean;
  onEdit: () => void;
  onSendCredentials: (personId: string) => Promise<{ ok: boolean; email: string }>;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);
  const [reminderSent, setReminderSent] = useState(false);

  const sendReminder = trpc.org.persons.sendReminder.useMutation();
  const setManualPassword = trpc.org.persons.setPortalPasswordManual.useMutation();
  const resetResident = trpc.org.persons.resetResident.useMutation();
  const [manualCreds, setManualCreds] = useState<{ email: string; password: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const handleManualPassword = async () => {
    setSending(true); setSendErr(null);
    try {
      const result = await setManualPassword.mutateAsync({ organizationId, personId: person.id });
      setManualCreds({ email: result.email, password: result.password });
    } catch (err: unknown) {
      setSendErr(err instanceof Error ? err.message : "Error");
    } finally {
      setSending(false);
    }
  };

  const handleSendAccess = async () => {
    setSending(true); setSent(null); setSendErr(null);
    try {
      const result = await onSendCredentials(person.id);
      setSent(result.email);
    } catch (err: unknown) {
      setSendErr(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  };

  const handleSendReminder = async () => {
    setReminding(true); setReminderSent(false);
    try {
      await sendReminder.mutateAsync({ organizationId, personId: person.id, unitId: unit.id });
      setReminderSent(true);
      setTimeout(() => setReminderSent(false), 4000);
    } finally {
      setReminding(false);
    }
  };

  const handleResetResident = async () => {
    const ok = window.confirm(
      `¿Resetear a ${person.firstName} ${person.lastName} (${unit.code}) a cero?\n\n` +
      `Perderá su clave actual y tendrá que confirmar sus datos y crear una clave nueva ` +
      `la próxima vez que entre. ${person.email ? "Se le enviará un enlace de acceso fresco." : "No tiene email, tendrás que darle acceso manual."}`,
    );
    if (!ok) return;
    setResetting(true); setSendErr(null);
    try {
      await resetResident.mutateAsync({ organizationId, personId: person.id, resendAccess: true });
      setResetDone(true);
      setManualCreds(null);
      setTimeout(() => setResetDone(false), 5000);
    } catch (err: unknown) {
      setSendErr(err instanceof Error ? err.message : "Error al resetear");
    } finally {
      setResetting(false);
    }
  };

  const hasPendingDebt = Number(debt?.pendingUsd ?? "0") > 0.005;

  return (
    <tr className="border-t hover:bg-muted/20">
      <td className="px-3 py-2">
        <div className="font-medium">{person.firstName} {person.lastName}</div>
        {isTenant && <div className="text-xs text-amber-700">Inquilino</div>}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {person.idType}: {person.idNumber}
      </td>
      <td className="px-3 py-2 text-xs">
        {person.email && <div>{person.email}</div>}
        {person.phone && <div>{person.phone}</div>}
        {person.whatsapp && <div className="text-green-700">WA: {person.whatsapp}</div>}
        {!person.email && !person.phone && !person.whatsapp && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{unit.code}</div>
        <div className="text-xs text-muted-foreground">
          {unit.tower && `T${unit.tower} `}{unit.floor != null && `Piso ${unit.floor}`}
        </div>
        {hasLegalCase && (
          <span
            className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700"
            title="Esta unidad tiene un caso legal (cobranza judicial) abierto"
          >
            ⚖️ En abogado
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {debt ? <DebtBadge debt={debt} /> : <span className="text-muted-foreground text-xs">—</span>}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {debt?.lastPaymentAt
          ? new Date(debt.lastPaymentAt).toLocaleDateString("es-VE")
          : <span className="text-red-500">Sin pagos</span>}
      </td>
      <td className="px-3 py-2">
        {person.vehicles.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="space-y-0.5">
            {person.vehicles.map((v) => (
              <div key={v.id} className="text-xs">
                <span className="font-medium">{VEHICLE_TYPES[v.type] ?? v.type}</span>
                {v.plate && <span className="ml-1 font-mono">{v.plate}</span>}
                {v.color && <span className="ml-1 text-muted-foreground">({v.color})</span>}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={onEdit}>✏️</Button>
          <Link href={`/org/communities/${communityId}/units/${unit.id}`}>
            <Button size="sm" variant="outline" title="Ver unidad">🏠</Button>
          </Link>
          {person.email && (
            <button
              onClick={handleSendAccess}
              disabled={sending}
              className="rounded-md border px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap"
              title="Enviar acceso al portal por email"
            >
              {sending ? "..." : sent ? "✓ Enviado" : "📧"}
            </button>
          )}
          <button
            onClick={handleManualPassword}
            disabled={sending}
            className="rounded-md border px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 disabled:opacity-50 whitespace-nowrap"
            title="Generar contraseña sin enviar email (útil sin email o si SMTP falla)"
          >
            🔑
          </button>
          {manualCreds && (
            <div className="w-full mt-1 rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-xs">
              <div className="font-medium text-green-800">Credenciales (anótalas y dáselas al residente):</div>
              <div className="font-mono">Usuario: <span className="font-semibold">{manualCreds.email}</span></div>
              <div className="font-mono">Clave: <span className="font-semibold">{manualCreds.password}</span></div>
              <button
                onClick={() => setManualCreds(null)}
                className="mt-1 text-green-700 hover:underline"
              >
                Cerrar
              </button>
            </div>
          )}
          {hasPendingDebt && (person.email || person.whatsapp) && (
            <button
              onClick={handleSendReminder}
              disabled={reminding}
              className="rounded-md border px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap"
              title="Enviar recordatorio de pago"
            >
              {reminding ? "..." : reminderSent ? "✓ Enviado" : "🔔 Recordar"}
            </button>
          )}
          <button
            onClick={handleResetResident}
            disabled={resetting}
            className="rounded-md border px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
            title="Resetear a cero: pierde la clave, vuelve a pedirle confirmar sus datos desde el tutorial"
          >
            {resetting ? "..." : resetDone ? "✓ Reseteado" : "🔄 Resetear"}
          </button>
          {sendErr && <div className="text-xs text-destructive w-full">{sendErr}</div>}
        </div>
      </td>
    </tr>
  );
}

// ─── Modal de edición ──────────────────────────────────────────────────────

function EditPersonModal({
  person, organizationId, onSave, onClose, isSaving,
}: {
  person: PersonData;
  organizationId: string;
  onSave: (fields: { firstName?: string; lastName?: string; email?: string; phone?: string; whatsapp?: string }) => Promise<void>;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [firstName, setFirstName] = useState(person.firstName);
  const [lastName, setLastName]   = useState(person.lastName);
  const [email, setEmail]         = useState(person.email ?? "");
  const [phone, setPhone]         = useState(person.phone ?? "");
  const [whatsapp, setWhatsapp]   = useState(person.whatsapp ?? "");
  const [err, setErr] = useState<string | null>(null);

  void organizationId;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSave = async () => {
    setErr(null);
    if (!firstName.trim() || !lastName.trim()) { setErr("Nombre y apellido son obligatorios."); return; }
    try {
      await onSave({
        firstName: firstName.trim(), lastName: lastName.trim(),
        email: email.trim() || undefined, phone: phone.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error al guardar.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleBackdropClick}>
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="font-semibold text-base">Editar propietario / inquilino</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label>Apellido *</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={isSaving} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email <span className="text-xs text-muted-foreground">(para recibos de condominio y portal)</span></Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="juan@correo.com" disabled={isSaving} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0414-1234567" disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp <span className="text-xs text-muted-foreground">internacional</span></Label>
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="584141234567" disabled={isSaving} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Para cambiar la cédula o unidad asignada, usa el detalle de la unidad.</p>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar cambios"}</Button>
        </div>
      </div>
    </div>
  );
}
