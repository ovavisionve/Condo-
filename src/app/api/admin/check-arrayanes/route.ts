/**
 * Verificación de seguridad: estado actual de Los Arrayanes.
 * Confirma que el reset de Castaños B NO tocó Arrayanes.
 * Eliminar después.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Buscar comunidades por nombre
  const communities = await db.community.findMany({
    where: { name: { contains: "rrayan", mode: "insensitive" } },
    select: {
      id: true, name: true, organizationId: true,
      _count: {
        select: {
          units: true,
          expenses: true,
          recurringExpenseTemplates: true,
        },
      },
    },
  });

  const result: Array<Record<string, unknown>> = [];
  for (const c of communities) {
    const [activeUnits, ownerships, invoices, payments, templates, expenses] = await Promise.all([
      db.unit.count({ where: { communityId: c.id, active: true, deletedAt: null } }),
      db.ownership.count({ where: { unit: { communityId: c.id }, endDate: null } }),
      db.invoice.count({ where: { communityId: c.id, status: { not: "VOIDED" } } }),
      db.payment.count({ where: { communityId: c.id, voidedAt: null } }),
      db.recurringExpenseTemplate.findMany({
        where: { communityId: c.id, active: true },
        select: { description: true, isProvision: true, amountUsd: true, amountBss: true },
      }),
      db.expense.count({ where: { communityId: c.id, voidedAt: null } }),
    ]);
    result.push({
      community: c.name,
      communityId: c.id,
      activeUnits,
      activeOwnerships: ownerships,
      activeInvoices: invoices,
      activePayments: payments,
      activeExpenses: expenses,
      templates: templates.map((t) => ({
        desc: t.description,
        isProvision: t.isProvision,
        usd: t.amountUsd.toString(),
        bss: t.amountBss?.toString() ?? null,
      })),
    });
  }

  return NextResponse.json({ ok: true, arrayanesCommunities: result });
}
