import { NextResponse } from "next/server";
import { getCurrentRate } from "@/server/services/exchange";
import { verifyBearerToken } from "@/lib/auth-utils";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Proteger el endpoint — solo Vercel Cron puede llamarlo
  if (
    process.env.NODE_ENV === "production" &&
    !verifyBearerToken(request.headers.get("authorization"), process.env.CRON_SECRET)
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
