/**
 * Seed one-shot: crea las 25 plantillas recurrentes del condominio Los Arrayanes
 * según el PDF de referencia (Aviso de Cobro 001923, Dic 2025).
 *
 * - 15 provisiones (isProvision=true): montos fijos en Bs que cobran cada mes
 *   como estimado, contra los que después se calcula el ajuste real.
 * - 10 gastos recurrentes (isProvision=false): montos fijos en Bs que se
 *   facturan directos cada mes.
 *
 * Idempotente: si la plantilla ya existe (por description), la skipea.
 *
 * Llamada:
 *   curl -X POST https://residia.vercel.app/api/admin/seed-arrayanes-templates \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { verifyBearerToken } from "@/lib/auth-utils";
import { getCurrentRate } from "@/server/services/exchange";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

// Plantillas según el PDF Aviso de Cobro 001923 — Arrayanes Dic 2025
type TemplateSeed = {
  description: string;
  category:
    | "ELECTRICITY" | "WATER" | "GAS" | "INTERNET" | "CLEANING" | "GARDENING"
    | "SECURITY" | "ELEVATOR" | "STAFF_PAYROLL" | "ADMINISTRATION"
    | "INSURANCE" | "REPAIRS" | "RESERVE_FUND" | "TAXES" | "OTHER";
  customCategory?: string;
  amountBss: number; // monto fijo en Bs (currencyPrimary=VES)
  isProvision: boolean;
  towerScope?: "A" | "B" | null;
};

const TEMPLATES: TemplateSeed[] = [
  // ───── Provisiones (15) — montos fijos estimados cada mes ─────
  { description: "Asistente Administrativo",                  category: "STAFF_PAYROLL", amountBss: 12_000,  isProvision: true },
  { description: "Bono Alimentación",                         category: "STAFF_PAYROLL", amountBss: 15_000,  isProvision: true },
  { description: "Servicios Generales $70",                   category: "STAFF_PAYROLL", amountBss: 18_000,  isProvision: true },
  { description: "Servicio Bote Desechos Sólidos",            category: "OTHER",         customCategory: "Bote Desechos Sólidos", amountBss: 3_000,   isProvision: true },
  { description: "Trabajos Varios (Lámparas, Estacionamiento)", category: "REPAIRS",     customCategory: "Trabajos Varios", amountBss: 3_000, isProvision: true },
  { description: "Luz Eléctrica Torres A y B",                category: "ELECTRICITY",   amountBss: 20_000,  isProvision: true },
  { description: "Hidrocapital Torres A y B",                 category: "WATER",         amountBss: 60_000,  isProvision: true },
  { description: "CANTV",                                     category: "INTERNET",      customCategory: "CANTV", amountBss: 630, isProvision: true },
  { description: "Seguridad Externa",                         category: "SECURITY",      customCategory: "Seguridad Externa", amountBss: 35_000, isProvision: true },
  { description: "Servicio Vigilancia Estacionamientos Internos", category: "SECURITY",  customCategory: "Vigilancia Internos", amountBss: 25_000, isProvision: true },
  { description: "Material de Limpieza",                      category: "CLEANING",      customCategory: "Material Limpieza", amountBss: 7_600,  isProvision: true },
  { description: "Material de Ferretería",                    category: "REPAIRS",       customCategory: "Material Ferretería", amountBss: 7_600,  isProvision: true },
  { description: "Comisiones Bancarias",                      category: "OTHER",         customCategory: "Comisiones Bancarias", amountBss: 3_500, isProvision: true },
  { description: "Mantenimiento de Ascensores",               category: "ELEVATOR",      amountBss: 11_000,  isProvision: true },
  { description: "Seguro Social IVSS",                        category: "INSURANCE",     customCategory: "IVSS", amountBss: 50, isProvision: true },

  // ───── Gastos recurrentes (10) — montos fijos mensuales sin ajuste ─────
  { description: "Papelería",                                 category: "ADMINISTRATION", customCategory: "Papelería",      amountBss: 10_904.37,   isProvision: false },
  { description: "Servicios de Jardinería",                   category: "GARDENING",      amountBss: 5_800,                 isProvision: false },
  { description: "Servicios de Mantenimiento y Limpieza (Contratado)", category: "CLEANING", customCategory: "Mantenimiento y Limpieza", amountBss: 109_269.87, isProvision: false },
  { description: "Servicio de Internet VNET",                 category: "INTERNET",       customCategory: "VNET",           amountBss: 7_410.01,    isProvision: false },
  { description: "Gastos Comunes Áreas Externas",             category: "OTHER",          customCategory: "Áreas Externas", amountBss: 16_247.36,   isProvision: false },
  { description: "Sistema Administrativo de Condominio",      category: "ADMINISTRATION", customCategory: "Sistema Admin",  amountBss: 30_148.90,   isProvision: false },
  { description: "Mantenimiento de Cámaras",                  category: "SECURITY",       customCategory: "Cámaras",        amountBss: 50_852.30,   isProvision: false },
  { description: "Bonificación de Fin de Año Personal",       category: "STAFF_PAYROLL",  customCategory: "Bonificación Fin de Año", amountBss: 36_726.66, isProvision: false },
  { description: "Obsequios Navideños para el Personal",      category: "STAFF_PAYROLL",  customCategory: "Obsequios Navideños",     amountBss: 36_164.76, isProvision: false },
  { description: "Fondo de Reserva",                          category: "RESERVE_FUND",   amountBss: 108_456.63, isProvision: false },
];

export async function POST(req: NextRequest) {
  if (!verifyBearerToken(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Locate Los Arrayanes
    const community = await db.community.findFirst({
      where: { name: { contains: "Arrayanes", mode: "insensitive" } },
      select: { id: true, organizationId: true, name: true },
    });
    if (!community) {
      return NextResponse.json({ error: "Comunidad Arrayanes no encontrada" }, { status: 404 });
    }

    // Tasa BCV de hoy para calcular amountUsd derivado
    const rate = await getCurrentRate("BCV");
    const rateNum = Number(rate.vesPerUsd);

    const results: { description: string; status: "created" | "skipped"; id?: string }[] = [];

    for (const tpl of TEMPLATES) {
      // Idempotencia: si ya existe por (communityId, description), skip
      const existing = await db.recurringExpenseTemplate.findFirst({
        where: {
          communityId: community.id,
          description: tpl.description,
        },
      });
      if (existing) {
        results.push({ description: tpl.description, status: "skipped", id: existing.id });
        continue;
      }

      const amountUsd = rateNum > 0 ? tpl.amountBss / rateNum : 0;
      const created = await db.recurringExpenseTemplate.create({
        data: {
          organizationId: community.organizationId,
          communityId: community.id,
          category: tpl.category,
          customCategory: tpl.customCategory ?? null,
          description: tpl.description,
          amountUsd: amountUsd.toFixed(2),
          amountBss: tpl.amountBss.toFixed(2),
          currencyPrimary: "VES",
          towerScope: tpl.towerScope ?? null,
          isProvision: tpl.isProvision,
          active: true,
        },
        select: { id: true },
      });
      results.push({ description: tpl.description, status: "created", id: created.id });
    }

    return NextResponse.json({
      ok: true,
      community: community.name,
      rateUsed: rateNum,
      summary: {
        created: results.filter(r => r.status === "created").length,
        skipped: results.filter(r => r.status === "skipped").length,
        total: results.length,
      },
      results,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
