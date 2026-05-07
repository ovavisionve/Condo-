"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";

// ─── Tipos de importación disponibles ────────────────────────────────────────
type Tab = "migration" | "units" | "residents" | "invoices" | "expenses" | "payments" | "vehicles" | "contractors" | "budget";

const TABS: { id: Tab; label: string; icon: string; highlight?: boolean }[] = [
  { id: "migration",   label: "Migración completa", icon: "🚀", highlight: true },
  { id: "units",       label: "Unidades",            icon: "🏠" },
  { id: "residents",   label: "Solo residentes",     icon: "👥" },
  { id: "invoices",    label: "Solo deudas",         icon: "📄" },
  { id: "expenses",    label: "Gastos históricos",   icon: "📋" },
  { id: "payments",    label: "Pagos históricos",    icon: "💳" },
  { id: "vehicles",    label: "Vehículos",           icon: "🚗" },
  { id: "contractors", label: "Contratistas",        icon: "🔧" },
  { id: "budget",      label: "Presupuesto anual",   icon: "📊" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function downloadXlsx(
  headers: string[],
  exampleRows: (string | number)[][],
  filename: string,
) {
  import("xlsx").then((xlsx) => {
    const ws = xlsx.utils.aoa_to_sheet([headers, ...exampleRows]);
    // Ancho de columnas automático
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Datos");
    xlsx.writeFile(wb, filename);
  });
}

function parseXlsxFile(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        import("xlsx").then((xlsx) => {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          // Force UTF-8 (codepage 65001) for CSV files so accented characters
          // are read correctly regardless of whether a BOM is present.
          const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
          const wb = xlsx.read(data, { type: "array", ...(isCsv ? { codepage: 65001 } : {}) });
          const ws = wb.Sheets[wb.SheetNames[0]!]!;
          const rows = xlsx.utils.sheet_to_json<Record<string, string>>(ws, {
            raw: false,
            defval: "",
          });
          resolve(rows);
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ─── Resultado de importación ─────────────────────────────────────────────────
function ImportResult({ result }: { result: { created: number; skipped: number; errors: string[]; extra?: string } | null }) {
  if (!result) return null;
  return (
    <div className="mt-4 space-y-2">
      <div className="rounded-lg border bg-green-50 border-green-200 px-4 py-3 text-sm space-y-0.5">
        <div>
          <span className="font-semibold text-green-700">✅ {result.created} registros importados</span>
          {result.skipped > 0 && (
            <span className="ml-3 text-amber-700">⚠️ {result.skipped} omitidos</span>
          )}
        </div>
        {result.extra && <div className="text-green-600 text-xs">{result.extra}</div>}
      </div>
      {result.errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 space-y-1 max-h-40 overflow-y-auto">
          {result.errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}
    </div>
  );
}

// ─── Panel genérico de carga ──────────────────────────────────────────────────
function ImportPanel({
  title,
  description,
  fields,
  onDownloadTemplate,
  onImport,
  isPending,
  result,
  previewRows,
  setPreviewRows,
}: {
  title: string;
  description: React.ReactNode;
  fields: { key: string; label: string; required?: boolean; note?: string }[];
  onDownloadTemplate: () => void;
  onImport: (rows: Record<string, string>[]) => void;
  isPending: boolean;
  result: { created: number; skipped: number; errors: string[]; extra?: string } | null;
  previewRows: Record<string, string>[];
  setPreviewRows: (r: Record<string, string>[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setPreviewRows([]);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseXlsxFile(file);
      if (rows.length === 0) { setFileError("El archivo está vacío"); return; }
      setPreviewRows(rows);
    } catch {
      setFileError("Error al leer el archivo. Asegúrate de que sea .xlsx o .csv");
    }
  };

  return (
    <div className="space-y-5">
      {/* Instrucciones */}
      <div className="rounded-lg border bg-blue-50 border-blue-200 px-4 py-3 text-sm text-blue-800">
        {description}
      </div>

      {/* Columnas esperadas */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Columnas del archivo</p>
        <div className="overflow-hidden rounded-lg border text-sm">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Columna</th>
                <th className="px-3 py-2 text-left font-medium">Descripción</th>
                <th className="px-3 py-2 text-left font-medium">¿Requerido?</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs text-blue-700">{f.key}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {f.label}
                    {f.note && <span className="ml-1 text-xs text-amber-600">({f.note})</span>}
                  </td>
                  <td className="px-3 py-2">
                    {f.required ? <span className="text-red-600 font-medium">Sí</span> : <span className="text-muted-foreground">No</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" onClick={onDownloadTemplate}>
          📥 Descargar plantilla Excel
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          📂 Seleccionar archivo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFile}
        />
      </div>
      {fileError && <p className="text-sm text-destructive">{fileError}</p>}

      {/* Preview */}
      {previewRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{previewRows.length} fila(s) detectadas — vista previa (primeras 5):</p>
            <Button
              onClick={() => onImport(previewRows)}
              disabled={isPending}
            >
              {isPending ? "Importando..." : `⬆️ Importar ${previewRows.length} registros`}
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border text-xs">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  {Object.keys(previewRows[0]!).map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-mono whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-t">
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="px-2 py-1.5 text-muted-foreground whitespace-nowrap max-w-[150px] overflow-hidden text-ellipsis">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ImportResult result={result} />
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ImportPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [tab, setTab] = useState<Tab>("units");

  // Preview rows por tab
  const [migrationRows,   setMigrationRows]   = useState<Record<string, string>[]>([]);
  const [unitsRows,       setUnitsRows]       = useState<Record<string, string>[]>([]);
  const [residentsRows,   setResidentsRows]   = useState<Record<string, string>[]>([]);
  const [invoicesRows,    setInvoicesRows]    = useState<Record<string, string>[]>([]);
  const [expensesRows,    setExpensesRows]    = useState<Record<string, string>[]>([]);
  const [paymentsRows,    setPaymentsRows]    = useState<Record<string, string>[]>([]);
  const [vehiclesRows,    setVehiclesRows]    = useState<Record<string, string>[]>([]);
  const [contractorsRows, setContractorsRows] = useState<Record<string, string>[]>([]);
  const [budgetRows,      setBudgetRows]      = useState<Record<string, string>[]>([]);
  const [budgetYear,      setBudgetYear]      = useState(new Date().getFullYear());

  // Mutations
  const bulkMigration   = trpc.finance.bulkImportMigration.useMutation();
  const bulkUnits       = trpc.org.units.bulkCreate.useMutation();
  const bulkResidents   = trpc.org.persons.bulkImport.useMutation();
  const bulkInvoices    = trpc.finance.bulkImportInvoices.useMutation();
  const bulkExpenses    = trpc.finance.bulkImportExpenses.useMutation();
  const bulkPayments    = trpc.finance.bulkImportPayments.useMutation();
  const bulkVehicles    = trpc.org.vehicles.bulkImport.useMutation();
  const bulkContractors = trpc.maintenance.bulkImportContractors.useMutation();
  const bulkBudget      = trpc.finance.bulkImportBudget.useMutation();

  // ── Migración completa (residente + deuda) ────────────────────────
  const handleImportMigration = (rows: Record<string, string>[]) => {
    const mapped = rows.map((r) => ({
      unitCode:     String(r.unidad       ?? r.unitCode    ?? "").trim(),
      firstName:    String(r.nombre       ?? r.firstName   ?? "").trim(),
      lastName:     String(r.apellido     ?? r.lastName    ?? "").trim(),
      idType:       (r.tipo_cedula ?? r.idType ?? "CEDULA_V") as "CEDULA_V" | "CEDULA_E" | "RIF" | "PASSPORT" | "OTHER",
      idNumber:     String(r.cedula       ?? r.idNumber    ?? "").trim(),
      email:        String(r.email        ?? "").trim()   || undefined,
      phone:        String(r.telefono     ?? r.phone      ?? "").trim() || undefined,
      whatsapp:     String(r.whatsapp     ?? "").trim()   || undefined,
      role:         (r.rol ?? r.role ?? "OWNER") as "OWNER" | "TENANT",
      sharePercent: r.porcentaje !== "" && r.porcentaje != null ? Number(r.porcentaje) : 100,
      fechaInicio:  String(r.fecha_inicio ?? r.fechaInicio ?? "").trim() || undefined,
      deudaUsd:     Number(r.deuda_usd    ?? r.deudaUsd   ?? 0),
      deudaBs:      r.deuda_bs  !== "" && r.deuda_bs  != null ? Number(r.deuda_bs)  : undefined,
      tasa:         r.tasa      !== "" && r.tasa      != null ? Number(r.tasa)      : undefined,
      descripcion:  String(r.descripcion  ?? "").trim() || undefined,
      fechaVence:   String(r.fecha_vence  ?? r.fechaVence ?? "").trim() || undefined,
      pagadoUsd:    Number(r.pagado_usd   ?? r.pagadoUsd  ?? 0),
      notas:        String(r.notas        ?? "").trim() || undefined,
    }));
    bulkMigration.mutate({ organizationId, communityId, rows: mapped });
  };

  // ── Vehículos ─────────────────────────────────────────────────────
  const handleImportVehicles = (rows: Record<string, string>[]) => {
    const mapped = rows.map((r) => ({
      cedula:      String(r.cedula      ?? "").trim()  || undefined,
      unitCode:    String(r.unidad      ?? r.unitCode  ?? "").trim() || undefined,
      type:        (r.tipo ?? r.type ?? "CAR") as "CAR" | "MOTORCYCLE" | "TRUCK" | "VAN" | "OTHER",
      brand:       String(r.marca       ?? r.brand     ?? "").trim() || undefined,
      model:       String(r.modelo      ?? r.model     ?? "").trim() || undefined,
      year:        r.año !== "" && r.año != null ? Number(r.año ?? r.year) : undefined,
      color:       String(r.color       ?? "").trim()  || undefined,
      plate:       String(r.placa       ?? r.plate     ?? "").trim() || undefined,
      parkingSpot: String(r.puesto      ?? r.parkingSpot ?? "").trim() || undefined,
      notes:       String(r.notas       ?? r.notes     ?? "").trim() || undefined,
    }));
    bulkVehicles.mutate({ organizationId, communityId, rows: mapped });
  };

  // ── Contratistas ──────────────────────────────────────────────────
  const handleImportContractors = (rows: Record<string, string>[]) => {
    const mapped = rows.map((r) => ({
      name:      String(r.nombre     ?? r.name      ?? "").trim(),
      specialty: String(r.especialidad ?? r.specialty ?? "").trim() || undefined,
      phone:     String(r.telefono   ?? r.phone     ?? "").trim() || undefined,
      email:     String(r.email      ?? "").trim()  || undefined,
      rating:    r.calificacion !== "" && r.calificacion != null ? Number(r.calificacion ?? r.rating) : undefined,
      notes:     String(r.notas     ?? r.notes      ?? "").trim() || undefined,
    }));
    bulkContractors.mutate({ organizationId, rows: mapped });
  };

  // ── Presupuesto ───────────────────────────────────────────────────
  const handleImportBudget = (rows: Record<string, string>[]) => {
    const mapped = rows.map((r) => ({
      category:  (r.categoria ?? r.category ?? "OTHER") as "ELECTRICITY" | "WATER" | "GAS" | "INTERNET" | "CLEANING" | "GARDENING" | "SECURITY" | "ELEVATOR" | "STAFF_PAYROLL" | "ADMINISTRATION" | "INSURANCE" | "REPAIRS" | "RESERVE_FUND" | "TAXES" | "OTHER",
      amountUsd: Number(r.monto_usd ?? r.amountUsd ?? 0),
      notes:     String(r.notas ?? r.notes ?? "").trim() || undefined,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkBudget.mutate({ organizationId, communityId, year: budgetYear, rows: mapped as any });
  };

  // ── Unidades ──────────────────────────────────────────────────────
  const handleImportUnits = (rows: Record<string, string>[]) => {
    const units = rows.map((r) => ({
      code:    String(r.codigo ?? r.code ?? "").trim(),
      aliquot: Number(r.alicuota ?? r.aliquot ?? 0),
      type:    (r.tipo ?? r.type ?? "APARTMENT") as "APARTMENT" | "HOUSE" | "COMMERCIAL" | "PARKING" | "STORAGE" | "OTHER",
      floor:   r.piso != null && r.piso !== "" ? Number(r.piso ?? r.floor) : undefined,
      tower:   String(r.torre ?? r.tower ?? "").trim() || undefined,
    }));
    bulkUnits.mutate({ organizationId, communityId, units });
  };

  // ── Residentes ────────────────────────────────────────────────────
  const handleImportResidents = (rows: Record<string, string>[]) => {
    const mapped = rows.map((r) => ({
      unitCode:  String(r.unidad ?? r.unitCode ?? "").trim(),
      firstName: String(r.nombre ?? r.firstName ?? "").trim(),
      lastName:  String(r.apellido ?? r.lastName ?? "").trim(),
      idType:    (r.tipo_cedula ?? r.idType ?? "CEDULA_V") as "CEDULA_V" | "CEDULA_E" | "RIF" | "PASSPORT" | "OTHER",
      idNumber:  String(r.cedula ?? r.idNumber ?? "").trim(),
      email:     String(r.email ?? "").trim() || undefined,
      phone:     String(r.telefono ?? r.phone ?? "").trim() || undefined,
      whatsapp:  String(r.whatsapp ?? "").trim() || undefined,
      role:      (r.rol ?? r.role ?? "OWNER") as "OWNER" | "TENANT",
    }));
    bulkResidents.mutate({ organizationId, communityId, rows: mapped });
  };

  // ── Deudas históricas ─────────────────────────────────────────────
  const handleImportInvoices = (rows: Record<string, string>[]) => {
    const mapped = rows.map((r) => ({
      unitCode:    String(r.unidad ?? r.unitCode ?? "").trim(),
      description: String(r.descripcion ?? r.description ?? "Deuda histórica").trim(),
      totalUsd:    Number(r.total_usd ?? r.totalUsd ?? 0),
      totalBss:    r.total_bs !== "" && r.total_bs != null ? Number(r.total_bs ?? r.totalBss) : undefined,
      exchangeRate: r.tasa !== "" && r.tasa != null ? Number(r.tasa ?? r.exchangeRate) : undefined,
      issuedAt:    String(r.fecha_emision ?? r.issuedAt ?? "").trim(),
      dueDate:     String(r.fecha_vence ?? r.dueDate ?? "").trim(),
      paidUsd:     r.pagado_usd !== "" && r.pagado_usd != null ? Number(r.pagado_usd ?? r.paidUsd) : undefined,
      notes:       String(r.notas ?? r.notes ?? "").trim() || undefined,
    }));
    bulkInvoices.mutate({ organizationId, communityId, rows: mapped });
  };

  // ── Gastos históricos ─────────────────────────────────────────────
  const handleImportExpenses = (rows: Record<string, string>[]) => {
    const mapped = rows.map((r) => ({
      periodYear:   Number(r.año ?? r.periodYear ?? new Date().getFullYear()),
      periodMonth:  Number(r.mes ?? r.periodMonth ?? 1),
      description:  String(r.descripcion ?? r.description ?? "").trim(),
      category:     (r.categoria ?? r.category ?? "OTHER") as "ELECTRICITY" | "WATER" | "GAS" | "INTERNET" | "CLEANING" | "GARDENING" | "SECURITY" | "ELEVATOR" | "STAFF_PAYROLL" | "ADMINISTRATION" | "INSURANCE" | "REPAIRS" | "RESERVE_FUND" | "TAXES" | "OTHER",
      amountUsd:    Number(r.monto_usd ?? r.amountUsd ?? 0),
      amountBss:    r.monto_bs !== "" && r.monto_bs != null ? Number(r.monto_bs ?? r.amountBss) : undefined,
      exchangeRate: r.tasa !== "" && r.tasa != null ? Number(r.tasa ?? r.exchangeRate) : undefined,
      supplierName: String(r.proveedor ?? r.supplierName ?? "").trim() || undefined,
      invoiceNumber: String(r.nro_factura ?? r.invoiceNumber ?? "").trim() || undefined,
      receiptDate:   String(r.fecha ?? r.receiptDate ?? "").trim() || undefined,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bulkExpenses.mutate({ organizationId, communityId, rows: mapped as any });
  };

  // ── Pagos históricos ──────────────────────────────────────────────
  const handleImportPayments = (rows: Record<string, string>[]) => {
    const mapped = rows.map((r) => ({
      unitCode:    String(r.unidad ?? r.unitCode ?? "").trim(),
      amountUsd:   Number(r.monto_usd ?? r.amountUsd ?? 0),
      amountBss:   r.monto_bs !== "" && r.monto_bs != null ? Number(r.monto_bs ?? r.amountBss) : undefined,
      exchangeRate: r.tasa !== "" && r.tasa != null ? Number(r.tasa ?? r.exchangeRate) : undefined,
      method:      (r.metodo ?? r.method ?? "OTHER") as "CASH_BSS" | "CASH_USD" | "TRANSFER_BSS" | "TRANSFER_USD" | "ZELLE" | "PAGO_MOVIL" | "CRYPTO" | "CHECK" | "OTHER",
      paidAt:      String(r.fecha ?? r.paidAt ?? "").trim(),
      reference:   String(r.referencia ?? r.reference ?? "").trim() || undefined,
      notes:       String(r.notas ?? r.notes ?? "").trim() || undefined,
    }));
    bulkPayments.mutate({ organizationId, communityId, rows: mapped });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Importación masiva de datos</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Carga datos históricos desde Excel para migrar información de otro sistema.
          Descarga la plantilla, llénala y súbela.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              tab === t.id
                ? "border-blue-600 text-blue-700 font-medium"
                : t.highlight
                ? "border-transparent text-blue-600 font-medium hover:text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Contenido según tab */}
      <div className="max-w-4xl">

        {/* ─── MIGRACIÓN COMPLETA ─── */}
        {tab === "migration" && (
          <ImportPanel
            title="Migración completa — Residente + Deuda en un solo Excel"
            description={
              <span>
                <strong>Ideal para migrar desde otro sistema.</strong> Cada fila crea el residente,
                lo asigna a su unidad y, si tiene deuda (<code>deuda_usd</code> &gt; 0), genera
                automáticamente su factura pendiente con el estado correcto
                (PAID / PARTIAL / OVERDUE / ISSUED). Si el residente ya existe se actualizan sus datos.
              </span>
            }
            fields={[
              { key: "unidad",      label: "Código de la unidad (debe existir ya en el sistema)", required: true },
              { key: "nombre",      label: "Primer nombre del residente",                          required: true },
              { key: "apellido",    label: "Apellido",                                             required: true },
              { key: "cedula",      label: "Número de cédula / RIF / pasaporte",                   required: true },
              { key: "tipo_cedula", label: "CEDULA_V / CEDULA_E / RIF / PASSPORT / OTHER",        required: false, note: "por defecto CEDULA_V" },
              { key: "email",       label: "Correo electrónico",                                   required: false },
              { key: "telefono",    label: "Teléfono",                                             required: false },
              { key: "whatsapp",    label: "WhatsApp",                                             required: false },
              { key: "rol",          label: "OWNER (propietario) / TENANT (inquilino)",            required: false, note: "por defecto OWNER" },
              { key: "porcentaje",   label: "% de copropiedad (ej: 50 si hay 2 dueños iguales)",  required: false, note: "por defecto 100" },
              { key: "fecha_inicio", label: "Fecha real de inicio de propiedad (YYYY-MM-DD)",     required: false, note: "por defecto hoy" },
              { key: "deuda_usd",   label: "Deuda total en USD (0 si no debe nada)",              required: false, note: "si > 0 se crea factura" },
              { key: "deuda_bs",    label: "Deuda en Bs (opcional, se calcula con tasa)",         required: false },
              { key: "tasa",        label: "Tasa USD→Bs al momento de la deuda",                  required: false },
              { key: "descripcion", label: "Concepto de la deuda (ej: Cuotas pendientes 2025)",   required: false },
              { key: "fecha_vence", label: "Fecha de vencimiento de la deuda (YYYY-MM-DD)",       required: false },
              { key: "pagado_usd",  label: "Monto ya abonado en USD (si hubo pagos parciales)",   required: false },
              { key: "notas",       label: "Notas adicionales",                                    required: false },
            ]}
            onDownloadTemplate={() => downloadXlsx(
              ["unidad","nombre","apellido","cedula","tipo_cedula","email","telefono","whatsapp","rol","porcentaje","fecha_inicio","deuda_usd","deuda_bs","tasa","descripcion","fecha_vence","pagado_usd","notas"],
              [
                ["A-101","María",   "González","12345678","CEDULA_V","maria@email.com","04141234567","04141234567","OWNER","100","2020-01-15","100.00","","","Cuotas pendientes 2025","2025-12-31","0",   ""],
                ["A-101","José",    "González","11111111","CEDULA_V","jose@email.com", "",            "",            "OWNER","0", "2020-01-15","0",    "","","",                      "",           "0",   "Co-propietario (mismo apartamento)"],
                ["A-102","Pedro",   "Pérez",   "23456789","CEDULA_V","pedro@email.com","04161234567","",            "OWNER","100","2019-06-01","50.00", "","","Deuda acumulada",       "2025-06-30","20.00","Pagó parcial en efectivo"],
                ["B-201","Empresa", "SRL",     "J-123456","RIF",     "admin@emp.com",  "",            "",            "OWNER","100","2021-03-10","0",    "","","",                      "",           "0",   "Sin deuda pendiente"],
                ["B-202","Luis",    "Torres",  "34567890","CEDULA_V","",               "04143333333","04143333333","OWNER","100","2018-08-20","200.00","","","3 meses sin pagar",     "2025-11-30","0",   ""],
              ],
              "plantilla_migracion_completa.xlsx",
            )}
            onImport={handleImportMigration}
            isPending={bulkMigration.isPending}
            result={
              bulkMigration.data
                ? {
                    created: bulkMigration.data.residents,
                    skipped: bulkMigration.data.skipped,
                    errors:  bulkMigration.data.errors,
                    extra:   `${bulkMigration.data.invoices} factura(s) de deuda generada(s)`,
                  }
                : null
            }
            previewRows={migrationRows}
            setPreviewRows={setMigrationRows}
          />
        )}

        {/* ─── UNIDADES ─── */}
        {tab === "units" && (
          <ImportPanel
            title="Unidades"
            description={
              <span>
                Carga las unidades (apartamentos, locales, etc.) del edificio.
                El código debe ser único. La <strong>alícuota</strong> es el porcentaje de participación de cada unidad.
                Puedes importar hasta <strong>500 unidades</strong> a la vez.
              </span>
            }
            fields={[
              { key: "codigo",   label: "Código de la unidad (ej: A-101, PH-2)",              required: true },
              { key: "alicuota", label: "Alícuota en % (ej: 2.5)",                            required: true },
              { key: "tipo",     label: "Tipo: APARTMENT / HOUSE / COMMERCIAL / PARKING / STORAGE / OTHER", required: false, note: "por defecto APARTMENT" },
              { key: "piso",     label: "Número de piso",                                      required: false },
              { key: "torre",    label: "Torre (ej: A, B, Norte)",                             required: false },
            ]}
            onDownloadTemplate={() => downloadXlsx(
              ["codigo", "alicuota", "tipo", "piso", "torre"],
              [
                ["A-101",  "2.5000", "APARTMENT", "1",  "A"],
                ["A-102",  "2.5000", "APARTMENT", "1",  "A"],
                ["B-PH1",  "3.0000", "APARTMENT", "24", "B"],
                ["L-001",  "1.2500", "COMMERCIAL","",   ""],
              ],
              "plantilla_unidades.xlsx",
            )}
            onImport={handleImportUnits}
            isPending={bulkUnits.isPending}
            result={bulkUnits.data ? { created: bulkUnits.data.count, skipped: bulkUnits.data.skipped, errors: [] } : null}
            previewRows={unitsRows}
            setPreviewRows={setUnitsRows}
          />
        )}

        {/* ─── RESIDENTES ─── */}
        {tab === "residents" && (
          <ImportPanel
            title="Residentes / Propietarios"
            description={
              <span>
                Carga los propietarios e inquilinos. La columna <strong>unidad</strong> debe coincidir
                exactamente con el código de una unidad ya registrada. La cédula hace de identificador único —
                si ya existe se actualizan sus datos.
              </span>
            }
            fields={[
              { key: "unidad",      label: "Código de la unidad (debe existir)",              required: true },
              { key: "nombre",      label: "Primer nombre",                                    required: true },
              { key: "apellido",    label: "Apellido",                                         required: true },
              { key: "cedula",      label: "Número de cédula o pasaporte",                     required: true },
              { key: "tipo_cedula", label: "Tipo: CEDULA_V / CEDULA_E / RIF / PASSPORT / OTHER", required: false, note: "por defecto CEDULA_V" },
              { key: "email",       label: "Correo electrónico",                               required: false },
              { key: "telefono",    label: "Teléfono",                                         required: false },
              { key: "whatsapp",    label: "Número de WhatsApp",                               required: false },
              { key: "rol",         label: "Rol: OWNER (propietario) / TENANT (inquilino)",    required: false, note: "por defecto OWNER" },
            ]}
            onDownloadTemplate={() => downloadXlsx(
              ["unidad", "nombre", "apellido", "cedula", "tipo_cedula", "email", "telefono", "whatsapp", "rol"],
              [
                ["A-101", "María",    "González", "12345678", "CEDULA_V", "maria@email.com", "04141234567", "04141234567", "OWNER"],
                ["A-102", "Pedro",    "Pérez",    "23456789", "CEDULA_V", "",                "04161234567", "",            "OWNER"],
                ["B-201", "Empresa",  "SRL",      "J-123456", "RIF",      "admin@empresa.com","",           "",            "OWNER"],
              ],
              "plantilla_residentes.xlsx",
            )}
            onImport={handleImportResidents}
            isPending={bulkResidents.isPending}
            result={bulkResidents.data ?? null}
            previewRows={residentsRows}
            setPreviewRows={setResidentsRows}
          />
        )}

        {/* ─── DEUDAS HISTÓRICAS ─── */}
        {tab === "invoices" && (
          <ImportPanel
            title="Deudas históricas"
            description={
              <span>
                Importa facturas o deudas pendientes del sistema anterior. Cada fila crea una factura
                con estado automático: <strong>PAID</strong> si pagado_usd ≥ total_usd, <strong>PARTIAL</strong>
                si hay pago parcial, <strong>OVERDUE</strong> si ya venció, <strong>ISSUED</strong> si está vigente.
                Las facturas importadas se identifican con prefijo <code>IMP-</code>.
              </span>
            }
            fields={[
              { key: "unidad",        label: "Código de la unidad",                  required: true },
              { key: "descripcion",   label: "Concepto o descripción de la deuda",   required: true },
              { key: "total_usd",     label: "Total en USD",                         required: true },
              { key: "total_bs",      label: "Total en Bs (opcional, se calcula)",   required: false },
              { key: "tasa",          label: "Tasa USD→Bs usada (opcional)",         required: false },
              { key: "fecha_emision", label: "Fecha de emisión (YYYY-MM-DD)",        required: true },
              { key: "fecha_vence",   label: "Fecha de vencimiento (YYYY-MM-DD)",    required: true },
              { key: "pagado_usd",    label: "Monto ya pagado en USD (si aplica)",   required: false },
              { key: "notas",         label: "Notas adicionales",                    required: false },
            ]}
            onDownloadTemplate={() => downloadXlsx(
              ["unidad", "descripcion", "total_usd", "total_bs", "tasa", "fecha_emision", "fecha_vence", "pagado_usd", "notas"],
              [
                ["A-101", "Cuota condominio Ene 2026", "20.00", "",         "",      "2026-01-01", "2026-01-05", "0",     ""],
                ["A-102", "Cuota condominio Ene 2026", "20.00", "750.00",   "37.50", "2026-01-01", "2026-01-05", "10.00", "Pago parcial previo"],
                ["B-201", "Deuda acumulada 2025",      "60.00", "2250.00",  "37.50", "2025-12-01", "2025-12-31", "0",    "3 meses pendientes"],
              ],
              "plantilla_deudas_historicas.xlsx",
            )}
            onImport={handleImportInvoices}
            isPending={bulkInvoices.isPending}
            result={bulkInvoices.data ?? null}
            previewRows={invoicesRows}
            setPreviewRows={setInvoicesRows}
          />
        )}

        {/* ─── GASTOS HISTÓRICOS ─── */}
        {tab === "expenses" && (
          <ImportPanel
            title="Gastos históricos"
            description={
              <span>
                Importa gastos comunes de períodos anteriores. El campo <strong>categoria</strong> determina
                el tipo de gasto. Estos gastos quedan registrados pero NO se prorratean (ya fueron facturados
                en el sistema anterior).
              </span>
            }
            fields={[
              { key: "año",         label: "Año del período (ej: 2025)",                            required: true },
              { key: "mes",         label: "Mes del período (1-12)",                                 required: true },
              { key: "descripcion", label: "Descripción del gasto",                                  required: true },
              { key: "categoria",   label: "Categoría: ELECTRICITY / WATER / GAS / INTERNET / CLEANING / GARDENING / SECURITY / ELEVATOR / STAFF_PAYROLL / ADMINISTRATION / INSURANCE / REPAIRS / RESERVE_FUND / TAXES / OTHER", required: false, note: "por defecto OTHER" },
              { key: "monto_usd",   label: "Monto en USD",                                          required: true },
              { key: "monto_bs",    label: "Monto en Bs (opcional, se calcula con tasa del día)",   required: false },
              { key: "tasa",        label: "Tasa USD→Bs usada (opcional)",                          required: false },
              { key: "proveedor",   label: "Nombre del proveedor",                                  required: false },
              { key: "nro_factura", label: "N° de factura del proveedor",                           required: false },
              { key: "fecha",       label: "Fecha del recibo (YYYY-MM-DD)",                         required: false },
            ]}
            onDownloadTemplate={() => downloadXlsx(
              ["año", "mes", "descripcion", "categoria", "monto_usd", "monto_bs", "tasa", "proveedor", "nro_factura", "fecha"],
              [
                [2025, 1, "Electricidad CORPOELEC",  "ELECTRICITY",     "45.00", "1687.50", "37.50", "CORPOELEC",     "0001234", "2025-01-15"],
                [2025, 1, "Agua HIDROCAPITAL",        "WATER",           "20.00", "750.00",  "37.50", "HIDROCAPITAL",  "9876543", "2025-01-20"],
                [2025, 1, "Mantenimiento ascensor",   "ELEVATOR",        "80.00", "",        "",      "TecnoAscensor", "A-0045",  "2025-01-10"],
                [2025, 2, "Nomina conserje Feb",      "STAFF_PAYROLL",   "150.00","",        "",      "",              "",        "2025-02-28"],
              ],
              "plantilla_gastos_historicos.xlsx",
            )}
            onImport={handleImportExpenses}
            isPending={bulkExpenses.isPending}
            result={bulkExpenses.data ?? null}
            previewRows={expensesRows}
            setPreviewRows={setExpensesRows}
          />
        )}

        {/* ─── VEHÍCULOS ─── */}
        {tab === "vehicles" && (
          <ImportPanel
            title="Vehículos"
            description={
              <span>
                Importa el registro vehicular del edificio. Puedes identificar al dueño del vehículo
                por <strong>cédula</strong> (recomendado) o por <strong>unidad</strong> (usa el propietario activo).
                Si el mismo residente tiene varios vehículos, agrega una fila por cada uno.
                Tipos válidos: CAR / MOTORCYCLE / TRUCK / VAN / OTHER
              </span>
            }
            fields={[
              { key: "cedula",   label: "Cédula del dueño del vehículo (prioridad)",    required: false, note: "o usa unidad" },
              { key: "unidad",   label: "Código de unidad (si no viene la cédula)",     required: false },
              { key: "tipo",     label: "Tipo: CAR / MOTORCYCLE / TRUCK / VAN / OTHER", required: false, note: "por defecto CAR" },
              { key: "marca",    label: "Marca (ej: Toyota, Ford, Chevrolet)",          required: false },
              { key: "modelo",   label: "Modelo (ej: Corolla, F-150, Aveo)",            required: false },
              { key: "año",      label: "Año del vehículo",                             required: false },
              { key: "color",    label: "Color",                                        required: false },
              { key: "placa",    label: "Placa (ej: ABC-123)",                          required: false },
              { key: "puesto",   label: "Puesto de estacionamiento asignado",           required: false },
              { key: "notas",    label: "Notas",                                        required: false },
            ]}
            onDownloadTemplate={() => downloadXlsx(
              ["cedula","unidad","tipo","marca","modelo","año","color","placa","puesto","notas"],
              [
                ["12345678","A-101","CAR",        "Toyota",   "Corolla", 2020,"Blanco",  "ABC-123","P-01",""],
                ["12345678","A-101","MOTORCYCLE",  "Yamaha",   "FZ-S",    2019,"Negro",   "XYZ-456","",   "Segunda moto del mismo residente"],
                ["23456789","A-102","CAR",         "Ford",     "EcoSport",2021,"Gris",    "DEF-789","P-02",""],
                ["34567890","B-201","TRUCK",        "Chevrolet","NHR",     2018,"Blanco",  "GHI-321","P-10","Camioneta de carga"],
                ["",        "B-202","CAR",          "Honda",    "Civic",   2022,"Azul",    "JKL-654","P-03","Buscar por unidad"],
              ],
              "plantilla_vehiculos.xlsx",
            )}
            onImport={handleImportVehicles}
            isPending={bulkVehicles.isPending}
            result={bulkVehicles.data ?? null}
            previewRows={vehiclesRows}
            setPreviewRows={setVehiclesRows}
          />
        )}

        {/* ─── CONTRATISTAS ─── */}
        {tab === "contractors" && (
          <ImportPanel
            title="Contratistas y proveedores"
            description={
              <span>
                Importa tu directorio de proveedores de confianza para tenerlos disponibles en el módulo
                de Mantenimiento. La <strong>calificación</strong> es de 0 a 5 estrellas.
                Si el contratista ya existe con el mismo nombre exacto, se omite.
              </span>
            }
            fields={[
              { key: "nombre",       label: "Nombre del contratista o empresa",         required: true },
              { key: "especialidad", label: "Especialidad (ej: Plomería, Electricidad)", required: false },
              { key: "telefono",     label: "Teléfono de contacto",                     required: false },
              { key: "email",        label: "Correo electrónico",                       required: false },
              { key: "calificacion", label: "Calificación de 0 a 5",                   required: false },
              { key: "notas",        label: "Notas o comentarios",                      required: false },
            ]}
            onDownloadTemplate={() => downloadXlsx(
              ["nombre","especialidad","telefono","email","calificacion","notas"],
              [
                ["TecnoAscensor CA",    "Ascensores y elevadores",  "04141234567","ascensor@email.com", "4.5","Contrato anual vigente"],
                ["Fontanería Rápida",   "Plomería",                 "04161234567","",                  "4.0","Disponible 24/7"],
                ["Eléctricos del Este", "Electricidad",             "04241234567","elec@email.com",     "5.0","Certificado CADAFE"],
                ["Jardines y Más",      "Jardinería y limpieza",    "04121234567","",                  "3.5","Viene los martes"],
                ["Pinturas Express",    "Pintura",                  "04161111111","paint@email.com",    "4.0",""],
              ],
              "plantilla_contratistas.xlsx",
            )}
            onImport={handleImportContractors}
            isPending={bulkContractors.isPending}
            result={bulkContractors.data ?? null}
            previewRows={contractorsRows}
            setPreviewRows={setContractorsRows}
          />
        )}

        {/* ─── PRESUPUESTO ANUAL ─── */}
        {tab === "budget" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium">Año del presupuesto:</label>
              <input
                type="number"
                value={budgetYear}
                onChange={(e) => setBudgetYear(Number(e.target.value))}
                className="w-24 rounded-md border px-3 py-1.5 text-sm"
                min={2020} max={2100}
              />
              <span className="text-xs text-amber-600">⚠️ Si ya existe un presupuesto para este año, sus partidas serán reemplazadas.</span>
            </div>
            <ImportPanel
              title={`Presupuesto anual ${budgetYear}`}
              description={
                <span>
                  Importa las partidas del presupuesto anual. Cada fila es una categoría de gasto con su
                  monto estimado en USD. Si ya existe un presupuesto para el año seleccionado,
                  <strong> sus partidas serán reemplazadas</strong> por las del archivo.
                  Categorías válidas: ELECTRICITY / WATER / GAS / INTERNET / CLEANING / GARDENING /
                  SECURITY / ELEVATOR / STAFF_PAYROLL / ADMINISTRATION / INSURANCE / REPAIRS / RESERVE_FUND / TAXES / OTHER
                </span>
              }
              fields={[
                { key: "categoria",  label: "Categoría (ver lista arriba)", required: true },
                { key: "monto_usd",  label: "Monto presupuestado en USD",   required: true },
                { key: "notas",      label: "Notas o descripción",          required: false },
              ]}
              onDownloadTemplate={() => downloadXlsx(
                ["categoria","monto_usd","notas"],
                [
                  ["ELECTRICITY",   "540.00",  "CORPOELEC — 12 meses × $45"],
                  ["WATER",         "240.00",  "HIDROCAPITAL — 12 meses × $20"],
                  ["STAFF_PAYROLL", "1800.00", "Conserje 12 meses × $150"],
                  ["CLEANING",      "600.00",  "Empresa de limpieza mensual"],
                  ["ELEVATOR",      "960.00",  "Mantenimiento TecnoAscensor"],
                  ["ADMINISTRATION","300.00",  "Gastos administrativos varios"],
                  ["INSURANCE",     "200.00",  "Póliza del edificio"],
                  ["REPAIRS",       "500.00",  "Fondo para reparaciones"],
                  ["RESERVE_FUND",  "400.00",  "Aporte al fondo de reserva"],
                  ["OTHER",         "200.00",  "Imprevistos"],
                ],
                `plantilla_presupuesto_${budgetYear}.xlsx`,
              )}
              onImport={handleImportBudget}
              isPending={bulkBudget.isPending}
              result={
                bulkBudget.data
                  ? {
                      created: bulkBudget.data.items,
                      skipped: 0,
                      errors: [],
                      extra: `Total presupuestado: $${bulkBudget.data.totalUsd} USD · Año ${bulkBudget.data.year}`,
                    }
                  : null
              }
              previewRows={budgetRows}
              setPreviewRows={setBudgetRows}
            />
          </div>
        )}

        {/* ─── PAGOS HISTÓRICOS ─── */}
        {tab === "payments" && (
          <ImportPanel
            title="Pagos históricos"
            description={
              <span>
                Importa pagos recibidos anteriormente. Los pagos se registran como <strong>anticipos</strong>
                (no se asignan a facturas específicas automáticamente). Puedes asignarlos manualmente desde
                la sección de Pagos después de importar. Métodos válidos:
                CASH_BSS / CASH_USD / TRANSFER_BSS / TRANSFER_USD / ZELLE / PAGO_MOVIL / CRYPTO / CHECK / OTHER
              </span>
            }
            fields={[
              { key: "unidad",     label: "Código de la unidad",                                  required: true },
              { key: "monto_usd",  label: "Monto en USD",                                         required: true },
              { key: "monto_bs",   label: "Monto en Bs (opcional, se calcula)",                   required: false },
              { key: "tasa",       label: "Tasa USD→Bs usada (opcional)",                         required: false },
              { key: "metodo",     label: "Método de pago (ver descripción arriba)",              required: false, note: "por defecto OTHER" },
              { key: "fecha",      label: "Fecha del pago (YYYY-MM-DD)",                          required: true },
              { key: "referencia", label: "N° de referencia o comprobante",                       required: false },
              { key: "notas",      label: "Notas u observaciones",                                required: false },
            ]}
            onDownloadTemplate={() => downloadXlsx(
              ["unidad", "monto_usd", "monto_bs", "tasa", "metodo", "fecha", "referencia", "notas"],
              [
                ["A-101", "20.00", "750.00",  "37.50", "TRANSFER_USD",  "2026-01-05", "00123456", "Cuota enero"],
                ["A-102", "10.00", "375.00",  "37.50", "ZELLE",         "2026-01-10", "abc@gmail", "Pago parcial"],
                ["B-201", "20.00", "",         "",      "CASH_USD",      "2026-01-08", "",         ""],
                ["B-202", "20.00", "760.00",  "38.00", "PAGO_MOVIL",    "2026-01-06", "PM-9999",  ""],
              ],
              "plantilla_pagos_historicos.xlsx",
            )}
            onImport={handleImportPayments}
            isPending={bulkPayments.isPending}
            result={bulkPayments.data ?? null}
            previewRows={paymentsRows}
            setPreviewRows={setPaymentsRows}
          />
        )}
      </div>
    </div>
  );
}
