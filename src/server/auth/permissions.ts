import type { Role } from "@prisma/client";

/**
 * Helpers de autorización. La regla general:
 * - PLATFORM_OWNER puede todo en cualquier organización.
 * - PLATFORM_ADMIN puede leer todo, escribir solo soporte.
 * - ORG_ADMIN gestiona su propia organización completa.
 * - COMMUNITY_ADMIN gestiona su edificio.
 * - BOARD_MEMBER aprueba y consulta dentro de su edificio.
 * - OWNER/TENANT solo ven y operan sobre sus unidades.
 * - SECURITY solo registra accesos.
 */

export const PLATFORM_ROLES: Role[] = ["PLATFORM_OWNER", "PLATFORM_ADMIN"];
export const ORG_ROLES: Role[] = ["ORG_ADMIN"];
export const COMMUNITY_ADMIN_ROLES: Role[] = ["COMMUNITY_ADMIN", "BOARD_MEMBER"];
export const RESIDENT_ROLES: Role[] = ["OWNER", "TENANT"];

export function isPlatform(role: Role): boolean {
  return PLATFORM_ROLES.includes(role);
}

export function canManageOrganization(role: Role): boolean {
  // COMMUNITY_ADMIN con scope ORGANIZATION = personal con cargo asignado por el admin
  return isPlatform(role) || role === "ORG_ADMIN" || role === "COMMUNITY_ADMIN";
}

export function canManageCommunity(role: Role): boolean {
  return isPlatform(role) || role === "ORG_ADMIN" || role === "COMMUNITY_ADMIN";
}
