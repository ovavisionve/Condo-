import { z } from "zod";
import { router } from "@/server/trpc/init";
import { orgProcedure, platformProcedure } from "@/server/trpc/init";
import { TRPCError } from "@trpc/server";
import { geminiChat } from "@/server/services/gemini";

const orgIdInput = z.object({ organizationId: z.string() });

export const aiRouter = router({
  /**
   * Verifica si el módulo de IA está habilitado para una organización.
   */
  isEnabled: orgProcedure
    .input(orgIdInput)
    .query(async ({ ctx, input }) => {
      const org = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
        select: { aiEnabled: true },
      });
      return { enabled: org?.aiEnabled ?? false };
    }),

  /**
   * Envía un mensaje al bot y obtiene respuesta.
   * Maneja el historial de conversación multi-turn con function calling.
   */
  chat: orgProcedure
    .input(
      orgIdInput.extend({
        module: z.enum(["residential", "commercial"]),
        history: z.array(
          z.object({
            role: z.enum(["user", "model"]),
            content: z.string(),
          }),
        ),
        message: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verificar que la IA está habilitada para esta organización
      const org = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
        select: { aiEnabled: true, name: true },
      });

      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organización no encontrada" });
      }

      if (!org.aiEnabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "El módulo de IA no está habilitado para esta organización",
        });
      }

      const response = await geminiChat({
        organizationId: input.organizationId,
        module: input.module,
        history: input.history,
        message: input.message,
      });

      return { response };
    }),

  /**
   * Activa o desactiva la IA para una organización (solo plataforma).
   */
  toggleEnabled: platformProcedure
    .input(z.object({ organizationId: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.db.organization.update({
        where: { id: input.organizationId },
        data: { aiEnabled: input.enabled },
        select: { id: true, name: true, aiEnabled: true },
      });
      return org;
    }),
});
