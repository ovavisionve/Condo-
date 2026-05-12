"use client";

import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import { useComercial } from "../ComercialContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BankRow {
  fecha: string;
  referencia: string;
  monto: number;
  descripcion: string;
}

type MatchType = "exact" | "partial" | "amount" | "none";

interface CcPaymentMin {
  id: string;
  reference: string | null;
  amountUsd: string;
  /** #10/#13 — Bs reales del pago (tasa histórica, no la de hoy). */
  amountBss: string;
  exchangeRate: string;
  currencyPrimary: string;
  localCode: string;
  localName: string | null;
  method: string;
  paidAt: string;
}

/** Tolerancia mínima de match por Bs (1 bolívar). Para montos grandes se usa 0.5%. */
const TOLERANCE_BS = 1;

interface MatchResult {
  bankRow: BankRow;
  matched: boolean;
  matchType: MatchType;
  payment?: CcPaymentMin;
}

type FileFormat = "csv" | "xlsx" | "xls" | "ofx" | "tsv" | "unknown";

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function parseMoney(raw: string): number {
  const s = raw.trim().replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let n: string;
  if (lastComma > -1 && lastDot > -1) {
    n = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const parts = s.split(",");
    n = parts.length === 2 && (parts[1]?.length ?? 0) <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else {
    n = s;
  }
  const v = parseFloat(n);
  return isNaN(v) ? 0 : v;
}

function normStr(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function detectCols(headers: string[]) {
  const h = headers.map(normStr);
  const find = (...terms: string[]) => h.findIndex((c) => terms.some((t) => c.includes(t)));
  return {
    fecha: find("fecha", "date", "dia"),
    referencia: find("referencia", "ref", "numero", "nro", "fitid", "checknum"),
    monto: find("monto", "credito", "haber", "amount", "trnamt", "importe", "valor"),
    descripcion: find("descripcion", "concepto", "detalle", "memo", "name", "beneficiario"),
  };
}

function parseSep(sample: string): string {
  const t = (sample.match(/\t/g) ?? []).length;
  const s = (sample.match(/;/g) ?? []).length;
  if (t >= s) return "\t";
  if (s > 0) return ";";
  return ",";
}

function splitCSVLine(line: string, sep: string): string[] {
  if (sep !== ",") return line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
  const res: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { res.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  res.push(cur.trim());
  return res;
}

/**
 * Busca la fila de cabecera entre las primeras N filas (bancos VE meten título arriba).
 */
function findHeader(allRows: string[][], maxRows = 10): { idx: number; cols: ReturnType<typeof detectCols> } | null {
  const upTo = Math.min(maxRows, allRows.length);
  for (let i = 0; i < upTo; i++) {
    const row = (allRows[i] ?? []).map(String);
    const c = detectCols(row);
    if (c.fecha !== -1 && c.monto !== -1) return { idx: i, cols: c };
  }
  return null;
}

/** Rellena con "" hasta minCols celdas para evitar "campos corridos" al renderizar. */
function padRow(cells: unknown[], minCols: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(cells.length, minCols); i++) {
    const v = cells[i];
    out.push(v === undefined || v === null ? "" : String(v));
  }
  return out;
}

function parseCSV(text: string): BankRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = parseSep(lines[0]!);
  const allRows = lines.map((l) => splitCSVLine(l, sep));
  const header = findHeader(allRows);
  if (!header) return [];
  const { idx, cols } = header;
  const colCount = (allRows[idx] ?? []).length;
  return allRows.slice(idx + 1).flatMap((rawCells) => {
    const cells = padRow(rawCells, colCount);
    const monto = parseMoney(cells[cols.monto] ?? "");
    if (monto <= 0) return [];
    return [{ fecha: cells[cols.fecha] ?? "", referencia: cols.referencia >= 0 ? (cells[cols.referencia] ?? "") : "", monto, descripcion: cols.descripcion >= 0 ? (cells[cols.descripcion] ?? "") : "" }];
  });
}

async function parseExcel(file: File): Promise<BankRow[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  if (rawRows.length < 2) return [];
  const allRows = (rawRows as unknown[][]).map((r) => r.map((v) => (v === undefined || v === null ? "" : String(v))));
  const header = findHeader(allRows);
  if (!header) return [];
  const { idx, cols } = header;
  const colCount = (allRows[idx] ?? []).length;
  return allRows.slice(idx + 1).flatMap((rawCells) => {
    const cells = padRow(rawCells, colCount);
    const monto = parseMoney(cells[cols.monto] ?? "");
    if (monto <= 0) return [];
    return [{ fecha: cells[cols.fecha] ?? "", referencia: cols.referencia >= 0 ? (cells[cols.referencia] ?? "") : "", monto, descripcion: cols.descripcion >= 0 ? (cells[cols.descripcion] ?? "") : "" }];
  });
}

function parseOFX(text: string): BankRow[] {
  const rows: BankRow[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|$))/gi) ?? [];
  for (const b of blocks) {
    const get = (tag: string) => b.match(new RegExp(`<${tag}>([^<\n\r]+)`, "i"))?.[1]?.trim() ?? "";
    const monto = parseMoney(get("TRNAMT"));
    if (monto <= 0) continue;
    const dt = get("DTPOSTED");
    const fecha = /^\d{8}/.test(dt) ? `${dt.slice(6, 8)}/${dt.slice(4, 6)}/${dt.slice(0, 4)}` : dt;
    rows.push({ fecha, referencia: get("FITID") || get("CHECKNUM") || "", monto, descripcion: get("NAME") || get("MEMO") || "" });
  }
  return rows;
}

function detectFormat(name: string): FileFormat {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, FileFormat> = { csv: "csv", txt: "csv", tsv: "tsv", xlsx: "xlsx", xls: "xls", ofx: "ofx", qfx: "ofx" };
  return map[ext] ?? "unknown";
}

// ─── Match engine ─────────────────────────────────────────────────────────────

function matchPayments(bankRows: BankRow[], payments: CcPaymentMin[]): MatchResult[] {
  const used = new Set<string>();
  return bankRows.map((br) => {
    let p: CcPaymentMin | undefined;
    let mt: MatchType = "none";

    p = payments.find((x) => !used.has(x.id) && x.reference && br.referencia && x.reference.toLowerCase().trim() === br.referencia.toLowerCase().trim());
    if (p) mt = "exact";

    if (!p && br.referencia) {
      p = payments.find((x) => {
        if (used.has(x.id) || !x.reference) return false;
        const r1 = x.reference.replace(/\D/g, "");
        const r2 = br.referencia.replace(/\D/g, "");
        return r1.length >= 4 && r2.length >= 4 && (r2.endsWith(r1) || r1.endsWith(r2));
      });
      if (p) mt = "partial";
    }

    if (!p) {
      // #10/#13 — Match por monto comparando Bs↔Bs directo (tasa histórica del pago).
      // El extracto bancario viene en Bs reales; el pago almacena los Bs reales que movió.
      p = payments.find((x) => {
        if (used.has(x.id)) return false;
        const pBs = Number(x.amountBss);
        if (!isFinite(pBs) || pBs <= 0) return false;
        const tol = Math.max(TOLERANCE_BS, pBs * 0.005);
        return Math.abs(pBs - br.monto) <= tol;
      });
      if (p) mt = "amount";
    }

    if (p) { used.add(p.id); return { bankRow: br, matched: true, matchType: mt, payment: p }; }
    return { bankRow: br, matched: false, matchType: "none" };
  });
}

const MATCH_COLORS: Record<MatchType, string> = {
  exact: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  partial: "bg-cyan-100 text-cyan-700 border border-cyan-200",
  amount: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  none: "",
};
const MATCH_LABELS: Record<MatchType, string> = {
  exact: "Ref exacta", partial: "Ref parcial", amount: "Por monto", none: "",
};
const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD",
  TRANSFER_BSS: "Trans. Bs", TRANSFER_USD: "Trans. USD",
  ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil", CRYPTO: "Cripto", CHECK: "Cheque", OTHER: "Otro",
};

function fmtMoney(n: number | string) {
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConciliacionCcPage() {
  const { selectedOrgId } = useComercial();
  const mallsQ = trpc.comercial.malls.list.useQuery({ organizationId: selectedOrgId });
  const mallId = mallsQ.data?.[0]?.id ?? "";

  // Cargar pagos del CC para reconciliar
  const paymentsQ = trpc.comercial.payments.list.useQuery(
    { organizationId: selectedOrgId, mallId, take: 200 },
    { enabled: !!mallId },
  );
  const payments: CcPaymentMin[] = (paymentsQ.data ?? []).map((p) => ({
    id: p.id,
    reference: p.reference,
    amountUsd: p.amountUsd.toString(),
    amountBss: p.amountBss.toString(),
    exchangeRate: p.exchangeRate.toString(),
    currencyPrimary: p.currencyPrimary,
    localCode: p.local?.code ?? "—",
    localName: p.local?.name ?? null,
    method: p.method,
    paidAt: new Date(p.paidAt).toLocaleDateString("es-VE"),
  }));

  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<FileFormat | null>(null);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [filter, setFilter] = useState<"all" | "matched" | "unmatched">("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setError("");
    setParsing(true);
    setResults(null);
    const fmt = detectFormat(file.name);
    setFormat(fmt);
    setFileName(file.name);
    try {
      let rows: BankRow[];
      if (fmt === "xlsx" || fmt === "xls") {
        rows = await parseExcel(file);
      } else if (fmt === "ofx") {
        rows = parseOFX(await file.text());
      } else if (fmt === "csv" || fmt === "tsv" || fmt === "unknown") {
        rows = parseCSV(await file.text());
      } else {
        rows = [];
      }
      if (rows.length === 0) { setError("No se encontraron movimientos en el archivo. Verifique que tenga columnas de fecha y monto."); setParsing(false); return; }
      setBankRows(rows);
    } catch {
      setError("Error al procesar el archivo.");
    }
    setParsing(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void processFile(f);
  }, [processFile]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void processFile(f);
    e.target.value = "";
  };

  const runMatch = () => {
    if (!bankRows.length || !payments.length) return;
    setResults(matchPayments(bankRows, payments));
  };

  const exportExcel = async () => {
    if (!results) return;
    const XLSX = await import("xlsx");
    const rows = results.map((r) => ({
      "Fecha": r.bankRow.fecha,
      "Referencia banco": r.bankRow.referencia,
      "Monto USD": r.bankRow.monto,
      "Descripción": r.bankRow.descripcion,
      "Match": r.matched ? "✅ Conciliado" : "❌ Sin match",
      "Tipo de match": r.matched ? MATCH_LABELS[r.matchType] : "",
      "Local": r.payment?.localCode ?? "",
      "Nombre local": r.payment?.localName ?? "",
      "Monto sistema": r.payment ? Number(r.payment.amountUsd) : "",
      "Método": r.payment ? (METHOD_LABEL[r.payment.method] ?? r.payment.method) : "",
      "Referencia sistema": r.payment?.reference ?? "",
      "Fecha sistema": r.payment?.paidAt ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conciliación CC");
    XLSX.writeFile(wb, `conciliacion_cc_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const filtered = results
    ? (filter === "matched" ? results.filter((r) => r.matched) : filter === "unmatched" ? results.filter((r) => !r.matched) : results)
    : null;

  const matchedCount = results?.filter((r) => r.matched).length ?? 0;
  const unmatchedCount = results ? results.length - matchedCount : 0;
  const matchedTotal = results?.filter((r) => r.matched).reduce((s, r) => s + r.bankRow.monto, 0) ?? 0;
  const unmatchedTotal = results?.filter((r) => !r.matched).reduce((s, r) => s + r.bankRow.monto, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">🏦 Conciliación bancaria</h1>
        <p className="text-muted-foreground text-sm">Compara movimientos bancarios con los pagos registrados en el sistema</p>
      </div>

      {/* Zona de carga */}
      <Card>
        <CardContent className="pt-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${isDragging ? "border-blue-400 bg-blue-50" : "border-muted-foreground/30 hover:border-blue-300 hover:bg-muted/30"}`}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.ofx,.qfx,.tsv,.txt" className="hidden" onChange={handleFile} />
            <p className="text-3xl mb-3">🏦</p>
            <p className="font-medium">Arrastra tu estado de cuenta bancario</p>
            <p className="text-sm text-muted-foreground mt-1">o haz clic para seleccionar</p>
            <p className="text-xs text-muted-foreground mt-2">CSV · Excel · OFX / QFX</p>
          </div>

          {parsing && <p className="text-sm text-center mt-3 text-muted-foreground animate-pulse">Procesando archivo...</p>}
          {error && <p className="text-sm text-center mt-3 text-red-600">{error}</p>}

          {bankRows.length > 0 && !results && (
            <div className="mt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground">{bankRows.length} movimientos · {payments.length} pagos en sistema</p>
              </div>
              <Button onClick={runMatch} className="bg-blue-600 hover:bg-blue-700">
                🔄 Conciliar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resultados */}
      {results && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total movimientos", value: results.length, color: "" },
              { label: "Conciliados", value: matchedCount, color: "text-green-600" },
              { label: "Sin match", value: unmatchedCount, color: "text-red-600" },
              { label: "% conciliado", value: `${results.length > 0 ? Math.round((matchedCount / results.length) * 100) : 0}%`, color: matchedCount === results.length ? "text-green-600" : "text-orange-600" },
            ].map((k) => (
              <Card key={k.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Totales */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 flex justify-between items-center">
              <div>
                <p className="text-xs text-green-700 font-medium">Total conciliado</p>
                <p className="text-lg font-bold text-green-800">${fmtMoney(matchedTotal)}</p>
              </div>
              <span className="text-2xl">✅</span>
            </div>
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex justify-between items-center">
              <div>
                <p className="text-xs text-red-700 font-medium">Sin conciliar</p>
                <p className="text-lg font-bold text-red-800">${fmtMoney(unmatchedTotal)}</p>
              </div>
              <span className="text-2xl">❌</span>
            </div>
          </div>

          {/* Controles */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-1">
              {(["all", "matched", "unmatched"] as const).map((f) => (
                <button key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filter === f ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                  {f === "all" ? `Todos (${results.length})` : f === "matched" ? `✅ Conciliados (${matchedCount})` : `❌ Sin match (${unmatchedCount})`}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void exportExcel()}>⬇️ Excel</Button>
              <Button size="sm" variant="outline" onClick={() => { setResults(null); setBankRows([]); setFileName(""); }}>
                🔄 Nueva conciliación
              </Button>
            </div>
          </div>

          {/* Tabla */}
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Fecha</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Referencia banco</th>
                  <th className="text-right px-4 py-3">Monto banco</th>
                  <th className="text-center px-4 py-3">Match</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Local (sistema)</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Monto sistema</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Ref sistema</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(filtered ?? []).map((r, i) => (
                  <tr key={i} className={r.matched ? "hover:bg-green-50/50" : "bg-red-50/30 hover:bg-red-50/60"}>
                    <td className="px-4 py-2.5 font-medium">{r.bankRow.fecha}</td>
                    <td className="px-4 py-2.5 font-mono hidden sm:table-cell text-muted-foreground">{r.bankRow.referencia || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">${fmtMoney(r.bankRow.monto)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {r.matched ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MATCH_COLORS[r.matchType]}`}>
                          {MATCH_LABELS[r.matchType]}
                        </span>
                      ) : (
                        <span className="text-red-500">❌</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      {r.payment ? (
                        <span className="font-medium">{r.payment.localCode}{r.payment.localName ? ` — ${r.payment.localName}` : ""}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right hidden md:table-cell">
                      {r.payment ? <span className="text-green-700 font-medium">${fmtMoney(r.payment.amountUsd)}</span> : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono hidden lg:table-cell text-muted-foreground">
                      {r.payment?.reference ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Movimientos sin match: instrucciones */}
          {unmatchedCount > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-red-700">❌ {unmatchedCount} movimientos sin conciliar</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p>Los movimientos sin match pueden deberse a:</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>Pagos registrados en el sistema sin referencia bancaria</li>
                  <li>Diferencias en el monto (comisiones bancarias, retenciones)</li>
                  <li>Pagos no registrados aún en el sistema</li>
                </ul>
                <p className="text-xs mt-2">👉 Ve a <strong>Pagos</strong> para registrar los pagos faltantes, luego vuelve a conciliar.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Estado vacío */}
      {!results && bankRows.length === 0 && !parsing && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-3xl">📊</p>
            <p className="font-medium">Carga tu estado de cuenta bancario</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              El sistema comparará automáticamente los movimientos del banco con los pagos registrados usando referencia y monto.
            </p>
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 inline-block text-left">
              <p className="font-medium mb-1">Formatos aceptados:</p>
              <p>• CSV / TXT con columnas de fecha, referencia y monto</p>
              <p>• Excel (.xlsx / .xls) — mismo formato</p>
              <p>• OFX / QFX — formato bancario estándar</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info de pagos disponibles */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">💡 Pagos disponibles para conciliación</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {paymentsQ.isLoading ? "Cargando..." : `${payments.length} pagos registrados en el sistema (últimos 200)`}
          </p>
          {payments.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
              <p>Total: ${fmtMoney(payments.reduce((s, p) => s + Number(p.amountUsd), 0))} USD</p>
              <p>Con referencia: {payments.filter((p) => p.reference).length} de {payments.length}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
