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
 * Fetch BCV oficial — intenta cuatro fuentes en orden:
 *   1. pydolarve.org        (API internacional, confiable desde Vercel/US)
 *   2. ve.dolarapi.com      (API venezolana, a veces bloqueada desde US)
 *   3. exchangerate.host    (API general con VES)
 *   4. Scraping directo BCV (funciona en redes venezolanas)
 */
async function fetchBcvRate(): Promise<Decimal | null> {
  const sources = [
    fetchFromPydolarve,
    fetchFromDolarApi,
    fetchFromExchangeRateHost,
    fetchBcvScrape,
  ];
  for (const fn of sources) {
    const result = await fn();
    if (result) return result;
  }
  return null;
}

/** pydolarve.org — funciona bien desde servidores internacionales */
async function fetchFromPydolarve(): Promise<Decimal | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch("https://pydolarve.org/api/v1/dollar?monitor=bcv", {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "Condominios/1.0" },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { price?: number; monitors?: { bcv?: { price?: number } } };
      const value = data.price ?? data.monitors?.bcv?.price;
      if (!value || !isFinite(value) || value < 1) return null;
      console.info("[exchange] Tasa BCV de pydolarve.org:", value);
      return new Decimal(value);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn("[exchange] pydolarve.org falló:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** ve.dolarapi.com — API venezolana pública */
async function fetchFromDolarApi(): Promise<Decimal | null> {
  const endpoints = [
    "https://ve.dolarapi.com/v1/dolares/oficial",
    "https://ve.dolarapi.com/v1/dolares",
  ];
  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) continue;
        const raw = await res.json();
        // Puede ser objeto único o array de tasas
        const item = Array.isArray(raw)
          ? (raw as { nombre?: string; promedio?: number; promedioVenta?: number }[]).find(
              (d) => d.nombre?.toLowerCase().includes("oficial") || d.nombre?.toLowerCase().includes("bcv"),
            ) ?? raw[0]
          : (raw as { promedio?: number; promedioVenta?: number });
        const value = (item as { promedio?: number; promedioVenta?: number })?.promedio
          ?? (item as { promedio?: number; promedioVenta?: number })?.promedioVenta;
        if (!value || !isFinite(value) || value < 1) continue;
        console.info("[exchange] Tasa BCV de dolarapi.com:", value);
        return new Decimal(value);
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.warn("[exchange] dolarapi.com falló:", err instanceof Error ? err.message : err);
    }
  }
  return null;
}

/** exchangerate.host — API general con cobertura de VES */
async function fetchFromExchangeRateHost(): Promise<Decimal | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { rates?: Record<string, number>; result?: string };
      if (data.result !== "success") return null;
      const value = data.rates?.VES;
      if (!value || !isFinite(value) || value < 1) return null;
      console.info("[exchange] Tasa VES/USD de open.er-api.com:", value);
      return new Decimal(value);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn("[exchange] open.er-api.com falló:", err instanceof Error ? err.message : err);
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
  // Patrón 1: bloque div#dolar exacto
  const blockMatch = html.match(/id=["']dolar["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
  const block = blockMatch
    ? blockMatch[0]
    : (() => {
        const idx = html.indexOf('id="dolar"');
        return idx >= 0 ? html.slice(idx, idx + 800) : null;
      })();

  if (block) {
    const match = block.match(/(\d{2,6}[,.](\d{2,10}))/);
    if (match) {
      const value = parseFloat((match[1] ?? "").replace(",", "."));
      if (isFinite(value) && value >= 1 && value <= 100_000) return value;
    }
  }

  // Patrón 2: buscar strong con número grande en contexto "dolar"/"USD" (HTML puede cambiar)
  const allNums = [...html.matchAll(/<strong[^>]*>(\d{2,6}[,.](\d{5,10}))<\/strong>/g)];
  for (const m of allNums) {
    const value = parseFloat((m[1] ?? "").replace(",", "."));
    if (!isFinite(value) || value < 1 || value > 100_000) continue;
    const idx = html.indexOf(m[0]);
    const ctx = html.slice(Math.max(0, idx - 600), idx + 100).toLowerCase();
    if (ctx.includes("dolar") || ctx.includes("usd") || ctx.includes("divisa")) return value;
  }

  return null;
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
