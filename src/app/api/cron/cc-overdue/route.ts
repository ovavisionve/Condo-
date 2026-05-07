/**
 * Cron — marcar facturas de Centro Comercial como OVERDUE
 * Corre diariamente a las 8:05 AM (UTC).
 * Busca facturas ISSUED o PARTIAL con dueDate < now y las marca OVERDUE.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Verificar CRON_SECRET con comparación timing-safe
  const { verifyBearerToken } = await import("@/lib/auth-utils");
  if (!verifyBearerToken(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();

    const result = await db.ccInvoice.updateMany({
      where: {
        status: { in: ["ISSUED", "PARTIAL"] },
        dueDate: { lt: now },
      },
      data: { status: "OVERDUE" },
    });

    return NextResponse.json({
      ok: true,
      markedOverdue: result.count,
      runAt: now.toISOString(),
    });
  } catch (err) {
    console.error("[cron/cc-overdue]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
