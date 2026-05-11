"use client";

/**
 * Botón flotante PERMANENTE para previsualizar el recibo del mes EN EL FORMATO REAL
 * (Aviso de Cobro) que verán los residentes. Usa el mismo generador PDF que el recibo
 * que se emite a producción.
 *
 * Pedido del cliente: "previsualizar el recibo que se emitirá... como lo verán los
 * residentes". El widget muestra un iframe con el PDF generado on-the-fly para una
 * unidad de muestra (configurable por buscador).
 *
 * Posición: esquina inferior IZQUIERDA (el chip de IA está en bottom-right).
 */
import { useState, useMemo, useEffect } from "react";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "@/app/org/OrgContext";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function ReceiptPreviewWidget() {
  const organizationId = useOrgId();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const communityId = useMemo(() => {
    const m = pathname?.match(/\/org\/communities\/([^/]+)/);
    return m?.[1] ?? null;
  }, [pathname]);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [unitFilter, setUnitFilter] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  // Lista de unidades para el buscador (solo cuando hay community)
  const unitsQ = trpc.org.units.list.useQuery(
    { organizationId, communityId: communityId ?? "" },
    { enabled: Boolean(communityId && open) },
  );

  // Generación on-demand del PDF preview
  const previewMut = trpc.finance.invoices.previewReceiptPdf.useMutation();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ unitCode: string; totalUsd: string; totalBss: string } | null>(null);

  // Cuando cambia unidad, mes o año → regenerar PDF
  useEffect(() => {
    if (!open || !communityId) return;
    if (!selectedUnitId && (unitsQ.data?.length ?? 0) === 0) return;
    let cancelled = false;
    const run = async () => {
      // Si no hay unidad seleccionada todavía, tomar la primera
      const uid = selectedUnitId ?? unitsQ.data?.[0]?.id;
      if (!uid) return;
      try {
        const res = await previewMut.mutateAsync({
          organizationId, communityId, year, month, unitId: uid,
        });
        if (cancelled) return;
        // data: URI es más compatible que blob: URL en algunos browsers/contextos
        // (algunos bloquean blob URLs en iframes por CSP/sandbox). Usamos data URI
        // que renderiza el PDF inline sin depender del PDF viewer del browser
        // sobre un blob.
        const dataUrl = `data:application/pdf;base64,${res.base64}`;
        setPdfUrl((prev) => {
          if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
          return dataUrl;
        });
        setPreviewMeta({ unitCode: res.unitCode, totalUsd: res.totalUsd, totalBss: res.totalBss });
      } catch {
        // El componente maneja los errores abajo
      }
    };
    void run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, communityId, selectedUnitId, year, month, unitsQ.data?.length]);

  // Cleanup blob URL al cerrar
  useEffect(() => {
    if (!open && pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
  }, [open, pdfUrl]);

  const units = unitsQ.data ?? [];
  const filteredUnits = units.filter((u) =>
    !unitFilter || u.code.toLowerCase().includes(unitFilter.toLowerCase()),
  );

  // Botón colapsado
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Previsualizar recibo del mes"
        className="fixed bottom-6 left-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:scale-105 hover:shadow-xl transition-all duration-200"
        title="Previsualizar recibo del mes (vista del residente)"
      >
        <span className="text-2xl">📄</span>
      </button>
    );
  }

  // Sin community en URL → mensaje
  if (!communityId) {
    return (
      <div className="fixed bottom-6 left-6 z-50 flex flex-col w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5">
          <span className="text-lg">📄</span>
          <span className="font-semibold text-sm flex-1">Previsualizar Recibo</span>
          <button onClick={() => setOpen(false)} aria-label="Cerrar" className="opacity-80 hover:opacity-100">✕</button>
        </div>
        <div className="p-6 text-center text-sm text-muted-foreground">
          Entrá a una comunidad (Finanzas → cualquier sub-página) para ver el preview del recibo.
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 left-6 z-50 flex w-[860px] max-w-[calc(100vw-2rem)] h-[80vh] max-h-[calc(100vh-3rem)] rounded-2xl border border-border bg-white shadow-2xl overflow-hidden">
      {/* Sidebar selección */}
      <div className="w-[230px] border-r bg-slate-50 flex flex-col">
        <div className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2.5">
          <span className="text-base">📄</span>
          <span className="font-semibold text-xs flex-1 leading-tight">Vista del Recibo<br/><span className="font-normal opacity-90">(como lo ve el residente)</span></span>
        </div>

        {/* Mes / Año */}
        <div className="p-2 border-b bg-white flex gap-1">
          <select
            className="flex-1 rounded border px-1.5 py-1 text-xs"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            className="w-20 rounded border px-1.5 py-1 text-xs"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Buscador unidad */}
        <div className="p-2 border-b bg-white">
          <input
            type="text"
            placeholder="🔍 Unidad (ej: 101A)"
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="w-full rounded border px-2 py-1 text-xs"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Ver el recibo para una unidad específica
          </p>
        </div>

        {/* Lista de unidades */}
        <div className="flex-1 overflow-y-auto">
          {unitsQ.isLoading && (
            <div className="p-3 text-xs text-muted-foreground">Cargando unidades...</div>
          )}
          {filteredUnits.slice(0, 100).map((u) => (
            <button
              key={u.id}
              onClick={() => setSelectedUnitId(u.id)}
              className={`w-full text-left px-3 py-1.5 text-xs border-b hover:bg-emerald-50 ${
                (selectedUnitId === u.id || (!selectedUnitId && filteredUnits[0]?.id === u.id))
                  ? "bg-emerald-100 font-semibold" : ""
              }`}
            >
              {u.code}
              {u.tower && <span className="ml-1 text-[10px] text-muted-foreground">T{u.tower}</span>}
            </button>
          ))}
          {filteredUnits.length > 100 && (
            <p className="px-3 py-1 text-[10px] text-muted-foreground">
              +{filteredUnits.length - 100} más — filtrá arriba
            </p>
          )}
        </div>

        <div className="border-t p-2 bg-white">
          {previewMeta && (
            <div className="text-[11px] mb-2 leading-tight">
              <div className="text-muted-foreground">Total recibo {previewMeta.unitCode}:</div>
              <div className="font-bold text-emerald-700">Bs {Number(previewMeta.totalBss).toLocaleString("es-VE", { minimumFractionDigits: 2 })}</div>
              <div className="text-muted-foreground">≈ ${previewMeta.totalUsd}</div>
            </div>
          )}
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={`Preview-Recibo-${previewMeta?.unitCode ?? "X"}.pdf`}
              className="block w-full mb-1 rounded bg-emerald-600 px-2 py-1 text-xs text-white text-center hover:bg-emerald-700"
            >
              ⬇️ Abrir / descargar PDF
            </a>
          )}
          <button
            onClick={() => setOpen(false)}
            className="w-full rounded bg-slate-200 px-2 py-1 text-xs hover:bg-slate-300"
          >
            ✕ Cerrar
          </button>
        </div>
      </div>

      {/* PDF Preview */}
      <div className="flex-1 bg-slate-100 relative">
        {previewMut.isPending && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-slate-100/80 z-10">
            ⏳ Generando preview del recibo...
          </div>
        )}
        {previewMut.error && !previewMut.isPending && (
          <div className="p-6 text-sm text-destructive">
            <strong>Error:</strong> {previewMut.error.message}
            <p className="mt-2 text-xs text-muted-foreground">
              Verificá que haya gastos cargados para {MONTHS[month - 1]} {year} y que la tasa BCV esté disponible.
            </p>
          </div>
        )}
        {pdfUrl && !previewMut.isPending && (
          // object da mejor compatibilidad que iframe con data:URLs en algunos
          // navegadores (especialmente con visor PDF interno de Chrome/Edge).
          // Si no funciona, fallback a iframe.
          <object
            data={pdfUrl}
            type="application/pdf"
            className="w-full h-full"
            aria-label="Preview del Recibo"
          >
            <iframe
              src={pdfUrl}
              className="w-full h-full border-0"
              title="Preview del Recibo"
            />
          </object>
        )}
        {!pdfUrl && !previewMut.isPending && !previewMut.error && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Seleccioná una unidad de la lista para ver su recibo.
          </div>
        )}
        {pdfUrl && previewMeta && Number(previewMeta.totalUsd) === 0 && (
          <div className="absolute top-3 right-3 bg-amber-50 border border-amber-300 rounded-md px-3 py-1.5 text-xs text-amber-800 max-w-[260px]">
            ⚠️ Sin gastos cargados para {MONTHS[month - 1]} {year}. El recibo aparece vacío.
            Cargá gastos en <strong>Finanzas → Gastos</strong> o aplicá plantillas.
          </div>
        )}
      </div>
    </div>
  );
}
