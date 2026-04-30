/**
 * Sistema de permisos granulares para el personal de cada organización.
 * Los ORG_ADMIN tienen acceso completo. El personal con cargo tiene
 * solo los permisos que se le asignen explícitamente.
 */

export const PERMISSIONS = {
  // Finanzas
  view_finances:     "Ver finanzas (gastos, facturas, pagos, tasas)",
  manage_expenses:   "Registrar y editar gastos comunes",
  manage_invoices:   "Emitir y anular facturas",
  manage_payments:   "Registrar y anular pagos",
  // Residentes y unidades
  view_residents:    "Ver residentes y propietarios",
  manage_residents:  "Crear y editar residentes",
  view_units:        "Ver unidades y su detalle",
  manage_units:      "Crear y editar unidades",
  // Operaciones
  view_reports:      "Ver reportes y estadísticas",
  manage_maintenance:"Gestionar órdenes de mantenimiento",
  manage_communications: "Enviar comunicaciones y anuncios",
  manage_governance: "Gobernanza (asambleas, junta directiva)",
  manage_security:   "Módulo de seguridad (visitantes, accesos)",
} as const;

export type Permission = keyof typeof PERMISSIONS;

/** Grupos de permisos por sección de la app. */
export const PERMISSION_GROUPS: { label: string; keys: Permission[] }[] = [
  {
    label: "Finanzas",
    keys: ["view_finances", "manage_expenses", "manage_invoices", "manage_payments"],
  },
  {
    label: "Residentes y Unidades",
    keys: ["view_residents", "manage_residents", "view_units", "manage_units"],
  },
  {
    label: "Operaciones",
    keys: ["view_reports", "manage_maintenance", "manage_communications", "manage_governance", "manage_security"],
  },
];

/** Presets por cargo. */
export const CARGO_PRESETS: { value: string; label: string; permissions: Permission[] }[] = [
  {
    value: "TREASURER",
    label: "Tesorero",
    permissions: ["view_finances", "manage_expenses", "manage_invoices", "manage_payments", "view_reports"],
  },
  {
    value: "ACCOUNTANT",
    label: "Contador",
    permissions: ["view_finances", "manage_expenses", "manage_invoices", "view_reports"],
  },
  {
    value: "SECRETARY",
    label: "Secretario(a)",
    permissions: ["view_residents", "manage_residents", "view_units", "manage_communications", "manage_governance"],
  },
  {
    value: "CONCIERGE",
    label: "Conserje",
    permissions: ["view_residents", "view_units", "manage_security"],
  },
  {
    value: "MAINTENANCE",
    label: "Jefe de Mantenimiento",
    permissions: ["view_units", "manage_maintenance", "view_residents"],
  },
  {
    value: "FULL_ADMIN",
    label: "Administrador General",
    permissions: Object.keys(PERMISSIONS) as Permission[],
  },
];

/** Verifica si un array de permisos incluye uno específico. */
export function hasPermission(permissions: string[], perm: Permission): boolean {
  return permissions.includes(perm);
}

/** El usuario tiene acceso pleno si permissions está vacío (ORG_ADMIN). */
export function hasAccess(permissions: string[], perm: Permission): boolean {
  if (permissions.length === 0) return true; // acceso completo (ORG_ADMIN)
  return permissions.includes(perm);
}
