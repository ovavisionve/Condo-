import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db/client";
import type { Role, MembershipScope } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      memberships: SessionMembership[];
    } & DefaultSession["user"];
  }
}

export type SessionMembership = {
  id: string;
  role: Role;
  scope: MembershipScope;
  organizationId: string | null;
  communityId: string | null;
  cargo: string | null;
  permissions: string[];
};

/** Intentos fallidos antes de bloquear la cuenta */
const MAX_FAILED_ATTEMPTS = 5;
/** Minutos de bloqueo tras exceder los intentos */
const LOCKOUT_MINUTES = 15;

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: {
    strategy: "jwt",
    maxAge: 30 * 60,       // 30 minutos (expira si no hay actividad)
    updateAge: 5 * 60,     // renueva el token cada 5 min de actividad
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await db.user.findUnique({
          where: { email: email.toLowerCase() },
          select: {
            id: true, email: true, name: true,
            passwordHash: true, active: true, deletedAt: true,
            failedLoginAttempts: true, lockedUntil: true,
          },
        });

        // Usuario no existe o inactivo
        if (!user || !user.active || user.deletedAt || !user.passwordHash) return null;

        // Cuenta bloqueada
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          throw new Error("ACCOUNT_LOCKED");
        }

        // Si el bloqueo expiró, limpiar el contador
        if (user.lockedUntil && user.lockedUntil <= new Date()) {
          await db.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: 0, lockedUntil: null },
          });
        }

        const ok = await bcrypt.compare(password, user.passwordHash);

        if (!ok) {
          const attempts = (user.failedLoginAttempts ?? 0) + 1;
          const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: shouldLock
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
                : undefined,
            },
          });
          if (shouldLock) throw new Error("ACCOUNT_LOCKED");
          throw new Error(`INVALID_CREDENTIALS:${MAX_FAILED_ATTEMPTS - attempts}`);
        }

        // Login exitoso — resetear contadores
        await db.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        });

        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session: async ({ session, token }) => {
      if (!token.sub) return session;
      const memberships = await db.membership.findMany({
        where: { userId: token.sub, active: true, revokedAt: null },
        select: { id: true, role: true, scope: true, organizationId: true, communityId: true, cargo: true, permissions: true },
      });
      session.user.id = token.sub;
      session.user.memberships = memberships;
      return session;
    },
  },
});
