"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";

// ─── Tipos de importación disponibles ────────────────────────────────────────
type Tab = "units" | "residents" | "invoices" | "expenses" | "payments";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "units",     label: "Unidades",          icon: "🏠" },
  { id: "residents", label: "Residentes",         icon: "👥" },
  { id: "invoices",  label: "Deudas históricas",  icon: "📄" },
  { id: "expenses",  label: "Gastos históricos",  icon: "📋" },
  { id: "payments",  label: "Pagos históricos",   icon: "💳" },
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
          const wb = xlsx.read(data, { type: "array" });
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
function ImportResult({ result }: { result: { created: number; skipped: number; errors: string[] } | null }) {
  if (!result) return null;
  return (
    <div className="mt-4 space-y-2">
      <div className="rounded-lg border bg-green-50 border-green-200 px-4 py-3 text-sm">
        <span className="font-semibold text-green-700">✅ {result.created} registros importados</span>
        {result.skipped > 0 && (
          <span className="ml-3 text-amber-700">⚠️ {result.skipped} omitidos</span>
        )}
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
  result: { created: number; skipped: number; errors: string[] } | null;
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
  const [unitsRows,     setUnitsRows]     = useState<Record<string, string>[]>([]);
  const [residentsRows, setResidentsRows] = useState<Record<string, string>[]>([]);
  const [invoicesRows,  setInvoicesRows]  = useState<Record<string, string>[]>([]);
  const [expensesRows,  setExpensesRows]  = useState<Record<string, string>[]>([]);
  const [paymentsRows,  setPaymentsRows]  = useState<Record<string, string>[]>([]);

  // Mutations
  const bulkUnits     = trpc.org.units.bulkCreate.useMutation();
  const bulkResidents = trpc.org.persons.bulkImport.useMutation();
  const bulkInvoices  = trpc.finance.bulkImportInvoices.useMutation();
  const bulkExpenses  = trpc.finance.bulkImportExpenses.useMutation();
  const bulkPayments  = trpc.finance.bulkImportPayments.useMutation();

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
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Contenido según tab */}
      <div className="max-w-4xl">

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
