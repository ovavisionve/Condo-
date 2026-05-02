"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useOrgs } from "@/app/org/OrgContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

type MatchType = "exact" | "partial" | "amount" | "none";

interface MatchResult {
  bankRow: BankRow;
  matched: boolean;
  matchType: MatchType;
  payment?: PaymentForReconciliation;
  diff?: number;
  parked?: boolean; // true si fue aparcado como no-identificado
}

type FileFormat = "csv" | "xlsx" | "xls" | "ofx" | "qfx" | "tsv" | "unknown";
type TabView = "results" | "unidentified";

// ─── Number parsing ───────────────────────────────────────────────────────────
function parseMoney(raw: string): number {
  const s = raw.trim().replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot   = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const parts = s.split(",");
    normalized = parts.length === 2 && parts[1]!.length <= 2
      ? s.replace(",", ".")
      : s.replace(/,/g, "");
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

function splitLine(line: string, sep: string): string[] {
  if (sep !== ",") return line.split(sep).map(c => c.trim().replace(/^"|"$/g, ""));
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
      fecha:       cells[cols.fecha] ?? "",
      referencia:  cols.referencia >= 0 ? (cells[cols.referencia] ?? "") : "",
      monto,
      descripcion: cols.descripcion >= 0 ? (cells[cols.descripcion] ?? "") : "",
    }];
  });
}

async function parseExcel(file: File): Promise<BankRow[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  if (rows.length < 2) return [];
  const headers = (rows[0] as string[]).map(String);
  const cols = detectColumns(headers);
  if (!cols) return [];
  return (rows.slice(1) as string[][]).flatMap(cells => {
    const monto = parseMoney(String(cells[cols.monto] ?? ""));
    if (monto <= 0) return [];
    return [{
      fecha:       String(cells[cols.fecha] ?? ""),
      referencia:  cols.referencia >= 0 ? String(cells[cols.referencia] ?? "") : "",
      monto,
      descripcion: cols.descripcion >= 0 ? String(cells[cols.descripcion] ?? "") : "",
    }];
  });
}

function parseOFX(text: string): BankRow[] {
  const rows: BankRow[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|$))/gi) ?? [];
  for (const block of blocks) {
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([^<\n\r]+)`, "i"));
      return m?.[1]?.trim() ?? "";
    };
    const trnamt = parseMoney(get("TRNAMT"));
    if (trnamt <= 0) continue;
    const dtposted = get("DTPOSTED");
    let fecha = dtposted;
    if (/^\d{8,}/.test(dtposted)) {
      fecha = `${dtposted.slice(6, 8)}/${dtposted.slice(4, 6)}/${dtposted.slice(0, 4)}`;
    }
    rows.push({
      fecha,
      referencia:  get("FITID") || get("CHECKNUM") || get("REFNUM") || "",
      monto:       trnamt,
      descripcion: get("NAME") || get("MEMO") || "",
    });
  }
  return rows;
}

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
  xls:     { label: "Excel 97",  icon: "📊", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  ofx:     { label: "OFX",       icon: "🏦", color: "text-purple-400 bg-purple-400/10 border-purple-400/20" },
  qfx:     { label: "QFX",       icon: "🏦", color: "text-purple-400 bg-purple-400/10 border-purple-400/20" },
  unknown: { label: "Desconocido", icon: "❓", color: "text-slate-400 bg-slate-400/10 border-slate-400/20" },
};

// ─── Match engine ─────────────────────────────────────────────────────────────
const TOLERANCE = 0.05;

function matchPayments(bankRows: BankRow[], payments: PaymentForReconciliation[]): MatchResult[] {
  const used = new Set<string>();
  return bankRows.map(br => {
    let pay: PaymentForReconciliation | undefined;
    let matchType: MatchType = "none";

    // 1. Referencia exacta
    pay = payments.find(p =>
      !used.has(p.id) && p.reference && br.referencia &&
      p.reference.toLowerCase().trim() === br.referencia.toLowerCase().trim()
    );
    if (pay) { matchType = "exact"; }

    // 2. Referencia parcial (dígitos finales/iniciales coinciden)
    if (!pay && br.referencia) {
      pay = payments.find(p => {
        if (used.has(p.id) || !p.reference) return false;
        const sRef = p.reference.replace(/\D/g, "");
        const bRef = br.referencia.replace(/\D/g, "");
        return sRef.length >= 4 && bRef.length >= 4 && (bRef.endsWith(sRef) || sRef.endsWith(bRef));
      });
      if (pay) matchType = "partial";
    }

    // 3. Monto dentro de tolerancia (último recurso)
    if (!pay) {
      pay = payments.find(p => {
        if (used.has(p.id)) return false;
        return Math.abs(Number(p.amountUsd) - br.monto) <= TOLERANCE;
      });
      if (pay) matchType = "amount";
    }

    if (pay) {
      used.add(pay.id);
      return { bankRow: br, matched: true, matchType, payment: pay, diff: Math.abs(Number(pay.amountUsd) - br.monto) };
    }
    return { bankRow: br, matched: false, matchType: "none" };
  });
}

// ─── Match type badge ─────────────────────────────────────────────────────────
const MATCH_TYPE_LABELS: Record<MatchType, { label: string; color: string } | null> = {
  exact:   { label: "Ref exacta",   color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" },
  partial: { label: "Ref parcial",  color: "bg-cyan-500/15 text-cyan-300 border-cyan-500/20" },
  amount:  { label: "Por monto",    color: "bg-yellow-500/15 text-yellow-300 border-yellow-500/20" },
  none:    null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
function useCommData() {
  const params = useParams<{ id: string }>();
  const { selectedOrgId } = useOrgs();
  const payments = trpc.finance.payments.listForReconciliation.useQuery(
    { organizationId: selectedOrgId, communityId: params.id },
    { enabled: Boolean(selectedOrgId && params.id) }
  );
  const unidentified = trpc.finance.payments.listUnidentified.useQuery(
    { organizationId: selectedOrgId, communityId: params.id },
    { enabled: Boolean(selectedOrgId && params.id) }
  );
  const units = trpc.org.units.list.useQuery(
    { organizationId: selectedOrgId, communityId: params.id },
    { enabled: Boolean(selectedOrgId && params.id), select: (data) => data.map((u: { id: string; code: string }) => ({ id: u.id, code: u.code })) }
  );
  return { payments, unidentified, units, organizationId: selectedOrgId, communityId: params.id };
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
  const [tab, setTab]               = useState<TabView>("results");

  // Dialogs
  const [parkingRow, setParkingRow] = useState<BankRow | null>(null);
  const [expenseRow, setExpenseRow] = useState<BankRow | null>(null);
  const [assignEntry, setAssignEntry] = useState<string | null>(null); // UnidentifiedPayment id

  const { payments, unidentified, units, organizationId, communityId } = useCommData();
  const parkMutation = trpc.finance.payments.parkUnidentified.useMutation({
    onSuccess: () => {
      void unidentified.refetch();
      setParkingRow(null);
      // marcar row como aparcada en el estado local
      setResults(prev => prev?.map(r =>
        r.bankRow === parkingRow ? { ...r, parked: true } : r
      ) ?? null);
    },
  });

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
        rows = parseCSV(await file.text());
      } else if (fmt === "xlsx" || fmt === "xls") {
        rows = await parseExcel(file);
      } else if (fmt === "ofx" || fmt === "qfx") {
        rows = parseOFX(await file.text());
      } else {
        setError("Formato no reconocido. Soportados: CSV, TXT, Excel (.xlsx/.xls), OFX, QFX.");
        setParsing(false);
        return;
      }
      if (rows.length === 0) {
        setError("No se detectaron movimientos. Verifica que el archivo tenga columnas de Fecha y Monto.");
        setParsing(false);
        return;
      }
      setBankRows(rows);
      setResults(matchPayments(rows, payments.data ?? []));
      setTab("results");
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
    if (filterMode === "matched")   return r.matched;
    if (filterMode === "unmatched") return !r.matched;
    return true;
  });

  const formatInfo = format ? FORMAT_LABELS[format] : null;
  const pendingUnidentified = unidentified.data?.filter(u => !u.assignedAt) ?? [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">🏦 Conciliación Bancaria</h1>
          <p className="text-slate-400 text-sm mt-1">
            Sube el estado de cuenta y compáralo automáticamente con los pagos registrados.
          </p>
        </div>
        {/* Tab: resultados / no-identificados */}
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
          <button
            onClick={() => setTab("results")}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "results" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Conciliación
          </button>
          <button
            onClick={() => setTab("unidentified")}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              tab === "unidentified" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            No identificados
            {pendingUnidentified.length > 0 && (
              <span className="bg-amber-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                {pendingUnidentified.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === "results" && (
        <>
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
                          {formatInfo && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${formatInfo.color}`}>
                              {formatInfo.icon} {formatInfo.label}
                            </span>
                          )}
                          {fileName}
                        </span>
                      ) : "Arrastra tu estado de cuenta bancario aquí"}
                    </p>
                    <p className="text-slate-500 text-sm mb-4">o haz click para seleccionar</p>
                    <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors">
                      <span>📁</span> Seleccionar archivo
                      <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,.ofx,.qfx" className="hidden" onChange={onFileChange} />
                    </label>
                  </>
                )}
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4 text-red-400 text-sm">
                  ⚠️ {error}
                </div>
              )}

              <div className="rounded-lg bg-slate-800 border border-slate-700 p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Formatos soportados</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { fmt: "CSV / TXT",   icon: "📄", desc: "Todos los bancos",       color: "text-blue-400" },
                    { fmt: "Excel .xlsx", icon: "📊", desc: "Mercantil, Banesco",      color: "text-emerald-400" },
                    { fmt: "OFX / QFX",  icon: "🏦", desc: "Formato bancario estándar", color: "text-purple-400" },
                    { fmt: "PDF",        icon: "🔒", desc: "No soportado",            color: "text-slate-500" },
                  ].map(f => (
                    <div key={f.fmt} className={`rounded-lg bg-slate-900 border border-slate-700 p-3 ${f.fmt === "PDF" ? "opacity-50" : ""}`}>
                      <div className={`text-lg mb-1 ${f.color}`}>{f.icon}</div>
                      <p className={`text-xs font-medium ${f.color}`}>{f.fmt}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          {results && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total en banco",   value: `$${totalBank.toFixed(2)}`,       sub: `${bankRows.length} movimientos`, color: "text-white" },
                  { label: "Conciliados",       value: String(matchedCount),             sub: `$${matchedAmount.toFixed(2)}`,   color: "text-emerald-400" },
                  { label: "Sin conciliar",     value: String(unmatchedCount),           sub: "requieren revisión",             color: "text-amber-400" },
                  { label: "% Conciliado",      value: `${bankRows.length > 0 ? Math.round((matchedCount / bankRows.length) * 100) : 0}%`, sub: null, color: "text-blue-400" },
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

              {/* Leyenda de tipos de match — Feature 4 */}
              <div className="flex flex-wrap gap-2 items-center text-xs text-slate-400">
                <span className="font-medium">Tipo de conciliación:</span>
                {(Object.entries(MATCH_TYPE_LABELS) as [MatchType, typeof MATCH_TYPE_LABELS[MatchType]][])
                  .filter(([, v]) => v !== null)
                  .map(([k, v]) => (
                    <span key={k} className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${v!.color}`}>
                      {v!.label}
                    </span>
                  ))}
                <span className="ml-2 opacity-60">· Haz click en 🏭 para registrar comisión bancaria · 📦 para aparcar no-identificado</span>
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
                          <th className="py-2 px-3 text-left text-xs text-slate-400 w-28">Estado</th>
                          <th className="py-2 px-3 text-left text-xs text-slate-400">Fecha</th>
                          <th className="py-2 px-3 text-left text-xs text-slate-400">Referencia banco</th>
                          <th className="py-2 px-3 text-left text-xs text-slate-400 max-w-[130px]">Descripción</th>
                          <th className="py-2 px-3 text-right text-xs text-slate-400">Monto banco</th>
                          <th className="py-2 px-3 text-left text-xs text-slate-400">Propietario</th>
                          <th className="py-2 px-3 text-left text-xs text-slate-400">Unidad</th>
                          <th className="py-2 px-3 text-right text-xs text-slate-400">Pago sistema</th>
                          <th className="py-2 px-3 text-right text-xs text-slate-400">Dif.</th>
                          <th className="py-2 px-3 text-center text-xs text-slate-400">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(filtered ?? []).map((r, i) => {
                          const mtLabel = MATCH_TYPE_LABELS[r.matchType];
                          return (
                            <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                              <td className="py-2.5 px-3">
                                <div className="flex flex-col gap-1">
                                  {r.matched ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 border border-emerald-500/20 whitespace-nowrap">
                                      ✅ Conciliado
                                    </span>
                                  ) : r.parked ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 text-slate-400 text-[10px] px-2 py-0.5 border border-slate-500/20 whitespace-nowrap">
                                      📦 Aparcado
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-400 text-[10px] px-2 py-0.5 border border-amber-500/20 whitespace-nowrap">
                                      ⚠️ Pendiente
                                    </span>
                                  )}
                                  {/* Feature 4: tipo de match */}
                                  {r.matched && mtLabel && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${mtLabel.color}`}>
                                      {mtLabel.label}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-slate-300 font-mono text-xs whitespace-nowrap">{r.bankRow.fecha}</td>
                              <td className="py-2.5 px-3 text-slate-300 font-mono text-xs">
                                {r.bankRow.referencia || <span className="text-slate-600">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-slate-500 text-xs max-w-[130px] truncate" title={r.bankRow.descripcion}>
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
                              {/* Feature 2 + 3: acciones en filas no-conciliadas */}
                              <td className="py-2.5 px-3 text-center">
                                {!r.matched && !r.parked && (
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      title="Registrar como gasto (comisión bancaria)"
                                      onClick={() => setExpenseRow(r.bankRow)}
                                      className="rounded p-1 text-slate-400 hover:text-orange-400 hover:bg-orange-400/10 transition-colors text-base"
                                    >
                                      🏭
                                    </button>
                                    <button
                                      title="Aparcar como pago no identificado"
                                      onClick={() => setParkingRow(r.bankRow)}
                                      className="rounded p-1 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 transition-colors text-base"
                                    >
                                      📦
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {(filtered ?? []).length === 0 && (
                          <tr>
                            <td colSpan={10} className="py-10 text-center text-slate-500">
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
                        Están registrados pero no aparecen en el extracto cargado.
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

          {!results && !error && !parsing && (
            <div className="text-center py-16 text-slate-500">
              <div className="text-5xl mb-4">📊</div>
              <p className="text-lg font-medium text-slate-400">Carga el estado de cuenta del banco</p>
              <p className="text-sm mt-1">CSV, Excel o OFX — detección automática de formato y columnas</p>
            </div>
          )}
        </>
      )}

      {/* ── Tab: Pagos no identificados (Feature 3) ────────────────────────── */}
      {tab === "unidentified" && (
        <UnidentifiedPanel
          entries={unidentified.data ?? []}
          units={units.data ?? []}
          organizationId={organizationId}
          communityId={communityId}
          onAssigned={() => void unidentified.refetch()}
          assignEntryId={assignEntry}
          setAssignEntryId={setAssignEntry}
        />
      )}

      {/* ── Dialog: Aparcar pago no identificado (Feature 3) ─────────────── */}
      {parkingRow && (
        <ParkDialog
          row={parkingRow}
          organizationId={organizationId}
          communityId={communityId}
          mutation={parkMutation}
          onClose={() => setParkingRow(null)}
        />
      )}

      {/* ── Dialog: Registrar gasto / comisión bancaria (Feature 2) ─────────── */}
      {expenseRow && (
        <ExpenseFromBankDialog
          row={expenseRow}
          organizationId={organizationId}
          communityId={communityId}
          onClose={() => setExpenseRow(null)}
          onCreated={() => {
            setExpenseRow(null);
            // marcar como aparcada / resuelta en UI local
            setResults(prev => prev?.map(r =>
              r.bankRow === expenseRow ? { ...r, parked: true } : r
            ) ?? null);
          }}
        />
      )}
    </div>
  );
}

// ─── Panel: Pagos no identificados ────────────────────────────────────────────
type UnidentifiedEntry = {
  id: string;
  bankDate: string;
  bankRef: string | null;
  bankAmountUsd: string | { toString(): string };
  bankDescription: string | null;
  notes: string | null;
  assignedAt: Date | null;
  assignedUnit: { code: string } | null;
};

function UnidentifiedPanel({
  entries,
  units,
  organizationId,
  communityId,
  onAssigned,
  assignEntryId,
  setAssignEntryId,
}: {
  entries: UnidentifiedEntry[];
  units: { id: string; code: string }[];
  organizationId: string;
  communityId: string;
  onAssigned: () => void;
  assignEntryId: string | null;
  setAssignEntryId: (id: string | null) => void;
}) {
  const pending  = entries.filter(e => !e.assignedAt);
  const assigned = entries.filter(e =>  e.assignedAt);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">📦 Pagos no identificados</h2>
        <p className="text-slate-400 text-sm">
          Movimientos bancarios recibidos cuya unidad/propietario aún se desconoce.
          Al identificarlos, crea el pago y lo aplica a facturas pendientes.
        </p>
      </div>

      {pending.length === 0 && assigned.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-5xl mb-4">✅</div>
          <p>No hay pagos no identificados pendientes.</p>
          <p className="text-sm mt-1">Usa el botón 📦 en la tabla de conciliación para aparcar movimientos sin match.</p>
        </div>
      )}

      {pending.length > 0 && (
        <Card className="bg-slate-900 border-amber-600/30">
          <CardHeader>
            <CardTitle className="text-base text-amber-400">Pendientes de asignación ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="py-2 px-3 text-left text-xs text-slate-400">Fecha banco</th>
                  <th className="py-2 px-3 text-left text-xs text-slate-400">Referencia</th>
                  <th className="py-2 px-3 text-left text-xs text-slate-400">Descripción</th>
                  <th className="py-2 px-3 text-right text-xs text-slate-400">Monto USD</th>
                  <th className="py-2 px-3 text-center text-xs text-slate-400">Acción</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(e => (
                  <tr key={e.id} className="border-b border-slate-800">
                    <td className="py-2 px-3 text-slate-300 font-mono text-xs">{e.bankDate}</td>
                    <td className="py-2 px-3 text-slate-300 font-mono text-xs">{e.bankRef ?? "—"}</td>
                    <td className="py-2 px-3 text-slate-500 text-xs max-w-[160px] truncate">{e.bankDescription ?? "—"}</td>
                    <td className="py-2 px-3 text-right text-white font-semibold text-xs">
                      ${Number(e.bankAmountUsd.toString()).toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => setAssignEntryId(e.id)}
                        className="rounded px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
                      >
                        Asignar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {assigned.length > 0 && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-base text-slate-300">Ya asignados ({assigned.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="py-2 px-3 text-left text-xs text-slate-400">Fecha banco</th>
                  <th className="py-2 px-3 text-left text-xs text-slate-400">Referencia</th>
                  <th className="py-2 px-3 text-right text-xs text-slate-400">Monto</th>
                  <th className="py-2 px-3 text-left text-xs text-slate-400">Unidad asignada</th>
                </tr>
              </thead>
              <tbody>
                {assigned.map(e => (
                  <tr key={e.id} className="border-b border-slate-800 opacity-60">
                    <td className="py-2 px-3 text-slate-400 font-mono text-xs">{e.bankDate}</td>
                    <td className="py-2 px-3 text-slate-400 font-mono text-xs">{e.bankRef ?? "—"}</td>
                    <td className="py-2 px-3 text-right text-slate-300 text-xs">${Number(e.bankAmountUsd.toString()).toFixed(2)}</td>
                    <td className="py-2 px-3 text-emerald-400 text-xs font-medium">
                      ✅ {e.assignedUnit?.code ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Assign dialog */}
      {assignEntryId && (() => {
        const entry = entries.find(e => e.id === assignEntryId);
        if (!entry) return null;
        return (
          <AssignDialog
            entry={entry}
            units={units}
            organizationId={organizationId}
            communityId={communityId}
            onClose={() => setAssignEntryId(null)}
            onAssigned={() => { setAssignEntryId(null); onAssigned(); }}
          />
        );
      })()}
    </div>
  );
}

// ─── Dialog: Aparcar movimiento bancario ──────────────────────────────────────
function ParkDialog({
  row,
  organizationId,
  communityId,
  mutation,
  onClose,
}: {
  row: BankRow;
  organizationId: string;
  communityId: string;
  mutation: ReturnType<typeof trpc.finance.payments.parkUnidentified.useMutation>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [err, setErr]     = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await mutation.mutateAsync({
        organizationId,
        communityId,
        bankDate:        row.fecha,
        bankRef:         row.referencia || undefined,
        bankAmountUsd:   row.monto,
        bankDescription: row.descripcion || undefined,
        notes:           notes || undefined,
      });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-white mb-1">📦 Aparcar pago no identificado</h3>
        <p className="text-xs text-slate-400 mb-4">
          Guarda este movimiento para revisión posterior. Luego podrás asignarlo a la unidad correcta.
        </p>
        <div className="space-y-2 text-sm bg-slate-800 rounded-lg p-3 mb-4">
          <div className="flex justify-between"><span className="text-slate-400">Fecha</span><span className="text-white font-mono">{row.fecha}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Referencia</span><span className="text-white font-mono">{row.referencia || "—"}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Monto</span><span className="text-emerald-400 font-semibold">${row.monto.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Descripción</span><span className="text-slate-300 text-xs">{row.descripcion || "—"}</span></div>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label className="text-slate-300">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ej: Podría ser el pago de marzo de la familia Rodríguez"
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Guardando…" : "Aparcar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Dialog: Asignar pago no identificado a unidad ───────────────────────────
const PAYMENT_METHODS_ES = [
  { value: "TRANSFER_USD", label: "Transferencia USD" },
  { value: "TRANSFER_BSS", label: "Transferencia Bs" },
  { value: "ZELLE",        label: "Zelle" },
  { value: "CASH_USD",     label: "Efectivo USD" },
  { value: "CASH_BSS",     label: "Efectivo Bs" },
  { value: "PAGO_MOVIL",   label: "Pago Móvil" },
  { value: "CRYPTO",       label: "Criptomoneda" },
  { value: "CHECK",        label: "Cheque" },
  { value: "OTHER",        label: "Otro" },
] as const;

function AssignDialog({
  entry,
  units,
  organizationId,
  communityId,
  onClose,
  onAssigned,
}: {
  entry: UnidentifiedEntry;
  units: { id: string; code: string }[];
  organizationId: string;
  communityId: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [unitId, setUnitId] = useState("");
  const [method, setMethod] = useState<string>("TRANSFER_USD");
  const [notes, setNotes]   = useState("");
  const [err, setErr]       = useState("");
  const assign = trpc.finance.payments.assignUnidentified.useMutation();

  // Cargar facturas pendientes de la unidad seleccionada
  const invoices = trpc.finance.invoices.list.useQuery(
    { organizationId, communityId, unitId, status: "ISSUED" },
    { enabled: Boolean(unitId) }
  );
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unitId) return setErr("Selecciona una unidad");
    setErr("");
    try {
      await assign.mutateAsync({
        organizationId,
        communityId,
        unidentifiedId: entry.id,
        unitId,
        method: method as "TRANSFER_USD",
        notes: notes || undefined,
        allocations: selectedInvoiceId
          ? [{ invoiceId: selectedInvoiceId, amount: Number(entry.bankAmountUsd.toString()) }]
          : undefined,
      });
      onAssigned();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-white mb-1">Asignar pago a unidad</h3>
        <div className="space-y-1 text-xs bg-slate-800 rounded-lg p-3 mb-4">
          <div className="flex justify-between"><span className="text-slate-400">Referencia</span><span className="text-white font-mono">{entry.bankRef ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Monto</span><span className="text-emerald-400 font-semibold">${Number(entry.bankAmountUsd.toString()).toFixed(2)}</span></div>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label className="text-slate-300">Unidad</Label>
            <select
              value={unitId}
              onChange={e => { setUnitId(e.target.value); setSelectedInvoiceId(null); }}
              className="flex h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white"
              required
            >
              <option value="">Seleccionar…</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-slate-300">Método de pago</Label>
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className="flex h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white"
            >
              {PAYMENT_METHODS_ES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          {unitId && invoices.data && invoices.data.length > 0 && (
            <div>
              <Label className="text-slate-300">Aplicar a factura (opcional)</Label>
              <select
                value={selectedInvoiceId ?? ""}
                onChange={e => setSelectedInvoiceId(e.target.value || null)}
                className="flex h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white"
              >
                <option value="">Sin asignar a factura específica</option>
                {invoices.data.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — ${Number(inv.totalUsd).toFixed(2)}
                    {Number(inv.paidUsd) > 0 ? ` (pagado $${Number(inv.paidUsd).toFixed(2)})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label className="text-slate-300">Notas</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} className="bg-slate-800 border-slate-600 text-white" />
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={assign.isPending}>
              {assign.isPending ? "Asignando…" : "Asignar y registrar pago"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Dialog: Registrar gasto / comisión bancaria (Feature 2) ─────────────────
const EXPENSE_CATEGORIES_ES = [
  { value: "OTHER",          label: "Comisión bancaria / Otro" },
  { value: "ADMINISTRATION", label: "Administración" },
  { value: "TAXES",          label: "Impuestos / Retenciones" },
  { value: "REPAIRS",        label: "Reparaciones" },
] as const;

function ExpenseFromBankDialog({
  row,
  organizationId,
  communityId,
  onClose,
  onCreated,
}: {
  row: BankRow;
  organizationId: string;
  communityId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = new Date();
  const [form, setForm] = useState({
    category: "OTHER" as string,
    customCategory: "Comisión bancaria",
    description: row.descripcion || row.referencia || "Comisión bancaria",
    periodYear:  today.getFullYear(),
    periodMonth: today.getMonth() + 1,
    amount: row.monto.toFixed(2),
    supplierName: "",
    notes: `Ref: ${row.referencia} | Fecha: ${row.fecha}`,
  });
  const [err, setErr] = useState("");
  const create = trpc.finance.expenses.create.useMutation();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await create.mutateAsync({
        organizationId,
        communityId,
        category: form.category as "OTHER",
        customCategory: form.customCategory.trim() || undefined,
        description: form.description,
        periodYear: form.periodYear,
        periodMonth: form.periodMonth,
        amount: Number(form.amount),
        currencyPrimary: "USD",
        supplierName: form.supplierName || undefined,
        notes: form.notes || undefined,
      });
      onCreated();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-white mb-1">🏭 Registrar como gasto</h3>
        <p className="text-xs text-slate-400 mb-4">
          Crea un gasto a partir de este movimiento bancario (comisión, retención, etc.)
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label className="text-slate-300">Categoría</Label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="flex h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white"
            >
              {EXPENSE_CATEGORIES_ES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          {form.category === "OTHER" && (
            <div>
              <Label className="text-slate-300">Tipo de gasto</Label>
              <Input
                value={form.customCategory}
                onChange={e => setForm(f => ({ ...f, customCategory: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="Ej: Comisión bancaria, Retención ISLR"
              />
            </div>
          )}
          <div>
            <Label className="text-slate-300">Descripción</Label>
            <Input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="bg-slate-800 border-slate-600 text-white"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">Monto USD</Label>
              <Input
                type="number" step="0.01"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                required
              />
            </div>
            <div>
              <Label className="text-slate-300">Período</Label>
              <div className="flex gap-1">
                <Input type="number" value={form.periodYear} onChange={e => setForm(f => ({ ...f, periodYear: Number(e.target.value) }))} className="bg-slate-800 border-slate-600 text-white w-20" />
                <Input type="number" min={1} max={12} value={form.periodMonth} onChange={e => setForm(f => ({ ...f, periodMonth: Number(e.target.value) }))} className="bg-slate-800 border-slate-600 text-white w-16" />
              </div>
            </div>
          </div>
          <div>
            <Label className="text-slate-300">Proveedor/Banco</Label>
            <Input
              value={form.supplierName}
              onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="Ej: Banco Mercantil"
            />
          </div>
          <div>
            <Label className="text-slate-300">Notas</Label>
            <Input
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Registrando…" : "Registrar gasto"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
