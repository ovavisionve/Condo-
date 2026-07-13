/**
 * Servicio Gemini AI — Function Calling con acceso completo al sistema.
 * Cubre TODOS los módulos: residencial y comercial.
 * SDK: @google/genai  |  Modelo: gemini-2.5-flash
 */

import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import type { Content, Tool, FunctionDeclaration } from "@google/genai";
import { db } from "@/server/db/client";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type ChatModule = "residential" | "commercial";

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface GeminiChatInput {
  organizationId: string;
  module: ChatModule;
  history: ChatMessage[];
  message: string;
}

// ─── Cliente y utilidades ─────────────────────────────────────────────────────

function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY no configurada");
  return new GoogleGenAI({ apiKey: key });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if ((status === 429 || (status && status >= 500)) && attempt < maxRetries) {
        await sleep(delay);
        delay = Math.min(delay * 2, 60_000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries reached");
}

// Shorthand: where clause any-typed (Prisma strict union types don't support dynamic composition)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWhere = any;

// ─── DECLARACIONES — MÓDULO RESIDENCIAL ──────────────────────────────────────

const RESIDENTIAL_TOOLS: FunctionDeclaration[] = [
  // ── Finanzas ──
  {
    name: "get_financial_summary",
    description: "Resumen financiero: total facturado, cobrado, pendiente, % cobranza, facturas vencidas. Filtrable por comunidad.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
      },
    },
  },
  {
    name: "get_top_debtors",
    description: "Lista las unidades con mayor deuda pendiente ordenadas de mayor a menor.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
        limit: { type: "number", description: "Máximo de resultados (default 10)." },
      },
    },
  },
  {
    name: "get_invoices",
    description: "Lista facturas. Filtrable por estado (DRAFT/ISSUED/PARTIAL/PAID/OVERDUE/VOIDED), mes (YYYY-MM), comunidad.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        status: { type: "string", enum: ["DRAFT","ISSUED","PARTIAL","PAID","OVERDUE","VOIDED"], description: "Estado (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
        unitCode: { type: "string", description: "Código de unidad, ej: 163B o B-052 (opcional)." },
        limit: { type: "number", description: "Máximo (default 20)." },
      },
    },
  },
  {
    name: "get_recent_payments",
    description: "Lista los pagos más recientes registrados en el sistema.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        unitCode: { type: "string", description: "Código de unidad (opcional)." },
        limit: { type: "number", description: "Cantidad de resultados (default 10)." },
      },
    },
  },
  {
    name: "get_expense_summary",
    description: "Resumen de gastos comunes: total y desglose por categoría. Filtrable por mes, comunidad y torre.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
        towerScope: { type: "string", description: "Torre: 'A', 'B' para filtrar por alcance de torre. Omitir para ver todos (opcional)." },
      },
    },
  },
  {
    name: "get_incomes",
    description: "Lista ingresos extra (alquiler de salón, estacionamiento, eventos, donaciones, etc.) con totales.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
      },
    },
  },
  {
    name: "get_budget",
    description: "Presupuesto anual: total aprobado y desglose por categoría.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de la comunidad." },
        year: { type: "number", description: "Año (default: año actual)." },
      },
    },
  },
  {
    name: "get_bank_accounts",
    description: "Lista las cuentas bancarias registradas de la organización o comunidad.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
      },
    },
  },
  {
    name: "get_unidentified_payments",
    description: "Pagos bancarios recibidos que aún no se han identificado ni asignado a una unidad.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        limit: { type: "number", description: "Máximo (default 15)." },
      },
    },
  },
  {
    name: "get_exchange_rate",
    description: "Tasa de cambio USD/VES más reciente registrada en el sistema (BCV u otra fuente).",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  // ── Unidades y Residentes ──
  {
    name: "get_communities",
    description: "Lista los edificios/comunidades de la organización con datos básicos.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_units",
    description: "Lista unidades con sus residentes actuales. Filtra por piso, torre, comunidad o código. Úsala para preguntas como '¿quién vive en el piso X?'.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
        floor: { type: "number", description: "Piso (opcional)." },
        tower: { type: "string", description: "Torre: 'A', 'B', etc. (opcional)." },
        unitCode: { type: "string", description: "Código exacto, ej: 163B o B-052 (opcional)." },
        limit: { type: "number", description: "Máximo (default 30)." },
      },
    },
  },
  {
    name: "get_unit_detail",
    description: "Detalle completo de una unidad: propietarios, inquilinos, vehículos, últimas facturas, últimos pagos, órdenes de mantenimiento activas.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        unitCode: { type: "string", description: "Código de la unidad, ej: 163B o B-052." },
        communityId: { type: "string", description: "ID de comunidad (opcional si el código es único)." },
      },
      required: ["unitCode"],
    },
  },
  {
    name: "search_resident",
    description: "Busca residentes (propietarios o inquilinos) por nombre, apellido, cédula o email.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Nombre, cédula o email." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_vehicles",
    description: "Lista vehículos registrados en el sistema. Filtrable por comunidad o persona.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        query: { type: "string", description: "Buscar por placa, marca, modelo o nombre del propietario (opcional)." },
        limit: { type: "number", description: "Máximo (default 20)." },
      },
    },
  },
  // ── Mantenimiento ──
  {
    name: "get_work_orders",
    description: "Lista órdenes de mantenimiento (tickets). Filtrable por estado, prioridad, comunidad.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        status: { type: "string", enum: ["OPEN","ASSIGNED","IN_PROGRESS","COMPLETED","CANCELLED"], description: "Estado (opcional)." },
        priority: { type: "string", enum: ["LOW","MEDIUM","HIGH","URGENT"], description: "Prioridad (opcional)." },
        limit: { type: "number", description: "Máximo (default 15)." },
      },
    },
  },
  {
    name: "get_contractors",
    description: "Lista contratistas registrados con su especialidad y calificación.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        specialty: { type: "string", description: "Filtrar por especialidad (opcional)." },
      },
    },
  },
  // ── Seguridad ──
  {
    name: "get_violations",
    description: "Lista infracciones al reglamento del condominio. Filtrable por comunidad o estado.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        resolved: { type: "boolean", description: "true=resueltas, false=pendientes, omitir=todas." },
        limit: { type: "number", description: "Máximo (default 15)." },
      },
    },
  },
  {
    name: "get_visitors",
    description: "Lista visitantes pre-autorizados recientes o activos.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Filtrar por comunidad (opcional)." },
        status: { type: "string", enum: ["PENDING","CHECKED_IN","CHECKED_OUT","EXPIRED","DENIED"], description: "Estado (opcional)." },
        limit: { type: "number", description: "Máximo (default 15)." },
      },
    },
  },
  // ── Gobernanza ──
  {
    name: "get_board_members",
    description: "Lista los miembros de la junta directiva activos o históricos.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad." },
        activeOnly: { type: "boolean", description: "true=solo vigentes (default true)." },
      },
    },
  },
  {
    name: "get_assemblies",
    description: "Lista asambleas de propietarios: programadas, en curso o cerradas.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
        status: { type: "string", enum: ["SCHEDULED","IN_PROGRESS","CLOSED","CANCELLED"], description: "Estado (opcional)." },
        limit: { type: "number", description: "Máximo (default 10)." },
      },
    },
  },
  // ── Amenidades ──
  {
    name: "get_common_areas",
    description: "Lista las áreas comunes y amenidades del edificio (piscina, salón de fiestas, gym, etc.).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad." },
      },
    },
  },
  {
    name: "get_reservations",
    description: "Lista reservas de áreas comunes. Filtrable por área, estado o fecha.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
        status: { type: "string", enum: ["PENDING","APPROVED","CANCELLED","COMPLETED"], description: "Estado (opcional)." },
        limit: { type: "number", description: "Máximo (default 15)." },
      },
    },
  },
  // ── Comunicación ──
  {
    name: "get_announcements",
    description: "Lista anuncios publicados en el tablero de la comunidad.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
        limit: { type: "number", description: "Máximo (default 10)." },
      },
    },
  },
  {
    name: "get_community_documents",
    description: "Lista documentos del repositorio de la comunidad (actas, reglamentos, certificados, etc.).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad." },
        category: { type: "string", description: "Categoría (opcional)." },
        limit: { type: "number", description: "Máximo (default 15)." },
      },
    },
  },
  // ── Nuevas funciones de cobertura completa ──
  {
    name: "get_expenses",
    description: "Lista gastos comunes individuales con doble moneda. Filtrable por mes, torre, categoría, estado (facturado/pendiente) y si es cargo individual a una unidad.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
        towerScope: { type: "string", description: "Torre: 'A', 'B', o null para gastos generales (opcional)." },
        category: { type: "string", description: "Categoría, ej: ELECTRICITY, REPAIRS, OTHER (opcional)." },
        invoiced: { type: "boolean", description: "true=solo facturados, false=solo pendientes, omitir=todos (opcional)." },
        isIndividual: { type: "boolean", description: "true=solo cargos individuales a una unidad (opcional)." },
        limit: { type: "number", description: "Máximo (default 25)." },
      },
    },
  },
  {
    name: "get_recurring_templates",
    description: "Lista las plantillas de gastos recurrentes configuradas (gastos fijos mensuales como electricidad, nómina, etc.).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
        activeOnly: { type: "boolean", description: "true=solo activas (default true)." },
      },
    },
  },
  {
    name: "get_access_log",
    description: "Log de accesos al condominio: entradas y salidas de visitantes walk-in y pre-autorizados. Soporta un día específico (date) O un rango (dateFrom/dateTo) para semanas, meses, etc.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
        direction: { type: "string", enum: ["IN","OUT"], description: "Dirección: IN=entradas, OUT=salidas (opcional)." },
        unitCode: { type: "string", description: "Filtrar por código de unidad, ej: 163B o B-052 (opcional)." },
        date: { type: "string", description: "Día exacto YYYY-MM-DD (omitir si usas dateFrom/dateTo). Default: hoy." },
        dateFrom: { type: "string", description: "Inicio del rango YYYY-MM-DD (para semanas, meses, etc.)." },
        dateTo: { type: "string", description: "Fin del rango YYYY-MM-DD (inclusive)." },
        onlyWalkIn: { type: "boolean", description: "true=solo visitas sin pre-autorización, false=solo pre-autorizados, omitir=todos." },
        limit: { type: "number", description: "Máximo registros a devolver (default 50 para rangos, 20 para día)." },
      },
    },
  },
  {
    name: "get_month_close_status",
    description: "Estado del cierre contable mensual de una comunidad. Indica si el mes está cerrado o abierto.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad." },
        month: { type: "string", description: "Mes YYYY-MM (default: mes actual)." },
      },
    },
  },
  {
    name: "get_aging",
    description: "Aging de cartera de deuda: desglose de facturas vencidas en rangos 0-30, 31-60, 61-90 y más de 90 días. Muestra monto total y cantidad de unidades por rango.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "ID de comunidad (opcional)." },
      },
    },
  },
  {
    name: "get_exchange_rate_history",
    description: "Historial de tasas de cambio USD/VES registradas, ordenadas de más reciente a más antigua.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Cantidad de registros (default 10)." },
      },
    },
  },
];

// ─── DECLARACIONES — MÓDULO COMERCIAL ─────────────────────────────────────────

const COMMERCIAL_TOOLS: FunctionDeclaration[] = [
  // ── Resumen y Malls ──
  {
    name: "get_malls",
    description: "Lista los centros comerciales de la organización.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_commercial_summary",
    description: "Resumen del centro comercial: total de locales, ocupación, facturado, cobrado, pendiente, % cobranza.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional si hay uno solo)." },
      },
    },
  },
  // ── Locales ──
  {
    name: "get_locals",
    description: "Lista locales del mall. Filtrable por piso, ala (wing), tipo, estado de ocupación.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        floor: { type: "number", description: "Número de piso (opcional)." },
        wing: { type: "string", description: "Ala o sector, ej: 'Norte', 'Sur' (opcional)." },
        type: { type: "string", enum: ["LOCAL","ANCORA","FOOD_COURT","RESTAURANT","BANCO","CINE","QUIOSCO","OFICINA","OTHER"], description: "Tipo (opcional)." },
        vacant: { type: "boolean", description: "true=solo vacíos, false=solo ocupados, omitir=todos." },
        limit: { type: "number", description: "Máximo (default 30)." },
      },
    },
  },
  {
    name: "get_local_details",
    description: "Detalle completo de un local: arrendatario actual, canon, historial reciente de facturas y pagos, saldo.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        localCode: { type: "string", description: "Código del local, ej: L-101." },
        localId: { type: "string", description: "ID del local (alternativo al código)." },
      },
    },
  },
  {
    name: "get_local_tenancy_history",
    description: "Historial completo de arrendatarios de un local (contratos pasados y vigente).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        localCode: { type: "string", description: "Código del local, ej: L-101." },
        localId: { type: "string", description: "ID del local (alternativo)." },
      },
    },
  },
  // ── Arrendatarios ──
  {
    name: "search_tenant",
    description: "Busca arrendatarios activos por nombre, RIF, email o nombre del contacto.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto a buscar." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_commercial_debtors",
    description: "Lista locales con deuda pendiente (saldo negativo), ordenados de mayor a menor deuda.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        limit: { type: "number", description: "Máximo (default 10)." },
      },
    },
  },
  // ── Finanzas Comerciales ──
  {
    name: "get_commercial_invoices",
    description: "Lista facturas del CC. Filtrable por estado, mes, mall o local.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "Filtrar por mall (opcional)." },
        status: { type: "string", enum: ["DRAFT","ISSUED","PARTIAL","PAID","OVERDUE","VOIDED"], description: "Estado (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
        localCode: { type: "string", description: "Código de local (opcional)." },
        limit: { type: "number", description: "Máximo (default 20)." },
      },
    },
  },
  {
    name: "get_commercial_payments",
    description: "Lista pagos del CC. Filtrable por mall o local.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "Filtrar por mall (opcional)." },
        localCode: { type: "string", description: "Código de local (opcional)." },
        limit: { type: "number", description: "Máximo (default 15)." },
      },
    },
  },
  {
    name: "get_commercial_expenses",
    description: "Gastos comunes del mall: total y desglose por categoría. Filtrable por mes.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
      },
    },
  },
  {
    name: "get_commercial_incomes",
    description: "Ingresos extra del mall (publicidad, estacionamiento, eventos, etc.).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
      },
    },
  },
  {
    name: "get_sales_declarations",
    description: "Declaraciones de ventas de arrendatarios con canon variable. Filtrable por mes o local.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
        localCode: { type: "string", description: "Código del local (opcional)." },
        verified: { type: "boolean", description: "true=solo verificadas, false=solo pendientes, omitir=todas." },
        limit: { type: "number", description: "Máximo (default 20)." },
      },
    },
  },
  {
    name: "get_month_close_status",
    description: "Estado del cierre mensual del mall: si está cerrado, quién lo cerró y cuándo.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional, default mes actual)." },
      },
    },
  },
  {
    name: "get_exchange_rate",
    description: "Tasa de cambio USD/VES más reciente registrada en el sistema.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_exchange_rate_history",
    description: "Historial de tasas de cambio USD/VES registradas, ordenadas de más reciente a más antigua.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Cantidad de registros (default 10)." },
      },
    },
  },
  {
    name: "get_cc_expense_list",
    description: "Lista gastos comunes individuales del mall con doble moneda. Filtrable por mes, categoría, estado (facturado/pendiente) y si es cargo individual a un local.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        month: { type: "string", description: "Mes YYYY-MM (opcional)." },
        category: { type: "string", description: "Categoría, ej: ELECTRICIDAD, SEGURIDAD, OTHER (opcional)." },
        invoiced: { type: "boolean", description: "true=solo facturados, false=solo pendientes, omitir=todos (opcional)." },
        isIndividual: { type: "boolean", description: "true=solo cargos individuales a un local (opcional)." },
        limit: { type: "number", description: "Máximo (default 25)." },
      },
    },
  },
  {
    name: "get_cc_aging",
    description: "Aging de cartera del centro comercial: desglose de deuda vencida por rango de días (0-30, 31-60, 61-90, 90+), con monto y cantidad de locales por rango.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
      },
    },
  },
  {
    name: "get_marketing_events",
    description: "Lista eventos de marketing y activaciones del centro comercial (ferias, fechas especiales, shows, etc.). Filtrable por estado y si son próximos o pasados.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        status: { type: "string", enum: ["PLANNED","ACTIVE","COMPLETED","CANCELLED"], description: "Estado del evento (opcional)." },
        upcoming: { type: "boolean", description: "true=solo eventos futuros, false=solo pasados, omitir=todos." },
        limit: { type: "number", description: "Máximo (default 15)." },
      },
    },
  },
  {
    name: "get_expiring_tenancies",
    description: "Lista contratos de arrendamiento que vencen próximamente (por defecto en los próximos 90 días). Útil para anticipar renovaciones.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        daysAhead: { type: "number", description: "Días hacia el futuro a considerar (default 90)." },
      },
    },
  },
  {
    name: "get_cc_month_close_list",
    description: "Lista el historial de cierres mensuales contables del centro comercial.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        mallId: { type: "string", description: "ID del mall (opcional)." },
        limit: { type: "number", description: "Máximo registros (default 12)." },
      },
    },
  },
];

// ─── IMPLEMENTACIONES — RESIDENCIAL ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runResidentialFunction(name: string, args: Record<string, unknown>, organizationId: string): Promise<unknown> {
  switch (name) {

    case "get_financial_summary": {
      const communityId = args.communityId as string | undefined;
      const invWhere: AnyWhere = communityId
        ? { communityId, organizationId, status: { not: "VOIDED" } }
        : { organizationId, status: { not: "VOIDED" } };

      // Usar solo invoices: paidUsd es lo realmente asignado a cada factura.
      // Evitamos payments.amountUsd que incluye anticipos y distorsiona collectionRate.
      const invoices = await db.invoice.findMany({ where: invWhere, select: { totalUsd: true, paidUsd: true, status: true } });

      const totalInvoiced = invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
      const totalAllocated = invoices.reduce((s, i) => s + Number(i.paidUsd), 0);
      const totalPending = invoices
        .filter(i => i.status !== "PAID" && i.status !== "VOIDED")
        .reduce((s, i) => s + (Number(i.totalUsd) - Number(i.paidUsd)), 0);
      const byStatus: Record<string, number> = {};
      for (const i of invoices) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;

      return {
        totalInvoicedUsd: totalInvoiced.toFixed(2),
        totalCollectedUsd: totalAllocated.toFixed(2),
        totalPendingUsd: totalPending.toFixed(2),
        collectionRate: totalInvoiced > 0 ? ((totalAllocated / totalInvoiced) * 100).toFixed(1) + "%" : "N/A",
        invoicesByStatus: byStatus,
      };
    }

    case "get_top_debtors": {
      const communityId = args.communityId as string | undefined;
      const limit = Number(args.limit ?? 10);
      const units = await db.unit.findMany({
        where: communityId ? { communityId, organizationId } : { organizationId },
        select: {
          code: true, floor: true, tower: true,
          community: { select: { name: true } },
          invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true } },
          ownerships: { where: { endDate: null }, take: 1, select: { person: { select: { firstName: true, lastName: true } } } },
        },
      });
      return units
        .map(u => ({
          unit: u.code,
          floor: u.floor,
          tower: u.tower,
          community: u.community.name,
          owner: u.ownerships[0]?.person ? `${u.ownerships[0].person.firstName} ${u.ownerships[0].person.lastName}` : "Sin propietario",
          debtUsd: u.invoices.reduce((s, i) => s + Number(i.totalUsd) - Number(i.paidUsd), 0).toFixed(2),
        }))
        .filter(u => Number(u.debtUsd) > 0.01)
        .sort((a, b) => Number(b.debtUsd) - Number(a.debtUsd))
        .slice(0, limit);
    }

    case "get_invoices": {
      const communityId = args.communityId as string | undefined;
      const status = args.status as string | undefined;
      const month = args.month as string | undefined;
      const unitCode = args.unitCode as string | undefined;
      const limit = Number(args.limit ?? 20);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (status) where.status = status;
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      if (unitCode) where.unit = { code: { equals: unitCode, mode: "insensitive" } };
      const invoices = await db.invoice.findMany({
        where, orderBy: { issuedAt: "desc" }, take: limit,
        select: {
          invoiceNumber: true, totalUsd: true, paidUsd: true, status: true, issuedAt: true, dueDate: true, periodYear: true, periodMonth: true, type: true,
          unit: { select: { code: true, community: { select: { name: true } } } },
        },
      });
      return invoices.map(i => ({
        invoiceNumber: i.invoiceNumber,
        unit: i.unit.code,
        community: i.unit.community.name,
        period: `${i.periodYear}-${String(i.periodMonth).padStart(2, "0")}`,
        type: i.type,
        totalUsd: Number(i.totalUsd).toFixed(2),
        paidUsd: Number(i.paidUsd).toFixed(2),
        pendingUsd: (Number(i.totalUsd) - Number(i.paidUsd)).toFixed(2),
        status: i.status,
        issued: i.issuedAt.toISOString().split("T")[0],
        due: i.dueDate.toISOString().split("T")[0],
      }));
    }

    case "get_recent_payments": {
      const communityId = args.communityId as string | undefined;
      const unitCode = args.unitCode as string | undefined;
      const limit = Number(args.limit ?? 10);
      const where: AnyWhere = communityId ? { communityId, organizationId, voidedAt: null } : { organizationId, voidedAt: null };
      if (unitCode) where.unit = { code: { equals: unitCode, mode: "insensitive" } };
      const payments = await db.payment.findMany({
        where, orderBy: { paidAt: "desc" }, take: limit,
        select: {
          amountUsd: true, amountBss: true, method: true, reference: true, paidAt: true, notes: true,
          unit: { select: { code: true, community: { select: { name: true } } } },
        },
      });
      return payments.map(p => ({
        unit: p.unit.code,
        community: p.unit.community.name,
        amountUsd: Number(p.amountUsd).toFixed(2),
        amountBss: Number(p.amountBss).toFixed(2),
        method: p.method,
        reference: p.reference,
        date: p.paidAt.toISOString().split("T")[0],
        notes: p.notes,
      }));
    }

    case "get_expense_summary": {
      const communityId = args.communityId as string | undefined;
      const month = args.month as string | undefined;
      const towerScope = args.towerScope as string | undefined;
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      if (towerScope !== undefined) where.towerScope = towerScope === "null" || towerScope === "" ? null : towerScope;
      const expenses = await db.expense.findMany({ where, select: { amountUsd: true, category: true, customCategory: true, description: true, invoicedAt: true } });
      const total = expenses.reduce((s, e) => s + Number(e.amountUsd), 0);
      const byCategory: Record<string, number> = {};
      for (const e of expenses) { const cat = e.customCategory ?? e.category; byCategory[cat] = (byCategory[cat] ?? 0) + Number(e.amountUsd); }
      return {
        totalUsd: total.toFixed(2),
        count: expenses.length,
        invoiced: expenses.filter(e => e.invoicedAt).length,
        pending: expenses.filter(e => !e.invoicedAt).length,
        byCategory: Object.entries(byCategory).sort(([,a],[,b]) => b-a).map(([cat, amt]) => ({ category: cat, amountUsd: amt.toFixed(2) })),
      };
    }

    case "get_incomes": {
      const communityId = args.communityId as string | undefined;
      const month = args.month as string | undefined;
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      const incomes = await db.income.findMany({
        where, orderBy: { createdAt: "desc" },
        select: { amountUsd: true, category: true, customCategory: true, description: true, reference: true, affectsInvoice: true, periodYear: true, periodMonth: true, community: { select: { name: true } } },
      });
      const total = incomes.reduce((s, i) => s + Number(i.amountUsd), 0);
      return {
        totalUsd: total.toFixed(2),
        count: incomes.length,
        items: incomes.map(i => ({
          community: i.community.name,
          category: i.customCategory ?? i.category,
          description: i.description,
          amountUsd: Number(i.amountUsd).toFixed(2),
          period: `${i.periodYear}-${String(i.periodMonth).padStart(2, "0")}`,
          affectsInvoice: i.affectsInvoice,
          reference: i.reference,
        })),
      };
    }

    case "get_budget": {
      const communityId = args.communityId as string | undefined;
      const year = Number(args.year ?? new Date().getFullYear());
      const where: AnyWhere = communityId ? { communityId, organizationId, year } : { organizationId, year };
      const budget = await db.budget.findFirst({
        where,
        include: { items: true },
      });
      if (!budget) return { message: `No hay presupuesto registrado para ${year}.` };
      return {
        year: budget.year,
        status: budget.status,
        totalUsd: Number(budget.totalUsd).toFixed(2),
        approvedAt: budget.approvedAt?.toISOString().split("T")[0] ?? null,
        items: budget.items.map(i => ({ category: i.category, amountUsd: Number(i.amountUsd).toFixed(2), notes: i.notes })),
      };
    }

    case "get_bank_accounts": {
      const communityId = args.communityId as string | undefined;
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      const accounts = await db.bankAccount.findMany({ where, select: { bankName: true, accountNumber: true, accountHolder: true, accountType: true, currency: true, active: true } });
      return accounts;
    }

    case "get_unidentified_payments": {
      const communityId = args.communityId as string | undefined;
      const limit = Number(args.limit ?? 15);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      const items = await db.unidentifiedPayment.findMany({
        where, orderBy: { bankDate: "desc" }, take: limit,
        select: { bankDate: true, bankRef: true, bankAmountUsd: true, bankDescription: true, assignedAt: true, notes: true },
      });
      return items.map(i => ({
        date: i.bankDate,
        reference: i.bankRef,
        amountUsd: Number(i.bankAmountUsd).toFixed(2),
        description: i.bankDescription,
        status: i.assignedAt ? "Asignado" : "Pendiente",
      }));
    }

    case "get_exchange_rate": {
      const rate = await db.exchangeRate.findFirst({ orderBy: { date: "desc" } });
      if (!rate) return { message: "No hay tasas de cambio registradas." };
      return {
        date: rate.date.toISOString().split("T")[0],
        vesPerUsd: Number(rate.vesPerUsd).toFixed(4),
        source: rate.source,
      };
    }

    case "get_communities": {
      const communities = await db.community.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, name: true, city: true, active: true, totalUnits: true, floorsCount: true, towersCount: true, monthlyFeeUsd: true, dueDaysAfterIssue: true, phone: true, email: true },
        orderBy: { name: "asc" },
      });
      return communities.map(c => ({ ...c, monthlyFeeUsd: c.monthlyFeeUsd ? Number(c.monthlyFeeUsd).toFixed(2) : null }));
    }

    case "get_units": {
      const communityId = args.communityId as string | undefined;
      const floor = args.floor !== undefined ? Number(args.floor) : undefined;
      const tower = args.tower as string | undefined;
      const unitCode = args.unitCode as string | undefined;
      const limit = Number(args.limit ?? 30);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (floor !== undefined) where.floor = floor;
      if (tower) where.tower = { equals: tower, mode: "insensitive" };
      if (unitCode) where.code = { equals: unitCode, mode: "insensitive" };
      const units = await db.unit.findMany({
        where, orderBy: [{ tower: "asc" }, { floor: "asc" }, { code: "asc" }], take: limit,
        select: {
          code: true, floor: true, tower: true, type: true, aliquot: true,
          community: { select: { name: true } },
          ownerships: { where: { endDate: null }, take: 2, select: { person: { select: { firstName: true, lastName: true, phone: true, email: true } }, sharePercent: true } },
          tenancies: { where: { endDate: null }, take: 1, select: { person: { select: { firstName: true, lastName: true, phone: true } } } },
          invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true } },
        },
      });
      return units.map(u => {
        const debt = u.invoices.reduce((s, i) => s + Number(i.totalUsd) - Number(i.paidUsd), 0);
        return {
          unit: u.code,
          floor: u.floor,
          tower: u.tower,
          type: u.type,
          community: u.community.name,
          aliquot: Number(u.aliquot).toFixed(4) + "%",
          owners: u.ownerships.map(o => ({ name: `${o.person.firstName} ${o.person.lastName}`, phone: o.person.phone, email: o.person.email, share: o.sharePercent ? Number(o.sharePercent).toFixed(2) + "%" : null })),
          tenant: u.tenancies[0] ? `${u.tenancies[0].person.firstName} ${u.tenancies[0].person.lastName}` : null,
          debtUsd: debt > 0.01 ? debt.toFixed(2) : null,
          status: debt > 0.01 ? "Con deuda" : "Solvente",
        };
      });
    }

    case "get_unit_detail": {
      const unitCode = args.unitCode as string;
      const communityId = args.communityId as string | undefined;
      const codeMatch = { equals: unitCode, mode: "insensitive" as const };
      const where: AnyWhere = communityId ? { code: codeMatch, communityId, organizationId } : { code: codeMatch, organizationId };
      const unit = await db.unit.findFirst({
        where,
        select: {
          id: true, code: true, floor: true, tower: true, type: true, areaM2: true, bedrooms: true, bathrooms: true, parkingSpots: true, aliquot: true, notes: true,
          community: { select: { name: true, monthlyFeeUsd: true } },
          ownerships: { where: { endDate: null }, select: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true, email: true, phone: true, whatsapp: true, vehicles: { select: { brand: true, model: true, plate: true, color: true, active: true } } } }, sharePercent: true, startDate: true } },
          tenancies: { where: { endDate: null }, select: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true, email: true, phone: true } }, startDate: true, monthlyRentUsd: true } },
          invoices: { where: { status: { not: "VOIDED" } }, orderBy: { issuedAt: "desc" }, take: 24, select: { invoiceNumber: true, totalUsd: true, paidUsd: true, status: true, periodYear: true, periodMonth: true, dueDate: true } },
          payments: { where: { voidedAt: null }, orderBy: { paidAt: "desc" }, take: 5, select: { amountUsd: true, method: true, paidAt: true, reference: true } },
          workOrders: { where: { status: { not: "COMPLETED" } }, take: 3, select: { title: true, status: true, priority: true, createdAt: true } },
        },
      });
      if (!unit) return { error: `Unidad "${unitCode}" no encontrada.` };
      // Deuda REAL agregada sobre TODAS las facturas no anuladas — NO solo las que se
      // muestran (`unit.invoices` está limitado a 24). Con la deuda partida mes a mes,
      // sumar solo las recientes cortaba el total (ej. 73A mostraba $240 de $604).
      // Se usa invoice.paidUsd (monto asignado via PaymentAllocation), no unit.payments.
      const debtAgg = await db.invoice.aggregate({
        where: { unitId: unit.id, status: { not: "VOIDED" } },
        _sum: { totalUsd: true, paidUsd: true },
      });
      const overdueCount = await db.invoice.count({
        where: { unitId: unit.id, status: "OVERDUE" },
      });
      const totalInvoiced = Number(debtAgg._sum.totalUsd ?? 0);
      const totalAllocated = Number(debtAgg._sum.paidUsd ?? 0);
      const debtUsd = Math.max(0, totalInvoiced - totalAllocated);
      const allVehicles = unit.ownerships.flatMap(o => o.person.vehicles.filter(v => v.active).map(v => `${v.brand} ${v.model} ${v.color} — ${v.plate}`));
      return {
        unit: unit.code, floor: unit.floor, tower: unit.tower, type: unit.type,
        community: unit.community.name, aliquot: Number(unit.aliquot).toFixed(4) + "%",
        areaM2: unit.areaM2 ? Number(unit.areaM2) : null,
        bedrooms: unit.bedrooms, bathrooms: unit.bathrooms, parkingSpots: unit.parkingSpots,
        owners: unit.ownerships.map(o => ({ name: `${o.person.firstName} ${o.person.lastName}`, id: `${o.person.idType}-${o.person.idNumber}`, email: o.person.email, phone: o.person.phone, whatsapp: o.person.whatsapp, share: o.sharePercent ? Number(o.sharePercent).toFixed(2) + "%" : null, since: o.startDate.toISOString().split("T")[0] })),
        tenant: unit.tenancies[0] ? { name: `${unit.tenancies[0].person.firstName} ${unit.tenancies[0].person.lastName}`, email: unit.tenancies[0].person.email, phone: unit.tenancies[0].person.phone, since: unit.tenancies[0].startDate.toISOString().split("T")[0], monthlyRentUsd: unit.tenancies[0].monthlyRentUsd ? Number(unit.tenancies[0].monthlyRentUsd).toFixed(2) : null } : null,
        vehicles: allVehicles,
        totalInvoicedUsd: totalInvoiced.toFixed(2),
        totalAllocatedUsd: totalAllocated.toFixed(2),
        // debtUsd = lo que le falta pagar de TODAS las facturas emitidas (0 si está solvente)
        debtUsd: debtUsd.toFixed(2),
        mesesVencidos: overdueCount,
        solvente: debtUsd < 0.01,
        recentInvoices: unit.invoices.map(i => ({ invoiceNumber: i.invoiceNumber, period: `${i.periodYear}-${String(i.periodMonth).padStart(2,"0")}`, totalUsd: Number(i.totalUsd).toFixed(2), paidUsd: Number(i.paidUsd).toFixed(2), status: i.status, due: i.dueDate.toISOString().split("T")[0] })),
        recentPayments: unit.payments.map(p => ({ amountUsd: Number(p.amountUsd).toFixed(2), method: p.method, date: p.paidAt.toISOString().split("T")[0], reference: p.reference })),
        openWorkOrders: unit.workOrders.map(w => ({ title: w.title, status: w.status, priority: w.priority })),
      };
    }

    case "search_resident": {
      const query = args.query as string;
      // Dividir por espacios para que "Luis Ilarraza" encuentre firstName="Luis" + lastName="Ilarraza".
      // Cada palabra debe estar en alguno de los campos buscados (AND entre tokens, OR dentro de cada token).
      const tokens = query.trim().split(/\s+/).filter(Boolean);
      const andConditions = tokens.map(token => ({
        OR: [
          { firstName: { contains: token, mode: "insensitive" as const } },
          { lastName: { contains: token, mode: "insensitive" as const } },
          { email: { contains: token, mode: "insensitive" as const } },
          { idNumber: { contains: token, mode: "insensitive" as const } },
        ],
      }));
      const persons = await db.person.findMany({
        where: {
          organizationId,
          AND: andConditions,
        },
        take: 10,
        select: {
          firstName: true, lastName: true, idType: true, idNumber: true, email: true, phone: true, whatsapp: true,
          ownerships: {
            where: { endDate: null }, take: 1,
            select: {
              unit: {
                select: {
                  code: true, floor: true, tower: true,
                  community: { select: { name: true } },
                  // Incluir facturas para calcular deuda sin necesitar segunda llamada.
                  // Evitamos que el bot alucine el código de unidad en un follow-up.
                  invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true } },
                },
              },
            },
          },
          tenancies: {
            where: { endDate: null }, take: 1,
            select: {
              unit: {
                select: {
                  code: true,
                  community: { select: { name: true } },
                  invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true } },
                },
              },
            },
          },
        },
      });
      return persons.map(p => {
        const ownerUnit = p.ownerships[0]?.unit ?? null;
        const tenantUnit = p.tenancies[0]?.unit ?? null;
        const activeUnit = ownerUnit ?? tenantUnit;
        const invoices = activeUnit?.invoices ?? [];
        const totalInvoiced = invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
        const totalAllocated = invoices.reduce((s, i) => s + Number(i.paidUsd), 0);
        const debtUsd = Math.max(0, totalInvoiced - totalAllocated);
        return {
          name: `${p.firstName} ${p.lastName}`,
          id: `${p.idType}-${p.idNumber}`,
          email: p.email, phone: p.phone, whatsapp: p.whatsapp,
          unit: activeUnit?.code ?? "Sin unidad",
          floor: ownerUnit?.floor ?? null,
          tower: ownerUnit?.tower ?? null,
          community: activeUnit?.community.name ?? "—",
          role: ownerUnit ? "Propietario" : tenantUnit ? "Inquilino" : "Sin asignación",
          // Deuda calculada correctamente (invoice.paidUsd = asignado via PaymentAllocation)
          debtUsd: debtUsd.toFixed(2),
          solvente: debtUsd < 0.01,
        };
      });
    }

    case "get_vehicles": {
      const communityId = args.communityId as string | undefined;
      const query = args.query as string | undefined;
      const limit = Number(args.limit ?? 20);
      const where: AnyWhere = { organizationId };
      // Filtrar por propietarios que tengan ownership activo en esa comunidad
      if (communityId) where.person = { ownerships: { some: { endDate: null, unit: { communityId } } } };
      if (query) where.OR = [
        { plate: { contains: query, mode: "insensitive" } },
        { brand: { contains: query, mode: "insensitive" } },
        { model: { contains: query, mode: "insensitive" } },
        { person: { OR: [{ firstName: { contains: query, mode: "insensitive" } }, { lastName: { contains: query, mode: "insensitive" } }] } },
      ];
      const vehicles = await db.vehicle.findMany({
        where, take: limit,
        select: {
          brand: true, model: true, year: true, color: true, plate: true, type: true, parkingSpot: true, active: true,
          person: { select: { firstName: true, lastName: true, ownerships: { where: { endDate: null }, take: 1, select: { unit: { select: { code: true } } } } } },
        },
      });
      return vehicles.map(v => ({
        plate: v.plate, brand: v.brand, model: v.model, year: v.year, color: v.color, type: v.type,
        parkingSpot: v.parkingSpot, active: v.active,
        owner: `${v.person.firstName} ${v.person.lastName}`,
        unit: v.person.ownerships[0]?.unit.code ?? "Sin unidad",
      }));
    }

    case "get_work_orders": {
      const communityId = args.communityId as string | undefined;
      const status = args.status as string | undefined;
      const priority = args.priority as string | undefined;
      const limit = Number(args.limit ?? 15);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (status) where.status = status;
      if (priority) where.priority = priority;
      const orders = await db.workOrder.findMany({
        where, orderBy: { createdAt: "desc" }, take: limit,
        select: {
          title: true, category: true, status: true, priority: true, estimatedCostUsd: true, actualCostUsd: true,
          scheduledAt: true, completedAt: true, createdAt: true, notes: true,
          community: { select: { name: true } },
          unit: { select: { code: true } },
          contractor: { select: { name: true, specialty: true } },
        },
      });
      return orders.map(o => ({
        title: o.title, category: o.category, status: o.status, priority: o.priority,
        community: o.community.name, unit: o.unit?.code ?? "Área común",
        contractor: o.contractor ? `${o.contractor.name} (${o.contractor.specialty})` : "Sin asignar",
        estimatedCostUsd: o.estimatedCostUsd ? Number(o.estimatedCostUsd).toFixed(2) : null,
        actualCostUsd: o.actualCostUsd ? Number(o.actualCostUsd).toFixed(2) : null,
        scheduledAt: o.scheduledAt?.toISOString().split("T")[0] ?? null,
        completedAt: o.completedAt?.toISOString().split("T")[0] ?? null,
        createdAt: o.createdAt.toISOString().split("T")[0],
      }));
    }

    case "get_contractors": {
      const specialty = args.specialty as string | undefined;
      const where: AnyWhere = { organizationId };
      if (specialty) where.specialty = { contains: specialty, mode: "insensitive" };
      const contractors = await db.contractor.findMany({
        where, orderBy: { rating: "desc" },
        select: { name: true, specialty: true, phone: true, email: true, rating: true, active: true, notes: true },
      });
      return contractors;
    }

    case "get_violations": {
      const communityId = args.communityId as string | undefined;
      const resolved = args.resolved as boolean | undefined;
      const limit = Number(args.limit ?? 15);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (resolved === true) where.resolvedAt = { not: null };
      if (resolved === false) where.resolvedAt = null;
      const violations = await db.violation.findMany({
        where, orderBy: { createdAt: "desc" }, take: limit,
        select: {
          type: true, description: true, fineAmountUsd: true, resolvedAt: true, resolvedNotes: true, createdAt: true,
          unit: { select: { code: true, community: { select: { name: true } } } },
        },
      });
      return violations.map(v => ({
        type: v.type, description: v.description,
        unit: v.unit.code, community: v.unit.community.name,
        fineUsd: v.fineAmountUsd ? Number(v.fineAmountUsd).toFixed(2) : null,
        status: v.resolvedAt ? "Resuelta" : "Pendiente",
        resolvedNotes: v.resolvedNotes,
        date: v.createdAt.toISOString().split("T")[0],
      }));
    }

    case "get_visitors": {
      const communityId = args.communityId as string | undefined;
      const status = args.status as string | undefined;
      const limit = Number(args.limit ?? 15);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (status) where.status = status;
      const visitors = await db.visitor.findMany({
        where, orderBy: { createdAt: "desc" }, take: limit,
        select: {
          firstName: true, lastName: true, idNumber: true, phone: true, vehiclePlate: true,
          purpose: true, status: true, validFrom: true, validUntil: true, checkInAt: true, checkOutAt: true,
          unit: { select: { code: true, community: { select: { name: true } } } },
        },
      });
      return visitors.map(v => ({
        name: `${v.firstName} ${v.lastName}`, id: v.idNumber, phone: v.phone, plate: v.vehiclePlate,
        purpose: v.purpose, status: v.status,
        unit: v.unit.code, community: v.unit.community.name,
        validFrom: v.validFrom.toISOString().split("T")[0],
        validUntil: v.validUntil.toISOString().split("T")[0],
        checkIn: v.checkInAt?.toISOString().split("T")[0] ?? null,
        checkOut: v.checkOutAt?.toISOString().split("T")[0] ?? null,
      }));
    }

    case "get_board_members": {
      const communityId = args.communityId as string | undefined;
      const activeOnly = args.activeOnly !== false;
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (activeOnly) where.endDate = null;
      const members = await db.boardMember.findMany({
        where, orderBy: { startDate: "desc" },
        select: {
          role: true, startDate: true, endDate: true, notes: true,
          person: { select: { firstName: true, lastName: true, email: true, phone: true } },
          community: { select: { name: true } },
        },
      });
      return members.map(m => ({
        name: `${m.person.firstName} ${m.person.lastName}`,
        role: m.role, community: m.community.name,
        email: m.person.email, phone: m.person.phone,
        from: m.startDate.toISOString().split("T")[0],
        until: m.endDate?.toISOString().split("T")[0] ?? "Vigente",
      }));
    }

    case "get_assemblies": {
      const communityId = args.communityId as string | undefined;
      const status = args.status as string | undefined;
      const limit = Number(args.limit ?? 10);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (status) where.status = status;
      const assemblies = await db.assembly.findMany({
        where, orderBy: { scheduledAt: "desc" }, take: limit,
        select: {
          title: true, status: true, scheduledAt: true, location: true, quorumRequired: true,
          quorumReached: true, attendeesCount: true, closedAt: true,
          community: { select: { name: true } },
          agendaItems: { select: { title: true, requiresVote: true, approved: true } },
        },
      });
      return assemblies.map(a => ({
        title: a.title, status: a.status, community: a.community.name,
        scheduledAt: a.scheduledAt.toISOString().split("T")[0],
        location: a.location, quorumRequired: a.quorumRequired, quorumReached: a.quorumReached,
        attendeesCount: a.attendeesCount,
        closedAt: a.closedAt?.toISOString().split("T")[0] ?? null,
        agendaItems: a.agendaItems.map(i => ({ title: i.title, requiresVote: i.requiresVote, result: i.approved === null ? "Pendiente" : i.approved ? "Aprobado" : "Rechazado" })),
      }));
    }

    case "get_common_areas": {
      const communityId = args.communityId as string | undefined;
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      const areas = await db.commonArea.findMany({
        where,
        select: { name: true, description: true, capacity: true, requiresApproval: true, costUsd: true, active: true, openTime: true, closeTime: true, rules: true },
      });
      return areas.map(a => ({ ...a, costUsd: a.costUsd ? Number(a.costUsd).toFixed(2) : null }));
    }

    case "get_reservations": {
      const communityId = args.communityId as string | undefined;
      const status = args.status as string | undefined;
      const limit = Number(args.limit ?? 15);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (status) where.status = status;
      const reservations = await db.reservation.findMany({
        where, orderBy: { date: "desc" }, take: limit,
        select: {
          date: true, startTime: true, endTime: true, status: true, purpose: true, guestCount: true, cancelReason: true,
          area: { select: { name: true } },
          unit: { select: { code: true, community: { select: { name: true } } } },
        },
      });
      return reservations.map(r => ({
        area: r.area.name, unit: r.unit.code, community: r.unit.community.name,
        date: r.date.toISOString().split("T")[0], startTime: r.startTime, endTime: r.endTime,
        status: r.status, purpose: r.purpose, guestCount: r.guestCount, cancelReason: r.cancelReason,
      }));
    }

    case "get_announcements": {
      const communityId = args.communityId as string | undefined;
      const limit = Number(args.limit ?? 10);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      const announcements = await db.announcement.findMany({
        where, orderBy: { createdAt: "desc" }, take: limit,
        select: { title: true, body: true, pinned: true, publishedAt: true, expiresAt: true },
      });
      return announcements.map(a => ({
        title: a.title, body: a.body.substring(0, 300) + (a.body.length > 300 ? "..." : ""),
        pinned: a.pinned,
        published: a.publishedAt?.toISOString().split("T")[0] ?? null,
        expires: a.expiresAt?.toISOString().split("T")[0] ?? null,
      }));
    }

    case "get_community_documents": {
      const communityId = args.communityId as string | undefined;
      const category = args.category as string | undefined;
      const limit = Number(args.limit ?? 15);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (category) where.category = category;
      const docs = await db.communityDocument.findMany({
        where, orderBy: { createdAt: "desc" }, take: limit,
        select: { title: true, category: true, description: true, fileName: true, mimeType: true, createdAt: true },
      });
      return docs.map(d => ({ title: d.title, category: d.category, description: d.description, fileName: d.fileName, fileType: d.mimeType ?? null, date: d.createdAt.toISOString().split("T")[0] }));
    }

    case "get_expenses": {
      const communityId = args.communityId as string | undefined;
      const month = args.month as string | undefined;
      const towerScope = args.towerScope as string | undefined;
      const category = args.category as string | undefined;
      const invoiced = args.invoiced as boolean | undefined;
      const isIndividual = args.isIndividual as boolean | undefined;
      const limit = Number(args.limit ?? 25);
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      if (towerScope !== undefined) where.towerScope = towerScope === "null" || towerScope === "" ? null : towerScope;
      if (category) where.category = category;
      if (invoiced === true) where.invoicedAt = { not: null };
      if (invoiced === false) where.invoicedAt = null;
      if (isIndividual !== undefined) where.isIndividual = isIndividual;
      const expenses = await db.expense.findMany({
        where, orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }], take: limit,
        select: {
          category: true, customCategory: true, description: true, supplierName: true,
          amountUsd: true, amountBss: true, exchangeRate: true, currencyPrimary: true,
          periodYear: true, periodMonth: true, towerScope: true, isIndividual: true,
          invoicedAt: true, voidedAt: true, notes: true,
          targetUnit: { select: { code: true } },
          community: { select: { name: true } },
        },
      });
      return expenses.map(e => ({
        category: e.customCategory ?? e.category,
        description: e.description,
        supplier: e.supplierName ?? null,
        amountUsd: Number(e.amountUsd).toFixed(2),
        amountBss: Number(e.amountBss).toFixed(2),
        exchangeRate: Number(e.exchangeRate).toFixed(4),
        period: `${e.periodYear}-${String(e.periodMonth).padStart(2, "0")}`,
        towerScope: e.towerScope ?? "General",
        isIndividual: e.isIndividual,
        targetUnit: e.targetUnit?.code ?? null,
        community: e.community.name,
        status: e.voidedAt ? "Anulado" : e.invoicedAt ? "Facturado" : "Pendiente",
        notes: e.notes,
      }));
    }

    case "get_recurring_templates": {
      const communityId = args.communityId as string | undefined;
      const activeOnly = args.activeOnly !== false;
      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      if (activeOnly) where.active = true;
      const templates = await db.recurringExpenseTemplate.findMany({
        where, orderBy: { createdAt: "asc" },
        select: {
          category: true, customCategory: true, description: true, supplierName: true,
          amountUsd: true, towerScope: true, active: true, notes: true,
          community: { select: { name: true } },
        },
      });
      return templates.map(t => ({
        category: t.customCategory ?? t.category,
        description: t.description,
        supplier: t.supplierName ?? null,
        amountUsd: Number(t.amountUsd).toFixed(2),
        towerScope: t.towerScope ?? "General",
        active: t.active,
        community: t.community.name,
        notes: t.notes,
      }));
    }

    case "get_access_log": {
      const communityId = args.communityId as string | undefined;
      const direction   = args.direction as string | undefined;
      const unitCode    = args.unitCode as string | undefined;
      const onlyWalkIn  = args.onlyWalkIn as boolean | undefined;
      const dateStr     = args.date as string | undefined;
      const dateFromStr = args.dateFrom as string | undefined;
      const dateToStr   = args.dateTo as string | undefined;

      // Calcular rango: date (un día) tiene prioridad; si no, usar dateFrom/dateTo; si nada, hoy.
      let dayStart: Date, dayEnd: Date, rangeLabel: string;
      if (dateFromStr) {
        dayStart = new Date(dateFromStr); dayStart.setHours(0, 0, 0, 0);
        dayEnd   = dateToStr ? new Date(dateToStr) : new Date(); dayEnd.setHours(23, 59, 59, 999);
        rangeLabel = `${dateFromStr} → ${dayEnd.toISOString().split("T")[0]}`;
      } else {
        const d = dateStr ? new Date(dateStr) : new Date();
        dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
        dayEnd   = new Date(d); dayEnd.setHours(23, 59, 59, 999);
        rangeLabel = d.toISOString().split("T")[0];
      }

      const defaultLimit = dateFromStr ? 100 : 20;
      const limit = Number(args.limit ?? defaultLimit);

      const where: AnyWhere = communityId ? { communityId, organizationId } : { organizationId };
      where.createdAt = { gte: dayStart, lte: dayEnd };
      if (direction) where.direction = direction;
      if (unitCode) where.unit = { code: { equals: unitCode, mode: "insensitive" } };
      if (onlyWalkIn === true)  where.visitorId = null;
      if (onlyWalkIn === false) where.visitorId = { not: null };

      const logs = await db.accessLog.findMany({
        where, orderBy: { createdAt: "desc" }, take: limit,
        select: {
          personName: true, personId_doc: true, vehiclePlate: true, purpose: true,
          direction: true, deniedReason: true, createdAt: true,
          unit: { select: { code: true } },
          visitor: { select: { firstName: true, lastName: true } },
        },
      });

      const totalIn       = logs.filter(l => l.direction === "IN").length;
      const totalOut      = logs.filter(l => l.direction === "OUT").length;
      const walkIns       = logs.filter(l => !l.visitor).length;
      const preAuthorized = logs.filter(l => !!l.visitor).length;

      return {
        period: rangeLabel,
        totalEntries: logs.length,
        totalIn,
        totalOut,
        walkIns,
        preAuthorized,
        entries: logs.map(l => ({
          date: l.createdAt.toISOString().split("T")[0],
          time: l.createdAt.toISOString().substring(11, 16),
          name: l.personName,
          cedula: l.personId_doc ?? null,
          plate: l.vehiclePlate ?? null,
          purpose: l.purpose ?? null,
          direction: l.direction === "IN" ? "Entrada" : "Salida",
          unit: l.unit?.code ?? null,
          isPreAuthorized: !!l.visitor,
          denied: !!l.deniedReason,
        })),
      };
    }

    case "get_month_close_status": {
      const communityId = args.communityId as string | undefined;
      const month = args.month as string | undefined;
      const now = new Date();
      const year = month ? Number(month.split("-")[0]) : now.getFullYear();
      const m = month ? Number(month.split("-")[1]) : now.getMonth() + 1;
      const where: AnyWhere = { organizationId, year, month: m };
      if (communityId) where.communityId = communityId;
      const close = await db.monthClose.findFirst({
        where,
        select: { year: true, month: true, closedAt: true, notes: true, summary: true, community: { select: { name: true } } },
      });
      if (!close) return { status: "Abierto", period: `${year}-${String(m).padStart(2,"0")}`, message: "El mes no ha sido cerrado aún." };
      return {
        status: "Cerrado",
        community: close.community.name,
        period: `${close.year}-${String(close.month).padStart(2,"0")}`,
        closedAt: close.closedAt.toISOString().split("T")[0],
        notes: close.notes ?? null,
      };
    }

    case "get_aging": {
      const communityId = args.communityId as string | undefined;
      const today = new Date();
      const where: AnyWhere = communityId
        ? { communityId, organizationId, status: { in: ["ISSUED","PARTIAL","OVERDUE"] } }
        : { organizationId, status: { in: ["ISSUED","PARTIAL","OVERDUE"] } };
      const invoices = await db.invoice.findMany({
        where,
        select: { totalUsd: true, paidUsd: true, dueDate: true, unit: { select: { code: true } } },
      });
      const buckets = { "0-30": { count: 0, amountUsd: 0, units: new Set<string>() }, "31-60": { count: 0, amountUsd: 0, units: new Set<string>() }, "61-90": { count: 0, amountUsd: 0, units: new Set<string>() }, "90+": { count: 0, amountUsd: 0, units: new Set<string>() } };
      for (const inv of invoices) {
        const debt = Number(inv.totalUsd) - Number(inv.paidUsd);
        if (debt <= 0.01) continue;
        const days = Math.floor((today.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const key = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
        buckets[key].count++;
        buckets[key].amountUsd += debt;
        buckets[key].units.add(inv.unit.code);
      }
      const totalDebt = Object.values(buckets).reduce((s, b) => s + b.amountUsd, 0);
      return {
        totalDebtUsd: totalDebt.toFixed(2),
        aging: Object.entries(buckets).map(([range, b]) => ({
          range,
          invoicesCount: b.count,
          unitsCount: b.units.size,
          amountUsd: b.amountUsd.toFixed(2),
          pct: totalDebt > 0 ? ((b.amountUsd / totalDebt) * 100).toFixed(1) + "%" : "0%",
        })),
      };
    }

    case "get_exchange_rate_history": {
      const limit = Number(args.limit ?? 10);
      const rates = await db.exchangeRate.findMany({
        orderBy: { date: "desc" }, take: limit,
        select: { date: true, vesPerUsd: true, source: true },
      });
      return rates.map(r => ({
        date: r.date.toISOString().split("T")[0],
        vesPerUsd: Number(r.vesPerUsd).toFixed(4),
        source: r.source,
      }));
    }

    default:
      return { error: `Función "${name}" no reconocida en módulo residencial.` };
  }
}

// ─── IMPLEMENTACIONES — COMERCIAL ─────────────────────────────────────────────

async function runCommercialFunction(name: string, args: Record<string, unknown>, organizationId: string): Promise<unknown> {
  switch (name) {

    case "get_malls": {
      const malls = await db.ccMall.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, name: true, rif: true, address: true, city: true, phone: true, email: true, website: true, totalLocales: true, floorsCount: true, active: true, openedAt: true, notes: true },
      });
      return malls.map(m => ({ ...m, openedAt: m.openedAt?.toISOString().split("T")[0] ?? null }));
    }

    case "get_commercial_summary": {
      const mallId = args.mallId as string | undefined;
      const malls = await db.ccMall.findMany({
        where: mallId ? { id: mallId, organizationId } : { organizationId, deletedAt: null },
        select: {
          name: true,
          locales: {
            where: { deletedAt: null },
            select: {
              active: true,
              tenancies: { where: { endDate: null }, take: 1, select: { id: true } },
              // Solo invoices — paidUsd es lo realmente cobrado por factura (vía CcPaymentAllocation).
              // No usamos payments.amountUsd que incluye anticipos sin aplicar.
              invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true, status: true } },
            },
          },
        },
      });
      const result = malls.map(mall => {
        const total = mall.locales.length;
        const occupied = mall.locales.filter(l => l.tenancies.length > 0).length;
        const totalInv = mall.locales.reduce((s, l) => s + l.invoices.reduce((si, i) => si + Number(i.totalUsd), 0), 0);
        const totalAllocated = mall.locales.reduce((s, l) => s + l.invoices.reduce((si, i) => si + Number(i.paidUsd), 0), 0);
        const totalPending = mall.locales.reduce((s, l) => s + l.invoices.filter(i => !["PAID","VOIDED"].includes(i.status)).reduce((si, i) => si + (Number(i.totalUsd) - Number(i.paidUsd)), 0), 0);
        return {
          mall: mall.name, totalLocals: total, occupied, vacant: total - occupied,
          occupancyRate: total > 0 ? ((occupied / total) * 100).toFixed(1) + "%" : "N/A",
          totalInvoicedUsd: totalInv.toFixed(2), totalCollectedUsd: totalAllocated.toFixed(2),
          totalPendingUsd: totalPending.toFixed(2),
          collectionRate: totalInv > 0 ? ((totalAllocated / totalInv) * 100).toFixed(1) + "%" : "N/A",
        };
      });
      return result.length === 1 ? result[0] : result;
    }

    case "get_locals": {
      const mallId = args.mallId as string | undefined;
      const floor = args.floor !== undefined ? Number(args.floor) : undefined;
      const wing = args.wing as string | undefined;
      const type = args.type as string | undefined;
      const vacant = args.vacant as boolean | undefined;
      const limit = Number(args.limit ?? 30);
      const where: AnyWhere = mallId ? { mallId, organizationId, deletedAt: null } : { organizationId, deletedAt: null };
      if (floor !== undefined) where.floor = floor;
      if (wing) where.wing = { contains: wing, mode: "insensitive" };
      if (type) where.type = type;
      const locals = await db.ccLocal.findMany({
        where, orderBy: [{ floor: "asc" }, { code: "asc" }], take: limit,
        select: {
          code: true, type: true, name: true, floor: true, wing: true, areaM2: true, canonType: true, canonUsd: true, salesPct: true, active: true,
          mall: { select: { name: true } },
          tenancies: { where: { endDate: null }, take: 1, select: { tenantName: true, tenantRif: true, startDate: true } },
          // paidUsd en cada invoice = monto asignado vía CcPaymentAllocation (correcto para deuda)
          invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true } },
        },
      });
      const filtered = vacant !== undefined
        ? locals.filter(l => vacant ? l.tenancies.length === 0 : l.tenancies.length > 0)
        : locals;
      return filtered.map(l => {
        const totalInv = l.invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
        const totalAllocated = l.invoices.reduce((s, i) => s + Number(i.paidUsd), 0);
        const debtUsd = Math.max(0, totalInv - totalAllocated);
        return {
          code: l.code, type: l.type, name: l.name, floor: l.floor, wing: l.wing,
          mall: l.mall.name, areaM2: l.areaM2 ? Number(l.areaM2).toFixed(2) : null,
          canonType: l.canonType, canonUsd: l.canonUsd ? Number(l.canonUsd).toFixed(2) : null,
          salesPct: l.salesPct ? Number(l.salesPct).toFixed(2) + "%" : null,
          tenant: l.tenancies[0] ? { name: l.tenancies[0].tenantName, rif: l.tenancies[0].tenantRif, since: l.tenancies[0].startDate.toISOString().split("T")[0] } : null,
          status: l.tenancies.length > 0 ? "Ocupado" : "Vacío",
          debtUsd: debtUsd.toFixed(2),
          solvente: debtUsd < 0.01,
        };
      });
    }

    case "get_local_details": {
      const localCode = args.localCode as string | undefined;
      const localId = args.localId as string | undefined;
      const local = await db.ccLocal.findFirst({
        where: localId ? { id: localId, organizationId } : { code: localCode, organizationId },
        select: {
          code: true, type: true, name: true, floor: true, wing: true, areaM2: true, canonType: true, canonUsd: true, salesPct: true, active: true, notes: true,
          mall: { select: { name: true } },
          tenancies: { where: { endDate: null }, take: 1, select: { tenantName: true, tenantRif: true, tenantEmail: true, tenantPhone: true, tenantContact: true, canonType: true, canonUsd: true, salesPct: true, startDate: true, depositUsd: true } },
          invoices: { where: { status: { not: "VOIDED" } }, orderBy: { dueDate: "desc" }, take: 6, select: { invoiceNumber: true, totalUsd: true, paidUsd: true, status: true, dueDate: true, periodYear: true, periodMonth: true } },
          payments: { where: { voidedAt: null }, orderBy: { paidAt: "desc" }, take: 5, select: { amountUsd: true, method: true, paidAt: true, reference: true } },
        },
      });
      if (!local) return { error: "Local no encontrado." };
      // Deuda = suma de (totalUsd - paidUsd) por factura. paidUsd = asignado via CcPaymentAllocation.
      // NO usar payments.amountUsd porque incluye anticipos sin aplicar y distorsiona el saldo.
      const totalInv = local.invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
      const totalAllocated = local.invoices.reduce((s, i) => s + Number(i.paidUsd), 0);
      const debtUsd = Math.max(0, totalInv - totalAllocated);
      const t = local.tenancies[0];
      return {
        code: local.code, type: local.type, name: local.name, mall: local.mall.name,
        floor: local.floor, wing: local.wing, areaM2: local.areaM2 ? Number(local.areaM2).toFixed(2) : null,
        canonType: local.canonType, canonUsd: local.canonUsd ? Number(local.canonUsd).toFixed(2) : null,
        currentTenant: t ? { name: t.tenantName, rif: t.tenantRif, email: t.tenantEmail, phone: t.tenantPhone, contact: t.tenantContact, canonUsd: t.canonUsd ? Number(t.canonUsd).toFixed(2) : null, salesPct: t.salesPct ? Number(t.salesPct).toFixed(2) + "%" : null, since: t.startDate.toISOString().split("T")[0], depositUsd: t.depositUsd ? Number(t.depositUsd).toFixed(2) : null } : null,
        debtUsd: debtUsd.toFixed(2),
        solvente: debtUsd < 0.01,
        recentInvoices: local.invoices.map(i => ({ invoiceNumber: i.invoiceNumber, period: `${i.periodYear}-${String(i.periodMonth).padStart(2,"0")}`, totalUsd: Number(i.totalUsd).toFixed(2), paidUsd: Number(i.paidUsd).toFixed(2), status: i.status, due: i.dueDate.toISOString().split("T")[0] })),
        recentPayments: local.payments.map(p => ({ amountUsd: Number(p.amountUsd).toFixed(2), method: p.method, date: p.paidAt.toISOString().split("T")[0], reference: p.reference })),
      };
    }

    case "get_local_tenancy_history": {
      const localCode = args.localCode as string | undefined;
      const localId = args.localId as string | undefined;
      const local = await db.ccLocal.findFirst({
        where: localId ? { id: localId, organizationId } : { code: localCode, organizationId },
        select: { code: true, mall: { select: { name: true } }, tenancies: { orderBy: { startDate: "desc" }, select: { tenantName: true, tenantRif: true, tenantEmail: true, tenantPhone: true, canonType: true, canonUsd: true, salesPct: true, startDate: true, endDate: true, depositUsd: true, notes: true } } },
      });
      if (!local) return { error: "Local no encontrado." };
      return {
        local: local.code, mall: local.mall.name,
        history: local.tenancies.map(t => ({
          tenant: t.tenantName, rif: t.tenantRif,
          from: t.startDate.toISOString().split("T")[0],
          until: t.endDate?.toISOString().split("T")[0] ?? "Vigente",
          canonType: t.canonType,
          canonUsd: t.canonUsd ? Number(t.canonUsd).toFixed(2) : null,
          salesPct: t.salesPct ? Number(t.salesPct).toFixed(2) + "%" : null,
          depositUsd: t.depositUsd ? Number(t.depositUsd).toFixed(2) : null,
        })),
      };
    }

    case "search_tenant": {
      const query = args.query as string;
      const tenancies = await db.ccTenancy.findMany({
        where: {
          organizationId, endDate: null,
          OR: [
            { tenantName: { contains: query, mode: "insensitive" } },
            { tenantRif: { contains: query, mode: "insensitive" } },
            { tenantEmail: { contains: query, mode: "insensitive" } },
            { tenantContact: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 10,
        select: {
          tenantName: true, tenantRif: true, tenantEmail: true, tenantPhone: true, tenantContact: true,
          canonType: true, canonUsd: true, salesPct: true, startDate: true,
          local: {
            select: {
              code: true, floor: true, wing: true,
              mall: { select: { name: true } },
              // Incluir facturas para mostrar deuda sin segunda llamada (evita alucinaciones de código).
              invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true } },
            },
          },
        },
      });
      return tenancies.map(t => {
        const totalInvoiced = t.local.invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
        const totalAllocated = t.local.invoices.reduce((s, i) => s + Number(i.paidUsd), 0);
        const debtUsd = Math.max(0, totalInvoiced - totalAllocated);
        return {
          name: t.tenantName, rif: t.tenantRif, email: t.tenantEmail, phone: t.tenantPhone, contact: t.tenantContact,
          local: t.local.code, floor: t.local.floor, wing: t.local.wing, mall: t.local.mall.name,
          canonType: t.canonType, canonUsd: t.canonUsd ? Number(t.canonUsd).toFixed(2) : null,
          salesPct: t.salesPct ? Number(t.salesPct).toFixed(2) + "%" : null,
          since: t.startDate.toISOString().split("T")[0],
          debtUsd: debtUsd.toFixed(2),
          solvente: debtUsd < 0.01,
        };
      });
    }

    case "get_commercial_debtors": {
      const mallId = args.mallId as string | undefined;
      const limit = Number(args.limit ?? 10);
      const locals = await db.ccLocal.findMany({
        where: mallId ? { mallId, organizationId, deletedAt: null } : { organizationId, deletedAt: null },
        select: {
          code: true, mall: { select: { name: true } },
          tenancies: { where: { endDate: null }, take: 1, select: { tenantName: true, tenantRif: true } },
          // paidUsd por factura = correcto. No payments.amountUsd que incluye anticipos.
          invoices: { where: { status: { not: "VOIDED" } }, select: { totalUsd: true, paidUsd: true } },
        },
      });
      return locals
        .map(l => {
          const totalInv = l.invoices.reduce((s, i) => s + Number(i.totalUsd), 0);
          const totalAllocated = l.invoices.reduce((s, i) => s + Number(i.paidUsd), 0);
          return { local: l.code, mall: l.mall.name, tenant: l.tenancies[0]?.tenantName ?? "Vacío", rif: l.tenancies[0]?.tenantRif ?? null, debtUsd: Math.max(0, totalInv - totalAllocated).toFixed(2) };
        })
        .filter(l => Number(l.debtUsd) > 0.01)
        .sort((a, b) => Number(b.debtUsd) - Number(a.debtUsd))
        .slice(0, limit);
    }

    case "get_commercial_invoices": {
      const mallId = args.mallId as string | undefined;
      const status = args.status as string | undefined;
      const month = args.month as string | undefined;
      const localCode = args.localCode as string | undefined;
      const limit = Number(args.limit ?? 20);
      const where: AnyWhere = mallId ? { mallId, organizationId } : { organizationId };
      if (status) where.status = status;
      // Filtrar por período contable (periodYear/periodMonth) igual que el módulo residencial.
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      if (localCode) where.local = { code: { equals: localCode, mode: "insensitive" } };
      const invoices = await db.ccInvoice.findMany({
        where, orderBy: { issuedAt: "desc" }, take: limit,
        select: { invoiceNumber: true, totalUsd: true, paidUsd: true, status: true, issuedAt: true, dueDate: true, type: true, periodYear: true, periodMonth: true, local: { select: { code: true, mall: { select: { name: true } } } } },
      });
      return invoices.map(i => ({
        invoiceNumber: i.invoiceNumber,
        local: i.local.code, mall: i.local.mall.name, type: i.type,
        period: `${i.periodYear}-${String(i.periodMonth).padStart(2,"0")}`,
        totalUsd: Number(i.totalUsd).toFixed(2), paidUsd: Number(i.paidUsd).toFixed(2),
        pendingUsd: (Number(i.totalUsd) - Number(i.paidUsd)).toFixed(2),
        status: i.status, issued: i.issuedAt.toISOString().split("T")[0], due: i.dueDate.toISOString().split("T")[0],
      }));
    }

    case "get_commercial_payments": {
      const mallId = args.mallId as string | undefined;
      const localCode = args.localCode as string | undefined;
      const limit = Number(args.limit ?? 15);
      const where: AnyWhere = mallId ? { mallId, organizationId, voidedAt: null } : { organizationId, voidedAt: null };
      if (localCode) where.local = { code: { equals: localCode, mode: "insensitive" } };
      const payments = await db.ccPayment.findMany({
        where, orderBy: { paidAt: "desc" }, take: limit,
        select: { amountUsd: true, method: true, reference: true, paidAt: true, notes: true, local: { select: { code: true, mall: { select: { name: true } } } } },
      });
      return payments.map(p => ({ local: p.local.code, mall: p.local.mall.name, amountUsd: Number(p.amountUsd).toFixed(2), method: p.method, reference: p.reference, date: p.paidAt.toISOString().split("T")[0], notes: p.notes }));
    }

    case "get_commercial_expenses": {
      const mallId = args.mallId as string | undefined;
      const month = args.month as string | undefined;
      const where: AnyWhere = mallId ? { mallId, organizationId } : { organizationId };
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      const expenses = await db.ccExpense.findMany({ where, select: { amountUsd: true, category: true, customCategory: true, description: true, supplierName: true, invoicedAt: true } });
      const total = expenses.reduce((s, e) => s + Number(e.amountUsd), 0);
      const byCategory: Record<string, number> = {};
      for (const e of expenses) { const cat = e.customCategory ?? e.category; byCategory[cat] = (byCategory[cat] ?? 0) + Number(e.amountUsd); }
      return {
        totalUsd: total.toFixed(2), count: expenses.length,
        invoiced: expenses.filter(e => e.invoicedAt).length,
        pending: expenses.filter(e => !e.invoicedAt).length,
        byCategory: Object.entries(byCategory).sort(([,a],[,b]) => b-a).map(([cat, amt]) => ({ category: cat, amountUsd: amt.toFixed(2) })),
      };
    }

    case "get_commercial_incomes": {
      const mallId = args.mallId as string | undefined;
      const month = args.month as string | undefined;
      const where: AnyWhere = mallId ? { mallId, organizationId } : { organizationId };
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      const incomes = await db.ccIncome.findMany({ where, orderBy: { createdAt: "desc" }, select: { amountUsd: true, category: true, customCategory: true, description: true, reference: true, affectsInvoice: true, periodYear: true, periodMonth: true } });
      const total = incomes.reduce((s, i) => s + Number(i.amountUsd), 0);
      return { totalUsd: total.toFixed(2), count: incomes.length, items: incomes.map(i => ({ category: i.customCategory ?? i.category, description: i.description, amountUsd: Number(i.amountUsd).toFixed(2), period: `${i.periodYear}-${String(i.periodMonth).padStart(2,"0")}`, reference: i.reference, affectsInvoice: i.affectsInvoice })) };
    }

    case "get_sales_declarations": {
      const mallId = args.mallId as string | undefined;
      const month = args.month as string | undefined;
      const localCode = args.localCode as string | undefined;
      const verified = args.verified as boolean | undefined;
      const limit = Number(args.limit ?? 20);
      const where: AnyWhere = mallId ? { mallId, organizationId } : { organizationId };
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      if (localCode) where.local = { code: { equals: localCode, mode: "insensitive" } };
      if (verified !== undefined) where.verified = verified;
      const declarations = await db.ccSalesDeclaration.findMany({
        where, orderBy: { createdAt: "desc" }, take: limit,
        select: { periodYear: true, periodMonth: true, salesAmountUsd: true, verified: true, verifiedAt: true, notes: true, local: { select: { code: true, salesPct: true, mall: { select: { name: true } } } } },
      });
      return declarations.map(d => ({
        local: d.local.code, mall: d.local.mall.name,
        period: `${d.periodYear}-${String(d.periodMonth).padStart(2,"0")}`,
        salesAmountUsd: Number(d.salesAmountUsd).toFixed(2),
        canonEstimatedUsd: d.local.salesPct ? (Number(d.salesAmountUsd) * Number(d.local.salesPct) / 100).toFixed(2) : null,
        verified: d.verified, verifiedAt: d.verifiedAt?.toISOString().split("T")[0] ?? null,
      }));
    }

    case "get_month_close_status": {
      const mallId = args.mallId as string | undefined;
      const month = args.month as string | undefined;
      const now = new Date();
      const year = month ? Number(month.split("-")[0]) : now.getFullYear();
      const m = month ? Number(month.split("-")[1]) : now.getMonth() + 1;
      const where: AnyWhere = mallId ? { mallId, organizationId, year, month: m } : { organizationId, year, month: m };
      const close = await db.ccMonthClose.findFirst({ where, select: { year: true, month: true, closedAt: true, notes: true, summary: true } });
      if (!close) return { status: "Abierto", period: `${year}-${String(m).padStart(2,"0")}`, message: "El mes no ha sido cerrado aún." };
      return { status: "Cerrado", period: `${close.year}-${String(close.month).padStart(2,"0")}`, closedAt: close.closedAt.toISOString().split("T")[0], notes: close.notes };
    }

    case "get_exchange_rate": {
      const rate = await db.exchangeRate.findFirst({ orderBy: { date: "desc" } });
      if (!rate) return { message: "No hay tasas de cambio registradas." };
      return { date: rate.date.toISOString().split("T")[0], vesPerUsd: Number(rate.vesPerUsd).toFixed(4), source: rate.source };
    }

    case "get_exchange_rate_history": {
      const limit = Number(args.limit ?? 10);
      const rates = await db.exchangeRate.findMany({
        orderBy: { date: "desc" }, take: limit,
        select: { date: true, vesPerUsd: true, source: true },
      });
      return rates.map(r => ({
        date: r.date.toISOString().split("T")[0],
        vesPerUsd: Number(r.vesPerUsd).toFixed(4),
        source: r.source,
      }));
    }

    case "get_cc_expense_list": {
      const mallId = args.mallId as string | undefined;
      const month = args.month as string | undefined;
      const category = args.category as string | undefined;
      const invoiced = args.invoiced as boolean | undefined;
      const isIndividual = args.isIndividual as boolean | undefined;
      const limit = Number(args.limit ?? 25);
      const where: AnyWhere = mallId ? { mallId, organizationId } : { organizationId };
      if (month) { const [y, m] = month.split("-").map(Number); where.periodYear = y; where.periodMonth = m; }
      if (category) where.category = category;
      if (invoiced === true) where.invoicedAt = { not: null };
      if (invoiced === false) where.invoicedAt = null;
      if (isIndividual !== undefined) where.isIndividual = isIndividual;
      const expenses = await db.ccExpense.findMany({
        where, orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }], take: limit,
        select: {
          category: true, customCategory: true, description: true, supplierName: true,
          amountUsd: true, amountBss: true, exchangeRate: true, periodYear: true, periodMonth: true,
          isIndividual: true, invoicedAt: true, voidedAt: true, notes: true,
          mall: { select: { name: true } },
        },
      });
      return expenses.map(e => ({
        category: e.customCategory ?? e.category,
        description: e.description,
        supplier: e.supplierName ?? null,
        amountUsd: Number(e.amountUsd).toFixed(2),
        amountBss: Number(e.amountBss).toFixed(2),
        exchangeRate: Number(e.exchangeRate).toFixed(4),
        period: `${e.periodYear}-${String(e.periodMonth).padStart(2,"0")}`,
        isIndividual: e.isIndividual,
        mall: e.mall.name,
        status: e.voidedAt ? "Anulado" : e.invoicedAt ? "Facturado" : "Pendiente",
        notes: e.notes,
      }));
    }

    case "get_cc_aging": {
      const mallId = args.mallId as string | undefined;
      const today = new Date();
      const where: AnyWhere = mallId
        ? { mallId, organizationId, status: { in: ["ISSUED","PARTIAL","OVERDUE"] } }
        : { organizationId, status: { in: ["ISSUED","PARTIAL","OVERDUE"] } };
      const invoices = await db.ccInvoice.findMany({
        where,
        select: { totalUsd: true, paidUsd: true, dueDate: true, local: { select: { code: true } } },
      });
      const buckets = { "0-30": { count: 0, amountUsd: 0, locals: new Set<string>() }, "31-60": { count: 0, amountUsd: 0, locals: new Set<string>() }, "61-90": { count: 0, amountUsd: 0, locals: new Set<string>() }, "90+": { count: 0, amountUsd: 0, locals: new Set<string>() } };
      for (const inv of invoices) {
        const debt = Number(inv.totalUsd) - Number(inv.paidUsd);
        if (debt <= 0.01) continue;
        const days = Math.floor((today.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const key = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
        buckets[key].count++;
        buckets[key].amountUsd += debt;
        buckets[key].locals.add(inv.local.code);
      }
      const totalDebt = Object.values(buckets).reduce((s, b) => s + b.amountUsd, 0);
      return {
        totalDebtUsd: totalDebt.toFixed(2),
        aging: Object.entries(buckets).map(([range, b]) => ({
          range,
          invoicesCount: b.count,
          localsCount: b.locals.size,
          amountUsd: b.amountUsd.toFixed(2),
          pct: totalDebt > 0 ? ((b.amountUsd / totalDebt) * 100).toFixed(1) + "%" : "0%",
        })),
      };
    }

    case "get_marketing_events": {
      const mallId = args.mallId as string | undefined;
      const status = args.status as string | undefined;
      const upcoming = args.upcoming as boolean | undefined;
      const limit = Number(args.limit ?? 15);
      const now = new Date();
      const where: AnyWhere = mallId ? { mallId, organizationId } : { organizationId };
      if (status) where.status = status;
      if (upcoming === true) where.scheduledAt = { gte: now };
      if (upcoming === false) where.scheduledAt = { lt: now };
      const events = await db.ccMarketingEvent.findMany({
        where, orderBy: { scheduledAt: upcoming === false ? "desc" : "asc" }, take: limit,
        select: { title: true, description: true, scheduledAt: true, endsAt: true, location: true, budgetUsd: true, actualCostUsd: true, sponsor: true, status: true, notes: true, mallId: true },
      });
      // Traer nombres de malls para mostrar
      const mallIds = [...new Set(events.map(e => e.mallId))];
      const malls = await db.ccMall.findMany({ where: { id: { in: mallIds } }, select: { id: true, name: true } });
      const mallMap = Object.fromEntries(malls.map(m => [m.id, m.name]));
      return events.map(e => ({
        mall: mallMap[e.mallId] ?? e.mallId,
        title: e.title,
        description: e.description ?? null,
        scheduledAt: e.scheduledAt.toISOString().split("T")[0],
        endsAt: e.endsAt?.toISOString().split("T")[0] ?? null,
        location: e.location ?? null,
        budgetUsd: e.budgetUsd ? Number(e.budgetUsd).toFixed(2) : null,
        actualCostUsd: e.actualCostUsd ? Number(e.actualCostUsd).toFixed(2) : null,
        sponsor: e.sponsor ?? null,
        status: e.status,
        notes: e.notes ?? null,
      }));
    }

    case "get_expiring_tenancies": {
      const mallId = args.mallId as string | undefined;
      const daysAhead = Number(args.daysAhead ?? 90);
      const now = new Date();
      const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      const where: AnyWhere = {
        organizationId,
        endDate: { gte: now, lte: cutoff },
      };
      if (mallId) where.mallId = mallId;
      const tenancies = await db.ccTenancy.findMany({
        where, orderBy: { endDate: "asc" },
        select: {
          tenantName: true, tenantRif: true, tenantEmail: true, tenantPhone: true, tenantContact: true,
          canonType: true, canonUsd: true, startDate: true, endDate: true, notes: true,
          local: { select: { code: true, floor: true, wing: true, mall: { select: { name: true } } } },
        },
      });
      return tenancies.map(t => ({
        local: t.local.code,
        floor: t.local.floor,
        wing: t.local.wing,
        mall: t.local.mall.name,
        tenantName: t.tenantName,
        tenantRif: t.tenantRif,
        email: t.tenantEmail ?? null,
        phone: t.tenantPhone ?? null,
        contact: t.tenantContact ?? null,
        canonType: t.canonType,
        canonUsd: t.canonUsd ? Number(t.canonUsd).toFixed(2) : null,
        startDate: t.startDate.toISOString().split("T")[0],
        endDate: t.endDate!.toISOString().split("T")[0],
        daysUntilExpiry: Math.ceil((t.endDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        notes: t.notes ?? null,
      }));
    }

    case "get_cc_month_close_list": {
      const mallId = args.mallId as string | undefined;
      const limit = Number(args.limit ?? 12);
      const where: AnyWhere = mallId ? { mallId, organizationId } : { organizationId };
      const closes = await db.ccMonthClose.findMany({
        where, orderBy: [{ year: "desc" }, { month: "desc" }], take: limit,
        select: { year: true, month: true, closedAt: true, notes: true, mall: { select: { name: true } } },
      });
      return closes.map(c => ({
        mall: c.mall.name,
        period: `${c.year}-${String(c.month).padStart(2, "0")}`,
        closedAt: c.closedAt.toISOString().split("T")[0],
        notes: c.notes ?? null,
      }));
    }

    default:
      return { error: `Función "${name}" no reconocida en módulo comercial.` };
  }
}

// ─── MOTOR PRINCIPAL DE CHAT ──────────────────────────────────────────────────

export async function geminiChat(input: GeminiChatInput): Promise<string> {
  const client = getClient();
  const isCommercial = input.module === "commercial";

  const now = new Date();
  const todayIso = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const todayMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; // YYYY-MM
  const prevMonth = (() => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  // Último lunes para calcular días relativos
  const dayOfWeek = now.getDay(); // 0=dom,1=lun,...,6=sab
  const lastMonday = new Date(now); lastMonday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  const dayNames = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const dayOffsets: Record<string, number> = { lunes: 1, martes: 2, miércoles: 3, jueves: 4, viernes: 5, sábado: 6, domingo: 0 };
  const lastDays = Object.fromEntries(
    Object.entries(dayOffsets).map(([name, dow]) => {
      const diff = ((dayOfWeek - dow + 7) % 7) || 7;
      const d = new Date(now); d.setDate(now.getDate() - diff);
      return [name, d.toISOString().split("T")[0]];
    })
  );

  const systemInstruction = isCommercial
    ? `Eres un asistente de IA experto en el sistema de gestión de centros comerciales.
Tienes acceso en tiempo real a TODO el sistema: centros comerciales, locales, arrendatarios,
contratos de arrendamiento (CcTenancy), facturas, pagos, gastos, ingresos, declaraciones de ventas,
cierres mensuales y tasas de cambio.

FECHA ACTUAL: ${todayIso} (${dayNames[dayOfWeek]})
MES ACTUAL: ${todayMonth} | MES PASADO: ${prevMonth}
DÍAS RECIENTES: lunes pasado=${lastDays.lunes}, martes=${lastDays.martes}, miércoles=${lastDays.miércoles}, jueves=${lastDays.jueves}, viernes=${lastDays.viernes}, sábado=${lastDays.sábado}, domingo=${lastDays.domingo}
Usa estas fechas para resolver referencias relativas ("hoy", "ayer", "el mes pasado", "el viernes pasado", etc.).

DATOS QUE PUEDES CONSULTAR:
- Centros comerciales (nombre, RIF, dirección, teléfono, email, total de locales, ocupación)
- Locales (código, tipo, piso, ala, área m², canon, tipo de canon, arrendatario vigente)
- Historial de arrendatarios por local
- Locales vacíos o buscando por filtros (piso, ala, tipo)
- Arrendatarios activos (nombre, RIF, email, teléfono, contacto, canon)
- Deudores del mall (locales con saldo negativo)
- Aging de cartera (deuda vencida por rangos: 0-30, 31-60, 61-90, 90+ días)
- Facturas por estado, mes o local (con número de factura y período)
- Pagos registrados por local o mall
- Gastos comunes: resumen por categoría y listado individual (filtrable por mes, categoría, estado)
- Ingresos extra del mall (publicidad, eventos, estacionamiento, etc.)
- Declaraciones de ventas (canon variable)
- Estado del cierre mensual y listado histórico de cierres
- Eventos de marketing y activaciones del mall (ferias, shows, fechas especiales)
- Contratos de arrendamiento próximos a vencer
- Historial de tasas de cambio USD/VES
- Tasa de cambio USD/VES vigente

REGLAS CRÍTICAS:
- Responde siempre en español, claro y profesional.
- Usa $ para USD y Bs para bolívares.
- Cuando el usuario pregunte por datos, usa las funciones disponibles.
- Si no encuentras datos, dilo claramente. NUNCA inventes información.
- Para tablas usa formato de lista con guiones o numeración.
- NUNCA modifiques ni reinterpretes los códigos de local que devuelven las funciones. Si la función devuelve code="L-101", muestra exactamente "L-101".
- Cuando search_tenant ya incluye debtUsd y solvente, NO hagas una llamada adicional a get_local_details. Responde directamente con los datos disponibles.
- Minimiza las llamadas a funciones: si ya tienes la información para responder, responde de inmediato sin hacer llamadas extra.`
    : `Eres un asistente de IA experto en el sistema de gestión de condominios.
Tienes acceso en tiempo real a TODO el sistema: comunidades, unidades, residentes,
finanzas, mantenimiento, seguridad, gobernanza, comunicaciones y amenidades.

FECHA ACTUAL: ${todayIso} (${dayNames[dayOfWeek]})
MES ACTUAL: ${todayMonth} | MES PASADO: ${prevMonth}
DÍAS RECIENTES: lunes pasado=${lastDays.lunes}, martes=${lastDays.martes}, miércoles=${lastDays.miércoles}, jueves=${lastDays.jueves}, viernes=${lastDays.viernes}, sábado=${lastDays.sábado}, domingo=${lastDays.domingo}
Usa estas fechas para resolver referencias relativas ("hoy", "ayer", "el mes pasado", "el viernes pasado", etc.).

DATOS QUE PUEDES CONSULTAR:
- Comunidades/edificios (nombre, ciudad, unidades, cuota mensual, días de vencimiento, teléfono, email)
- Unidades (código, piso, torre, tipo, alícuota, área)
- Propietarios e inquilinos (nombre, cédula, email, teléfono, whatsapp)
- Vehículos registrados (placa, marca, modelo, propietario)
- Resumen financiero (facturado, cobrado, pendiente, % cobranza)
- Aging de cartera (deuda por rangos: 0-30, 31-60, 61-90, 90+ días)
- Deudores (unidades con saldo negativo)
- Facturas por estado, mes, unidad (con número de factura)
- Pagos realizados
- Gastos comunes: resumen por categoría, listado individual (filtrable por torre, estado, categoría)
- Plantillas de gastos recurrentes (gastos fijos configurados)
- Ingresos extra (alquiler de salón, estacionamiento, etc.)
- Presupuesto anual vs ejecución
- Cuentas bancarias
- Pagos no identificados (conciliación bancaria)
- Historial de tasas de cambio USD/VES
- Estado de cierre contable mensual
- Órdenes de mantenimiento (estado, prioridad, contratista)
- Contratistas (especialidad, calificación)
- Infracciones al reglamento y multas
- Visitantes pre-autorizados
- Log de accesos (entradas y salidas al edificio)
- Miembros de la junta directiva
- Asambleas de propietarios y resultados de votaciones
- Áreas comunes y reservas
- Anuncios publicados en tablero
- Documentos de la comunidad (actas, reglamentos)

REGLAS CRÍTICAS:
- Responde siempre en español, claro y profesional.
- Usa $ para USD y Bs para bolívares.
- Cuando el usuario pregunte por datos, usa las funciones disponibles.
- Si no encuentras datos, dilo claramente. NUNCA inventes información.
- Para tablas usa formato de lista con guiones o numeración.
- CÓDIGOS DE UNIDAD: cada edificio usa su propio formato. Los Arrayanes usa códigos SIN guion como "163B", "73A", "11A", "PH1A" (piso+apto+torre). Castaños B usa códigos CON guion como "B-052", "B-011". Pasa el código EXACTAMENTE como lo escribe el usuario a las funciones (la búsqueda ignora mayúsculas/minúsculas). NUNCA reinterpretes ni cambies el formato: si el usuario dice "163B", busca "163B" tal cual — no lo conviertas a "A-16-3" ni a nada. Muestra los códigos tal como los devuelven las funciones.
- Cuando search_resident ya incluye debtUsd y solvente, NO hagas una llamada adicional a get_unit_detail. Responde directamente con los datos disponibles.
- Minimiza las llamadas a funciones: si ya tienes la información para responder, responde de inmediato sin hacer llamadas extra.
- Para buscar por nombre/cédula/email usa search_resident (incluye deuda automáticamente).
- Para detalles adicionales de una unidad (vehículos, facturas desglosadas, órdenes de trabajo) usa get_unit_detail.
- Para buscar por piso/torre usa get_units.

═══════════════════════════════════════════════════════════════════
GUÍA DE PROCESOS (para asistir al admin paso a paso)
═══════════════════════════════════════════════════════════════════
Cuando el admin pregunte "cómo hago X" o "no me sale Y", usa esta guía
para responder con instrucciones precisas. Cita el menú exacto y el flujo.

━━━ 1. CICLO MENSUAL DE FACTURACIÓN ━━━
Flujo ideal cada mes:
  1° del mes: Aplicar plantillas recurrentes (Finanzas → Gastos → tab
    Plantillas → ⚡ Aplicar plantillas recurrentes). Esto crea PROVISION_BASE
    del mes + AJUSTE PROVISION del mes anterior automáticamente.
  Durante el mes: Registrar gastos reales. Si es factura real de un servicio
    provisionado (Hidrocapital, Luz, etc.), VINCULAR a la plantilla en la
    caja ámbar "📊 ¿Es el gasto real de alguna provisión?".
  Fin de mes: Emitir recibos (Finanzas → Recibos → ✨ Emitir recibos).
  Cierre: Finanzas → General → 🔒 Cerrar mes (bloquea modificaciones).

━━━ 2. PROVISIONES (Modelo A — el que usa Arrayanes) ━━━
La provisión = monto fijo estimado que se cobra cada mes (ej. Bs 20.000
de Hidrocapital). Durante el mes, los gastos REALES vinculados sirven solo
para calcular el AJUSTE del mes siguiente (real − provisión).
Si real > provisión → ajuste positivo (se cobra extra al residente).
Si real < provisión → ajuste negativo (crédito al residente).
Las provisiones NO se cobran "el real del mismo mes" — eso es otro modelo
(reembolso). El sistema implementa el Modelo A (provisión + ajuste mes siguiente)
porque coincide con el PDF Aviso de Cobro tradicional de Arrayanes.

━━━ 3. FONDO DE RESERVA AUTOMÁTICO ━━━
Cada Community tiene reserveFundPct (default 0.10 = 10%). El sistema
calcula 10% del subtotal de gastos comunes prorrateados y agrega línea
"Fondo de Reserva (10%)" al final de GASTOS COMUNES. Si ya hay un Expense
manual con category=RESERVE_FUND, NO duplica.

━━━ 4. PREVIEW EN VIVO ━━━
Botón flotante 📄 (esquina inferior izquierda, en cualquier pantalla admin).
Muestra el PDF del recibo del mes con el formato real que verá el residente.
Se actualiza automáticamente cuando: creas/editas gastos, plantillas,
ingresos, cierras/reabres mes. Si no refresca: Ctrl+Shift+R.

━━━ 5. CONCILIACIÓN BANCARIA ━━━
Finanzas → Conciliación → subir CSV/Excel/OFX del banco. El sistema detecta
formato, separador y cabecera. Matchea por: referencia exacta, referencia
parcial, código de unidad, monto en Bs. Etiqueta comisiones (1% banca,
mantenimiento de cuenta) e IGTF 3% automáticamente.

━━━ 6. TASA BCV ━━━
Se actualiza por cron diario (6pm Caracas) + auto-refresh en background
cuando el admin entra a /finance y la tasa no es de hoy. Manualmente:
Finanzas → General → 🔄 Actualizar desde BCV. Si BCV no responde, se puede
cargar tasa manual (queda marcada como source=MANUAL).
Hay 85+ tasas históricas cargadas desde enero 2026: cuando se registra
un pago con fecha pasada, se usa la tasa histórica correcta automáticamente.

━━━ 7. CIERRE DE MES ━━━
Finanzas → General → card 🔒 Cierre de mes. Cerrar bloquea creación/edición
de gastos e ingresos para ese período. Excepción: gastos vinculados a
plantilla de provisión SÍ se pueden registrar aunque el mes esté cerrado
(no se facturan, solo sirven para ajuste). Reabrir: mismo card, botón
🔓 Reabrir mes.

━━━ 8. MANTENIMIENTO CON ALCANCE TORRE ━━━
Mantenimiento → + Nueva orden → selector Alcance: 🏢 Todo / 🏗️ Torre A /
🏗️ Torre B. Para una unidad específica, usar el campo "Unidad específica"
(deshabilita el selector de torre).

━━━ 9. VISITANTES DESDE PORTAL RESIDENTE ━━━
El residente entra al portal → tab Visitantes → + Solicitar. El sistema
crea Visitor con accessCode único. El vigilante en /security ve la lista
con PENDING primero (fondo ámbar destacado) y reloj en tiempo real arriba.
Apreta ✓ Ingreso al llegar (status → CHECKED_IN) y ↑ Salida al salir.

━━━ 10. RECIBO COMO TÍTULO EJECUTIVO ART. 14 LPH ━━━
Los recibos emitidos tienen fuerza ejecutiva según Art. 14 LPH. Para
cobranza extrajudicial: Finanzas → Recibos → seleccionar deudor → 📜
Generar carta legal. El PDF incluye: monto adeudado, días de mora,
intimación según LPH, plazo de pago.

━━━ 11. PLANTILLAS CON CATEGORÍAS NUEVAS ━━━
Las 15 categorías del enum (Electricidad, Agua, etc.) están fijas, pero
puedes crear "categorías virtuales" usando el dropdown CategoryCombobox:
seleccionar "+ Crear nueva categoría", escribir el nombre (ej. "Hidrocapital"),
se guarda como category=OTHER + customCategory="Hidrocapital". El nombre
aparece en el recibo y queda disponible en futuras plantillas/gastos.

━━━ 12. ERRORES COMUNES Y CÓMO RESOLVERLOS ━━━
"Total no puede ser negativo" → era un bug ya arreglado en preview.
  Si aparece: Ctrl+Shift+R.
"Ya se emitieron facturas para X/Y" → el mes ya tiene recibos emitidos.
  Para agregar gasto: marcar isIndividual o vincular a plantilla de provisión.
"El mes X/Y está cerrado" → Reabrir desde Finanzas → General.
"Ya existe un registro con el mismo valor en: userId" → 2 personas comparten
  email. El sistema desvincula automáticamente al anterior — solo notificar.
"No están saliendo las provisiones del mes" → bug ya corregido (provision y
  ajuste se colapsaban en una línea). Ctrl+Shift+R.
`;

  const toolDeclarations: Tool[] = [
    { functionDeclarations: isCommercial ? COMMERCIAL_TOOLS : RESIDENTIAL_TOOLS },
  ];

  const contents: Content[] = input.history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }],
  }));
  contents.push({ role: "user", parts: [{ text: input.message }] });

  for (let round = 0; round < 10; round++) {
    const response = await callWithRetry(() =>
      client.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction,
          tools: toolDeclarations,
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      }),
    );

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    const parts = candidate.content.parts;
    const functionCalls = parts.filter(p => p.functionCall != null);

    if (functionCalls.length === 0) {
      return parts.filter(p => p.text != null).map(p => p.text ?? "").join("") || "No pude generar una respuesta.";
    }

    contents.push({ role: "model", parts });

    const functionResponseParts = await Promise.all(
      functionCalls.map(async part => {
        const fc = part.functionCall!;
        const fnArgs = (fc.args ?? {}) as Record<string, unknown>;
        let result: unknown;
        try {
          result = isCommercial
            ? await runCommercialFunction(fc.name!, fnArgs, input.organizationId)
            : await runResidentialFunction(fc.name!, fnArgs, input.organizationId);
        } catch (err) {
          result = { error: String(err) };
        }
        return { functionResponse: { name: fc.name!, response: { result } } };
      }),
    );

    contents.push({ role: "user", parts: functionResponseParts });
  }

  return "Lo siento, no pude completar la consulta. Por favor intenta de nuevo.";
}
