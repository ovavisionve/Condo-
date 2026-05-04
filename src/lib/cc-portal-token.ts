/**
 * Tokens firmados con HMAC-SHA256 para el portal público del arrendatario CC.
 * No requiere jose ni jsonwebtoken — usa la crypto API nativa de Node.js.
 *
 * Formato del token en URL-safe base64:
 *   header.payload.signature
 *   header  = base64url({ alg: "HS256", typ: "CCPORTAL" })
 *   payload = base64url({ tenancyId, localId, mallId, iat, exp })
 *   sig     = HMAC-SHA256(header.payload, secret)
 */

import { createHmac } from "crypto";

const ALG_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "CCPORTAL" })).toString("base64url");

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET no configurado");
  return s;
}

export interface CcPortalPayload {
  tenancyId: string;
  localId: string;
  mallId: string;
  organizationId: string;
  iat: number;
  exp: number;
}

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Genera un token firmado válido por `expiresInDays` días (por defecto 90).
 */
export function generateCcPortalToken(
  payload: Omit<CcPortalPayload, "iat" | "exp">,
  expiresInDays = 90,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: CcPortalPayload = { ...payload, iat: now, exp: now + expiresInDays * 86400 };
  const payloadB64 = b64url(full);
  const signingInput = `${ALG_HEADER}.${payloadB64}`;
  const sig = sign(signingInput, getSecret());
  return `${signingInput}.${sig}`;
}

/**
 * Verifica y decodifica el token. Lanza si es inválido o expirado.
 */
export function verifyCcPortalToken(token: string): CcPortalPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token malformado");
  const [header, payloadB64, sig] = parts as [string, string, string];

  const expected = sign(`${header}.${payloadB64}`, getSecret());
  if (expected !== sig) throw new Error("Firma inválida");

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as CcPortalPayload;
  if (Date.now() / 1000 > payload.exp) throw new Error("Token expirado");

  return payload;
}
