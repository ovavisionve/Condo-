import { Decimal } from "decimal.js";
import { db } from "@/server/db/client";
import type { ExchangeSource } from "@prisma/client";

/**
 * Servicio de tasas de cambio.
 *
 * Reglas:
 * - Cada transacción financiera debe usar la tasa del DÍA en que se registra.
 * - Si la tasa del día no está en DB, se intenta hacer fetch automático (BCV vía dolarapi.com).
 * - Si el fetch falla, se exige tasa MANUAL del administrador.
 * - Las tasas son globales (tabla ExchangeRate), no por organización.
 */

export type RateInfo = {
  date: Date;
  source: ExchangeSource;
  vesPerUsd: Decimal;
};

const dateOnly = (d: Date): Date => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

/** Intenta obtener la tasa más reciente para una fuente; si falta hoy, hace fetch. */
export async function getCurrentRate(
  source: ExchangeSource = "BCV",
  today: Date = new Date(),
): Promise<RateInfo> {
  const date = dateOnly(today);

  const cached = await db.exchangeRate.findUnique({
    where: { date_source: { date, source } },
  });
  if (cached) {
    return { date: cached.date, source: cached.source, vesPerUsd: new Decimal(cached.vesPerUsd) };
  }

  if (source === "BCV") {
    const fetched = await fetchBcvRate();
    if (fetched) {
      const saved = await db.exchangeRate.upsert({
        where: { date_source: { date, source: "BCV" } },
        update: { vesPerUsd: fetched.toString() },
        create: { date, source: "BCV", vesPerUsd: fetched.toString() },
      });
      return { date: saved.date, source: saved.source, vesPerUsd: new Decimal(saved.vesPerUsd) };
    }
  }

  // Fallback: la tasa más reciente disponible.
  // Para BCV, también aceptamos MANUAL como respaldo (el admin pudo haberla ingresado).
  const sourceFallback = source === "BCV" ? { in: ["BCV", "MANUAL"] as ExchangeSource[] } : source;
  const latest = await db.exchangeRate.findFirst({
    where: { source: sourceFallback },
    orderBy: { date: "desc" },
  });
  if (latest) {
    return { date: latest.date, source: latest.source, vesPerUsd: new Decimal(latest.vesPerUsd) };
  }

  throw new Error(
    `No hay tasa de cambio disponible. Registra una tasa manualmente en Finanzas → Configuración o presiona "Actualizar desde BCV".`,
  );
}

/**
 * Registra una tasa manual (cuando el admin no puede o no quiere depender del fetch automático).
 */
export async function setManualRate(
  vesPerUsd: Decimal.Value,
  date: Date = new Date(),
  notes?: string,
): Promise<RateInfo> {
  const d = dateOnly(date);
  const rate = new Decimal(vesPerUsd);
  if (rate.lte(0)) throw new Error("La tasa debe ser mayor que cero");
  const saved = await db.exchangeRate.upsert({
    where: { date_source: { date: d, source: "MANUAL" } },
    update: { vesPerUsd: rate.toString(), notes },
    create: { date: d, source: "MANUAL", vesPerUsd: rate.toString(), notes },
  });
  return { date: saved.date, source: saved.source, vesPerUsd: new Decimal(saved.vesPerUsd) };
}

/**
 * Fetch BCV oficial — intenta dos fuentes en orden:
 *   1. ve.dolarapi.com  (API pública, funciona desde servidores externos)
 *   2. Scraping directo de www.bcv.org.ve (funciona en local, puede bloquearse en prod)
 */
async function fetchBcvRate(): Promise<Decimal | null> {
  // Fuente 1: ve.dolarapi.com — API pública venezolana que publica la tasa BCV oficial
  const fromApi = await fetchFromDolarApi();
  if (fromApi) return fromApi;

  // Fuente 2: scraping directo del BCV (funciona en redes venezolanas / local)
  const fromScrape = await fetchBcvScrape();
  return fromScrape;
}

/** Intenta obtener la tasa desde ve.dolarapi.com */
async function fetchFromDolarApi(): Promise<Decimal | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return null;
      // Respuesta: { fuente, nombre, promedio, promedioCompra, promedioVenta, fechaActualizacion }
      const data = (await res.json()) as { promedio?: number; promedioVenta?: number };
      const value = data.promedio ?? data.promedioVenta;
      if (!value || !isFinite(value) || value < 1) return null;
      console.info("[exchange] Tasa BCV obtenida de dolarapi.com:", value);
      return new Decimal(value);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn("[exchange] dolarapi.com falló:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Scraping directo de www.bcv.org.ve (fallback).
 * El BCV usa coma como separador decimal: "490,22510000".
 */
async function fetchBcvScrape(): Promise<Decimal | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let html: string;
    try {
      const res = await fetch("https://www.bcv.org.ve/", {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Condominios/1.0)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "es-VE,es;q=0.9",
        },
        cache: "no-store",
      });
      if (!res.ok) return null;
      html = await res.text();
    } finally {
      clearTimeout(timeout);
    }
    const rate = parseBcvHtml(html);
    if (rate === null) {
      console.warn("[exchange] BCV scraping: no se pudo extraer tasa del HTML");
      return null;
    }
    console.info("[exchange] Tasa BCV obtenida por scraping:", rate);
    return new Decimal(rate);
  } catch (err) {
    console.warn("[exchange] BCV scraping falló:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Expuesta para testing — recibe HTML crudo y retorna número o null. */
export function parseBcvHtml(html: string): number | null {
  // Paso 1: aislar bloque div#dolar
  const blockMatch = html.match(/id=["']dolar["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
  const block = blockMatch
    ? blockMatch[0]
    : (() => {
        const idx = html.indexOf('id="dolar"');
        return idx >= 0 ? html.slice(idx, idx + 600) : null;
      })();

  if (!block) return null;

  // Paso 2: extraer número con coma o punto decimal
  const match = block.match(/(\d{2,6}[,.](\d{2,10}))/);
  if (!match) return null;

  const normalized = (match[1] ?? "").replace(",", ".");
  const value = parseFloat(normalized);
  if (!isFinite(value) || value < 1 || value > 100_000) return null;
  return value;
}

/**
 * Fuerza un fetch fresco del BCV ignorando la caché del día.
 * Útil para el botón "Actualizar ahora" en la UI.
 */
export async function refreshBcvRate(): Promise<RateInfo> {
  const fetched = await fetchBcvRate();
  if (!fetched) {
    throw new Error(
      "No se pudo obtener la tasa automáticamente (dolarapi.com y BCV no respondieron). Ingresa la tasa manualmente.",
    );
  }
  const date = dateOnly(new Date());
  const saved = await db.exchangeRate.upsert({
    where: { date_source: { date, source: "BCV" } },
    update: { vesPerUsd: fetched.toString() },
    create: { date, source: "BCV", vesPerUsd: fetched.toString() },
  });
  return { date: saved.date, source: saved.source, vesPerUsd: new Decimal(saved.vesPerUsd) };
}

/**
 * Lista de tasas registradas (para UI de auditoría).
 */
export async function listRecentRates(limit = 30): Promise<RateInfo[]> {
  const rows = await db.exchangeRate.findMany({
    orderBy: [{ date: "desc" }, { source: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({ date: r.date, source: r.source, vesPerUsd: new Decimal(r.vesPerUsd) }));
}
