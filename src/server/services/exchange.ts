import { Decimal } from "decimal.js";
import { db } from "@/server/db/client";
import type { ExchangeSource } from "@prisma/client";
import axios from "axios";
import * as https from "https";
import * as cheerio from "cheerio";

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

/**
 * Obtiene la tasa para una fecha específica.
 *
 * Reglas:
 * - Si `forDate` es hoy o futuro: intenta cache → fetch BCV → fallback a la última disponible.
 * - Si `forDate` es pasado: solo busca tasa cacheada para esa fecha exacta. Si no hay,
 *   busca la tasa BCV/MANUAL más cercana ANTERIOR (no usa la tasa actual). Esto evita
 *   que un pago/gasto retroactivo se registre con una tasa que no existía aún.
 */
export async function getCurrentRate(
  source: ExchangeSource = "BCV",
  forDate: Date = new Date(),
): Promise<RateInfo> {
  const date = dateOnly(forDate);
  const todayStart = dateOnly(new Date());
  const isPastDate = date.getTime() < todayStart.getTime();

  const cached = await db.exchangeRate.findUnique({
    where: { date_source: { date, source } },
  });
  if (cached) {
    return { date: cached.date, source: cached.source, vesPerUsd: new Decimal(cached.vesPerUsd) };
  }

  // Para fechas pasadas, NO hacemos fetch: la API solo devuelve la tasa actual,
  // y guardarla bajo una fecha pasada distorsionaría la histórica.
  if (!isPastDate && source === "BCV") {
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

  // Fallback histórico: para fechas pasadas, la tasa más cercana ANTERIOR o IGUAL a esa fecha.
  // Para fechas presentes/futuras sin cache ni fetch, la última tasa disponible.
  const sourceFallback = source === "BCV" ? { in: ["BCV", "MANUAL"] as ExchangeSource[] } : source;
  const latest = await db.exchangeRate.findFirst({
    where: {
      source: sourceFallback,
      ...(isPastDate ? { date: { lte: date } } : {}),
    },
    orderBy: { date: "desc" },
  });
  if (latest) {
    return { date: latest.date, source: latest.source, vesPerUsd: new Decimal(latest.vesPerUsd) };
  }

  throw new Error(
    `No hay tasa de cambio disponible para ${date.toISOString().slice(0, 10)}. Registra una tasa manualmente en Finanzas → Configuración o presiona "Actualizar desde BCV".`,
  );
}

/**
 * Registra una tasa manual (cuando el admin corrige la tasa automática).
 *
 * IMPORTANTE: sobreescribe también la entrada BCV del día para que
 * getCurrentRate("BCV") devuelva el valor correcto de inmediato.
 * Así, si la API devolvió un valor equivocado, el admin puede corregirlo
 * y todas las transacciones del día usarán la tasa correcta.
 */
export async function setManualRate(
  vesPerUsd: Decimal.Value,
  date: Date = new Date(),
  notes?: string,
): Promise<RateInfo> {
  const d = dateOnly(date);
  const rate = new Decimal(vesPerUsd);
  if (rate.lte(0)) throw new Error("La tasa debe ser mayor que cero");

  // 1. Guardar como MANUAL (historial de entradas manuales del administrador)
  await db.exchangeRate.upsert({
    where: { date_source: { date: d, source: "MANUAL" } },
    update: { vesPerUsd: rate.toString(), notes },
    create: { date: d, source: "MANUAL", vesPerUsd: rate.toString(), notes },
  });

  // 2. Sobreescribir el BCV del día para que getCurrentRate("BCV") lo use
  //    sin volver a llamar a la API externa.
  await db.exchangeRate.upsert({
    where: { date_source: { date: d, source: "BCV" } },
    update: { vesPerUsd: rate.toString(), notes: `Corregido manualmente${notes ? ": " + notes : ""}` },
    create: { date: d, source: "BCV", vesPerUsd: rate.toString(), notes: `Ingresado manualmente` },
  });

  return { date: d, source: "MANUAL", vesPerUsd: rate };
}

/**
 * Fetch BCV oficial — intenta las fuentes en este orden:
 *   1. Scraping directo bcv.org.ve  ← FUENTE PRIMARIA (igual que el proyecto comanda)
 *   2. pydolarve.org                ← Fallback API internacional
 *   3. ve.dolarapi.com              ← Fallback API venezolana
 *
 * open.er-api.com fue removida: no actualiza VES con frecuencia suficiente.
 */
async function fetchBcvRate(): Promise<Decimal | null> {
  const sources = [
    fetchBcvScrape,        // 1° — más precisa, fuente oficial directa
    fetchFromPydolarve,    // 2° — fallback si BCV está inaccesible desde Vercel
    fetchFromDolarApi,     // 3° — fallback adicional
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

// open.er-api.com removida: no actualiza VES con la frecuencia del BCV oficial.

/**
 * Agente HTTPS que ignora el certificado SSL mal configurado del BCV.
 * Igual que en el proyecto comanda (probado en producción).
 */
const bcvHttpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Scraping directo de www.bcv.org.ve — FUENTE PRIMARIA.
 * Usa axios + cheerio (igual que comanda) con SSL bypass para el cert malo del BCV.
 * El BCV usa coma como separador decimal: "490,22510000".
 */
async function fetchBcvScrape(): Promise<Decimal | null> {
  try {
    const response = await axios.get<string>("https://www.bcv.org.ve/", {
      timeout: 15_000,
      httpsAgent: bcvHttpsAgent,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "es-VE,es;q=0.9,en;q=0.5",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
      },
      maxRedirects: 5,
      responseType: "text",
    });

    const $ = cheerio.load(response.data);
    let rateText: string | null = null;

    // 1. Selector principal: div#dolar > strong
    const dolarSection = $("#dolar");
    if (dolarSection.length) {
      dolarSection.find("strong").each((_, el) => {
        const text = $(el).text().trim();
        if (/^\d+,\d+$/.test(text)) rateText = text;
      });
    }

    // 2. Fallback: divs centrados / campos tasa-del-dia
    if (!rateText) {
      $("div.centrado strong, .views-field-field-tasa-del-dia-usd strong, .field-content strong").each((_, el) => {
        const text = $(el).text().trim();
        if (/^\d+,\d+$/.test(text)) rateText = text;
      });
    }

    // 3. Última opción: regex sobre el body completo
    if (!rateText) {
      const body = $("body").text();
      const match = body.match(/USD[\s\S]*?(\d{2,3},\d{4})/);
      if (match?.[1]) rateText = match[1];
    }

    if (!rateText) {
      console.warn("[exchange] BCV scraping: HTML recibido pero no se pudo extraer tasa");
      return null;
    }

    const value = parseFloat(rateText.replace(",", "."));
    if (!isFinite(value) || value < 1 || value > 100_000) {
      console.warn("[exchange] BCV scraping: tasa fuera de rango:", value);
      return null;
    }

    console.info("[exchange] ✓ Tasa BCV obtenida por scraping directo:", value);
    return new Decimal(value);
  } catch (err) {
    console.warn("[exchange] BCV scraping falló:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Expuesta para testing — recibe HTML crudo y retorna número o null. */
export function parseBcvHtml(html: string): number | null {
  const $ = cheerio.load(html);
  let rateText: string | null = null;

  const dolarSection = $("#dolar");
  if (dolarSection.length) {
    dolarSection.find("strong").each((_, el) => {
      const text = $(el).text().trim();
      if (/^\d+,\d+$/.test(text)) rateText = text;
    });
  }
  if (!rateText) {
    $("div.centrado strong, .views-field-field-tasa-del-dia-usd strong, .field-content strong").each((_, el) => {
      const text = $(el).text().trim();
      if (/^\d+,\d+$/.test(text)) rateText = text;
    });
  }
  if (!rateText) {
    const body = $("body").text();
    const match = body.match(/USD[\s\S]*?(\d{2,3},\d{4})/);
    if (match?.[1]) rateText = match[1];
  }
  if (!rateText) return null;
  const value = parseFloat(rateText.replace(",", "."));
  return isFinite(value) && value >= 1 && value <= 100_000 ? value : null;
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
