/**
 * Utilities para verificación segura de auth en API routes.
 */
import crypto from "crypto";

/**
 * Compara un Bearer token con el secret en tiempo constante (timing-safe).
 * Previene timing attacks donde un atacante mide cuánto tarda la comparación
 * para inferir el contenido del secret carácter a carácter.
 */
export function verifyBearerToken(authHeader: string | null, expected: string | undefined): boolean {
  if (!expected || !authHeader) return false;
  const provided = authHeader.replace(/^Bearer\s+/i, "");
  // Si los lengths difieren, ya falla — pero hay que comparar contra un buffer
  // del mismo tamaño para no leakear info por timing.
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}
