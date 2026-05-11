import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Session } from "next-auth";
import { auth, type SessionMembership } from "@/server/auth/config";
import { db } from "@/server/db/client";
import { isPlatform, canManageOrganization, canManageCommunity } from "@/server/auth/permissions";

export type Context = {
  session: Session | null;
  db: typeof db;
};

export const createContext = async (): Promise<Context> => {
  const session = (await auth()) as Session | null;
  return { session, db };
};

/**
 * Traduce errores técnicos a mensajes que el usuario puede entender y accionar.
 * Cubre los códigos de Prisma más comunes. Los TRPCError con `message` propio
 * pasan tal cual (asumimos que el dev ya lo redactó para el usuario).
 */
function humanizeServerError(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const err = error as { code?: string; message?: string; name?: string; meta?: Record<string, unknown> };

  // Prisma errors (PrismaClientKnownRequestError)
  if (err.name === "PrismaClientKnownRequestError" && err.code) {
    switch (err.code) {
      case "P2002": {
        const target = err.meta?.target;
        const field = Array.isArray(target) ? target.join(", ") : String(target ?? "campo");
        return `Ya existe un registro con el mismo valor en: ${field}.`;
      }
      case "P2025":
        return "El registro buscado no existe o ya fue eliminado.";
      case "P2003":
        return "No se puede completar la operación porque hay datos relacionados que dependen de este registro.";
      case "P2014":
        return "La operación violaría una relación entre tablas.";
      case "P2024":
        return "Tiempo de espera agotado al acceder a la base de datos. Intenta de nuevo en unos segundos.";
    }
  }

  // PrismaClientInitializationError / "Can't reach database"
  if (err.message?.includes("Can't reach database server")) {
    return "No se pudo conectar con la base de datos. Reintenta en unos segundos o avisa al administrador.";
  }

  return null;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => {
    const zodError = error.cause instanceof ZodError ? error.cause.flatten() : null;
    // Si es un TRPCError con mensaje custom, dejarlo tal cual (el dev ya lo redactó).
    // Si es un error técnico (Prisma, etc.), traducirlo a algo accionable.
    const humanized = !(error.cause instanceof ZodError)
      ? humanizeServerError(error.cause ?? error)
      : null;
    return {
      ...shape,
      message: humanized ?? shape.message,
      data: {
        ...shape.data,
        zodError,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.session.user } });
});

export const protectedProcedure = t.procedure.use(requireSession);

/** Solo PLATFORM_OWNER o PLATFORM_ADMIN. */
export const platformProcedure = protectedProcedure.use(({ ctx, next }) => {
  const memberships = ctx.user.memberships;
  if (!memberships.some((m: SessionMembership) => isPlatform(m.role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Requiere rol de plataforma" });
  }
  return next({ ctx });
});

/**
 * Procedure que requiere acceso a una organización específica.
 * El input debe incluir `organizationId`. PLATFORM_OWNER puede pasar cualquier id.
 */
export const orgProcedure = protectedProcedure.use(async ({ ctx, next, getRawInput }) => {
  const raw = (await getRawInput()) as { organizationId?: string } | undefined;
  const orgId = raw?.organizationId;
  if (!orgId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId requerido" });
  }
  const memberships = ctx.user.memberships;
  const isPlat = memberships.some((m: SessionMembership) => isPlatform(m.role));
  const orgMembership = memberships.find(
    (m: SessionMembership) => m.organizationId === orgId && canManageOrganization(m.role),
  );
  if (!isPlat && !orgMembership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso a esta organización" });
  }
  return next({ ctx: { ...ctx, organizationId: orgId } });
});

export { canManageCommunity };
