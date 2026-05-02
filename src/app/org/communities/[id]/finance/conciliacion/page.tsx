"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useOrgs } from "@/app/org/OrgContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────
interface BankRow {
  fecha: string;
  referencia: string;
  monto: number;
  descripcion: string;
}

interface PaymentForReconciliation {
  id: string;
  reference: string | null;
  amountUsd: string;
  unitLabel: string;
  ownerName: string;
  paidAt: string;
}

interface MatchResult {
  bankRow: BankRow;
  matched: boolean;
  payment?: PaymentForReconciliation;
  diff?: number;
}

type FileFormat = "csv" | "xlsx" | "xls" | "ofx" | "qfx" | "tsv" | "unknown";

// ─── Number parsing ───────────────────────────────────────────────────────────
/**
 * Detecta si la coma o el punto actúan como separador decimal.
 * Soporta: "1.234,56" · "1,234.56" · "1234.56" · "1234,56" · "500"
 */
function parseMoney(raw: string): number {
  const s = raw.trim().replace(/[^\d.,-]/g, ""); // quita signos de moneda, espacios, etc.
  if (!s) return 0;

  const lastComma = s.lastIndexOf(",");
  const lastDot   = s.lastIndexOf(".");

  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    // Ambos presentes: el que viene último es el decimal
    if (lastComma > lastDot) {
      // "1.234,56" → europeo
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      // "1,234.56" → anglosajón
      normalized = s.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    // Solo coma → puede ser decimal ("1234,56") o miles ("1,234")
    const parts = s.split(",");
    if (parts.length === 2 && parts[1]!.length <= 2) {
      // Coma como decimal
      normalized = s.replace(",", ".");
    } else {
      // Coma como miles
      normalized = s.replace(/,/g, "");
    }
  } else {
    normalized = s;
  }

  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

// ─── Column detection ─────────────────────────────────────────────────────────
function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

interface ColMap { fecha: number; referencia: number; monto: number; descripcion: number }

function detectColumns(headers: string[]): ColMap | null {
  const h = headers.map(normalize);
  const find = (...terms: string[]) => h.findIndex(col => terms.some(t => col.includes(t)));

  const fecha      = find("fecha", "date", "dia", "fec");
  const referencia = find("referencia", "ref", "numero", "nro", "num", "checknum", "fitid", "cheque");
  const monto      = find("monto", "credito", "importe", "cantidad", "amount", "valor", "trnamt", "haber", "credit");
  const descripcion = find("descripcion", "concepto", "detalle", "obs", "memo", "name", "nombre", "beneficiario");

  if (fecha === -1 || monto === -1) return null;
  return {
    fecha,
    referencia: referencia === -1 ? -1 : referencia,
    monto,
    descripcion: descripcion === -1 ? referencia : descripcion,
  };
}

// ─── CSV / TXT parser (coma · punto y coma · tab) ────────────────────────────
function splitLine(line: string, sep: string): string[] {
  if (sep !== ",") return line.split(sep).map(c => c.trim().replace(/^"|"$/g, ""));
  // CSV con soporte de comillas
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { result.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function detectSeparator(sample: string): string {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of sample) {
    if (ch in counts) counts[ch as keyof typeof counts]++;
  }
  if (counts["\t"] >= counts[","] && counts["\t"] >= counts[";"]) return "\t";
  if (counts[";"] > counts[","]) return ";";
  return ",";
}

function parseCSV(text: string): BankRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = detectSeparator(lines[0]!);
  const headers = splitLine(lines[0]!, sep);
  const cols = detectColumns(headers);
  if (!cols) return [];

  return lines.slice(1).flatMap(line => {
    const cells = splitLine(line, sep);
    const monto = parseMoney(cells[cols.monto] ?? "");
    if (monto <= 0) return [];
    return [{
      fecha:      cells[cols.fecha] ?? "",
      referencia: cols.referencia >= 0 ? (cells[cols.referencia] ?? "") : "",
      monto,
      descripcion: cols.descripcion >= 0 ? (cells[cols.descripcion] ?? "") : "",
    }];
  });
}

// ─── Excel parser (via SheetJS) ───────────────────────────────────────────────
async function parseExcel(file: File): Promise<BankRow[]> {
  // Dynamic import: SheetJS es ~1 MB, solo se carga cuando se necesita
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName]!;

  // Convertir a array 2D con todo como string (raw: false formatea fechas/números)
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  if (rows.length < 2) return [];

  const headers = (rows[0] as string[]).map(String);
  const cols = detectColumns(headers);
  if (!cols) return [];

  return (rows.slice(1) as string[][]).flatMap(cells => {
    const monto = parseMoney(String(cells[cols.monto] ?? ""));
    if (monto <= 0) return [];
    return [{
      fecha:      String(cells[cols.fecha] ?? ""),
      referencia: cols.referencia >= 0 ? String(cells[cols.referencia] ?? "") : "",
      monto,
      descripcion: cols.descripcion >= 0 ? String(cells[cols.descripcion] ?? "") : "",
    }];
  });
}

// ─── OFX / QFX parser (SGML bancario estándar) ───────────────────────────────
/**
 * Soporta tanto el formato SGML antiguo (sin closing tags) como el XML moderno.
 * Bancos como Mercantil, Banesco, BBVA Provincial exportan OFX.
 */
function parseOFX(text: string): BankRow[] {
  const rows: BankRow[] = [];

  // Encontrar todos los bloques STMTTRN
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|$))/gi) ?? [];

  for (const block of blocks) {
    const get = (tag: string) => {
      // Soporta <TAG>VALUE</TAG> y <TAG>VALUE\n
      const m = block.match(new RegExp(`<${tag}>([^<\n\r]+)`, "i"));
      return m?.[1]?.trim() ?? "";
    };

    const trnamt = parseMoney(get("TRNAMT"));
    if (trnamt <= 0) continue; // Solo créditos (ingresos al banco)

    const dtposted = get("DTPOSTED");
    // OFX usa formato YYYYMMDD o YYYYMMDDHHmmss
    let fecha = dtposted;
    if (/^\d{8,}/.test(dtposted)) {
      const y = dtposted.slice(0, 4);
      const m = dtposted.slice(4, 6);
      const d = dtposted.slice(6, 8);
      fecha = `${d}/${m}/${y}`;
    }

    rows.push({
      fecha,
      referencia: get("FITID") || get("CHECKNUM") || get("REFNUM") || "",
      monto: trnamt,
      descripcion: get("NAME") || get("MEMO") || "",
    });
  }

  return rows;
}

// ─── File format detection ────────────────────────────────────────────────────
function detectFormat(filename: string): FileFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, FileFormat> = {
    csv: "csv", txt: "csv", tsv: "tsv",
    xlsx: "xlsx", xls: "xls",
    ofx: "ofx", qfx: "qfx",
  };
  return map[ext ?? ""] ?? "unknown";
}

const FORMAT_LABELS: Record<FileFormat, { label: string; icon: string; color: string }> = {
  csv:     { label: "CSV",        icon: "📄", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  tsv:     { label: "TSV",        icon: "📄", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  xlsx:    { label: "Excel",      icon: "📊", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  xls:    { label: "Excel 97",   icon: "📊", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  ofx:     { label: "OFX",       icon: "🏦", color: "text-purple-400 bg-purple-400/10 border-purple-400/20" },
  qfx:     { label: "QFX",       icon: "🏦", color: "text-purple-400 bg-purple-400/10 border-purple-400/20" },
  unknown: { label: "Desconocido", icon: "❓", color: "text-slate-400 bg-slate-400/10 border-slate-400/20" },
};

// ─── Match engine ─────────────────────────────────────────────────────────────
const TOLERANCE = 0.05; // ±5 centavos

function matchPayments(bankRows: BankRow[], payments: PaymentForReconciliation[]): MatchResult[] {
  const used = new Set<string>();
  return bankRows.map(br => {
    // 1. Referencia exacta (case-insensitive, trim)
    let pay = payments.find(p =>
      !used.has(p.id) &&
      p.reference && br.referencia &&
      p.reference.toLowerCase().trim() === br.referencia.toLowerCase().trim()
    );
    // 2. Referencia parcial: el número de referencia del banco termina/empieza con el del sistema
    if (!pay && br.referencia) {
      pay = payments.find(p => {
        if (used.has(p.id) || !p.reference) return false;
        const sRef = p.reference.replace(/\D/g, ""); // solo dígitos
        const bRef = br.referencia.replace(/\D/g, "");
        return sRef.length >= 4 && bRef.length >= 4 && (bRef.endsWith(sRef) || sRef.endsWith(bRef));
      });
    }
    // 3. Monto dentro de tolerancia (como último recurso)
    if (!pay) {
      pay = payments.find(p => {
        if (used.has(p.id)) return false;
        return Math.abs(Number(p.amountUsd) - br.monto) <= TOLERANCE;
      });
    }

    if (pay) {
      used.add(pay.id);
      return { bankRow: br, matched: true, payment: pay, diff: Math.abs(Number(pay.amountUsd) - br.monto) };
    }
    return { bankRow: br, matched: false };
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
function usePayments() {
  const params = useParams<{ id: string }>();
  const { selectedOrgId } = useOrgs();
  return trpc.finance.payments.listForReconciliation.useQuery(
    { organizationId: selectedOrgId, communityId: params.id },
    { enabled: Boolean(selectedOrgId && params.id) }
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ConciliacionPage() {
  const [bankRows, setBankRows]     = useState<BankRow[]>([]);
  const [results, setResults]       = useState<MatchResult[] | null>(null);
  const [fileName, setFileName]     = useState("");
  const [format, setFormat]         = useState<FileFormat | null>(null);
  const [error, setError]           = useState("");
  const [parsing, setParsing]       = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "matched" | "unmatched">("all");

  const payments = usePayments();

  const processFile = useCallback(async (file: File) => {
    setError("");
    setResults(null);
    setFileName(file.name);
    setParsing(true);

    const fmt = detectFormat(file.name);
    setFormat(fmt);

    try {
      let rows: BankRow[] = [];

      if (fmt === "csv" || fmt === "tsv") {
        const text = await file.text();
        rows = parseCSV(text);
      } else if (fmt === "xlsx" || fmt === "xls") {
        rows = await parseExcel(file);
      } else if (fmt === "ofx" || fmt === "qfx") {
        const text = await file.text();
        rows = parseOFX(text);
      } else {
        setError(
          "Formato no reconocido. Formatos soportados: CSV, TXT, Excel (.xlsx/.xls), OFX, QFX. " +
          "Los archivos PDF no son soportados — descarga el estado de cuenta en otro formato desde tu banco."
        );
        setParsing(false);
        return;
      }

      if (rows.length === 0) {
        if (fmt === "ofx" || fmt === "qfx") {
          setError("No se encontraron transacciones de crédito en el archivo OFX. Verifica que contenga movimientos de entrada (TRNAMT positivo).");
        } else {
          setError(
            "No se detectaron movimientos. Verifica que el archivo tenga columnas de Fecha y Monto. " +
            "El sistema detecta automáticamente: Fecha, Referencia, Monto/Crédito, Descripción."
          );
        }
        setParsing(false);
        return;
      }

      setBankRows(rows);
      setResults(matchPayments(rows, payments.data ?? []));
    } catch (err) {
      setError(`Error al leer el archivo: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setParsing(false);
    }
  }, [payments.data]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void processFile(f);
  }, [processFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void processFile(f);
  }, [processFile]);

  const matchedCount   = results?.filter(r => r.matched).length ?? 0;
  const unmatchedCount = results?.filter(r => !r.matched).length ?? 0;
  const totalBank      = bankRows.reduce((s, r) => s + r.monto, 0);
  const matchedAmount  = results?.filter(r => r.matched).reduce((s, r) => s + r.bankRow.monto, 0) ?? 0;

  const filtered = results?.filter(r => {
    if (filterMode === "matched") return r.matched;
    if (filterMode === "unmatched") return !r.matched;
    return true;
  });

  const formatInfo = format ? FORMAT_LABELS[format] : null;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">🏦 Conciliación Bancaria</h1>
        <p className="text-slate-400 text-sm mt-1">
          Sube el estado de cuenta del banco y compáralo automáticamente con los pagos registrados.
        </p>
      </div>

      {/* Upload zone */}
      <Card className="bg-slate-900 border-slate-700">
        <CardContent className="pt-6 space-y-4">
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
              isDragging ? "border-blue-500 bg-blue-500/10" : "border-slate-600 hover:border-slate-500"
            }`}
          >
            {parsing ? (
              <div className="space-y-2">
                <div className="text-3xl animate-spin inline-block">⚙️</div>
                <p className="text-slate-300 font-medium">Procesando archivo…</p>
              </div>
            ) : (
              <>
                <div className="text-4xl mb-3">📂</div>
                <p className="text-slate-300 font-medium mb-1">
                  {fileName ? (
                    <span className="flex items-center justify-center gap-2">
                      {formatInfo && <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${formatInfo.color}`}>{formatInfo.icon} {formatInfo.label}</span>}
                      {fileName}
                    </span>
                  ) : "Arrastra tu estado de cuenta bancario aquí"}
                </p>
                <p className="text-slate-500 text-sm mb-4">o haz click para seleccionar</p>
                <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors">
                  <span>📁</span> Seleccionar archivo
                  <input
                    type="file"
                    accept=".csv,.txt,.tsv,.xlsx,.xls,.ofx,.qfx"
                    className="hidden"
                    onChange={onFileChange}
                  />
                </label>
              </>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4 text-red-400 text-sm">
              ⚠️ {error}
            </div>
          )}

          {/* Format support info */}
          <div className="rounded-lg bg-slate-800 border border-slate-700 p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              📋 Formatos soportados
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { fmt: "CSV / TXT", icon: "📄", desc: "Todos los bancos", color: "text-blue-400" },
                { fmt: "Excel .xlsx", icon: "📊", desc: "Mercantil, Banesco", color: "text-emerald-400" },
                { fmt: "OFX / QFX", icon: "🏦", desc: "Formato bancario estándar", color: "text-purple-400" },
                { fmt: "PDF", icon: "🔒", desc: "No soportado aún", color: "text-slate-500" },
              ].map(f => (
                <div key={f.fmt} className={`rounded-lg bg-slate-900 border border-slate-700 p-3 ${f.fmt === "PDF" ? "opacity-50" : ""}`}>
                  <div className={`text-lg mb-1 ${f.color}`}>{f.icon}</div>
                  <p className={`text-xs font-medium ${f.color}`}>{f.fmt}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{f.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-3">
              ⚡ Detección automática de columnas: Fecha · Referencia · Monto/Crédito · Descripción.
              Soporta separadores por coma, punto y coma o tab. Montos en formato europeo (1.234,56) y anglosajón (1,234.56).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total en banco", value: `$${totalBank.toFixed(2)}`, sub: `${bankRows.length} movimientos`, color: "text-white" },
              { label: "Conciliados", value: String(matchedCount), sub: `$${matchedAmount.toFixed(2)}`, color: "text-emerald-400" },
              { label: "Sin conciliar", value: String(unmatchedCount), sub: "revisar manualmente", color: "text-amber-400" },
              { label: "% Conciliado", value: `${bankRows.length > 0 ? Math.round((matchedCount / bankRows.length) * 100) : 0}%`, sub: null, color: "text-blue-400" },
            ].map((s, i) => (
              <Card key={i} className="bg-slate-900 border-slate-700">
                <CardContent className="pt-5">
                  <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  {s.sub && <p className="text-xs text-slate-500">{s.sub}</p>}
                  {i === 3 && (
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${bankRows.length > 0 ? (matchedCount / bankRows.length) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filter */}
          <div className="flex gap-2 flex-wrap">
            {(["all", "matched", "unmatched"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  filterMode === mode ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {mode === "all"       && `Todos (${results.length})`}
                {mode === "matched"   && `✅ Conciliados (${matchedCount})`}
                {mode === "unmatched" && `⚠️ Sin conciliar (${unmatchedCount})`}
              </button>
            ))}
          </div>

          {/* Main table */}
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="text-base text-white flex items-center gap-2">
                Resultados de conciliación
                {format && formatInfo && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${formatInfo.color}`}>
                    {formatInfo.icon} {formatInfo.label}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="py-2 px-3 text-left text-xs text-slate-400 w-24">Estado</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Fecha banco</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Referencia banco</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400 max-w-[140px]">Descripción</th>
                      <th className="py-2 px-3 text-right text-xs text-slate-400">Monto banco</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Propietario</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Unidad</th>
                      <th className="py-2 px-3 text-right text-xs text-slate-400">Pago sistema</th>
                      <th className="py-2 px-3 text-right text-xs text-slate-400">Dif.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filtered ?? []).map((r, i) => (
                      <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-3">
                          {r.matched ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 border border-emerald-500/20 whitespace-nowrap">
                              ✅ OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-400 text-[10px] px-2 py-0.5 border border-amber-500/20 whitespace-nowrap">
                              ⚠️ Pendiente
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-mono text-xs whitespace-nowrap">{r.bankRow.fecha}</td>
                        <td className="py-2.5 px-3 text-slate-300 font-mono text-xs">
                          {r.bankRow.referencia || <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-xs max-w-[140px] truncate" title={r.bankRow.descripcion}>
                          {r.bankRow.descripcion || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right text-white font-semibold text-xs">
                          ${r.bankRow.monto.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 text-xs">
                          {r.payment?.ownerName ?? <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-xs font-mono">
                          {r.payment?.unitLabel ?? <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300 text-xs">
                          {r.payment ? `$${Number(r.payment.amountUsd).toFixed(2)}` : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right text-xs">
                          {r.matched && r.diff !== undefined ? (
                            r.diff < 0.01
                              ? <span className="text-emerald-400">—</span>
                              : <span className="text-amber-400">${r.diff.toFixed(2)}</span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>
                      </tr>
                    ))}
                    {(filtered ?? []).length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-slate-500">
                          No hay movimientos en esta vista
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Pagos en sistema no encontrados en banco */}
          {payments.data && (() => {
            const matchedIds = new Set(results.filter(r => r.matched && r.payment).map(r => r.payment!.id));
            const notInBank  = payments.data.filter(p => !matchedIds.has(p.id));
            if (notInBank.length === 0) return null;
            return (
              <Card className="bg-slate-900 border-amber-600/30">
                <CardHeader>
                  <CardTitle className="text-base text-amber-400">
                    ⚠️ Pagos en sistema no encontrados en banco ({notInBank.length})
                  </CardTitle>
                  <p className="text-xs text-slate-400">
                    Están registrados en el sistema pero no aparecen en el estado de cuenta cargado.
                    Pueden ser pagos fuera del período del extracto, o que aún no se han reflejado en el banco.
                  </p>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="py-2 px-3 text-left text-xs text-slate-400">Fecha</th>
                        <th className="py-2 px-3 text-left text-xs text-slate-400">Referencia</th>
                        <th className="py-2 px-3 text-left text-xs text-slate-400">Propietario</th>
                        <th className="py-2 px-3 text-left text-xs text-slate-400">Unidad</th>
                        <th className="py-2 px-3 text-right text-xs text-slate-400">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notInBank.map(p => (
                        <tr key={p.id} className="border-b border-slate-800">
                          <td className="py-2 px-3 text-slate-400 text-xs font-mono whitespace-nowrap">
                            {new Date(p.paidAt).toLocaleDateString("es-VE")}
                          </td>
                          <td className="py-2 px-3 text-slate-300 text-xs font-mono">{p.reference ?? "—"}</td>
                          <td className="py-2 px-3 text-slate-300 text-xs">{p.ownerName}</td>
                          <td className="py-2 px-3 text-slate-400 text-xs">{p.unitLabel}</td>
                          <td className="py-2 px-3 text-right text-white text-xs font-semibold">${Number(p.amountUsd).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })()}
        </>
      )}

      {/* Empty state */}
      {!results && !error && !parsing && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-lg font-medium text-slate-400">Carga el estado de cuenta del banco</p>
          <p className="text-sm mt-1">
            CSV, Excel o OFX — el sistema detecta el formato y las columnas automáticamente
          </p>
        </div>
      )}
    </div>
  );
}
