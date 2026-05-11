"use client";

/**
 * Botón flotante PERMANENTE para previsualizar el recibo del mes en cualquier pantalla
 * del panel de administración. Pedido del cliente:
 *   "Que haya un botón permanente, tal cual como el de la IA, que esté siempre que
 *    permita pre visualizar el recibo que se emitirá desde cualquier lugar."
 *
 * Posición: esquina inferior IZQUIERDA (el chip de IA está en bottom-right).
 * Comportamiento: abre un panel con el preview del mes corriente y permite
 * cambiar de mes/año + ver el desglose por unidad.
 */
import { useState, useMemo } from "react";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "@/app/org/OrgContext";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function ReceiptPreviewWidget() {
  const organizationId = useOrgId();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Detectar communityId desde la URL (si estamos dentro de /org/communities/[id]/...)
  const communityId = useMemo(() => {
    const m = pathname?.match(/\/org\/communities\/([^/]+)/);
    return m?.[1] ?? null;
  }, [pathname]);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [unitFilter, setUnitFilter] = useState("");

  const previewQ = trpc.finance.invoices.previewMonth.useQuery(
    { organizationId, communityId: communityId ?? "", year, month },
    { enabled: Boolean(communityId && open), staleTime: 30_000 },
  );

  // Si no estamos en un community, mostramos el botón igual pero al abrir
  // pedimos elegir community
  const communitiesQ = trpc.org.communities.list.useQuery(
    { organizationId },
    { enabled: !communityId && open },
  );

  // Botón colapsado
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Previsualizar recibo del mes"
        className="fixed bottom-6 left-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:scale-105 hover:shadow-xl transition-all duration-200"
        title="Previsualizar recibo del mes"
      >
        <span className="text-2xl">📄</span>
      </button>
    );
  }

  // Si no hay community en la URL, mostrar selector
  if (!communityId) {
    return (
      <div className="fixed bottom-6 left-6 z-50 flex flex-col w-[420px] max-w-[calc(100vw-2rem)] max-h-[60vh] rounded-2xl border border-border bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5">
          <span className="text-lg">📄</span>
          <span className="font-semibold text-sm flex-1">Previsualizar Recibo</span>
          <button onClick={() => setOpen(false)} className="opacity-80 hover:opacity-100">✕</button>
        </div>
        <div className="p-4 text-sm space-y-2 overflow-y-auto">
          <p className="text-muted-foreground">Elegí un condominio para ver el preview:</p>
          {communitiesQ.data?.map((c) => (
            <a
              key={c.id}
              href={`/org/communities/${c.id}/finance/invoices`}
              className="block rounded border px-3 py-2 hover:bg-emerald-50"
            >
              {c.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  const data = previewQ.data;
  const filteredUnits = data?.unitPreviews.filter((u) =>
    !unitFilter || u.unitCode.toLowerCase().includes(unitFilter.toLowerCase()),
  ) ?? [];

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col w-[440px] max-w-[calc(100vw-2rem)] h-[620px] max-h-[calc(100vh-5rem)] rounded-2xl border border-border bg-white shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5">
        <span className="text-lg">📄</span>
        <span className="font-semibold text-sm flex-1">Previsualizar Recibo</span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Cerrar"
          className="opacity-80 hover:opacity-100"
        >✕</button>
      </div>

      {/* Selector mes/año */}
      <div className="border-b bg-slate-50 px-4 py-2 flex items-center gap-2 text-sm">
        <select
          className="rounded border px-2 py-1 text-xs"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        >
          {MONTHS.map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          className="rounded border px-2 py-1 text-xs"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {data?.alreadyIssued && (
          <span className="ml-auto text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
            Ya emitido
          </span>
        )}
      </div>

      {/* Resumen */}
      {previewQ.isLoading && (
        <div className="p-6 text-center text-sm text-muted-foreground">Calculando preview...</div>
      )}
      {previewQ.error && (
        <div className="p-4 text-sm text-destructive">
          {previewQ.error.message ?? "Error al cargar preview"}
        </div>
      )}
      {data && (
        <>
          <div className="border-b bg-emerald-50 px-4 py-2 text-xs space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gastos del mes:</span>
              <span className="font-semibold">${data.totalExpensesUsd}</span>
            </div>
            {Number(data.incomeDeduction.totalUsd) > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>− Ingresos que descuentan ({data.incomeDeduction.count}):</span>
                <span className="font-semibold">−${data.incomeDeduction.totalUsd}</span>
              </div>
            )}
            {Number(data.monthlyFeeUsd) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">+ Cuota mensual × {data.unitCount} unidades:</span>
                <span className="font-semibold">+${(Number(data.monthlyFeeUsd) * data.unitCount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 mt-1">
              <span className="font-semibold">TOTAL a facturar:</span>
              <span className="font-bold text-emerald-700">${data.grandTotalUsd}</span>
            </div>
          </div>

          {/* Buscador unidad */}
          <div className="px-4 py-2 border-b">
            <input
              type="text"
              placeholder="🔍 Buscar unidad (ej: 101A, B-16)..."
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="w-full rounded border px-3 py-1.5 text-sm"
            />
          </div>

          {/* Lista de unidades */}
          <div className="flex-1 overflow-y-auto">
            {filteredUnits.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {unitFilter ? "Sin unidades que coincidan" : "Sin unidades"}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100 text-left">
                  <tr>
                    <th className="px-3 py-1.5">Unidad</th>
                    <th className="px-3 py-1.5">Torre</th>
                    <th className="px-3 py-1.5 text-right">USD</th>
                    <th className="px-3 py-1.5 text-right">Bs (≈)</th>
                    <th className="px-3 py-1.5 text-center">Líneas</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUnits.slice(0, 200).map((u) => (
                    <tr key={u.unitCode} className="border-t hover:bg-emerald-50/30">
                      <td className="px-3 py-1 font-medium">{u.unitCode}</td>
                      <td className="px-3 py-1 text-muted-foreground">{u.tower ?? "—"}</td>
                      <td className="px-3 py-1 text-right font-mono">${u.totalUsd}</td>
                      <td className="px-3 py-1 text-right font-mono text-muted-foreground">
                        Bs {Number(u.totalBss).toLocaleString("es-VE", { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-1 text-center text-muted-foreground">{u.lineCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {filteredUnits.length > 200 && (
              <p className="px-3 py-2 text-[10px] text-muted-foreground text-center">
                Mostrando 200 de {filteredUnits.length} unidades — filtrá arriba para reducir.
              </p>
            )}
          </div>

          <div className="border-t bg-slate-50 px-4 py-2 flex items-center gap-2">
            <a
              href={`/org/communities/${communityId}/finance/invoices`}
              className="text-xs text-emerald-700 underline hover:text-emerald-900"
            >
              Ir al wizard de emisión →
            </a>
            <button
              onClick={() => previewQ.refetch()}
              className="ml-auto text-xs rounded border px-2 py-1 hover:bg-white"
              title="Refrescar"
            >
              🔄
            </button>
          </div>
        </>
      )}
    </div>
  );
}
