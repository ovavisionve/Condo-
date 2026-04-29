import { NextResponse } from "next/server";
import { getCurrentRate } from "@/server/services/exchange";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Proteger el endpoint — solo Vercel Cron puede llamarlo
  const authHeader = request.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rate = await getCurrentRate("BCV");
    return NextResponse.json({
      ok: true,
      date: rate.date,
      vesPerUsd: rate.vesPerUsd.toString(),
      source: rate.source,
    });
  } catch (err) {
    console.error("[cron/bcv] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
