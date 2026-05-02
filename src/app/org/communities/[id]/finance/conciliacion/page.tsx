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

// ─── CSV / Excel parser ───────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function detectColumns(headers: string[]): { fecha: number; referencia: number; monto: number; descripcion: number } | null {
  const h = headers.map(h => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const find = (...terms: string[]) => h.findIndex(col => terms.some(t => col.includes(t)));
  const fecha = find("fecha", "date", "dia");
  const referencia = find("referencia", "ref", "numero", "nro", "nro.");
  const monto = find("monto", "credito", "importe", "cantidad", "amount", "valor");
  const descripcion = find("descripcion", "concepto", "detalle", "obs");
  if (fecha === -1 || monto === -1) return null;
  return { fecha, referencia: referencia === -1 ? 0 : referencia, monto, descripcion: descripcion === -1 ? referencia : descripcion };
}

function parseCSV(text: string): BankRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]!);
  const cols = detectColumns(headers);
  if (!cols) return [];

  return lines.slice(1).map(line => {
    const cells = parseCSVLine(line);
    const montoRaw = (cells[cols.monto] ?? "").replace(/[^0-9.,\-]/g, "").replace(",", ".");
    return {
      fecha: cells[cols.fecha] ?? "",
      referencia: cells[cols.referencia] ?? "",
      monto: parseFloat(montoRaw) || 0,
      descripcion: cols.descripcion !== undefined ? (cells[cols.descripcion] ?? "") : "",
    };
  }).filter(r => r.monto > 0);
}

// ─── Fuzzy match amount ────────────────────────────────────────────────────────
const TOLERANCE = 0.05; // 5 centavos de diferencia permitida

function matchPayments(bankRows: BankRow[], payments: PaymentForReconciliation[] | undefined): MatchResult[] {
  if (!payments) return bankRows.map(br => ({ bankRow: br, matched: false }));

  const used = new Set<string>();

  return bankRows.map(br => {
    // Try exact reference match first
    let pay = payments.find(p =>
      !used.has(p.id) &&
      p.reference &&
      br.referencia &&
      p.reference.toLowerCase().trim() === br.referencia.toLowerCase().trim()
    );

    // Fallback: match by amount within tolerance
    if (!pay) {
      pay = payments.find(p => {
        if (used.has(p.id)) return false;
        const diff = Math.abs(Number(p.amountUsd) - br.monto);
        return diff <= TOLERANCE;
      });
    }

    if (pay) {
      used.add(pay.id);
      return {
        bankRow: br,
        matched: true,
        payment: pay,
        diff: Math.abs(Number(pay.amountUsd) - br.monto),
      };
    }
    return { bankRow: br, matched: false };
  });
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
function usePayments() {
  const params = useParams<{ id: string }>();
  const { selectedOrgId } = useOrgs();
  return trpc.finance.payments.listForReconciliation.useQuery(
    { organizationId: selectedOrgId, communityId: params.id },
    { enabled: Boolean(selectedOrgId && params.id) }
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ConciliacionPage() {
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "matched" | "unmatched">("all");

  const payments = usePayments();

  const processFile = useCallback(async (file: File) => {
    setError("");
    setResults(null);
    setFileName(file.name);

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "txt"].includes(ext ?? "")) {
      setError("Por ahora solo se soportan archivos CSV o TXT. Exporta tu estado de cuenta bancario en ese formato.");
      return;
    }

    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) {
      setError("No se pudo detectar la estructura del archivo. Asegúrate de que tenga columnas: Fecha, Referencia, Monto (o Crédito).");
      return;
    }

    setBankRows(rows);
    const matched = matchPayments(rows, payments.data ?? []);
    setResults(matched);
  }, [payments.data]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }, [processFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  // Stats
  const matchedCount = results?.filter(r => r.matched).length ?? 0;
  const unmatchedCount = results?.filter(r => !r.matched).length ?? 0;
  const totalBank = bankRows.reduce((s, r) => s + r.monto, 0);
  const matchedAmount = results?.filter(r => r.matched).reduce((s, r) => s + r.bankRow.monto, 0) ?? 0;

  const filtered = results?.filter(r => {
    if (filterMode === "matched") return r.matched;
    if (filterMode === "unmatched") return !r.matched;
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">🏦 Conciliación Bancaria</h1>
        <p className="text-slate-400 text-sm mt-1">
          Sube el estado de cuenta del banco (CSV) y compáralo automáticamente con los pagos registrados.
        </p>
      </div>

      {/* Upload zone */}
      <Card className="bg-slate-900 border-slate-700">
        <CardContent className="pt-6">
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
              isDragging ? "border-blue-500 bg-blue-500/10" : "border-slate-600 hover:border-slate-500"
            }`}
          >
            <div className="text-4xl mb-3">📂</div>
            <p className="text-slate-300 font-medium mb-1">
              {fileName ? `Archivo cargado: ${fileName}` : "Arrastra tu estado de cuenta bancario aquí"}
            </p>
            <p className="text-slate-500 text-sm mb-4">o haz click para seleccionar · Formato: CSV o TXT</p>
            <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors">
              <span>📁</span> Seleccionar archivo
              <input type="file" accept=".csv,.txt" className="hidden" onChange={onFileChange} />
            </label>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 p-4 text-red-400 text-sm">
              ⚠️ {error}
            </div>
          )}

          <div className="mt-4 p-4 rounded-lg bg-slate-800 border border-slate-700">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              💡 Columnas detectadas automáticamente:
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              {["Fecha / Date / Dia", "Referencia / Ref / Número", "Monto / Crédito / Amount / Importe", "Descripción / Concepto / Detalle"].map(c => (
                <span key={c} className="rounded-md bg-slate-700 px-2 py-1">{c}</span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-slate-900 border-slate-700">
              <CardContent className="pt-5">
                <p className="text-xs text-slate-400 mb-1">Total en banco</p>
                <p className="text-xl font-bold text-white">${totalBank.toFixed(2)}</p>
                <p className="text-xs text-slate-500">{bankRows.length} movimientos</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-700">
              <CardContent className="pt-5">
                <p className="text-xs text-slate-400 mb-1">Conciliados</p>
                <p className="text-xl font-bold text-emerald-400">{matchedCount}</p>
                <p className="text-xs text-slate-500">${matchedAmount.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-700">
              <CardContent className="pt-5">
                <p className="text-xs text-slate-400 mb-1">Sin conciliar</p>
                <p className="text-xl font-bold text-amber-400">{unmatchedCount}</p>
                <p className="text-xs text-slate-500">revisar manualmente</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-900 border-slate-700">
              <CardContent className="pt-5">
                <p className="text-xs text-slate-400 mb-1">% Conciliado</p>
                <p className="text-xl font-bold text-blue-400">
                  {bankRows.length > 0 ? Math.round((matchedCount / bankRows.length) * 100) : 0}%
                </p>
                <div className="mt-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${bankRows.length > 0 ? (matchedCount / bankRows.length) * 100 : 0}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2">
            {(["all", "matched", "unmatched"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  filterMode === mode
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {mode === "all" && `Todos (${results.length})`}
                {mode === "matched" && `✅ Conciliados (${matchedCount})`}
                {mode === "unmatched" && `⚠️ Sin conciliar (${unmatchedCount})`}
              </button>
            ))}
          </div>

          {/* Table */}
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="text-base text-white">Resultados de conciliación</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Estado</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Fecha banco</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Referencia banco</th>
                      <th className="py-2 px-3 text-right text-xs text-slate-400">Monto banco</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Propietario</th>
                      <th className="py-2 px-3 text-left text-xs text-slate-400">Unidad</th>
                      <th className="py-2 px-3 text-right text-xs text-slate-400">Pago sistema</th>
                      <th className="py-2 px-3 text-right text-xs text-slate-400">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filtered ?? []).map((r, i) => (
                      <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                        <td className="py-2.5 px-3">
                          {r.matched ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs px-2 py-0.5 border border-emerald-500/20">
                              ✅ OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-400 text-xs px-2 py-0.5 border border-amber-500/20">
                              ⚠️ Pendiente
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-mono text-xs">{r.bankRow.fecha}</td>
                        <td className="py-2.5 px-3 text-slate-300 font-mono text-xs">
                          {r.bankRow.referencia || <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right text-white font-medium">
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
                            r.diff < 0.01 ? (
                              <span className="text-emerald-400">$0.00</span>
                            ) : (
                              <span className="text-amber-400">${r.diff.toFixed(2)}</span>
                            )
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(filtered ?? []).length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-slate-500">
                          No hay movimientos en esta vista
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Payments in system NOT in bank */}
          {payments.data && (() => {
            const bankRefs = new Set(results.filter(r => r.matched).map(r => r.payment?.id).filter(Boolean));
            const notInBank = payments.data.filter(p => !bankRefs.has(p.id));
            if (notInBank.length === 0) return null;
            return (
              <Card className="bg-slate-900 border-amber-600/30">
                <CardHeader>
                  <CardTitle className="text-base text-amber-400">
                    ⚠️ Pagos en sistema no encontrados en banco ({notInBank.length})
                  </CardTitle>
                  <p className="text-xs text-slate-400">Estos pagos están registrados en el sistema pero no aparecen en el estado de cuenta bancario cargado.</p>
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
                          <td className="py-2 px-3 text-slate-400 text-xs font-mono">{new Date(p.paidAt).toLocaleDateString("es-VE")}</td>
                          <td className="py-2 px-3 text-slate-300 text-xs font-mono">{p.reference ?? "—"}</td>
                          <td className="py-2 px-3 text-slate-300 text-xs">{p.ownerName}</td>
                          <td className="py-2 px-3 text-slate-400 text-xs">{p.unitLabel}</td>
                          <td className="py-2 px-3 text-right text-white text-xs font-medium">${Number(p.amountUsd).toFixed(2)}</td>
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
      {!results && !error && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-lg font-medium text-slate-400">Carga un estado de cuenta bancario para comenzar</p>
          <p className="text-sm mt-1">El sistema comparará automáticamente cada movimiento con los pagos registrados</p>
        </div>
      )}
    </div>
  );
}
