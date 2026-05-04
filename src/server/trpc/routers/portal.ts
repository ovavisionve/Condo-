/**
 * Router del portal público de residentes.
 * Soporta dos modos de acceso:
 * 1. Token mágico (7 días) — magic link enviado por email
 * 2. Credenciales permanentes — email + contraseña, login vía /login
 */
import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/init";
import { TRPCError } from "@trpc/server";
import { sendEmail } from "@/server/services/email";
import { getCurrentRate } from "@/server/services/exchange";
import { Decimal } from "decimal.js";
import { db } from "@/server/db/client";

const INVOICE_TYPE_LABELS: Record<string, string> = {
  ALIQUOT:     "Cuota mensual",
  SPECIAL_FEE: "Cuota especial",
  FINE:        "Multa",
  EXTRA_FEE:   "Cuota extra",
  OTHER:       "Otro",
};

const METHOD_LABELS: Record<string, string> = {
  CASH_BSS:     "Efectivo Bs",
  CASH_USD:     "Efectivo USD",
  TRANSFER_BSS: "Transferencia Bs",
  TRANSFER_USD: "Transferencia USD",
  ZELLE:        "Zelle",
  PAGO_MOVIL:   "Pago Móvil",
  CRYPTO:       "Criptomoneda",
  CHECK:        "Cheque",
  OTHER:        "Otro",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT:   "Borrador",
  ISSUED:  "Emitida",
  PARTIAL: "Pago parcial",
  PAID:    "Pagada",
  OVERDUE: "Vencida",
  VOIDED:  "Anulada",
};

const MONTHS_ES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

/** Short month abbreviations for chart labels */
const MONTHS_SHORT = [
  "Ene.","Feb.","Mar.","Abr.","May.","Jun.",
  "Jul.","Ago.","Sep.","Oct.","Nov.","Dic.",
];

const AGING_BUCKETS = [
  { label: "0 - 30 días",   min: 0,   max: 30  },
  { label: "31 - 60 días",  min: 31,  max: 60  },
  { label: "61 - 90 días",  min: 61,  max: 90  },
  { label: "91 - 120 días", min: 91,  max: 120 },
  { label: "+120 días",     min: 121, max: Infinity },
];

function daysOverdue(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0;
  const diff = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function agingBucketIndex(days: number): number {
  for (let i = 0; i < AGING_BUCKETS.length; i++) {
    const b = AGING_BUCKETS[i]!;
    if (days >= b.min && days <= b.max) return i;
  }
  return AGING_BUCKETS.length - 1;
}

// ─── Shared helper ────────────────────────────────────────────────────────────

type UnitEntry = {
  unitId: string;
  unitCode: string;
  communityId: string;
  communityName: string;
  communityAddress: string | null;
  role: "Propietario" | "Inquilino";
};

async function buildUnitsForPerson(
  dbClient: typeof db,
  personId: string,
  todayRate: Decimal,
): Promise<Awaited<ReturnType<typeof buildUnitPayload>>[]> {
  const today = new Date();

  const [ownerships, tenancies] = await Promise.all([
    dbClient.ownership.findMany({
      where: { personId, endDate: null },
      include: {
        unit: {
          include: {
            community: { select: { id: true, name: true, address: true } },
          },
        },
      },
    }),
    dbClient.tenancy.findMany({
      where: { personId, endDate: null },
      include: {
        unit: {
          include: {
            community: { select: { id: true, name: true, address: true } },
          },
        },
      },
    }),
  ]);

  const unitEntries: UnitEntry[] = [
    ...ownerships.map((o) => ({
      unitId: o.unit.id,
      unitCode: o.unit.code,
      communityId: o.unit.community.id,
      communityName: o.unit.community.name,
      communityAddress: o.unit.community.address,
      role: "Propietario" as const,
    })),
    ...tenancies.map((t) => ({
      unitId: t.unit.id,
      unitCode: t.unit.code,
      communityId: t.unit.community.id,
      communityName: t.unit.community.name,
      communityAddress: t.unit.community.address,
      role: "Inquilino" as const,
    })),
  ];

  return Promise.all(
    unitEntries.map((entry) => buildUnitPayload(dbClient, entry, todayRate, today)),
  );
}

async function buildUnitPayload(
  dbClient: typeof db,
  entry: UnitEntry,
  todayRate: Decimal,
  today: Date,
) {
  const [invoices, payments] = await Promise.all([
    dbClient.invoice.findMany({
      where: { unitId: entry.unitId, status: { not: "VOIDED" } },
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { issuedAt: "desc" }],
      select: {
        id: true,
        invoiceNumber: true,
        type: true,
        periodYear: true,
        periodMonth: true,
        issuedAt: true,
        dueDate: true,
        totalUsd: true,
        totalBss: true,
        paidUsd: true,
        paidBss: true,
        status: true,
        communityId: true,
        unitId: true,
        exchangeRate: true,
        exchangeSource: true,
      },
    }),
    dbClient.payment.findMany({
      where: { unitId: entry.unitId, voidedAt: null },
      include: {
        allocations: {
          include: { invoice: { select: { invoiceNumber: true } } },
        },
      },
      orderBy: { paidAt: "desc" },
    }),
  ]);

  // Pending invoices (ISSUED / PARTIAL / OVERDUE)
  const pendingStatuses = new Set(["ISSUED", "PARTIAL", "OVERDUE"]);
  const pendingInvoicesRaw = invoices.filter((inv) => pendingStatuses.has(inv.status));

  const pendingInvoices = pendingInvoicesRaw.map((inv) => {
    const pending = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
    const days = daysOverdue(inv.dueDate, today);
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      type: inv.type,
      typeLabel: INVOICE_TYPE_LABELS[inv.type] ?? inv.type,
      periodYear: inv.periodYear,
      periodMonth: inv.periodMonth,
      issuedAt: inv.issuedAt,
      dueDate: inv.dueDate,
      totalUsd: inv.totalUsd.toString(),
      totalBss: inv.totalBss.toString(),
      paidUsd: inv.paidUsd.toString(),
      pendingUsd: pending.toFixed(2),
      status: inv.status,
      statusLabel: STATUS_LABELS[inv.status] ?? inv.status,
      daysOverdue: days,
      monthsOverdue: Math.ceil(days / 30),
    };
  });

  // Total pending USD across all invoices (gross — before applying unallocated credit)
  const totalPendingUsd = invoices.reduce(
    (acc, inv) => acc.plus(inv.totalUsd.toString()).minus(inv.paidUsd.toString()),
    new Decimal(0),
  );

  // Unallocated credit (anticipos): total paid minus total allocated to invoices
  const totalPaidUsd = payments.reduce(
    (acc, p) => acc.plus(p.amountUsd.toString()),
    new Decimal(0),
  );
  const totalAllocatedUsd = payments.reduce(
    (acc, p) =>
      acc.plus(
        p.allocations.reduce((s, a) => s.plus(a.amountUsd.toString()), new Decimal(0)),
      ),
    new Decimal(0),
  );
  const creditAvailableUsd = Decimal.max(new Decimal(0), totalPaidUsd.minus(totalAllocatedUsd));
  // Net pending = gross pending minus unallocated credit
  const netPendingUsd = Decimal.max(new Decimal(0), totalPendingUsd.minus(creditAvailableUsd));

  const pendingBsHoy = netPendingUsd.mul(todayRate);

  // Aging buckets (based on pendingInvoices)
  const agingBuckets = AGING_BUCKETS.map((b) => {
    const usd = pendingInvoices
      .filter((inv) => inv.daysOverdue >= b.min && inv.daysOverdue <= b.max)
      .reduce((acc, inv) => acc.plus(inv.pendingUsd), new Decimal(0));
    return { label: b.label, usd: usd.toNumber() };
  });

  // Last invoice (most recent by periodYear+periodMonth desc — already sorted)
  const lastInvoice = invoices[0]
    ? {
        id: invoices[0].id,
        totalUsd: invoices[0].totalUsd.toString(),
        totalBss: invoices[0].totalBss.toString(),
        periodYear: invoices[0].periodYear,
        periodMonth: invoices[0].periodMonth,
      }
    : null;

  // Last payment (already sorted desc by paidAt)
  const lastPayment = payments[0]
    ? {
        amountUsd: payments[0].amountUsd.toString(),
        amountBss: payments[0].amountBss.toString(),
        paidAt: payments[0].paidAt,
      }
    : null;

  // Payments with running balance calculation (desc order)
  let runningBalance = totalPendingUsd;
  const paymentsWithBalance = payments.map((p) => {
    const amtUsd = new Decimal(p.amountUsd.toString());
    const quedaPendienteUsd = runningBalance;
    const saldoAnteriorUsd = runningBalance.plus(amtUsd);
    runningBalance = saldoAnteriorUsd;
    return {
      id: p.id,
      paidAt: p.paidAt,
      method: p.method,
      methodLabel: METHOD_LABELS[p.method] ?? p.method,
      amountUsd: p.amountUsd.toString(),
      amountBss: p.amountBss.toString(),
      reference: p.reference,
      notes: p.notes ?? null,
      invoices: p.allocations.map((a) => a.invoice.invoiceNumber),
      saldoAnteriorUsd: saldoAnteriorUsd.toFixed(2),
      quedaPendienteUsd: quedaPendienteUsd.toFixed(2),
    };
  });

  // Monthly payment totals — last 6 months
  const monthlyPaymentTotals = buildMonthlyPaymentTotals(payments, today);

  return {
    ...entry,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      type: inv.type,
      typeLabel: INVOICE_TYPE_LABELS[inv.type] ?? inv.type,
      periodYear: inv.periodYear,
      periodMonth: inv.periodMonth,
      issuedAt: inv.issuedAt,
      dueDate: inv.dueDate,
      totalUsd: inv.totalUsd.toString(),
      totalBss: inv.totalBss.toString(),
      paidUsd: inv.paidUsd.toString(),
      pendingUsd: new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString()).toFixed(2),
      status: inv.status,
      statusLabel: STATUS_LABELS[inv.status] ?? inv.status,
    })),
    payments: paymentsWithBalance,
    pendingInvoices,
    agingBuckets,
    lastInvoice,
    lastPayment,
    monthlyPaymentTotals,
    pendingUsd: netPendingUsd.toFixed(2),
    pendingBsHoy: pendingBsHoy.toFixed(2),
    creditAvailableUsd: creditAvailableUsd.toFixed(2),
  };
}

function buildMonthlyPaymentTotals(
  payments: Array<{ paidAt: Date; amountUsd: { toString(): string } }>,
  today: Date,
): Array<{ yearMonth: string; label: string; totalUsd: number }> {
  // Build last 6 months (including current month)
  const months: Array<{ yearMonth: string; label: string; totalUsd: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-indexed
    const yearMonth = `${y}-${String(m + 1).padStart(2, "0")}`;
    const shortName = MONTHS_SHORT[m] ?? String(m + 1);
    months.push({ yearMonth, label: `${shortName} ${y}`, totalUsd: 0 });
  }

  for (const p of payments) {
    const pd = new Date(p.paidAt);
    const ym = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    const slot = months.find((mo) => mo.yearMonth === ym);
    if (slot) {
      slot.totalUsd += new Decimal(p.amountUsd.toString()).toNumber();
    }
  }

  return months.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

// ─── Helper: resolve personId from token or session ──────────────────────────

async function resolvePersonId(
  dbClient: typeof db,
  token: string | undefined,
  sessionUserId: string | undefined,
): Promise<string | null> {
  if (token) {
    const record = await dbClient.portalToken.findUnique({
      where: { token },
      select: { personId: true, expiresAt: true },
    });
    if (!record || record.expiresAt < new Date()) return null;
    return record.personId;
  }
  if (sessionUserId) {
    const person = await dbClient.person.findFirst({
      where: { userId: sessionUserId, deletedAt: null },
      select: { id: true },
    });
    return person?.id ?? null;
  }
  return null;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const portalRouter = router({
  /**
   * El residente ingresa su email. Si existe un Person con ese email,
   * se crea un PortalToken (válido 7 días) y se envía el enlace por correo.
   * Siempre retorna { sent: true } para no revelar si el email existe.
   */
  requestAccess: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const person = await ctx.db.person.findFirst({
        where: { email: input.email.toLowerCase(), deletedAt: null },
      });
      if (!person) return { sent: true };

      await ctx.db.portalToken.deleteMany({
        where: { personId: person.id, expiresAt: { lt: new Date() } },
      });

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const record = await ctx.db.portalToken.create({
        data: { personId: person.id, expiresAt },
      });

      const portalUrl = `${process.env.NEXTAUTH_URL ?? "https://condominios-theta.vercel.app"}/portal?t=${record.token}`;

      await sendEmail({
        to: input.email,
        subject: "Acceso a tu portal de condominio",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2 style="color:#1e3a5f">Portal del residente</h2>
            <p>Hola <strong>${person.firstName} ${person.lastName}</strong>,</p>
            <p>Haz clic en el siguiente botón para acceder a tu portal y ver tus facturas, pagos y saldo:</p>
            <p style="text-align:center;margin:32px 0">
              <a href="${portalUrl}" style="background:#1e3a5f;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600">
                Ver mi estado de cuenta
              </a>
            </p>
            <p style="color:#888;font-size:12px">Este enlace es válido por 7 días. No lo compartas con nadie.</p>
            <p style="color:#888;font-size:12px">Si no solicitaste este correo, ignóralo.</p>
          </div>
        `,
        text: `Hola ${person.firstName}, accede a tu portal aquí: ${portalUrl} (válido 7 días)`,
      });

      return { sent: true };
    }),

  /**
   * Devuelve los datos del residente a partir de un token válido.
   */
  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const record = await ctx.db.portalToken.findUnique({
        where: { token: input.token },
        include: { person: true },
      });

      if (!record || record.expiresAt < new Date()) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "El enlace es inválido o ha expirado. Solicita uno nuevo.",
        });
      }

      const person = record.person;

      let todayRate = new Decimal(1);
      try {
        const rate = await getCurrentRate("BCV");
        todayRate = rate.vesPerUsd;
      } catch {
        // Si no hay tasa, mostrar solo USD
      }

      const units = await buildUnitsForPerson(db, person.id, todayRate);

      return {
        person: {
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email,
          idType: person.idType,
          idNumber: person.idNumber,
          phone: person.phone,
          whatsapp: person.whatsapp,
        },
        units,
        todayRate: todayRate.toFixed(4),
        tokenExpiresAt: record.expiresAt,
      };
    }),

  /**
   * Igual que getByToken pero usa la sesión de NextAuth.
   * Devuelve null si no hay sesión o si el usuario no es un residente.
   */
  getBySession: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.session?.user?.id) return null;

    const person = await ctx.db.person.findFirst({
      where: { userId: ctx.session.user.id, deletedAt: null },
    });
    if (!person) return null;

    let todayRate = new Decimal(1);
    try {
      const rate = await getCurrentRate("BCV");
      todayRate = rate.vesPerUsd;
    } catch {
      // ignore
    }

    const units = await buildUnitsForPerson(db, person.id, todayRate);

    return {
      person: {
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        idType: person.idType,
        idNumber: person.idNumber,
        phone: person.phone,
        whatsapp: person.whatsapp,
      },
      units,
      todayRate: todayRate.toFixed(4),
      tokenExpiresAt: null,
    };
  }),

  /**
   * Detalle completo de un aviso de cobro: ítems, deuda anterior, totales.
   * Acepta token (magic link) o usa la sesión activa.
   */
  getInvoiceDetail: publicProcedure
    .input(z.object({ invoiceId: z.string(), token: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      let personId: string | null = null;
      if (input.token) {
        const record = await ctx.db.portalToken.findUnique({
          where: { token: input.token },
          select: { personId: true, expiresAt: true },
        });
        if (!record || record.expiresAt < new Date()) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Token inválido o expirado" });
        }
        personId = record.personId;
      } else if (ctx.session?.user?.id) {
        const person = await ctx.db.person.findFirst({
          where: { userId: ctx.session.user.id, deletedAt: null },
          select: { id: true },
        });
        personId = person?.id ?? null;
      }
      if (!personId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sin acceso" });

      const [ownerships, tenancies] = await Promise.all([
        ctx.db.ownership.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
        ctx.db.tenancy.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
      ]);
      const unitIds = new Set([...ownerships.map((o) => o.unitId), ...tenancies.map((t) => t.unitId)]);

      const inv = await ctx.db.invoice.findFirstOrThrow({
        where: { id: input.invoiceId },
        include: {
          unit: { select: { code: true, floor: true, tower: true, aliquot: true } },
          items: { orderBy: { description: "asc" } },
        },
      });

      if (!unitIds.has(inv.unitId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este recibo" });
      }

      const [community, ownership, prevDebtAgg] = await Promise.all([
        ctx.db.community.findFirstOrThrow({
          where: { id: inv.communityId },
          select: { name: true, address: true, rif: true, phone: true, email: true },
        }),
        ctx.db.ownership.findFirst({
          where: { unitId: inv.unitId, endDate: null },
          include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
        }),
        ctx.db.invoice.aggregate({
          where: {
            unitId: inv.unitId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
            id: { not: inv.id },
          },
          _sum: { totalUsd: true, paidUsd: true },
        }),
      ]);

      const prevDebtUsd = Math.max(
        0,
        Number(prevDebtAgg._sum.totalUsd ?? 0) - Number(prevDebtAgg._sum.paidUsd ?? 0),
      );
      const thisPendingUsd = Math.max(
        0,
        Number(inv.totalUsd.toString()) - Number(inv.paidUsd.toString()),
      );

      return {
        communityName:    community.name,
        communityAddress: community.address,
        communityRif:     community.rif,
        communityPhone:   community.phone,
        communityEmail:   community.email,
        invoiceNumber:    inv.invoiceNumber,
        periodYear:       inv.periodYear,
        periodMonth:      inv.periodMonth,
        issuedAt:         inv.issuedAt,
        dueDate:          inv.dueDate,
        status:           inv.status,
        unitCode:         inv.unit.code,
        unitFloor:        inv.unit.floor,
        unitTower:        inv.unit.tower,
        aliquot:          inv.unit.aliquot.toString(),
        ownerName: ownership?.person
          ? `${ownership.person.firstName} ${ownership.person.lastName}`
          : null,
        ownerIdNumber: ownership?.person?.idNumber ?? null,
        exchangeRate:   inv.exchangeRate.toString(),
        exchangeSource: inv.exchangeSource,
        items: inv.items.map((it) => ({
          description: it.description,
          aliquot:     it.aliquot?.toString() ?? null,
          amountUsd:   it.amountUsd.toString(),
          amountBss:   it.amountBss.toString(),
        })),
        totalUsd:       inv.totalUsd.toString(),
        totalBss:       inv.totalBss.toString(),
        paidUsd:        inv.paidUsd.toString(),
        paidBss:        inv.paidBss.toString(),
        prevDebtUsd:    prevDebtUsd.toFixed(2),
        thisPendingUsd: thisPendingUsd.toFixed(2),
        totalToPayUsd:  (thisPendingUsd + prevDebtUsd).toFixed(2),
        totalToPayBss:  (
          (thisPendingUsd + prevDebtUsd) * Number(inv.exchangeRate.toString())
        ).toFixed(2),
      };
    }),

  /**
   * Devuelve todos los recibos de un mes combinados en un solo aviso.
   * Agrupa los ítems de todas las facturas del período para mostrar un único documento.
   */
  getInvoicesByMonth: publicProcedure
    .input(z.object({
      unitId: z.string(),
      year:   z.number().int(),
      month:  z.number().int().min(1).max(12),
      token:  z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Autenticación
      let personId: string | null = null;
      if (input.token) {
        const record = await ctx.db.portalToken.findUnique({
          where: { token: input.token },
          select: { personId: true, expiresAt: true },
        });
        if (!record || record.expiresAt < new Date()) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Token inválido o expirado" });
        }
        personId = record.personId;
      } else if (ctx.session?.user?.id) {
        const person = await ctx.db.person.findFirst({
          where: { userId: ctx.session.user.id, deletedAt: null },
          select: { id: true },
        });
        personId = person?.id ?? null;
      }
      if (!personId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sin acceso" });

      const [ownerships, tenancies] = await Promise.all([
        ctx.db.ownership.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
        ctx.db.tenancy.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
      ]);
      const unitIds = new Set([...ownerships.map((o) => o.unitId), ...tenancies.map((t) => t.unitId)]);
      if (!unitIds.has(input.unitId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a esta unidad" });
      }

      // Todas las facturas no anuladas del período
      const invoices = await ctx.db.invoice.findMany({
        where: {
          unitId:      input.unitId,
          periodYear:  input.year,
          periodMonth: input.month,
          status:      { not: "VOIDED" },
        },
        include: {
          unit:  { select: { code: true, floor: true, tower: true, aliquot: true } },
          items: { orderBy: { description: "asc" } },
        },
        orderBy: { issuedAt: "asc" },
      });

      if (invoices.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sin facturas para ese período" });
      }

      const first = invoices[0]!;

      const [community, ownership, prevDebtAgg] = await Promise.all([
        ctx.db.community.findFirstOrThrow({
          where: { id: first.communityId },
          select: { name: true, address: true, rif: true, phone: true, email: true },
        }),
        ctx.db.ownership.findFirst({
          where: { unitId: input.unitId, endDate: null },
          include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
        }),
        ctx.db.invoice.aggregate({
          where: {
            unitId: input.unitId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
            OR: [
              { periodYear: { lt: input.year } },
              { AND: [{ periodYear: input.year }, { periodMonth: { lt: input.month } }] },
            ],
          },
          _sum: { totalUsd: true, paidUsd: true },
        }),
      ]);

      // Combinar totales y todos los ítems
      let totalUsd = 0;
      let totalBss = 0;
      let paidUsd  = 0;
      let paidBss  = 0;
      const allItems: { invoiceNumber: string; description: string; aliquot: string | null; amountUsd: string; amountBss: string }[] = [];
      const invoiceNumbers: string[] = [];

      for (const inv of invoices) {
        totalUsd += Number(inv.totalUsd.toString());
        totalBss += Number(inv.totalBss.toString());
        paidUsd  += Number(inv.paidUsd.toString());
        paidBss  += Number(inv.paidBss.toString());
        invoiceNumbers.push(inv.invoiceNumber);
        for (const it of inv.items) {
          allItems.push({
            invoiceNumber: inv.invoiceNumber,
            description:   it.description,
            aliquot:       it.aliquot?.toString() ?? null,
            amountUsd:     it.amountUsd.toString(),
            amountBss:     it.amountBss.toString(),
          });
        }
      }

      const prevDebtUsd = Math.max(
        0,
        Number(prevDebtAgg._sum.totalUsd ?? 0) - Number(prevDebtAgg._sum.paidUsd ?? 0),
      );
      const thisPendingUsd = Math.max(0, totalUsd - paidUsd);

      return {
        communityName:    community.name,
        communityAddress: community.address,
        communityRif:     community.rif,
        communityPhone:   community.phone,
        communityEmail:   community.email,
        invoiceNumbers,
        primaryInvoiceId: first.id,
        periodYear:       first.periodYear,
        periodMonth:      first.periodMonth,
        issuedAt:         first.issuedAt,
        dueDate:          first.dueDate,
        status:           first.status,
        unitCode:         first.unit.code,
        unitFloor:        first.unit.floor,
        unitTower:        first.unit.tower,
        aliquot:          first.unit.aliquot.toString(),
        ownerName: ownership?.person
          ? `${ownership.person.firstName} ${ownership.person.lastName}`
          : null,
        ownerIdNumber: ownership?.person?.idNumber ?? null,
        exchangeRate:   first.exchangeRate.toString(),
        exchangeSource: first.exchangeSource,
        items:          allItems,
        totalUsd:       totalUsd.toFixed(2),
        totalBss:       totalBss.toFixed(2),
        paidUsd:        paidUsd.toFixed(2),
        paidBss:        paidBss.toFixed(2),
        prevDebtUsd:    prevDebtUsd.toFixed(2),
        thisPendingUsd: thisPendingUsd.toFixed(2),
        totalToPayUsd:  (thisPendingUsd + prevDebtUsd).toFixed(2),
        totalToPayBss:  ((thisPendingUsd + prevDebtUsd) * Number(first.exchangeRate.toString())).toFixed(2),
      };
    }),

  /**
   * Descarga el PDF de un recibo. Valida que el invoice pertenezca al residente.
   */
  downloadInvoicePdf: publicProcedure
    .input(z.object({ invoiceId: z.string(), token: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      let personId: string | null = null;

      if (input.token) {
        const record = await ctx.db.portalToken.findUnique({
          where: { token: input.token },
          select: { personId: true, expiresAt: true },
        });
        if (!record || record.expiresAt < new Date()) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Token inválido o expirado" });
        }
        personId = record.personId;
      } else if (ctx.session?.user?.id) {
        const person = await ctx.db.person.findFirst({
          where: { userId: ctx.session.user.id, deletedAt: null },
          select: { id: true },
        });
        personId = person?.id ?? null;
      }

      if (!personId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sin acceso" });

      const [ownerships, tenancies] = await Promise.all([
        ctx.db.ownership.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
        ctx.db.tenancy.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
      ]);
      const unitIds = new Set([...ownerships.map((o) => o.unitId), ...tenancies.map((t) => t.unitId)]);

      const inv = await ctx.db.invoice.findFirstOrThrow({
        where: { id: input.invoiceId },
        include: {
          unit: true,
          items: { orderBy: { description: "asc" } },
          payments: {
            include: {
              payment: {
                select: { paidAt: true, method: true, amountUsd: true, amountBss: true, reference: true },
              },
            },
          },
        },
      });

      if (!unitIds.has(inv.unitId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este recibo" });
      }

      const [community, ownership, bankAccounts] = await Promise.all([
        ctx.db.community.findFirstOrThrow({
          where: { id: inv.communityId },
          select: { name: true, address: true, rif: true },
        }),
        ctx.db.ownership.findFirst({
          where: { unitId: inv.unitId, endDate: null },
          include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
        }),
        ctx.db.bankAccount.findMany({
          where: { communityId: inv.communityId, active: true },
          select: {
            bankName: true, accountNumber: true, accountHolder: true,
            accountType: true, currency: true,
          },
        }),
      ]);

      const { generateInvoicePdf } = await import("@/server/services/pdf");
      const buffer = await generateInvoicePdf({
        communityName: community.name,
        communityAddress: community.address ?? "",
        communityRif: community.rif,
        invoiceNumber: inv.invoiceNumber,
        periodYear: inv.periodYear,
        periodMonth: inv.periodMonth,
        issuedAt: inv.issuedAt,
        dueDate: inv.dueDate,
        status: inv.status,
        exchangeRate: inv.exchangeRate.toString(),
        exchangeSource: inv.exchangeSource,
        unitCode: inv.unit.code,
        unitFloor: inv.unit.floor,
        unitTower: inv.unit.tower,
        ownerName: ownership?.person
          ? `${ownership.person.firstName} ${ownership.person.lastName}`
          : "Sin propietario",
        ownerIdType: ownership?.person?.idType,
        ownerIdNumber: ownership?.person?.idNumber,
        items: inv.items.map((it) => ({
          description: it.description,
          aliquot: it.aliquot?.toString(),
          amountUsd: it.amountUsd.toString(),
          amountBss: it.amountBss.toString(),
        })),
        totalUsd: inv.totalUsd.toString(),
        totalBss: inv.totalBss.toString(),
        paidUsd: inv.paidUsd.toString(),
        paidBss: inv.paidBss.toString(),
        paymentsApplied: inv.payments.map((pa) => ({
          paidAt: pa.payment.paidAt,
          method: pa.payment.method,
          amountUsd: pa.payment.amountUsd.toString(),
          amountBss: pa.payment.amountBss.toString(),
          reference: pa.payment.reference,
        })),
        bankAccounts: bankAccounts.map((b) => ({
          bankName: b.bankName, accountNumber: b.accountNumber,
          accountHolder: b.accountHolder, accountType: b.accountType, currency: b.currency,
        })),
      });

      return {
        base64: buffer.toString("base64"),
        fileName: `Recibo-${inv.invoiceNumber}.pdf`,
        mimeType: "application/pdf",
      };
    }),

  /**
   * Deuda general de la comunidad. Requiere token o sesión válida del residente.
   * Devuelve aging de cartera a nivel comunidad + detalle por unidad.
   */
  getDeudaGeneral: publicProcedure
    .input(z.object({ communityId: z.string(), token: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // Validate identity
      const personId = await resolvePersonId(
        ctx.db,
        input.token,
        ctx.session?.user?.id,
      );
      if (!personId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sin acceso" });
      }

      // Confirm resident belongs to this community
      const [ownerships, tenancies] = await Promise.all([
        ctx.db.ownership.findMany({
          where: { personId, endDate: null },
          include: { unit: { select: { communityId: true } } },
        }),
        ctx.db.tenancy.findMany({
          where: { personId, endDate: null },
          include: { unit: { select: { communityId: true } } },
        }),
      ]);
      const communityIds = new Set([
        ...ownerships.map((o) => o.unit.communityId),
        ...tenancies.map((t) => t.unit.communityId),
      ]);
      if (!communityIds.has(input.communityId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a esta comunidad" });
      }

      const today = new Date();

      // Query all pending invoices for this community
      const pendingInvoices = await ctx.db.invoice.findMany({
        where: {
          communityId: input.communityId,
          status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
        },
        select: {
          id: true,
          unitId: true,
          dueDate: true,
          totalUsd: true,
          paidUsd: true,
          unit: {
            select: {
              code: true,
              ownerships: {
                where: { endDate: null },
                take: 1,
                include: { person: { select: { firstName: true, lastName: true } } },
              },
            },
          },
        },
      });

      // Group by unit
      type UnitDebtEntry = {
        unitCode: string;
        ownerName: string | null;
        pendingUsd: Decimal;
        maxDaysOverdue: number;
      };
      const unitMap = new Map<string, UnitDebtEntry>();

      // Aging accumulators
      const agingUsd = AGING_BUCKETS.map(() => new Decimal(0));
      const agingUnitSets = AGING_BUCKETS.map(() => new Set<string>());
      let totalPending = new Decimal(0);

      for (const inv of pendingInvoices) {
        const pending = new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
        if (pending.lte(0)) continue;

        totalPending = totalPending.plus(pending);

        const days = daysOverdue(inv.dueDate, today);
        const bucketIdx = agingBucketIndex(days);
        agingUsd[bucketIdx] = agingUsd[bucketIdx]!.plus(pending);
        agingUnitSets[bucketIdx]!.add(inv.unitId);

        // Unit accumulation
        const existing = unitMap.get(inv.unitId);
        const ownerPerson = inv.unit.ownerships[0]?.person ?? null;
        const ownerName = ownerPerson
          ? `${ownerPerson.firstName} ${ownerPerson.lastName}`
          : null;
        if (existing) {
          existing.pendingUsd = existing.pendingUsd.plus(pending);
          existing.maxDaysOverdue = Math.max(existing.maxDaysOverdue, days);
        } else {
          unitMap.set(inv.unitId, {
            unitCode: inv.unit.code,
            ownerName,
            pendingUsd: pending,
            maxDaysOverdue: days,
          });
        }
      }

      const agingBuckets = AGING_BUCKETS.map((b, i) => ({
        label: b.label,
        usd: agingUsd[i]!.toNumber(),
        count: agingUnitSets[i]!.size,
      }));

      const unidades = Array.from(unitMap.values())
        .map((u) => ({
          unitCode: u.unitCode,
          ownerName: u.ownerName,
          pendingUsd: u.pendingUsd.toFixed(2),
          overdueMonths: Math.ceil(u.maxDaysOverdue / 30),
        }))
        .sort((a, b) => Number(b.pendingUsd) - Number(a.pendingUsd));

      return {
        totalPendingUsd: totalPending.toFixed(2),
        agingBuckets,
        unidades,
      };
    }),

  /**
   * Descarga bauche (comprobante de pago) en PDF.
   */
  downloadPaymentVoucher: publicProcedure
    .input(z.object({ paymentId: z.string(), token: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const personId = await resolvePersonId(ctx.db, input.token, ctx.session?.user?.id);
      if (!personId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sin acceso" });

      const [ownerships, tenancies] = await Promise.all([
        ctx.db.ownership.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
        ctx.db.tenancy.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
      ]);
      const unitIds = new Set([
        ...ownerships.map((o) => o.unitId),
        ...tenancies.map((t) => t.unitId),
      ]);

      const payment = await ctx.db.payment.findFirstOrThrow({
        where: { id: input.paymentId },
        include: {
          unit: {
            include: {
              community: {
                select: { name: true, address: true, rif: true, phone: true },
              },
              ownerships: {
                where: { endDate: null },
                take: 1,
                include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
              },
            },
          },
          allocations: {
            include: {
              invoice: {
                select: {
                  invoiceNumber: true, periodYear: true, periodMonth: true,
                },
              },
            },
          },
        },
      });

      if (!unitIds.has(payment.unitId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este bauche" });
      }

      const owner = payment.unit.ownerships[0];
      const personName = owner
        ? `${owner.person.firstName} ${owner.person.lastName}`
        : "Residente";
      const personDocId = owner
        ? `${owner.person.idType} ${owner.person.idNumber}`
        : undefined;

      const invoicesData = payment.allocations.map((alloc) => {
        const inv = alloc.invoice;
        const period =
          inv.periodMonth && inv.periodYear
            ? `${String(inv.periodMonth).padStart(2, "0")}/${inv.periodYear}`
            : "";
        return {
          number: inv.invoiceNumber,
          period,
          amountUsd: alloc.amountUsd.toString(),
        };
      });

      const { generatePaymentVoucherPdf } = await import("@/server/services/pdf");
      const buffer = await generatePaymentVoucherPdf({
        communityName: payment.unit.community.name,
        communityAddress: payment.unit.community.address ?? undefined,
        communityRif: payment.unit.community.rif ?? undefined,
        communityPhone: payment.unit.community.phone ?? undefined,
        paymentId: payment.id,
        unitCode: payment.unit.code,
        personName,
        personId: personDocId,
        amountUsd: payment.amountUsd.toString(),
        amountBss: payment.amountBss.toString(),
        exchangeRate: payment.exchangeRate.toString(),
        method: payment.method,
        reference: payment.reference ?? undefined,
        paidAt: payment.paidAt,
        invoices: invoicesData,
      });

      return {
        base64: buffer.toString("base64"),
        fileName: `Bauche-${payment.id.slice(-8).toUpperCase()}.pdf`,
        mimeType: "application/pdf",
      };
    }),

  /**
   * Notifica al administrador de la comunidad sobre un pago realizado.
   * Crea un registro de Notification (con prefijo PAGO_POR_VERIFICAR:) visible en el panel admin
   * y envía email al admin.
   */
  notificarPago: publicProcedure
    .input(
      z.object({
        token: z.string().optional(),
        unitId: z.string(),
        banco: z.string().min(1),
        referencia: z.string().min(1),
        monto: z.coerce.number().positive(),
        moneda: z.enum(["USD", "VES"]).default("USD"),
        fechaPago: z.coerce.date(),
        tipoPago: z.enum(["ANTICIPO", "CUOTA_ESPECIFICA", "GENERAL"]).default("GENERAL"),
        invoiceId: z.string().optional(), // si tipoPago === "CUOTA_ESPECIFICA"
        notas: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate identity
      const personId = await resolvePersonId(
        ctx.db,
        input.token,
        ctx.session?.user?.id,
      );
      if (!personId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sin acceso" });
      }

      // Verify unit belongs to person
      const [ownerships, tenancies] = await Promise.all([
        ctx.db.ownership.findMany({
          where: { personId, endDate: null },
          select: { unitId: true },
        }),
        ctx.db.tenancy.findMany({
          where: { personId, endDate: null },
          select: { unitId: true },
        }),
      ]);
      const unitIds = new Set([
        ...ownerships.map((o) => o.unitId),
        ...tenancies.map((t) => t.unitId),
      ]);
      if (!unitIds.has(input.unitId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a esta unidad" });
      }

      // Load unit + community + organization
      const unit = await ctx.db.unit.findFirstOrThrow({
        where: { id: input.unitId },
        include: {
          community: {
            include: {
              organization: {
                include: {
                  // Buscar ORG_ADMIN primero, luego COMMUNITY_ADMIN como fallback
                  memberships: {
                    where: { role: { in: ["ORG_ADMIN", "COMMUNITY_ADMIN"] } },
                    include: { user: { select: { email: true, name: true } } },
                  },
                },
              },
            },
          },
        },
      });

      const community = unit.community;
      const organization = community.organization;
      // Preferir ORG_ADMIN sobre COMMUNITY_ADMIN; usar community.email como último fallback
      const orgAdmin = organization.memberships.find((m) => m.role === "ORG_ADMIN");
      const commAdmin = organization.memberships.find((m) => m.role === "COMMUNITY_ADMIN");
      const adminUser = orgAdmin?.user ?? commAdmin?.user ?? null;
      // Dirección de email destino: usuario admin o email configurado en la comunidad
      const adminEmail = adminUser?.email ?? community.email ?? null;

      // Load person info
      const person = await ctx.db.person.findFirstOrThrow({
        where: { id: personId },
        select: { firstName: true, lastName: true, email: true, phone: true },
      });

      const fechaStr = input.fechaPago.toLocaleDateString("es-VE", {
        day: "2-digit", month: "long", year: "numeric",
      });
      const montoStr = `${input.moneda === "USD" ? "$" : "Bs."}${input.monto.toFixed(2)}`;

      const TIPO_PAGO_LABELS_EMAIL: Record<string, string> = {
        ANTICIPO: "Anticipo / Adelanto (sin factura específica)",
        CUOTA_ESPECIFICA: "Cuota específica",
        GENERAL: "Pago general",
      };
      const tipoPagoStr = TIPO_PAGO_LABELS_EMAIL[input.tipoPago] ?? input.tipoPago;

      // Send email to admin (ORG_ADMIN / COMMUNITY_ADMIN / community.email)
      if (adminEmail) {
        await sendEmail({
          to: adminEmail,
          subject: `Notificación de pago — ${community.name} · Unidad ${unit.code}`,
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:auto">
              <h2 style="color:#1e3a5f">Notificación de pago recibido</h2>
              <p>El residente <strong>${person.firstName} ${person.lastName}</strong> ha reportado un pago:</p>
              <table style="border-collapse:collapse;width:100%">
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Comunidad</td><td style="padding:6px 12px">${community.name}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Unidad</td><td style="padding:6px 12px">${unit.code}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Tipo de pago</td><td style="padding:6px 12px"><strong style="color:#1e3a5f">${tipoPagoStr}</strong></td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Banco / Método</td><td style="padding:6px 12px">${input.banco}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Referencia</td><td style="padding:6px 12px">${input.referencia}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Monto</td><td style="padding:6px 12px"><strong>${montoStr}</strong></td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Fecha de pago</td><td style="padding:6px 12px">${fechaStr}</td></tr>
                ${input.notas ? `<tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Notas</td><td style="padding:6px 12px">${input.notas}</td></tr>` : ""}
              </table>
              ${input.tipoPago === "ANTICIPO" ? `<p style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 14px;margin-top:16px;font-size:13px;color:#92400e">⚠️ <strong>Anticipo:</strong> Este pago no tiene factura asignada. Regístralo como anticipo en Finanzas → Pagos. El crédito se aplicará automáticamente cuando generes las próximas facturas.</p>` : ""}
              <p style="color:#888;font-size:12px;margin-top:24px">Este correo fue generado automáticamente desde el portal de residentes.</p>
            </div>
          `,
          text: `[${tipoPagoStr}] Pago reportado por ${person.firstName} ${person.lastName}: ${montoStr} via ${input.banco}, ref ${input.referencia}, fecha ${fechaStr}.`,
        });
      }

      // Confirmación al residente (si tiene email registrado)
      if (person.email) {
        await sendEmail({
          to: person.email,
          subject: `Notificación enviada — ${community.name}`,
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:auto">
              <h2 style="color:#1e3a5f">Notificación de pago enviada</h2>
              <p>Hola <strong>${person.firstName}</strong>, tu notificación de pago fue recibida correctamente por la Junta de Condominio <strong>${community.name}</strong>.</p>
              <table style="border-collapse:collapse;width:100%;margin:16px 0">
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Banco / Método</td><td style="padding:6px 12px">${input.banco}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Referencia</td><td style="padding:6px 12px">${input.referencia}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Monto</td><td style="padding:6px 12px"><strong>${montoStr}</strong></td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;background:#f3f4f6">Fecha de pago</td><td style="padding:6px 12px">${fechaStr}</td></tr>
              </table>
              <p style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:6px;padding:10px 14px;font-size:13px;color:#065f46">
                ✅ La Junta verificará tu pago y lo registrará en el sistema. Recibirás una actualización cuando esté procesado.
              </p>
              <p style="color:#888;font-size:12px;margin-top:24px">Este correo fue generado automáticamente desde el portal de residentes.</p>
            </div>
          `,
          text: `Tu notificación de pago fue recibida. Referencia: ${input.referencia}, Monto: ${montoStr}, Fecha: ${fechaStr}. La Junta la verificará pronto.`,
        });
      }

      // Create Notification record with structured JSON prefix for admin panel
      const TIPO_PAGO_LABELS: Record<string, string> = {
        ANTICIPO: "Anticipo / Adelanto",
        CUOTA_ESPECIFICA: "Cuota específica",
        GENERAL: "Pago general",
      };
      const paymentReportPayload = JSON.stringify({
        unitId: unit.id,
        unitCode: unit.code,
        communityId: community.id,
        communityName: community.name,
        personId,
        personName: `${person.firstName} ${person.lastName}`,
        banco: input.banco,
        referencia: input.referencia,
        monto: input.monto,
        moneda: input.moneda,
        fechaPago: input.fechaPago.toISOString(),
        tipoPago: input.tipoPago,
        tipoPagoLabel: TIPO_PAGO_LABELS[input.tipoPago] ?? input.tipoPago,
        invoiceId: input.invoiceId ?? null,
        notas: input.notas ?? null,
        estado: "PENDIENTE",
        createdAt: new Date().toISOString(),
      });
      await ctx.db.notification.create({
        data: {
          channel: "IN_APP",
          event: "ANNOUNCEMENT",
          status: "SENT",
          organizationId: organization.id,
          communityId: community.id,
          personId,
          body: `PAGO_POR_VERIFICAR:${paymentReportPayload}`,
        },
      });

      return { ok: true };
    }),

  /** Resumen financiero del condominio para el mes indicado (visible en portal). */
  getCommunityMonthSummary: publicProcedure
    .input(z.object({
      communityId: z.string(),
      year:  z.number().int(),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ ctx, input }) => {
      const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
      const monthEnd   = new Date(Date.UTC(input.year, input.month, 1));

      const [invoiceAgg, paymentAgg, totalUnits, paidUnits] = await Promise.all([
        ctx.db.invoice.aggregate({
          where: {
            communityId: input.communityId,
            periodYear:  input.year,
            periodMonth: input.month,
            status: { not: "VOIDED" },
          },
          _sum: { totalUsd: true },
          _count: true,
        }),
        ctx.db.payment.aggregate({
          where: {
            communityId: input.communityId,
            voidedAt: null,
            paidAt: { gte: monthStart, lt: monthEnd },
          },
          _sum: { amountUsd: true },
          _count: true,
        }),
        ctx.db.unit.count({ where: { communityId: input.communityId, active: true, deletedAt: null } }),
        ctx.db.invoice.count({
          where: {
            communityId: input.communityId,
            periodYear:  input.year,
            periodMonth: input.month,
            status: "PAID",
          },
        }),
      ]);

      const totalInvoiced  = Number(invoiceAgg._sum.totalUsd ?? 0);
      const totalCollected = Number(paymentAgg._sum.amountUsd ?? 0);

      return {
        year: input.year,
        month: input.month,
        totalInvoicedUsd:  totalInvoiced.toFixed(2),
        totalCollectedUsd: totalCollected.toFixed(2),
        pendingUsd:        Math.max(0, totalInvoiced - totalCollected).toFixed(2),
        invoiceCount:      invoiceAgg._count,
        paymentCount:      paymentAgg._count,
        totalUnits,
        paidUnits,
        collectionRate:    totalInvoiced > 0
          ? Math.round((totalCollected / totalInvoiced) * 100)
          : 0,
      };
    }),

  // ─── Visitantes de la unidad (con código QR) ──────────────────────────────
  myVisitors: publicProcedure
    .input(z.object({
      unitId: z.string(),
      token: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const visitors = await db.visitor.findMany({
        where: { unitId: input.unitId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          status: true,
          validFrom: true,
          validUntil: true,
          purpose: true,
          accessCode: true,
          unit: { select: { code: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return visitors;
    }),
});
