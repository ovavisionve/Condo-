"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

export default function ResidentsPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvRows, setCsvRows] = useState<ReturnType<typeof parseCSV>>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  const { data, refetch } = trpc.org.persons.list.useQuery({ organizationId, communityId });
  const bulkImport = trpc.org.persons.bulkImport.useMutation();

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

  const { data: unitsData } = trpc.org.units.list.useQuery({ organizationId, communityId });
  const units = Array.isArray(unitsData) ? unitsData : [];

  const createPerson = trpc.org.persons.create.useMutation();
  const assignOwner = trpc.org.persons.assignOwner.useMutation();
  const assignTenant = trpc.org.persons.assignTenant.useMutation();

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setIdType("CEDULA_V");
    setIdNumber("");
    setEmail("");
    setPhone("");
    setWhatsapp("");
    setRole("OWNER");
    setUnitId("");
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
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        idType,
        idNumber: idNumber.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
      });
      const today = new Date().toISOString().split("T")[0]!;
      if (role === "OWNER") {
        await assignOwner.mutateAsync({
          organizationId,
          unitId,
          personId: person.id,
          sharePercent: 100,
          startDate: today,
        });
      } else {
        await assignTenant.mutateAsync({
          organizationId,
          unitId,
          personId: person.id,
          startDate: today,
        });
      }
      void refetch();
      setFormMsg({ type: "success", text: `Residente ${person.firstName} ${person.lastName} agregado correctamente.` });
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      setCsvRows(rows);
      setImportError(null);
      setImportResult(null);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleImport = async () => {
    if (csvRows.length < 2) {
      setImportError("El archivo debe tener encabezado + al menos una fila de datos");
      return;
    }
    const [header, ...dataRows] = csvRows;
    if (!header) return;

    const idxUnit = header.findIndex((h) => h.toLowerCase().includes("unidad") || h.toLowerCase() === "unit");
    const idxFirst = header.findIndex((h) => h.toLowerCase().includes("nombre") || h.toLowerCase().includes("first"));
    const idxLast = header.findIndex((h) => h.toLowerCase().includes("apellido") || h.toLowerCase().includes("last"));
    const idxIdType = header.findIndex((h) => h.toLowerCase().includes("tipo_id") || h.toLowerCase().includes("id_type"));
    const idxIdNum = header.findIndex((h) => h.toLowerCase().includes("numero_id") || h.toLowerCase().includes("id_number") || h.toLowerCase() === "cedula");
    const idxEmail = header.findIndex((h) => h.toLowerCase().includes("email") || h.toLowerCase().includes("correo"));
    const idxPhone = header.findIndex((h) => h.toLowerCase().includes("telefono") || h.toLowerCase().includes("phone") || h.toLowerCase().includes("tel"));
    const idxWa = header.findIndex((h) => h.toLowerCase().includes("whatsapp") || h.toLowerCase().includes("wa"));
    const idxRole = header.findIndex((h) => h.toLowerCase().includes("rol") || h.toLowerCase().includes("role") || h.toLowerCase().includes("tipo"));

    if (idxUnit < 0 || idxFirst < 0 || idxLast < 0 || idxIdNum < 0) {
      setImportError("Columnas requeridas: unidad, nombre, apellido, numero_id");
      return;
    }

    const rows = dataRows
      .filter((r) => r.some((c) => c.trim()))
      .map((r) => ({
        unitCode: r[idxUnit] ?? "",
        firstName: r[idxFirst] ?? "",
        lastName: r[idxLast] ?? "",
        idType: (idxIdType >= 0 ? r[idxIdType] : "CEDULA_V") as "CEDULA_V" | "CEDULA_E" | "RIF" | "PASSPORT" | "OTHER",
        idNumber: r[idxIdNum] ?? "",
        email: idxEmail >= 0 && r[idxEmail] ? r[idxEmail] : undefined,
        phone: idxPhone >= 0 && r[idxPhone] ? r[idxPhone] : undefined,
        whatsapp: idxWa >= 0 && r[idxWa] ? r[idxWa] : undefined,
        role: ((idxRole >= 0 ? r[idxRole]?.toUpperCase() : "OWNER") === "TENANT" ? "TENANT" : "OWNER") as "OWNER" | "TENANT",
      }))
      .filter((r) => r.unitCode && r.firstName && r.lastName && r.idNumber);

    if (rows.length === 0) {
      setImportError("No se encontraron filas válidas");
      return;
    }

    try {
      const result = await bulkImport.mutateAsync({ organizationId, communityId, rows });
      setImportResult(result);
      setCsvRows([]);
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
    a.href = url;
    a.download = "plantilla_residentes.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Residentes</h2>
          <p className="text-sm text-muted-foreground">
            {residents.ownerships.length} propietario(s) · {residents.tenancies.length} inquilino(s) activos
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadTemplate}>Descargar plantilla CSV</Button>
          <label>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            <Button variant="outline" type="button" onClick={() => fileInputRef.current?.click()}>
              Importar CSV/Excel
            </Button>
          </label>
          <Button
            type="button"
            onClick={() => { setShowForm((v) => !v); setFormMsg(null); }}
          >
            {showForm ? "Cancelar" : "+ Agregar residente"}
          </Button>
        </div>
      </div>

      {/* Mensaje de éxito/error tras guardar */}
      {formMsg && !showForm && (
        <div className={`rounded-lg border p-4 text-sm ${formMsg.type === "success" ? "border-green-300 bg-green-50 text-green-800" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
          {formMsg.text}
        </div>
      )}

      {/* Formulario manual: Agregar residente */}
      {showForm && (
        <div className="rounded-lg border bg-card p-5 space-y-5">
          <h3 className="font-semibold text-base">Agregar residente manualmente</h3>

          {formMsg && (
            <div className={`rounded-md border px-3 py-2 text-sm ${formMsg.type === "success" ? "border-green-300 bg-green-50 text-green-800" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
              {formMsg.text}
            </div>
          )}

          {/* Datos de la persona */}
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
                <select
                  id="res-idType"
                  value={idType}
                  onChange={(e) => setIdType(e.target.value as typeof idType)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
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
                <Label htmlFor="res-email">Email <span className="text-muted-foreground text-xs">(para facturas)</span></Label>
                <Input id="res-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="juan@correo.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-phone">Teléfono <span className="text-muted-foreground text-xs">ej. 0414-1234567</span></Label>
                <Input id="res-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0414-1234567" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="res-whatsapp">WhatsApp <span className="text-muted-foreground text-xs">formato internacional ej. 584141234567</span></Label>
                <Input id="res-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="584141234567" />
              </div>
            </div>
          </div>

          {/* Asignación a unidad */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Asignación a unidad</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="res-role">Rol</Label>
                <select
                  id="res-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as "OWNER" | "TENANT")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="OWNER">Propietario</option>
                  <option value="TENANT">Inquilino</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="res-unit">Unidad *</Label>
                <select
                  id="res-unit"
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Seleccionar unidad...</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code}{u.floor != null ? ` - Piso ${u.floor}` : ""}{u.tower ? ` - Torre ${u.tower}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
              disabled={formLoading}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleAddResident} disabled={formLoading}>
              {formLoading ? "Guardando..." : "Guardar residente"}
            </Button>
          </div>
        </div>
      )}

      {/* Preview de CSV */}
      {csvRows.length > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {csvRows.length - 1} fila(s) detectadas para importar
            </p>
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
            {csvRows.length > 7 && (
              <p className="mt-1 text-xs text-muted-foreground">... y {csvRows.length - 7} filas más</p>
            )}
          </div>
        </div>
      )}

      {/* Resultado de importación */}
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

      {/* Propietarios */}
      <Section title="Propietarios activos">
        {residents.ownerships.length === 0 ? (
          <EmptyRow msg="Sin propietarios registrados" />
        ) : (
          residents.ownerships.map(({ person, unit }) => (
            <ResidentRow
              key={person.id}
              person={person}
              unitCode={unit.code}
              unitFloor={unit.floor}
              unitTower={unit.tower}
              communityId={communityId}
              unitId={unit.id}
            />
          ))
        )}
      </Section>

      {/* Inquilinos */}
      <Section title="Inquilinos activos">
        {residents.tenancies.length === 0 ? (
          <EmptyRow msg="Sin inquilinos registrados" />
        ) : (
          residents.tenancies.map(({ person, unit }) => (
            <ResidentRow
              key={person.id}
              person={person}
              unitCode={unit.code}
              unitFloor={unit.floor}
              unitTower={unit.tower}
              communityId={communityId}
              unitId={unit.id}
              isTenant
            />
          ))
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Contacto</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Vehículos</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyRow({ msg }: { msg: string }) {
  return (
    <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{msg}</td></tr>
  );
}

function ResidentRow({
  person,
  unitCode,
  unitFloor,
  unitTower,
  communityId,
  unitId,
  isTenant = false,
}: {
  person: {
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
  unitCode: string;
  unitFloor?: number | null;
  unitTower?: string | null;
  communityId: string;
  unitId: string;
  isTenant?: boolean;
}) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <div className="font-medium">{person.firstName} {person.lastName}</div>
        {isTenant && <div className="text-xs text-amber-700">Inquilino</div>}
      </td>
      <td className="px-3 py-2 text-muted-foreground text-xs">
        {person.idType}: {person.idNumber}
      </td>
      <td className="px-3 py-2 text-xs">
        {person.email && <div>{person.email}</div>}
        {person.phone && <div>{person.phone}</div>}
        {person.whatsapp && <div className="text-green-700">WA: {person.whatsapp}</div>}
        {!person.email && !person.phone && !person.whatsapp && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{unitCode}</div>
        <div className="text-xs text-muted-foreground">
          {unitTower && `T${unitTower} `}{unitFloor != null && `Piso ${unitFloor}`}
        </div>
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
        <Link href={`/org/communities/${communityId}/units/${unitId}`}>
          <Button size="sm" variant="outline">Ver unidad</Button>
        </Link>
      </td>
    </tr>
  );
}
