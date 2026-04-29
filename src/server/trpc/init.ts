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

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
    },
  }),
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
