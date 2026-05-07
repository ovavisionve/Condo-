"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type LocalRow = {
  code: string; name?: string; floor?: number; areaM2?: number;
  canonType: "FIXED" | "VARIABLE_SALES" | "MIXED"; canonUsd?: number; aliquot?: number;
  tenantName?: string; tenantRif?: string; tenantPhone?: string; tenantEmail?: string;
  tenantStartDate?: Date; depositUsd?: number;
};

type PaymentRow = {
  localCode: string; amountUsd: number; paidAt: Date;
  method: "CASH_BSS"|"CASH_USD"|"TRANSFER_BSS"|"TRANSFER_USD"|"ZELLE"|"PAGO_MOVIL"|"CRYPTO"|"CHECK"|"OTHER";
  exchangeRate?: number; reference?: string; notes?: string;
};

type InvoiceRow = {
  localCode: string; periodYear: number; periodMonth: number; amountUsd: number;
  type: "CANON"|"CANON_SALES"|"ALIQUOT"|"EXTRA_FEE"|"FINE"|"OTHER";
  exchangeRate?: number; description?: string; issuedAt?: Date; dueDate?: Date;
  status?: "ISSUED"|"PAID"|"PARTIAL"|"OVERDUE"|"VOIDED"; paidUsd?: number;
};

type SalesRow = {
  localCode: string; periodYear: number; periodMonth: number; salesAmountUsd: number;
  salesAmountBss?: number; exchangeRate?: number; verified: boolean;
};

type IncomeRow = {
  category: "PUBLICIDAD_INTERNA"|"ALQUILER_ESPACIO"|"ESTACIONAMIENTO"|"PATROCINIOS"|"INTERESES"|"PENALIDADES"|"OTHER";
  description: string; amountUsd: number; periodYear: number; periodMonth: number;
  exchangeRate?: number; reference?: string; affectsInvoice: boolean; notes?: string;
};

// ─── Parsers ──────────────────────────────────────────────────────────────────

function get(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = raw[k] ?? raw[k.toLowerCase()] ?? raw[k.toUpperCase()];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function parseDate(val: unknown): Date | undefined {
  if (!val) return undefined;
  // XLSX puede devolver Date directamente
  if (val instanceof Date) return isNaN(val.getTime()) ? undefined : val;
  // Número serial de Excel
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? undefined : d;
}

function parseMethod(val: unknown): PaymentRow["method"] {
  const v = String(val ?? "TRANSFER_USD").toUpperCase().replace(/ /g, "_");
  const valid = ["CASH_BSS","CASH_USD","TRANSFER_BSS","TRANSFER_USD","ZELLE","PAGO_MOVIL","CRYPTO","CHECK","OTHER"];
  return valid.includes(v) ? v as PaymentRow["method"] : "TRANSFER_USD";
}

function parseInvoiceType(val: unknown): InvoiceRow["type"] {
  const v = String(val ?? "CANON").toUpperCase();
  const valid = ["CANON","CANON_SALES","ALIQUOT","EXTRA_FEE","FINE","OTHER"];
  return valid.includes(v) ? v as InvoiceRow["type"] : "CANON";
}

function parseIncomeCategory(val: unknown): IncomeRow["category"] {
  const v = String(val ?? "OTHER").toUpperCase().replace(/ /g, "_");
  const valid = ["PUBLICIDAD_INTERNA","ALQUILER_ESPACIO","ESTACIONAMIENTO","PATROCINIOS","INTERESES","PENALIDADES","OTHER"];
  return valid.includes(v) ? v as IncomeRow["category"] : "OTHER";
}

function normalizeLocalRow(raw: Record<string, unknown>): LocalRow {
  const canonRaw = String(get(raw, "canonType", "Tipo Canon", "tipo_canon") ?? "FIXED").toUpperCase();
  const canonType = ["FIXED", "VARIABLE_SALES", "MIXED"].includes(canonRaw)
    ? (canonRaw as LocalRow["canonType"]) : "FIXED";
  const emailRaw = String(get(raw, "tenantEmail", "Email arrendatario", "email") ?? "");
  const emailClean = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : undefined;
  return {
    code: String(get(raw, "code", "Código", "codigo", "local") ?? "").trim().toUpperCase(),
    name: String(get(raw, "name", "Nombre", "nombre_local") ?? "") || undefined,
    floor: Number(get(raw, "floor", "Piso", "piso")) || undefined,
    areaM2: Number(get(raw, "areaM2", "area", "Área", "area_m2")) || undefined,
    canonType,
    canonUsd: Number(get(raw, "canonUsd", "Canon USD", "canon_usd")) || undefined,
    aliquot: Number(get(raw, "aliquot", "aliquotPct", "Alícuota %", "alicuota_pct")) || undefined,
    tenantName: String(get(raw, "tenantName", "Arrendatario", "tenant_name", "razon_social") ?? "") || undefined,
    tenantRif: String(get(raw, "tenantRif", "RIF", "rif") ?? "") || undefined,
    tenantPhone: String(get(raw, "tenantPhone", "Teléfono", "telefono", "phone") ?? "") || undefined,
    tenantEmail: emailClean,
    tenantStartDate: parseDate(get(raw, "tenantStartDate", "Inicio contrato", "inicio_contrato", "startDate")),
    depositUsd: Number(get(raw, "depositUsd", "Depósito USD", "deposito_usd")) || undefined,
  };
}

function normalizePaymentRow(raw: Record<string, unknown>): PaymentRow {
  return {
    localCode: String(get(raw, "localCode", "local", "Local", "codigo_local") ?? "").trim().toUpperCase(),
    amountUsd: Number(get(raw, "amountUsd", "Monto USD", "monto_usd") ?? 0),
    paidAt: parseDate(get(raw, "paidAt", "Fecha pago", "fecha_pago")) ?? new Date(),
    method: parseMethod(get(raw, "method", "Método", "metodo")),
    exchangeRate: Number(get(raw, "exchangeRate", "Tasa", "tasa")) || undefined,
    reference: String(get(raw, "reference", "Referencia", "ref") ?? "") || undefined,
    notes: String(get(raw, "notes", "Notas", "notas") ?? "") || undefined,
  };
}

function normalizeInvoiceRow(raw: Record<string, unknown>): InvoiceRow {
  return {
    localCode: String(get(raw, "localCode", "local", "Local", "codigo_local") ?? "").trim().toUpperCase(),
    periodYear: Number(get(raw, "periodYear", "Año", "anio", "year") ?? 0),
    periodMonth: Number(get(raw, "periodMonth", "Mes", "mes", "month") ?? 0),
    amountUsd: Number(get(raw, "amountUsd", "Monto USD", "monto_usd") ?? 0),
    type: parseInvoiceType(get(raw, "type", "Tipo", "tipo")),
    exchangeRate: Number(get(raw, "exchangeRate", "Tasa", "tasa")) || undefined,
    description: String(get(raw, "description", "Descripción", "descripcion") ?? "") || undefined,
    issuedAt: parseDate(get(raw, "issuedAt", "Fecha emisión", "fecha_emision")),
    dueDate: parseDate(get(raw, "dueDate", "Fecha vencimiento", "vencimiento")),
    status: String(get(raw, "status", "Estado", "estado") ?? "ISSUED").toUpperCase() as InvoiceRow["status"],
    paidUsd: Number(get(raw, "paidUsd", "Pagado USD", "pagado_usd")) || undefined,
  };
}

function normalizeSalesRow(raw: Record<string, unknown>): SalesRow {
  return {
    localCode: String(get(raw, "localCode", "local", "Local", "codigo_local") ?? "").trim().toUpperCase(),
    periodYear: Number(get(raw, "periodYear", "Año", "anio", "year") ?? 0),
    periodMonth: Number(get(raw, "periodMonth", "Mes", "mes", "month") ?? 0),
    salesAmountUsd: Number(get(raw, "salesAmountUsd", "Ventas USD", "ventas_usd") ?? 0),
    salesAmountBss: Number(get(raw, "salesAmountBss", "Ventas Bs", "ventas_bss")) || undefined,
    exchangeRate: Number(get(raw, "exchangeRate", "Tasa", "tasa")) || undefined,
    verified: String(get(raw, "verified", "Verificado", "verificado") ?? "false").toLowerCase() === "true",
  };
}

function normalizeIncomeRow(raw: Record<string, unknown>): IncomeRow {
  return {
    category: parseIncomeCategory(get(raw, "category", "Categoría", "categoria")),
    description: String(get(raw, "description", "Descripción", "descripcion") ?? "").trim(),
    amountUsd: Number(get(raw, "amountUsd", "Monto USD", "monto_usd") ?? 0),
    periodYear: Number(get(raw, "periodYear", "Año", "anio", "year") ?? 0),
    periodMonth: Number(get(raw, "periodMonth", "Mes", "mes", "month") ?? 0),
    exchangeRate: Number(get(raw, "exchangeRate", "Tasa", "tasa")) || undefined,
    reference: String(get(raw, "reference", "Referencia", "ref") ?? "") || undefined,
    affectsInvoice: String(get(raw, "affectsInvoice", "Afecta factura") ?? "false").toLowerCase() === "true",
    notes: String(get(raw, "notes", "Notas", "notas") ?? "") || undefined,
  };
}

// ─── Plantillas Excel ─────────────────────────────────────────────────────────

function downloadTemplate(type: "locales" | "pagos" | "facturas" | "ventas" | "recaudacion" | "all") {
  const wb = XLSX.utils.book_new();

  const localesRows = [{
    "code (*)": "A-01", "name": "Tienda Ejemplo", "floor": 1, "areaM2": 45.5,
    "canonType (FIXED/VARIABLE_SALES/MIXED)": "FIXED", "canonUsd": 500, "aliquot": 2.5,
    "tenantName": "Empresa ABC C.A.", "tenantRif": "J-12345678-9",
    "tenantPhone": "+584241234567", "tenantEmail": "empresa@abc.com",
    "tenantStartDate": "2025-01-01", "depositUsd": 1000,
  }, {
    "code (*)": "A-02", "name": "Otra Tienda", "floor": 1, "areaM2": 60,
    "canonType (FIXED/VARIABLE_SALES/MIXED)": "FIXED", "canonUsd": 700, "aliquot": 3,
    "tenantName": "", "tenantRif": "", "tenantPhone": "", "tenantEmail": "",
    "tenantStartDate": "", "depositUsd": "",
  }];

  const pagosRows = [{
    "localCode (*)": "A-01", "amountUsd (*)": 800, "paidAt (*)": "2026-01-15",
    "method (TRANSFER_USD/ZELLE/PAGO_MOVIL/OTHER)": "TRANSFER_USD",
    "exchangeRate": 90.50, "reference": "TRF-001", "notes": "",
  }, {
    "localCode (*)": "A-02", "amountUsd (*)": 1200, "paidAt (*)": "2026-01-20",
    "method (TRANSFER_USD/ZELLE/PAGO_MOVIL/OTHER)": "ZELLE",
    "exchangeRate": 90.50, "reference": "ZLL-002", "notes": "Pago mes enero",
  }];

  const facturasRows = [{
    "localCode (*)": "A-01", "periodYear (*)": 2026, "periodMonth (*)": 1, "amountUsd (*)": 500,
    "type (CANON/EXTRA_FEE/FINE/OTHER)": "CANON", "description": "", "exchangeRate": 90.50,
    "issuedAt": "2026-01-01", "dueDate": "2026-01-06",
    "status (ISSUED/PAID/PARTIAL/OVERDUE)": "ISSUED", "paidUsd": 0,
  }, {
    "localCode (*)": "A-02", "periodYear (*)": 2026, "periodMonth (*)": 1, "amountUsd (*)": 700,
    "type (CANON/EXTRA_FEE/FINE/OTHER)": "CANON", "description": "", "exchangeRate": 90.50,
    "issuedAt": "2026-01-01", "dueDate": "2026-01-06",
    "status (ISSUED/PAID/PARTIAL/OVERDUE)": "PAID", "paidUsd": 700,
  }];

  const ventasRows = [{
    "localCode (*)": "A-01", "periodYear (*)": 2026, "periodMonth (*)": 1,
    "salesAmountUsd (*)": 15000, "exchangeRate": 90.50, "verified (true/false)": "false",
  }];

  const recaudacionRows = [{
    "description (*)": "Alquiler espacio feria navideña", "amountUsd (*)": 2000,
    "periodYear (*)": 2025, "periodMonth (*)": 12,
    "category (PUBLICIDAD_INTERNA/ALQUILER_ESPACIO/ESTACIONAMIENTO/PATROCINIOS/INTERESES/PENALIDADES/OTHER)": "ALQUILER_ESPACIO",
    "exchangeRate": 90.50, "reference": "ING-001",
    "affectsInvoice (true/false)": "false", "notes": "",
  }];

  if (type === "locales" || type === "all") {
    const ws = XLSX.utils.json_to_sheet(localesRows);
    ws["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 6 }, { wch: 10 }, { wch: 38 }, { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 26 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Locales");
  }
  if (type === "pagos" || type === "all") {
    const ws = XLSX.utils.json_to_sheet(pagosRows);
    ws["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, "Pagos");
  }
  if (type === "facturas" || type === "all") {
    const ws = XLSX.utils.json_to_sheet(facturasRows);
    ws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 38 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 38 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, "Facturas");
  }
  if (type === "ventas" || type === "all") {
    const ws = XLSX.utils.json_to_sheet(ventasRows);
    ws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, "Ventas");
  }
  if (type === "recaudacion" || type === "all") {
    const ws = XLSX.utils.json_to_sheet(recaudacionRows);
    ws["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 60 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, "Recaudacion");
  }

  const fileName = type === "all" ? "plantilla_importacion_completa_cc.xlsx" : `plantilla_${type}_cc.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// ─── Componente principal ─────────────────────────────────────────────────────

type TabId = "locales" | "pagos" | "facturas" | "ventas" | "recaudacion" | "all";

const TABS: { id: TabId; label: string }[] = [
  { id: "locales", label: "Locales" },
  { id: "pagos", label: "Pagos" },
  { id: "facturas", label: "Facturas" },
  { id: "ventas", label: "Ventas" },
  { id: "recaudacion", label: "Recaudacion" },
  { id: "all", label: "Todo en uno" },
];

export default function ImportarPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const [activeTab, setActiveTab] = useState<TabId>("locales");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Importar datos</h1>
        <p className="text-muted-foreground text-sm">Carga masiva desde Excel o CSV</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "locales" && (
        <LocalesTab orgId={selectedOrgId} mallId={mallId} />
      )}
      {activeTab === "pagos" && (
        <PagosTab orgId={selectedOrgId} mallId={mallId} />
      )}
      {activeTab === "facturas" && (
        <FacturasTab orgId={selectedOrgId} mallId={mallId} />
      )}
      {activeTab === "ventas" && (
        <VentasTab orgId={selectedOrgId} mallId={mallId} />
      )}
      {activeTab === "recaudacion" && (
        <RecaudacionTab orgId={selectedOrgId} mallId={mallId} />
      )}
      {activeTab === "all" && (
        <TodoEnUnoTab orgId={selectedOrgId} mallId={mallId} />
      )}
    </div>
  );
}

// ─── Tab Locales ──────────────────────────────────────────────────────────────

function LocalesTab({ orgId, mallId }: { orgId: string; mallId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; updated: number; tenantsCreated: number; errors: string[] } | null>(null);

  const importMut = trpc.comercial.imports.bulkLocales.useMutation({
    onSuccess: (r) => { setResult(r); setRows([]); setFileName(""); },
    onError: (e) => alert(`Error: ${e.message}`),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name); setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      setRows(raw.map(normalizeLocalRow).filter((r) => r.code.length > 0));
    };
    reader.readAsArrayBuffer(file); e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Locales y arrendatarios</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <p><strong>Obligatorio:</strong> <code>code</code> (codigo del local)</p>
            <p><strong>Opcional:</strong> name, floor, areaM2, canonType, canonUsd, aliquot, tenantName, tenantRif, tenantPhone, tenantEmail, tenantStartDate, depositUsd</p>
            <p><strong>canonType:</strong> FIXED · VARIABLE_SALES · MIXED</p>
            <p>Los locales existentes (mismo codigo) se actualizan. Si hay tenantName y el local no tiene contrato activo, se crea uno.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadTemplate("locales")}>Descargar plantilla</Button>
        </CardContent>
      </Card>
      <ImportCard
        fileRef={fileRef} fileName={fileName} rows={rows} rowCount={rows.length}
        onFile={handleFile} onClear={() => { setRows([]); setFileName(""); setResult(null); }}
        onImport={() => {
          if (!mallId || rows.length === 0) return;
          void importMut.mutateAsync({ organizationId: orgId, mallId, rows });
        }}
        isPending={importMut.isPending} disabled={!mallId}
        preview={
          <SimpleTable
            headers={["Codigo", "Nombre", "Piso", "Canon USD", "Tipo", "Arrendatario"]}
            rows={rows.slice(0, 5).map((r) => [r.code, r.name ?? "—", r.floor ?? "—", r.canonUsd ? `$${r.canonUsd}` : "—", r.canonType, r.tenantName ?? "—"])}
          />
        }
        result={result && (
          <ResultCard errors={result.errors}>
            <Counter label="Creados" value={result.created} color="green" />
            <Counter label="Actualizados" value={result.updated} color="blue" />
            <Counter label="Contratos" value={result.tenantsCreated} color="purple" />
          </ResultCard>
        )}
      />
    </div>
  );
}

// ─── Tab Pagos ────────────────────────────────────────────────────────────────

function PagosTab({ orgId, mallId }: { orgId: string; mallId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

  const importMut = trpc.comercial.imports.bulkPayments.useMutation({
    onSuccess: (r) => { setResult(r); setRows([]); setFileName(""); },
    onError: (e) => alert(`Error: ${e.message}`),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name); setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      setRows(raw.map(normalizePaymentRow).filter((r) => r.localCode.length > 0 && r.amountUsd > 0));
    };
    reader.readAsArrayBuffer(file); e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Pagos historicos</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <p><strong>Obligatorio:</strong> localCode, amountUsd, paidAt</p>
            <p><strong>Opcional:</strong> method (TRANSFER_USD por defecto), exchangeRate, reference, notes</p>
            <p><strong>method:</strong> CASH_BSS · CASH_USD · TRANSFER_BSS · TRANSFER_USD · ZELLE · PAGO_MOVIL · CRYPTO · CHECK · OTHER</p>
            <p>Se aplica oldest-first a facturas pendientes. El surplus queda como anticipo.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadTemplate("pagos")}>Descargar plantilla</Button>
        </CardContent>
      </Card>
      <ImportCard
        fileRef={fileRef} fileName={fileName} rows={rows} rowCount={rows.length}
        onFile={handleFile} onClear={() => { setRows([]); setFileName(""); setResult(null); }}
        onImport={() => {
          if (!mallId || rows.length === 0) return;
          void importMut.mutateAsync({
            organizationId: orgId, mallId,
            rows: rows.map((r) => ({ ...r, exchangeRate: r.exchangeRate ?? undefined })),
          });
        }}
        isPending={importMut.isPending} disabled={!mallId}
        preview={
          <SimpleTable
            headers={["Local", "Monto USD", "Fecha pago", "Metodo", "Referencia"]}
            rows={rows.slice(0, 5).map((r) => [r.localCode, `$${r.amountUsd}`, r.paidAt.toLocaleDateString("es-VE"), r.method, r.reference ?? "—"])}
          />
        }
        result={result && (
          <ResultCard errors={result.errors}>
            <Counter label="Pagos creados" value={result.created} color="green" />
          </ResultCard>
        )}
      />
    </div>
  );
}

// ─── Tab Facturas ─────────────────────────────────────────────────────────────

function FacturasTab({ orgId, mallId }: { orgId: string; mallId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  const importMut = trpc.comercial.imports.bulkInvoices.useMutation({
    onSuccess: (r) => { setResult(r); setRows([]); setFileName(""); },
    onError: (e) => alert(`Error: ${e.message}`),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name); setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      setRows(raw.map(normalizeInvoiceRow).filter((r) => r.localCode.length > 0 && r.amountUsd > 0 && r.periodYear > 2000 && r.periodMonth >= 1 && r.periodMonth <= 12));
    };
    reader.readAsArrayBuffer(file); e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Facturas historicas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <p><strong>Obligatorio:</strong> localCode, periodYear, periodMonth, amountUsd</p>
            <p><strong>Opcional:</strong> type (CANON por defecto), description, exchangeRate, issuedAt, dueDate, status, paidUsd</p>
            <p><strong>type:</strong> CANON · CANON_SALES · ALIQUOT · EXTRA_FEE · FINE · OTHER</p>
            <p>Si ya existe factura del mismo tipo+periodo+local (no VOIDED), se omite.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadTemplate("facturas")}>Descargar plantilla</Button>
        </CardContent>
      </Card>
      <ImportCard
        fileRef={fileRef} fileName={fileName} rows={rows} rowCount={rows.length}
        onFile={handleFile} onClear={() => { setRows([]); setFileName(""); setResult(null); }}
        onImport={() => {
          if (!mallId || rows.length === 0) return;
          void importMut.mutateAsync({ organizationId: orgId, mallId, rows });
        }}
        isPending={importMut.isPending} disabled={!mallId}
        preview={
          <SimpleTable
            headers={["Local", "Año", "Mes", "Monto USD", "Tipo", "Estado"]}
            rows={rows.slice(0, 5).map((r) => [r.localCode, String(r.periodYear), String(r.periodMonth), `$${r.amountUsd}`, r.type, r.status ?? "ISSUED"])}
          />
        }
        result={result && (
          <ResultCard errors={result.errors}>
            <Counter label="Creadas" value={result.created} color="green" />
            <Counter label="Omitidas (ya existen)" value={result.skipped} color="amber" />
          </ResultCard>
        )}
      />
    </div>
  );
}

// ─── Tab Ventas ───────────────────────────────────────────────────────────────

function VentasTab({ orgId, mallId }: { orgId: string; mallId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);

  const importMut = trpc.comercial.imports.bulkSalesDeclarations.useMutation({
    onSuccess: (r) => { setResult(r); setRows([]); setFileName(""); },
    onError: (e) => alert(`Error: ${e.message}`),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name); setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      setRows(raw.map(normalizeSalesRow).filter((r) => r.localCode.length > 0 && r.periodYear > 2000));
    };
    reader.readAsArrayBuffer(file); e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Declaraciones de ventas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <p><strong>Obligatorio:</strong> localCode, periodYear, periodMonth, salesAmountUsd</p>
            <p><strong>Opcional:</strong> salesAmountBss, exchangeRate, verified (true/false)</p>
            <p>Si ya existe declaracion del mismo local+periodo, se actualiza.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadTemplate("ventas")}>Descargar plantilla</Button>
        </CardContent>
      </Card>
      <ImportCard
        fileRef={fileRef} fileName={fileName} rows={rows} rowCount={rows.length}
        onFile={handleFile} onClear={() => { setRows([]); setFileName(""); setResult(null); }}
        onImport={() => {
          if (!mallId || rows.length === 0) return;
          void importMut.mutateAsync({ organizationId: orgId, mallId, rows });
        }}
        isPending={importMut.isPending} disabled={!mallId}
        preview={
          <SimpleTable
            headers={["Local", "Año", "Mes", "Ventas USD", "Verificado"]}
            rows={rows.slice(0, 5).map((r) => [r.localCode, String(r.periodYear), String(r.periodMonth), `$${r.salesAmountUsd}`, r.verified ? "Si" : "No"])}
          />
        }
        result={result && (
          <ResultCard errors={result.errors}>
            <Counter label="Creadas" value={result.created} color="green" />
            <Counter label="Actualizadas" value={result.updated} color="blue" />
          </ResultCard>
        )}
      />
    </div>
  );
}

// ─── Tab Recaudacion ──────────────────────────────────────────────────────────

function RecaudacionTab({ orgId, mallId }: { orgId: string; mallId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<IncomeRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

  const importMut = trpc.comercial.imports.bulkIncomes.useMutation({
    onSuccess: (r) => { setResult(r); setRows([]); setFileName(""); },
    onError: (e) => alert(`Error: ${e.message}`),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name); setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      setRows(raw.map(normalizeIncomeRow).filter((r) => r.description.length > 0 && r.amountUsd > 0));
    };
    reader.readAsArrayBuffer(file); e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recaudacion extra</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <p><strong>Obligatorio:</strong> description, amountUsd, periodYear, periodMonth</p>
            <p><strong>Opcional:</strong> category, exchangeRate, reference, affectsInvoice (true/false), notes</p>
            <p><strong>category:</strong> PUBLICIDAD_INTERNA · ALQUILER_ESPACIO · ESTACIONAMIENTO · PATROCINIOS · INTERESES · PENALIDADES · OTHER</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadTemplate("recaudacion")}>Descargar plantilla</Button>
        </CardContent>
      </Card>
      <ImportCard
        fileRef={fileRef} fileName={fileName} rows={rows} rowCount={rows.length}
        onFile={handleFile} onClear={() => { setRows([]); setFileName(""); setResult(null); }}
        onImport={() => {
          if (!mallId || rows.length === 0) return;
          void importMut.mutateAsync({ organizationId: orgId, mallId, rows });
        }}
        isPending={importMut.isPending} disabled={!mallId}
        preview={
          <SimpleTable
            headers={["Descripcion", "Monto USD", "Año", "Mes", "Categoria"]}
            rows={rows.slice(0, 5).map((r) => [r.description, `$${r.amountUsd}`, String(r.periodYear), String(r.periodMonth), r.category])}
          />
        }
        result={result && (
          <ResultCard errors={result.errors}>
            <Counter label="Creados" value={result.created} color="green" />
          </ResultCard>
        )}
      />
    </div>
  );
}

// ─── Tab Todo en uno ──────────────────────────────────────────────────────────

type AllResult = {
  locales?: { created: number; updated: number; tenantsCreated: number; errors: string[] };
  pagos?: { created: number; errors: string[] };
  facturas?: { created: number; skipped: number; errors: string[] };
  ventas?: { created: number; updated: number; errors: string[] };
  recaudacion?: { created: number; errors: string[] };
};

function TodoEnUnoTab({ orgId, mallId }: { orgId: string; mallId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<{
    locales?: LocalRow[]; pagos?: PaymentRow[]; facturas?: InvoiceRow[];
    ventas?: SalesRow[]; recaudacion?: IncomeRow[];
  }>({});
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<AllResult | null>(null);

  const localesMut = trpc.comercial.imports.bulkLocales.useMutation();
  const pagosMut = trpc.comercial.imports.bulkPayments.useMutation();
  const facturasMut = trpc.comercial.imports.bulkInvoices.useMutation();
  const ventasMut = trpc.comercial.imports.bulkSalesDeclarations.useMutation();
  const recaudacionMut = trpc.comercial.imports.bulkIncomes.useMutation();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name); setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array", cellDates: true });
      const parsed: typeof sheets = {};
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName]!;
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        const nameLower = sheetName.toLowerCase();
        if (nameLower.includes("local")) {
          parsed.locales = raw.map(normalizeLocalRow).filter((r) => r.code.length > 0);
        } else if (nameLower.includes("pago")) {
          parsed.pagos = raw.map(normalizePaymentRow).filter((r) => r.localCode.length > 0 && r.amountUsd > 0);
        } else if (nameLower.includes("factura") || nameLower.includes("invoice")) {
          parsed.facturas = raw.map(normalizeInvoiceRow).filter((r) => r.localCode.length > 0 && r.amountUsd > 0);
        } else if (nameLower.includes("venta") || nameLower.includes("sale")) {
          parsed.ventas = raw.map(normalizeSalesRow).filter((r) => r.localCode.length > 0 && r.periodYear > 2000);
        } else if (nameLower.includes("recaud") || nameLower.includes("income")) {
          parsed.recaudacion = raw.map(normalizeIncomeRow).filter((r) => r.description.length > 0 && r.amountUsd > 0);
        }
      }
      setSheets(parsed);
    };
    reader.readAsArrayBuffer(file); e.target.value = "";
  };

  const handleImportAll = async () => {
    if (!mallId) return;
    setIsPending(true);
    const res: AllResult = {};
    try {
      if (sheets.locales?.length) {
        res.locales = await localesMut.mutateAsync({ organizationId: orgId, mallId, rows: sheets.locales });
      }
      if (sheets.pagos?.length) {
        res.pagos = await pagosMut.mutateAsync({ organizationId: orgId, mallId, rows: sheets.pagos.map((r) => ({ ...r, exchangeRate: r.exchangeRate ?? undefined })) });
      }
      if (sheets.facturas?.length) {
        res.facturas = await facturasMut.mutateAsync({ organizationId: orgId, mallId, rows: sheets.facturas });
      }
      if (sheets.ventas?.length) {
        res.ventas = await ventasMut.mutateAsync({ organizationId: orgId, mallId, rows: sheets.ventas });
      }
      if (sheets.recaudacion?.length) {
        res.recaudacion = await recaudacionMut.mutateAsync({ organizationId: orgId, mallId, rows: sheets.recaudacion });
      }
      setResult(res);
      setSheets({});
      setFileName("");
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Error desconocido"}`);
    } finally {
      setIsPending(false);
    }
  };

  const totalRows = (sheets.locales?.length ?? 0) + (sheets.pagos?.length ?? 0) +
    (sheets.facturas?.length ?? 0) + (sheets.ventas?.length ?? 0) + (sheets.recaudacion?.length ?? 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Importacion completa (multiples modulos)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Descarga la plantilla con 5 hojas. Completa las que necesites y sube el archivo.
            El sistema importara en orden: Locales → Pagos → Facturas → Ventas → Recaudacion.
          </p>
          <Button variant="outline" size="sm" onClick={() => downloadTemplate("all")}>Descargar plantilla completa (5 hojas)</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>Seleccionar archivo</Button>
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          </div>

          {totalRows > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([
                { label: "Locales", count: sheets.locales?.length ?? 0 },
                { label: "Pagos", count: sheets.pagos?.length ?? 0 },
                { label: "Facturas", count: sheets.facturas?.length ?? 0 },
                { label: "Ventas", count: sheets.ventas?.length ?? 0 },
                { label: "Recaudacion", count: sheets.recaudacion?.length ?? 0 },
              ] as { label: string; count: number }[]).map((s) => (
                <div key={s.label} className={`rounded-lg border p-3 text-center ${s.count > 0 ? "border-blue-200 bg-blue-50" : "border-muted bg-muted/30"}`}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.count > 0 ? "text-blue-700" : "text-muted-foreground"}`}>{s.count}</p>
                  <p className="text-xs text-muted-foreground">{s.count > 0 ? "filas" : "sin datos"}</p>
                </div>
              ))}
            </div>
          )}

          {totalRows > 0 && (
            <Button onClick={handleImportAll} disabled={isPending || !mallId} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? "Importando..." : `Importar todo (${totalRows} filas)`}
            </Button>
          )}

          {result && (
            <div className="space-y-3">
              {result.locales && (
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-2">Locales</p>
                  <ResultCard errors={result.locales.errors}>
                    <Counter label="Creados" value={result.locales.created} color="green" />
                    <Counter label="Actualizados" value={result.locales.updated} color="blue" />
                    <Counter label="Contratos" value={result.locales.tenantsCreated} color="purple" />
                  </ResultCard>
                </div>
              )}
              {result.pagos && (
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-2">Pagos</p>
                  <ResultCard errors={result.pagos.errors}>
                    <Counter label="Creados" value={result.pagos.created} color="green" />
                  </ResultCard>
                </div>
              )}
              {result.facturas && (
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-2">Facturas</p>
                  <ResultCard errors={result.facturas.errors}>
                    <Counter label="Creadas" value={result.facturas.created} color="green" />
                    <Counter label="Omitidas" value={result.facturas.skipped} color="amber" />
                  </ResultCard>
                </div>
              )}
              {result.ventas && (
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-2">Ventas</p>
                  <ResultCard errors={result.ventas.errors}>
                    <Counter label="Creadas" value={result.ventas.created} color="green" />
                    <Counter label="Actualizadas" value={result.ventas.updated} color="blue" />
                  </ResultCard>
                </div>
              )}
              {result.recaudacion && (
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-2">Recaudacion</p>
                  <ResultCard errors={result.recaudacion.errors}>
                    <Counter label="Creados" value={result.recaudacion.created} color="green" />
                  </ResultCard>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Componentes reutilizables ─────────────────────────────────────────────────

function ImportCard({
  fileRef, fileName, rows, rowCount, onFile, onClear, onImport, isPending, disabled, preview, result,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fileRef: React.RefObject<any>;
  fileName: string; rows: unknown[]; rowCount: number;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void; onImport: () => void;
  isPending: boolean; disabled: boolean;
  preview: React.ReactNode; result: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>Seleccionar archivo</Button>
          {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          {rows.length > 0 && (
            <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground underline">Limpiar</button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
        </div>

        {rowCount > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{rowCount} filas — Vista previa (primeras 5):</p>
            {preview}
            {rowCount > 5 && <p className="text-xs text-muted-foreground">... y {rowCount - 5} filas mas</p>}
            <Button onClick={onImport} disabled={isPending || disabled} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? "Importando..." : `Importar ${rowCount} filas`}
            </Button>
          </div>
        )}

        {result}
      </CardContent>
    </Card>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultCard({ errors, children }: { errors: string[]; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg p-4 ${errors.length > 0 ? "bg-yellow-50 border border-yellow-200" : "bg-green-50 border border-green-200"}`}>
      <p className="font-medium text-sm mb-3">
        {errors.length === 0 ? "Importacion completada" : "Importacion con errores"}
      </p>
      <div className="flex gap-6 flex-wrap mb-3">{children}</div>
      {errors.length > 0 && (
        <div className="space-y-1 mt-2">
          <p className="text-xs font-medium text-yellow-800">Errores ({errors.length}):</p>
          {errors.slice(0, 20).map((e, i) => (
            <p key={i} className="text-xs text-yellow-700">- {e}</p>
          ))}
          {errors.length > 20 && <p className="text-xs text-yellow-600">... y {errors.length - 20} errores mas</p>}
        </div>
      )}
    </div>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color: "green" | "blue" | "purple" | "amber" }) {
  const colorMap = {
    green: "text-green-700", blue: "text-blue-700", purple: "text-purple-700", amber: "text-amber-700",
  };
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`font-bold text-lg ${colorMap[color]}`}>{value}</p>
    </div>
  );
}
