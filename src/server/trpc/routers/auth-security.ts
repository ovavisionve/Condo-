/**
 * Router de seguridad de autenticación.
 * Procedimientos públicos: requestPasswordReset, validateResetToken, resetPassword.
 */
import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/init";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendEmail } from "@/server/services/email";

const TOKEN_EXPIRY_MINUTES = 15;

const passwordSchema = z
  .string()
  .min(8, "Mínimo 8 caracteres")
  .regex(/[A-Z]/, "Debe incluir al menos una mayúscula")
  .regex(/[0-9]/, "Debe incluir al menos un número");

export const authSecurityRouter = router({

  /** Solicitar recuperación de contraseña */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      // Siempre responder "OK" para no revelar si el email existe
      const user = await db.user.findUnique({
        where: { email: input.email.toLowerCase() },
        select: { id: true, email: true, name: true, active: true, deletedAt: true },
      });

      if (!user || !user.active || user.deletedAt) {
        // No revelar que no existe — respuesta idéntica
        return { ok: true };
      }

      // Invalidar tokens anteriores del usuario
      await db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() }, // marcar como usados (invalidados)
      });

      // Crear nuevo token seguro
      const rawToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

      await db.passwordResetToken.create({
        data: {
          token: rawToken,
          userId: user.id,
          expiresAt,
        },
      });

      const resetUrl = `${process.env.NEXTAUTH_URL}/login/reset-password?token=${rawToken}`;

      await sendEmail({
        to: user.email,
        subject: "Recuperar contraseña — ResidIA",
        html: buildPasswordResetEmail({ name: user.name, resetUrl, expiresMinutes: TOKEN_EXPIRY_MINUTES }),
        text: `Usa este enlace para restablecer tu contraseña (válido ${TOKEN_EXPIRY_MINUTES} min): ${resetUrl}`,
      });

      return { ok: true };
    }),

  /** Validar si un token es válido (sin usarlo) */
  validateResetToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const record = await db.passwordResetToken.findUnique({
        where: { token: input.token },
        select: { expiresAt: true, usedAt: true, user: { select: { email: true } } },
      });

      if (!record || record.usedAt || record.expiresAt < new Date()) {
        return { valid: false, email: null };
      }

      return { valid: true, email: record.user.email };
    }),

  /** Cambiar contraseña usando el token */
  resetPassword: publicProcedure
    .input(z.object({
      token: z.string(),
      password: passwordSchema,
    }))
    .mutation(async ({ input }) => {
      const record = await db.passwordResetToken.findUnique({
        where: { token: input.token },
        include: { user: { select: { id: true, active: true, deletedAt: true } } },
      });

      if (!record || record.usedAt || record.expiresAt < new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El enlace es inválido o ya expiró. Solicita uno nuevo.",
        });
      }

      if (!record.user.active || record.user.deletedAt) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cuenta desactivada." });
      }

      const hash = await bcrypt.hash(input.password, 12);

      await db.$transaction([
        // Actualizar contraseña y resetear contadores de seguridad
        db.user.update({
          where: { id: record.userId },
          data: {
            passwordHash: hash,
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        }),
        // Marcar token como usado
        db.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
        // Invalidar todos los tokens anteriores del usuario
        db.passwordResetToken.updateMany({
          where: { userId: record.userId, id: { not: record.id } },
          data: { usedAt: new Date() },
        }),
      ]);

      return { ok: true };
    }),
});

// ─── Email template ──────────────────────────────────────────────────────────

function buildPasswordResetEmail({
  name,
  resetUrl,
  expiresMinutes,
}: {
  name: string | null;
  resetUrl: string;
  expiresMinutes: number;
}): string {
  const displayName = name ?? "Usuario";
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">

    <!-- Header -->
    <div style="background:#1e293b;padding:28px 36px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;background:#3b82f6;border-radius:8px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-weight:800;font-size:18px;">R</span>
        </div>
        <span style="color:#fff;font-size:18px;font-weight:700;">ResidIA</span>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:36px;">
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">Recuperar contraseña</h1>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola, ${displayName}.</p>

      <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.6;">
        Recibimos una solicitud para restablecer la contraseña de tu cuenta.
        Haz clic en el botón a continuación para elegir una nueva contraseña.
      </p>

      <div style="text-align:center;margin-bottom:28px;">
        <a href="${resetUrl}"
           style="display:inline-block;background:#1e293b;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">
          🔑 Restablecer contraseña
        </a>
      </div>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0;color:#92400e;font-size:13px;">
          ⏱ Este enlace es válido por <strong>${expiresMinutes} minutos</strong> y solo puede usarse una vez.
          Si no solicitaste este cambio, ignora este correo.
        </p>
      </div>

      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
        Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
        <span style="color:#3b82f6;word-break:break-all;">${resetUrl}</span>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 36px;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        ResidIA — Sistema de gestión de condominios · Este correo es automático, no responder.
      </p>
    </div>
  </div>
</body>
</html>`;
}
