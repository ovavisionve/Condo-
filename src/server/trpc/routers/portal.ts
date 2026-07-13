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
import { shiftPeriod, unshiftPeriod } from "@/server/services/invoice-pdf-builder";
import { Decimal } from "decimal.js";
import { db } from "@/server/db/client";
import bcrypt from "bcryptjs";

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

// "Vigente" (aún no vence) va PRIMERO, igual que el "current" del aging admin
// (reports.ts communitySummary) — antes se recortaba a 0 y una factura recién emitida
// (que ni siquiera ha vencido) caía en el bucket "0-30 días" como si ya estuviera
// vencida. Bug encontrado 04-jul-2026 con impacto ACTUAL: el recibo de julio (vence
// 8/jul, hoy 4/jul) se mostraba como "vencido 0-30 días" en las 188 unidades.
const AGING_BUCKETS = [
  { label: "Vigente (no vence aún)", min: -Infinity, max: -1 },
  { label: "0 - 30 días",   min: 0,   max: 30  },
  { label: "31 - 60 días",  min: 31,  max: 60  },
  { label: "61 - 90 días",  min: 61,  max: 90  },
  { label: "91 - 120 días", min: 91,  max: 120 },
  { label: "+120 días",     min: 121, max: Infinity },
];

/** Días desde el vencimiento — puede ser NEGATIVO si la factura aún no vence (igual
 * que el aging admin, reports.ts). No recortar a 0 aquí: eso perdía la distinción entre
 * "vigente" y "recién vencida" en los buckets. Para mostrar "meses vencida" en pantalla,
 * usar Math.max(0, ...) en el punto de uso, no acá. */
function daysOverdue(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0;
  return Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
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
  const [invoices, payments, communityShiftRow] = await Promise.all([
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
    dbClient.community.findUnique({
      where: { id: entry.communityId },
      select: { invoicePeriodShift: true },
    }),
  ]);

  // El recibo se nombra por el mes que COBRA (período de emisión − shift). Igual que
  // en el PDF y el email: recibo emitido en julio (período 7) con shift=1 → "Junio".
  const periodShift = communityShiftRow?.invoicePeriodShift ?? 0;

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
      ...shiftPeriod(inv.periodYear, inv.periodMonth, periodShift),
      issuedAt: inv.issuedAt,
      dueDate: inv.dueDate,
      totalUsd: inv.totalUsd.toString(),
      totalBss: inv.totalBss.toString(),
      paidUsd: inv.paidUsd.toString(),
      pendingUsd: pending.toFixed(2),
      status: inv.status,
      statusLabel: STATUS_LABELS[inv.status] ?? inv.status,
      daysOverdue: days,
      // Nunca negativo en pantalla: si aún no vence, "0 meses vencida" (no "-1").
      monthsOverdue: Math.max(0, Math.ceil(days / 30)),
    };
  });

  // Total pending USD (gross, antes de aplicar el crédito no asignado). Se calcula SOLO
  // sobre facturas ISSUED/PARTIAL/OVERDUE (pendingInvoicesRaw) — antes sumaba `invoices`
  // completo, que también incluye PAID (pending=0, inofensivo) y DRAFT (facturas aún no
  // publicadas al residente, que si tuvieran monto pendiente se contarían igual sin deber
  // contarse). Con esto la deuda del portal queda IDÉNTICA a la fórmula del admin
  // (residentes list / getDeudaGeneral), que siempre filtró por estos 3 estados.
  const totalPendingUsd = pendingInvoicesRaw.reduce(
    (acc, inv) => acc.plus(inv.totalUsd.toString()).minus(inv.paidUsd.toString()),
    new Decimal(0),
  );

  // Unallocated credit (anticipos): total paid minus total allocated to invoices.
  // OJO: los pagos históricos migrados (isHistorical) NO cuentan — se muestran en
  // el historial pero la deuda real ya está cargada como total neto, así que sumarlos
  // como crédito anularía el saldo. Solo los pagos reales generan anticipo.
  const realPayments = payments.filter((p) => !p.isHistorical);
  const totalPaidUsd = realPayments.reduce(
    (acc, p) => acc.plus(p.amountUsd.toString()),
    new Decimal(0),
  );
  const totalAllocatedUsd = realPayments.reduce(
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
        ...shiftPeriod(invoices[0].periodYear, invoices[0].periodMonth, periodShift),
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

  // Payments with running balance calculation (desc order). El saldo corrido solo
  // aplica a pagos REALES (los históricos migrados no tienen factura mensual asociada,
  // así que sus columnas de saldo van nulas → se muestran como "—").
  let runningBalance = totalPendingUsd;
  const paymentsWithBalance = payments.map((p) => {
    const amtUsd = new Decimal(p.amountUsd.toString());
    let saldoAnteriorUsd: string | null = null;
    let quedaPendienteUsd: string | null = null;
    if (!p.isHistorical) {
      quedaPendienteUsd = runningBalance.toFixed(2);
      const saldoAnterior = runningBalance.plus(amtUsd);
      saldoAnteriorUsd = saldoAnterior.toFixed(2);
      runningBalance = saldoAnterior;
    }
    return {
      id: p.id,
      paidAt: p.paidAt,
      method: p.method,
      methodLabel: METHOD_LABELS[p.method] ?? p.method,
      amountUsd: p.amountUsd.toString(),
      amountBss: p.amountBss.toString(),
      reference: p.reference,
      notes: p.notes ?? null,
      isHistorical: p.isHistorical,
      invoices: p.allocations.map((a) => a.invoice.invoiceNumber),
      saldoAnteriorUsd,
      quedaPendienteUsd,
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
      ...shiftPeriod(inv.periodYear, inv.periodMonth, periodShift),
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
  /**
   * Onboarding obligatorio del residente — la primera vez que entra al portal
   * debe completar WhatsApp, email(s), nombre y apellido. Pedido cliente Reinaldo
   * 8/jun/2026: "que la primera vez le pregunte obligatoriamente sus datos hasta
   * que lo llenen no podrán seguir". Esta data alimenta el sistema directo
   * (Person) y habilita el envío masivo por email y bot de WhatsApp.
   */
  updateOwnProfile: publicProcedure
    .input(
      z.object({
        token: z.string().optional(),
        firstName: z.string().min(2).max(80),
        lastName: z.string().min(2).max(80),
        whatsapp: z.string().min(7).max(20), // OBLIGATORIO. Solo dígitos + (códigos de país)
        email: z.string().email(),
        emailSecondary: z.string().email().nullable().optional(), // opcional
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionUserId = ctx.session?.user?.id;
      const personId = await resolvePersonId(ctx.db, input.token, sessionUserId);
      if (!personId) throw new TRPCError({ code: "UNAUTHORIZED" });

      // Normalizar whatsapp: solo dígitos, con código país 58 si no lo trae
      const digits = input.whatsapp.replace(/\D/g, "");
      const waNumber = digits.startsWith("58") ? digits : digits.startsWith("0") ? `58${digits.slice(1)}` : `58${digits}`;

      const updated = await ctx.db.person.update({
        where: { id: personId },
        data: {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          whatsapp: waNumber,
          email: input.email.toLowerCase().trim(),
          // emailSecondary se guarda como nota si no hay columna específica
          notes: input.emailSecondary?.trim()
            ? `Email secundario: ${input.emailSecondary.toLowerCase().trim()}`
            : undefined,
          // Marca que el residente ya confirmó sus datos → no se le vuelve a pedir.
          portalConfirmedAt: new Date(),
        },
        select: { id: true, firstName: true, lastName: true, whatsapp: true, email: true },
      });
      return { ok: true, person: updated };
    }),

  /**
   * El residente (autenticado por enlace mágico o sesión) crea/cambia su propia
   * contraseña para entrar con email+clave la próxima vez, SIN que nunca se le
   * envíe una clave por correo. Crea/vincula el User (email = usuario).
   */
  setOwnPassword: publicProcedure
    .input(z.object({ token: z.string().optional(), password: z.string().min(8).max(72) }))
    .mutation(async ({ ctx, input }) => {
      const sessionUserId = ctx.session?.user?.id;
      const personId = await resolvePersonId(ctx.db, input.token, sessionUserId);
      if (!personId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const person = await ctx.db.person.findUniqueOrThrow({ where: { id: personId } });
      if (!person.email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Necesitas un email registrado para crear una contraseña. Confirma tus datos primero.",
        });
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      // El login (NextAuth) siempre busca por email en minúsculas — normalizar aquí
      // también, o el User quedaría con mayúsculas y el residente nunca podría entrar
      // (bug encontrado 03-jul-2026: emails importados del Excel con mayúsculas).
      // resolveLoginEmail además maneja emails COMPARTIDOS entre residentes distintos
      // (ej. familia con un solo Gmail para 2 apartamentos): si el email ya es de OTRA
      // persona activa, genera un alias único "+unidad" en vez de robarle el acceso.
      const { resolveLoginEmail } = await import("@/server/services/login-email");
      const loginEmail = await resolveLoginEmail(person.id, person.email);

      // Crear o vincular el User (email = usuario)
      let user = person.userId
        ? await ctx.db.user.findUnique({ where: { id: person.userId } })
        : await ctx.db.user.findUnique({ where: { email: loginEmail } });

      if (user) {
        user = await ctx.db.user.update({
          where: { id: user.id },
          data: { passwordHash, active: true, emailVerified: new Date(), email: loginEmail },
        });
      } else {
        user = await ctx.db.user.create({
          data: {
            email: loginEmail,
            name: `${person.firstName} ${person.lastName}`,
            passwordHash,
            emailVerified: new Date(),
            active: true,
          },
        });
      }

      if (person.userId !== user.id) {
        await ctx.db.person.update({ where: { id: person.id }, data: { userId: user.id } });
      }

      // loginEmail puede diferir de person.email (alias "+" si el correo es compartido
      // con otro residente) — el frontend debe mostrárselo al residente para que sepa
      // con qué dirección exacta debe iniciar sesión la próxima vez.
      return { ok: true, email: person.email, loginEmail };
    }),

  requestAccess: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      // mode:"insensitive" porque Person.email puede tener mayúsculas de importaciones
      // viejas (Excel) que no se normalizaron — sin esto, un residente con email
      // "Nombre@Gmail.com" nunca se encontraba al escribir su correo en minúsculas.
      const person = await ctx.db.person.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" }, deletedAt: null },
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

      // SMTP de la organización (el mismo que usan recibos/bauches). Tiene
      // prioridad sobre el SMTP global de env vars; si la org no tiene SMTP
      // configurado, sendEmail cae al global como fallback.
      const org = await ctx.db.organization.findUnique({
        where: { id: person.organizationId },
        select: {
          smtpHost: true, smtpPort: true, smtpUser: true,
          smtpPass: true, smtpFrom: true, smtpSecure: true,
        },
      });
      const orgSmtp = org?.smtpHost && org.smtpUser && org.smtpPass
        ? {
            host: org.smtpHost,
            port: org.smtpPort ?? 587,
            user: org.smtpUser,
            pass: org.smtpPass,
            from: org.smtpFrom ?? org.smtpUser,
            secure: org.smtpSecure,
          }
        : null;

      await sendEmail({
        to: input.email,
        subject: "Acceso a tu portal de condominio",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;color:#1f2937">
            <div style="background:#1e3a5f;border-radius:12px 12px 0 0;padding:24px;text-align:center">
              <div style="color:#cfe0f5;font-size:13px;font-weight:600;letter-spacing:.5px">ResidIA</div>
              <div style="color:#fff;font-size:20px;font-weight:600;margin-top:6px">Bienvenido/a al portal de tu condominio</div>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
              <p>Hola <strong>${person.firstName} ${person.lastName}</strong>,</p>
              <p>Este es tu acceso digital al condominio. Desde tu celular o computadora puedes:</p>
              <ul style="padding-left:18px;line-height:1.8;color:#374151">
                <li>📄 Ver y descargar tu recibo</li>
                <li>💵 Notificar tus pagos</li>
                <li>🧾 Ver tu estado de cuenta y saldo</li>
                <li>🧍 Registrar visitas y reservar áreas comunes</li>
              </ul>
              <p style="text-align:center;margin:28px 0">
                <a href="${portalUrl}" style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
                  Entrar a mi portal →
                </a>
              </p>
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;font-size:13px;color:#1e40af">
                ⚠️ La primera vez te pediremos <strong>confirmar tu correo y WhatsApp</strong>. Solo toma un minuto y nos ayuda a tener tus datos al día.
              </div>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-top:16px;text-align:center">
                <div style="font-size:13px;color:#475569;margin-bottom:8px">¿No sabes por dónde empezar? Tenemos un manual paso a paso 👇</div>
                <a href="${portalUrl.replace(/\/portal\?t=.*/, "/portal/help")}" style="color:#1e3a5f;font-size:14px;font-weight:600;text-decoration:none">
                  📖 Ver el manual: cómo usar el portal →
                </a>
              </div>
              <p style="color:#9ca3af;font-size:12px;margin-top:18px">Este enlace es válido por 7 días y es personal — no lo compartas.</p>
              <p style="color:#9ca3af;font-size:12px">Si no esperabas este correo, ignóralo.</p>
            </div>
          </div>
        `,
        text: `Hola ${person.firstName}, bienvenido/a al portal de tu condominio. Entra aquí para ver tu recibo, pagos y saldo: ${portalUrl} (válido 7 días). La primera vez te pediremos confirmar tu correo y WhatsApp. Manual de uso paso a paso: ${portalUrl.replace(/\/portal\?t=.*/, "/portal/help")}`,
        orgSmtp,
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
          portalConfirmedAt: person.portalConfirmedAt,
          hasPassword: !!person.userId,
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
        portalConfirmedAt: person.portalConfirmedAt,
        hasPassword: !!person.userId,
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
          // Sin orderBy por descripción: separaba Provisión de Ajuste (bug 07-jul-2026,
          // el orden se reconstruye abajo con buildProvisionPairKeys).
          items: {
            include: {
              expense: {
                select: { id: true, kind: true, category: true, towerScope: true, recurringTemplateId: true, createdAt: true },
              },
            },
          },
        },
      });

      if (!unitIds.has(inv.unitId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este recibo" });
      }

      // Reordenar items para intercalar Provisión→Ajuste (mismo patrón que
      // buildInvoicePdfData / getInvoicesByMonth).
      {
        const { buildProvisionPairKeys } = await import("@/server/services/invoicing");
        const pairKeys = buildProvisionPairKeys(
          inv.items.map((it) => it.expense).filter((e): e is NonNullable<typeof e> => e != null),
        );
        const itemSortKey = (it: (typeof inv.items)[number]): string => {
          const exp = it.expense;
          if (exp && (exp.kind === "PROVISION_BASE" || exp.kind === "PROVISION_ADJUSTMENT")) {
            const token = pairKeys.get(exp.id) ?? exp.id;
            const sub = exp.kind === "PROVISION_ADJUSTMENT" ? "1" : "0";
            return `1|${token}|${sub}`;
          }
          if (!exp) return `3|${it.description}`;
          if (exp.category === "RESERVE_FUND") return "5";
          return `4|${exp.createdAt.toISOString()}|${it.description}`;
        };
        inv.items.sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b)));
      }

      const [community, ownership, prevDebtAgg] = await Promise.all([
        ctx.db.community.findFirstOrThrow({
          where: { id: inv.communityId },
          select: { name: true, address: true, rif: true, phone: true, email: true, invoicePeriodShift: true },
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
        // Mostrar el mes COBRADO (charged), no el de emisión — mismo bug de shift ya
        // corregido en getInvoicesByMonth pero nunca aplicado acá (07-jul-2026).
        ...shiftPeriod(inv.periodYear, inv.periodMonth, community.invoicePeriodShift ?? 0),
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

      // input.year/month viene del selector de "Avisos de cobro", que muestra el mes
      // COBRADO (ya desplazado, ej. "Junio"). Pero Invoice.periodYear/periodMonth siempre
      // guarda el mes de EMISIÓN (ej. Julio). Hay que revertir el shift ANTES de consultar,
      // o esta query encuentra la factura equivocada (bug encontrado 04-jul-2026: el
      // selector mostraba "Junio" pero al abrirlo traía el recibo de mayo, emitido en junio).
      const unitForShift = await ctx.db.unit.findUniqueOrThrow({
        where: { id: input.unitId },
        select: { communityId: true },
      });
      const communityForShift = await ctx.db.community.findUniqueOrThrow({
        where: { id: unitForShift.communityId },
        select: { invoicePeriodShift: true },
      });
      const shift = communityForShift.invoicePeriodShift ?? 0;
      const rawPeriod = unshiftPeriod(input.year, input.month, shift);

      // Todas las facturas no anuladas del período (en su período de EMISIÓN real).
      // Sin orderBy por descripción en items: separaba "AJUSTE PROVISION MES ANTERIOR"
      // (alfabéticamente antes) de "PROVISION X" — el orden se reconstruye abajo con
      // buildProvisionPairKeys, igual que buildInvoicePdfData (bug encontrado 07-jul-2026,
      // Reinaldo: "el recibo está todo desordenado" — esta pestaña nunca recibió el fix
      // que sí se aplicó al PDF descargado).
      const invoices = await ctx.db.invoice.findMany({
        where: {
          unitId:      input.unitId,
          periodYear:  rawPeriod.periodYear,
          periodMonth: rawPeriod.periodMonth,
          status:      { not: "VOIDED" },
        },
        include: {
          unit: { select: { code: true, floor: true, tower: true, aliquot: true } },
          items: {
            include: {
              expense: {
                select: { id: true, kind: true, category: true, towerScope: true, recurringTemplateId: true, createdAt: true },
              },
            },
          },
        },
        orderBy: { issuedAt: "asc" },
      });

      // Reordenar los items de CADA factura para intercalar Provisión→Ajuste (mismo
      // patrón que invoice-pdf-builder.ts buildInvoicePdfData).
      const { buildProvisionPairKeys } = await import("@/server/services/invoicing");
      for (const inv of invoices) {
        const pairKeys = buildProvisionPairKeys(
          inv.items.map((it) => it.expense).filter((e): e is NonNullable<typeof e> => e != null),
        );
        const itemSortKey = (it: (typeof inv.items)[number]): string => {
          const exp = it.expense;
          if (exp && (exp.kind === "PROVISION_BASE" || exp.kind === "PROVISION_ADJUSTMENT")) {
            const token = pairKeys.get(exp.id) ?? exp.id;
            const sub = exp.kind === "PROVISION_ADJUSTMENT" ? "1" : "0";
            return `1|${token}|${sub}`;
          }
          if (!exp) return `3|${it.description}`;
          if (exp.category === "RESERVE_FUND") return "5";
          return `4|${exp.createdAt.toISOString()}|${it.description}`;
        };
        inv.items.sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b)));
      }

      if (invoices.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sin facturas para ese período" });
      }

      const first = invoices[0]!;

      const [community, ownership, prevDebtInvoices, creditPayments] = await Promise.all([
        ctx.db.community.findFirstOrThrow({
          where: { id: first.communityId },
          select: { name: true, address: true, rif: true, phone: true, email: true },
        }),
        ctx.db.ownership.findFirst({
          where: { unitId: input.unitId, endDate: null },
          include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
        }),
        // "Deuda anterior" = facturas con mes de EMISIÓN estrictamente anterior a esta
        // (misma unidad de período que rawPeriod, no el input ya desplazado). Se trae la
        // lista (no un aggregate) para poder contar cuántos MESES distintos debe.
        ctx.db.invoice.findMany({
          where: {
            unitId: input.unitId,
            status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
            OR: [
              { periodYear: { lt: rawPeriod.periodYear } },
              { AND: [{ periodYear: rawPeriod.periodYear }, { periodMonth: { lt: rawPeriod.periodMonth } }] },
            ],
          },
          select: { totalUsd: true, paidUsd: true, periodYear: true, periodMonth: true },
        }),
        // Saldo a favor (anticipo): SOLO pagos reales (isHistorical: false) — igual que
        // buildUnitPayload/previewReceiptPdf/buildInvoicePdfData. Bug corregido 05-jul-2026:
        // este endpoint no aplicaba ningún crédito (ni falso ni real), mostrando un total a
        // pagar más alto de lo debido para las unidades con anticipo genuino.
        ctx.db.payment.findMany({
          where: { unitId: input.unitId, voidedAt: null, isHistorical: false },
          select: { amountUsd: true, allocations: { select: { amountUsd: true } } },
        }),
      ]);

      const prevDebtAgg = {
        _sum: {
          totalUsd: prevDebtInvoices.reduce((s, i) => s + Number(i.totalUsd), 0),
          paidUsd: prevDebtInvoices.reduce((s, i) => s + Number(i.paidUsd), 0),
        },
      };
      const debtMonthsSet = new Set<string>();
      for (const i of prevDebtInvoices) {
        if (Number(i.totalUsd) - Number(i.paidUsd) > 0.005) debtMonthsSet.add(`${i.periodYear}-${i.periodMonth}`);
      }
      const debtMonthsCount = debtMonthsSet.size;

      let creditUsd = 0;
      for (const p of creditPayments) {
        const tU = Number(p.amountUsd);
        const aU = p.allocations.reduce((s, a) => s + Number(a.amountUsd), 0);
        if (tU - aU > 0.005) creditUsd += tU - aU;
      }

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
      // Crédito real (anticipo) tope al total a pagar — nunca deja el total en negativo.
      const creditApplyUsd = Math.min(creditUsd, thisPendingUsd + prevDebtUsd);

      return {
        communityName:    community.name,
        communityAddress: community.address,
        communityRif:     community.rif,
        communityPhone:   community.phone,
        communityEmail:   community.email,
        invoiceNumbers,
        primaryInvoiceId: first.id,
        // Mostrar el mes COBRADO (charged), no el de emisión — igual que el resto del
        // portal/PDF/email (bug encontrado 04-jul-2026: el aviso mostraba "Julio" cuando
        // debía decir "Junio").
        ...shiftPeriod(first.periodYear, first.periodMonth, shift),
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
        // Meses distintos (no filas de factura) con saldo pendiente de meses anteriores —
        // pedido cliente 05-jul-2026: "que sepamos cuántos meses debe cada quien".
        debtMonthsCount,
        thisPendingUsd: thisPendingUsd.toFixed(2),
        creditUsd:      creditApplyUsd > 0.005 ? creditApplyUsd.toFixed(2) : undefined,
        totalToPayUsd:  Math.max(0, thisPendingUsd + prevDebtUsd - creditApplyUsd).toFixed(2),
        totalToPayBss:  (Math.max(0, thisPendingUsd + prevDebtUsd - creditApplyUsd) * Number(first.exchangeRate.toString())).toFixed(2),
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

      // Validar acceso del residente a este recibo antes de generar el PDF
      const invAccess = await ctx.db.invoice.findFirstOrThrow({
        where: { id: input.invoiceId },
        select: { unitId: true, invoiceNumber: true },
      });
      if (!unitIds.has(invAccess.unitId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este recibo" });
      }

      // Usa el mismo builder que el admin para garantizar paridad de contenido:
      // secciones con SUBTOTAL/TOTAL, Fondo de Reserva acumulado del edificio,
      // Saldo a Favor del residente, formato Aviso de Cobro.
      const { buildInvoicePdfData } = await import("@/server/services/invoice-pdf-builder");
      const { generateInvoicePdf } = await import("@/server/services/pdf");
      const data = await buildInvoicePdfData(input.invoiceId);
      const buffer = await generateInvoicePdf(data);

      return {
        base64: buffer.toString("base64"),
        fileName: `Recibo-${invAccess.invoiceNumber}.pdf`,
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

      // Privacidad: no exponemos nombres de propietarios al portal del residente
      // (pedido cliente 8/jun/2026 para Castaños y Arrayanes). Solo unidad+deuda+mora.
      const unidades = Array.from(unitMap.values())
        .map((u) => ({
          unitCode: u.unitCode,
          pendingUsd: u.pendingUsd.toFixed(2),
          // Nunca negativo: si el mayor vencimiento de la unidad todavía no vence, 0 meses.
          overdueMonths: Math.max(0, Math.ceil(u.maxDaysOverdue / 30)),
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
                select: { name: true, address: true, rif: true, phone: true, invoicePeriodShift: true },
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

      const MONTHS_PDF_P = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
      const vShift = payment.unit.community.invoicePeriodShift ?? 0;
      const invoicesData = payment.allocations.map((alloc) => {
        const inv = alloc.invoice;
        const sp = inv.periodMonth && inv.periodYear
          ? shiftPeriod(inv.periodYear, inv.periodMonth, vShift)
          : null;
        const period = sp ? `${MONTHS_PDF_P[sp.periodMonth - 1]} ${sp.periodYear}` : "";
        return {
          number: inv.invoiceNumber,
          period,
          amountUsd: alloc.amountUsd.toString(),
        };
      });

      // Saldo a favor: monto del pago - lo aplicado a facturas
      const { Decimal: DecP } = await import("decimal.js");
      const totalUsdP = new DecP(payment.amountUsd.toString());
      const totalBssP = new DecP(payment.amountBss.toString());
      const allocUsdP = payment.allocations.reduce(
        (s, a) => s.plus(a.amountUsd.toString()),
        new DecP(0),
      );
      const allocBssP = payment.allocations.reduce(
        (s, a) => s.plus(a.amountBss.toString()),
        new DecP(0),
      );
      const creditUsdP = DecP.max(0, totalUsdP.minus(allocUsdP));
      const creditBssP = DecP.max(0, totalBssP.minus(allocBssP));

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
        creditUsd: creditUsdP.gt(0.005) ? creditUsdP.toFixed(2) : undefined,
        creditBss: creditBssP.gt(0.005) ? creditBssP.toFixed(2) : undefined,
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
        // Captura de pantalla en data URL base64 (image/jpeg|png|webp). Max ~2.5MB.
        // Pedido cliente: "colocar para poder subir cap de pantalla".
        screenshot: z.string().max(3_500_000).optional(),
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
                  // Buscar ORG_ADMIN primero, luego COMMUNITY_ADMIN como fallback.
                  // CRÍTICO: filtrar active:true — una membership revocada no debe
                  // seguir recibiendo notificaciones de pago (bug real encontrado
                  // 09-jul-2026: una cuenta de prueba con email inválido, aunque se
                  // revocara, seguía "ganando" el .find() porque esta query no
                  // filtraba por active).
                  memberships: {
                    where: { role: { in: ["ORG_ADMIN", "COMMUNITY_ADMIN"] }, active: true },
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

      // SMTP de la org (mismo que recibos) para que estas notificaciones no usen
      // el SMTP global. Fallback al global si la org no tiene SMTP.
      const orgRec = await ctx.db.organization.findUnique({
        where: { id: organization.id },
        select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true },
      });
      const orgSmtp = orgRec?.smtpHost && orgRec.smtpUser && orgRec.smtpPass
        ? {
            host: orgRec.smtpHost,
            port: orgRec.smtpPort ?? 587,
            user: orgRec.smtpUser,
            pass: orgRec.smtpPass,
            from: orgRec.smtpFrom ?? orgRec.smtpUser,
            secure: orgRec.smtpSecure,
          }
        : null;

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
          orgSmtp,
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
          orgSmtp,
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
        // La captura va en el JSON estructurado del cuerpo de la notificación.
        // El admin la ve al aprobar el pago (preview en el dialog de aprobación).
        screenshot: input.screenshot ?? null,
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
            isHistorical: false,
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

      // Tasa BCV del día para mostrar Bs primario en el portal (pedido cliente).
      const { getCurrentRate } = await import("@/server/services/exchange");
      const rateRec = await getCurrentRate("BCV");
      const rate = Number(rateRec.vesPerUsd);

      return {
        year: input.year,
        month: input.month,
        totalInvoicedUsd:  totalInvoiced.toFixed(2),
        totalCollectedUsd: totalCollected.toFixed(2),
        pendingUsd:        Math.max(0, totalInvoiced - totalCollected).toFixed(2),
        totalInvoicedBss:  (totalInvoiced * rate).toFixed(2),
        totalCollectedBss: (totalCollected * rate).toFixed(2),
        pendingBss:        (Math.max(0, totalInvoiced - totalCollected) * rate).toFixed(2),
        rate:              rate.toFixed(8),
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

  /**
   * Pre-autoriza un visitante desde el portal del residente.
   * El residente provee datos del visitante, fechas válidas y motivo.
   * Se crea un Visitor con status PENDING + accessCode único (para QR).
   * Pedido del cliente: "poder solicitar visitantes desde el portal de residente".
   */
  requestVisitor: publicProcedure
    .input(z.object({
      token: z.string().optional(),
      unitId: z.string(),
      firstName: z.string().min(1).max(80),
      lastName: z.string().min(1).max(80),
      idNumber: z.string().max(20).optional(),
      idType: z.enum(["V", "E", "P", "J"]).default("V"),
      phone: z.string().max(20).optional(),
      vehiclePlate: z.string().max(20).optional(),
      validFrom: z.coerce.date(),
      validUntil: z.coerce.date(),
      purpose: z.string().max(200).optional(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const personId = await resolvePersonId(ctx.db, input.token, ctx.session?.user?.id);
      if (!personId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sin acceso" });
      }

      // Verificar que la unidad pertenezca al residente
      const [ownerships, tenancies] = await Promise.all([
        ctx.db.ownership.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
        ctx.db.tenancy.findMany({ where: { personId, endDate: null }, select: { unitId: true } }),
      ]);
      const unitIds = new Set([
        ...ownerships.map((o) => o.unitId),
        ...tenancies.map((t) => t.unitId),
      ]);
      if (!unitIds.has(input.unitId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a esta unidad" });
      }

      // Validar fechas
      if (input.validUntil <= input.validFrom) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha final debe ser posterior a la inicial" });
      }

      const unit = await ctx.db.unit.findFirstOrThrow({
        where: { id: input.unitId },
        select: { organizationId: true, communityId: true, code: true },
      });

      // Buscar el User asociado al residente (para authorizedById)
      const person = await ctx.db.person.findUnique({
        where: { id: personId },
        select: { userId: true, firstName: true, lastName: true },
      });

      const visitor = await ctx.db.visitor.create({
        data: {
          organizationId: unit.organizationId,
          communityId: unit.communityId,
          unitId: input.unitId,
          authorizedById: person?.userId ?? null,
          firstName: input.firstName,
          lastName: input.lastName,
          idNumber: input.idNumber ?? null,
          idType: input.idType,
          phone: input.phone ?? null,
          vehiclePlate: input.vehiclePlate ?? null,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          purpose: input.purpose ?? null,
          notes: input.notes ?? null,
          status: "PENDING",
        },
        select: { id: true, accessCode: true, firstName: true, lastName: true },
      });

      return {
        ok: true,
        visitorId: visitor.id,
        accessCode: visitor.accessCode,
      };
    }),
});
