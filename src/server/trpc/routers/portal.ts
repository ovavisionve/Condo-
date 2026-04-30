/**
 * Router del portal público de residentes.
 * No requiere autenticación de admin — usa tokens de acceso enviados por email.
 */
import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/init";
import { TRPCError } from "@trpc/server";
import { sendEmail } from "@/server/services/email";
import { getCurrentRate } from "@/server/services/exchange";
import { Decimal } from "decimal.js";

const INVOICE_TYPE_LABELS: Record<string, string> = {
  ALIQUOT:    "Cuota mensual",
  SPECIAL_FEE:"Cuota especial",
  FINE:       "Multa",
  EXTRA_FEE:  "Cuota extra",
  OTHER:      "Otro",
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
      if (!person) return { sent: true }; // no revelar si existe

      // Eliminar tokens vencidos de esta persona
      await ctx.db.portalToken.deleteMany({
        where: { personId: person.id, expiresAt: { lt: new Date() } },
      });

      // Crear nuevo token (7 días)
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
   * Incluye: datos personales, unidades, facturas, pagos, saldo en USD y Bs al cambio de hoy.
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

      // Obtener unidades activas (propietario e inquilino)
      const [ownerships, tenancies] = await Promise.all([
        ctx.db.ownership.findMany({
          where: { personId: person.id, endDate: null },
          include: {
            unit: {
              include: {
                community: { select: { id: true, name: true, address: true } },
              },
            },
          },
        }),
        ctx.db.tenancy.findMany({
          where: { personId: person.id, endDate: null },
          include: {
            unit: {
              include: {
                community: { select: { id: true, name: true, address: true } },
              },
            },
          },
        }),
      ]);

      // Unir unidades con rol
      type UnitEntry = {
        unitId: string;
        unitCode: string;
        communityName: string;
        communityAddress: string | null;
        role: "Propietario" | "Inquilino";
      };

      const unitEntries: UnitEntry[] = [
        ...ownerships.map((o) => ({
          unitId: o.unit.id,
          unitCode: o.unit.code,
          communityName: o.unit.community.name,
          communityAddress: o.unit.community.address,
          role: "Propietario" as const,
        })),
        ...tenancies.map((t) => ({
          unitId: t.unit.id,
          unitCode: t.unit.code,
          communityName: t.unit.community.name,
          communityAddress: t.unit.community.address,
          role: "Inquilino" as const,
        })),
      ];

      // Obtener tasa de hoy
      let todayRate = new Decimal(1);
      try {
        const rate = await getCurrentRate("BCV");
        todayRate = rate.vesPerUsd;
      } catch {
        // Si no hay tasa, mostrar solo USD
      }

      // Para cada unidad, obtener facturas y pagos
      const units = await Promise.all(
        unitEntries.map(async (entry) => {
          const [invoices, payments] = await Promise.all([
            ctx.db.invoice.findMany({
              where: { unitId: entry.unitId, status: { not: "VOIDED" } },
              orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { issuedAt: "desc" }],
            }),
            ctx.db.payment.findMany({
              where: { unitId: entry.unitId, voidedAt: null },
              include: {
                allocations: {
                  include: { invoice: { select: { invoiceNumber: true } } },
                },
              },
              orderBy: { paidAt: "desc" },
            }),
          ]);

          // Calcular saldo en USD (fijo) y Bs al cambio de hoy
          const pendingUsd = invoices.reduce((acc, inv) => {
            return acc.plus(inv.totalUsd.toString()).minus(inv.paidUsd.toString());
          }, new Decimal(0));
          const pendingBsHoy = pendingUsd.mul(todayRate);

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
              paidUsd: inv.paidUsd.toString(),
              pendingUsd: new Decimal(inv.totalUsd.toString()).minus(inv.paidUsd.toString()).toFixed(2),
              status: inv.status,
              statusLabel: STATUS_LABELS[inv.status] ?? inv.status,
            })),
            payments: payments.map((p) => ({
              id: p.id,
              paidAt: p.paidAt,
              method: p.method,
              methodLabel: METHOD_LABELS[p.method] ?? p.method,
              amountUsd: p.amountUsd.toString(),
              amountBss: p.amountBss.toString(),
              reference: p.reference,
              invoices: p.allocations.map((a) => a.invoice.invoiceNumber),
            })),
            pendingUsd: pendingUsd.toFixed(2),
            pendingBsHoy: pendingBsHoy.toFixed(2),
          };
        }),
      );

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
});
