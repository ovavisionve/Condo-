import { NextResponse } from "next/server";
import { refreshBcvRate } from "@/server/services/exchange";
import { verifyBearerToken } from "@/lib/auth-utils";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Cron horario: actualiza la tasa BCV.
 * Usa refreshBcvRate() en lugar de getCurrentRate() para FORZAR el refetch
 * y no caer en cache (que devuelve la última guardada). Esto permite captar
 * actualizaciones del BCV durante el día (el BCV a veces publica varias
 * veces antes del cierre).
 *
 * Pedido del cliente: la tasa a veces no se actualiza diariamente — al correr
 * cada hora aumentamos la probabilidad de capturarla el mismo día que el BCV
 * la publica.
 */
export async function GET(request: Request) {
  // Proteger el endpoint — solo Vercel Cron puede llamarlo
  if (
    process.env.NODE_ENV === "production" &&
    !verifyBearerToken(request.headers.get("authorization"), process.env.CRON_SECRET)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rate = await refreshBcvRate();
    return NextResponse.json({
      ok: true,
      date: rate.date,
      vesPerUsd: rate.vesPerUsd.toString(),
      source: rate.source,
      ranAt: new Date().toISOString(),
    });
  } catch (err) {
    // Fallar el refresh no es crítico (queda la tasa anterior). Logueamos
    // pero respondemos 200 para que Vercel no marque el cron como fallido
    // en su dashboard cuando BCV está caído.
    console.error("[cron/bcv] refresh falló:", err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
      ranAt: new Date().toISOString(),
    });
  }
}
