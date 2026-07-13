import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatea una fecha "de calendario" (guardada como medianoche UTC, ej.
 * ExchangeRate.date) usando los componentes UTC en vez de la hora local del
 * navegador. `new Date(...).toLocaleDateString()` en Venezuela (UTC-4) muestra
 * un día ANTES porque convierte la medianoche UTC a las 20:00 del día previo
 * en hora local. Bug reportado 10-jul-2026: "pongo el 5 de julio, me trae la
 * tasa del 4".
 */
export function formatUtcDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const utcDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return utcDate.toLocaleDateString("es-VE");
}

/** Venezuela (VET) es UTC-4 fijo, sin horario de verano desde 2016. */
const VENEZUELA_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * Fecha de HOY según el calendario de Venezuela, normalizada a medianoche UTC
 * (mismo formato que usan las columnas de fecha "de calendario" en la BD,
 * ej. ExchangeRate.date). Necesario porque el servidor (Vercel) corre en UTC:
 * entre las 8pm y medianoche hora de Venezuela, el día calendario en UTC YA
 * cambió a "mañana" aunque en Venezuela sigue siendo "hoy" — sin este ajuste,
 * cualquier código que use `new Date()` para calcular "hoy" (ej. la tasa BCV)
 * queda un día adelantado. Bug reportado 11-jul-2026.
 */
export function todayInVenezuela(): Date {
  const shifted = new Date(Date.now() - VENEZUELA_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** Como `todayInVenezuela()` pero como string "YYYY-MM-DD", para inputs type=date. */
export function todayInVenezuelaStr(): string {
  return todayInVenezuela().toISOString().slice(0, 10);
}
