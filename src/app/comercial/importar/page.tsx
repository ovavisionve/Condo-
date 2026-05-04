"use client";

import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

type LocalRow = {
  code: string;
  name?: string;
  floor?: number;
  areaM2?: number;
  canonType: "FIXED" | "VARIABLE_SALES" | "MIXED";
  canonUsd?: number;
  aliquot?: number;
  tenantName?: string;
  tenantRif?: string;
  tenantPhone?: string;
  tenantEmail?: string;
  tenantStartDate?: Date;
  depositUsd?: number;
};

// ─── Columnas esperadas en el Excel ───────────────────────────────────────────

const HEADERS_LOCALES = [
  "code", "name", "floor", "areaM2", "canonType",
  "canonUsd", "aliquot",
  "tenantName", "tenantRif", "tenantPhone", "tenantEmail",
  "tenantStartDate", "depositUsd",
];

// ─── Utilidades ───────────────────────────────────────────────────────────────

function normalizeRow(raw: Record<string, unknown>): LocalRow {
  // Mapear nombres de columna en español o inglés
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = raw[k] ?? raw[k.toLowerCase()] ?? raw[k.toUpperCase()];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };

  const canonRaw = String(get("canonType", "Tipo Canon", "tipo_canon") ?? "FIXED").toUpperCase();
  const canonType = ["FIXED", "VARIABLE_SALES", "MIXED"].includes(canonRaw)
    ? (canonRaw as "FIXED" | "VARIABLE_SALES" | "MIXED")
    : "FIXED";

  const dateRaw = get("tenantStartDate", "Inicio contrato", "inicio_contrato", "startDate");
  let tenantStartDate: Date | undefined;
  if (dateRaw) {
    const d = new Date(String(dateRaw));
    if (!isNaN(d.getTime())) tenantStartDate = d;
  }

  const emailRaw = String(get("tenantEmail", "Email arrendatario", "email") ?? "");
  const emailClean = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : undefined;

  return {
    code: String(get("code", "Código", "codigo", "local") ?? "").trim().toUpperCase(),
    name: String(get("name", "Nombre", "nombre_local") ?? "") || undefined,
    floor: Number(get("floor", "Piso", "piso")) || undefined,
    areaM2: Number(get("areaM2", "area", "Área", "area_m2")) || undefined,
    canonType,
    canonUsd: Number(get("canonUsd", "Canon USD", "canon_usd")) || undefined,
    aliquot: Number(get("aliquot", "aliquotPct", "Alícuota %", "alicuota_pct")) || undefined,
    tenantName: String(get("tenantName", "Arrendatario", "tenant_name", "razon_social") ?? "") || undefined,
    tenantRif: String(get("tenantRif", "RIF", "rif") ?? "") || undefined,
    tenantPhone: String(get("tenantPhone", "Teléfono", "telefono", "phone") ?? "") || undefined,
    tenantEmail: emailClean,
    tenantStartDate,
    depositUsd: Number(get("depositUsd", "Depósito USD", "deposito_usd")) || undefined,
  };
}

// ─── Plantilla Excel descargable ──────────────────────────────────────────────

function downloadTemplate() {
  const rows = [
    {
      "code (*)": "A-01", "name": "Tienda Ejemplo", "floor": 1, "areaM2": 45.5,
      "canonType (FIXED/VARIABLE_SALES/MIXED)": "FIXED", "canonUsd": 500, "aliquot": 2.5,
      "tenantName": "Empresa ABC C.A.", "tenantRif": "J-12345678-9",
      "tenantPhone": "+584241234567", "tenantEmail": "empresa@abc.com",
      "tenantStartDate": "2025-01-01", "depositUsd": 1000,
    },
    {
      "code (*)": "A-02", "name": "Otra Tienda", "floor": 1, "areaM2": 60,
      "canonType (FIXED/VARIABLE_SALES/MIXED)": "FIXED", "canonUsd": 700, "aliquot": 3,
      "tenantName": "", "tenantRif": "",
      "tenantPhone": "", "tenantEmail": "",
      "tenantStartDate": "", "depositUsd": "",
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 14 }, { wch: 20 }, { wch: 6 }, { wch: 10 },
    { wch: 38 }, { wch: 12 }, { wch: 12 },
    { wch: 24 }, { wch: 18 },
    { wch: 18 }, { wch: 26 },
    { wch: 16 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Locales");
  XLSX.writeFile(wb, "plantilla_locales_cc.xlsx");
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ImportarPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ created: number; updated: number; tenantsCreated: number; errors: string[] } | null>(null);

  const importMut = trpc.comercial.imports.bulkLocales.useMutation({
    onSuccess: (r) => { setResult(r); setRows([]); setFileName(""); },
    onError: (e) => alert(`❌ Error: ${e.message}`),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const parsed = raw.map(normalizeRow).filter((r) => r.code.length > 0);
      setRows(parsed);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleImport = () => {
    if (!mallId || rows.length === 0) return;
    void importMut.mutateAsync({
      organizationId: selectedOrgId,
      mallId,
      rows: rows.map((r) => ({
        code: r.code,
        name: r.name,
        floor: r.floor,
        areaM2: r.areaM2,
        canonType: r.canonType,
        canonUsd: r.canonUsd,
        aliquot: r.aliquot,
        tenantName: r.tenantName,
        tenantRif: r.tenantRif,
        tenantPhone: r.tenantPhone,
        tenantEmail: r.tenantEmail ?? undefined,
        tenantStartDate: r.tenantStartDate,
        depositUsd: r.depositUsd,
      })),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">📥 Importar datos</h1>
        <p className="text-muted-foreground text-sm">Carga masiva de locales y arrendatarios desde Excel o CSV</p>
      </div>

      {/* Instrucciones + plantilla */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">📋 Locales y arrendatarios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Descarga la plantilla, completa los datos y sube el archivo. Los locales existentes (mismo código) se actualizarán.
            Si incluyes datos del arrendatario, se creará el contrato si el local no tiene uno activo.
          </p>
          <div className="grid gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <p><strong>Campos obligatorios:</strong> Código</p>
            <p><strong>Canon tipo:</strong> <code>FIXED</code> (fijo) · <code>VARIABLE_SALES</code> (% ventas) · <code>MIXED</code> (ambos)</p>
            <p><strong>Arrendatario:</strong> Si el campo &quot;Arrendatario&quot; está vacío, solo se crea/actualiza el local sin contrato</p>
            <p><strong>Formatos de fecha:</strong> AAAA-MM-DD o DD/MM/AAAA</p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            ⬇️ Descargar plantilla Excel
          </Button>
        </CardContent>
      </Card>

      {/* Zona de carga */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              📂 Seleccionar archivo
            </Button>
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          {/* Preview */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{rows.length} filas detectadas — Vista previa (primeras 10):</p>
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["Código", "Nombre", "Piso", "Canon USD", "Tipo", "Arrendatario", "Email"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i} className={!r.code ? "bg-red-50" : ""}>
                        <td className="px-3 py-2 font-mono font-medium">{r.code || <span className="text-red-500">⚠ vacío</span>}</td>
                        <td className="px-3 py-2">{r.name ?? "—"}</td>
                        <td className="px-3 py-2 text-center">{r.floor ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{r.canonUsd ? `$${r.canonUsd}` : "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-1.5 py-0.5 text-xs ${r.canonType === "FIXED" ? "bg-blue-100 text-blue-700" : r.canonType === "VARIABLE_SALES" ? "bg-purple-100 text-purple-700" : "bg-orange-100 text-orange-700"}`}>
                            {r.canonType}
                          </span>
                        </td>
                        <td className="px-3 py-2">{r.tenantName ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2">{r.tenantEmail ?? <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 10 && (
                <p className="text-xs text-muted-foreground">... y {rows.length - 10} filas más</p>
              )}

              <Button
                onClick={handleImport}
                disabled={importMut.isPending || !mallId}
                className="bg-blue-600 hover:bg-blue-700">
                {importMut.isPending ? "Importando..." : `⬆️ Importar ${rows.length} locales`}
              </Button>
            </div>
          )}

          {/* Resultado */}
          {result && (
            <div className={`rounded-lg p-4 ${result.errors.length > 0 ? "bg-yellow-50 border border-yellow-200" : "bg-green-50 border border-green-200"}`}>
              <p className="font-medium text-sm mb-2">
                {result.errors.length === 0 ? "✅ Importación completada" : "⚠️ Importación con errores"}
              </p>
              <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                <div>
                  <p className="text-muted-foreground text-xs">Creados</p>
                  <p className="font-bold text-green-700 text-lg">{result.created}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Actualizados</p>
                  <p className="font-bold text-blue-700 text-lg">{result.updated}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Contratos creados</p>
                  <p className="font-bold text-purple-700 text-lg">{result.tenantsCreated}</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-yellow-800">Errores ({result.errors.length}):</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-yellow-700">• {e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
