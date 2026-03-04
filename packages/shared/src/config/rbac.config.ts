export const MANAGER_PERMISSIONS = {
  VIEW_DASHBOARD: 'view_dashboard',
  MANAGE_SYSTEM_FLAGS: 'manage_system_flags',
  MANAGE_DRIVERS: 'manage_drivers',
  MANAGE_OFFICES: 'manage_offices',
  MANAGE_LINES: 'manage_lines',
  MANAGE_LICENSES: 'manage_licenses',
  MANAGE_VEHICLES: 'manage_vehicles',
  MANAGE_PRICING: 'manage_pricing',
  VIEW_MONITORING: 'view_monitoring',
  MANAGE_ALERTS: 'manage_alerts',
  FORCE_CANCEL_TRIP: 'force_cancel_trip',
  MANAGE_RBAC: 'manage_rbac',
} as const;

export type ManagerPermission =
  (typeof MANAGER_PERMISSIONS)[keyof typeof MANAGER_PERMISSIONS];

export const MANAGER_ROLE_VALUES = [
  'admin',
  'manager',
  'operations_manager',
  'dispatcher',
  'support',
] as const;

export type ManagerRole = (typeof MANAGER_ROLE_VALUES)[number];

export const MANAGER_ROLE_DEFAULT_PERMISSIONS: Record<
  ManagerRole,
  readonly ManagerPermission[]
> = {
  admin: [
    MANAGER_PERMISSIONS.VIEW_DASHBOARD,
    MANAGER_PERMISSIONS.MANAGE_SYSTEM_FLAGS,
    MANAGER_PERMISSIONS.MANAGE_DRIVERS,
    MANAGER_PERMISSIONS.MANAGE_OFFICES,
    MANAGER_PERMISSIONS.MANAGE_LINES,
    MANAGER_PERMISSIONS.MANAGE_LICENSES,
    MANAGER_PERMISSIONS.MANAGE_VEHICLES,
    MANAGER_PERMISSIONS.MANAGE_PRICING,
    MANAGER_PERMISSIONS.VIEW_MONITORING,
    MANAGER_PERMISSIONS.MANAGE_ALERTS,
    MANAGER_PERMISSIONS.FORCE_CANCEL_TRIP,
    MANAGER_PERMISSIONS.MANAGE_RBAC,
  ],
  manager: [
    MANAGER_PERMISSIONS.VIEW_DASHBOARD,
    MANAGER_PERMISSIONS.MANAGE_SYSTEM_FLAGS,
    MANAGER_PERMISSIONS.MANAGE_DRIVERS,
    MANAGER_PERMISSIONS.MANAGE_OFFICES,
    MANAGER_PERMISSIONS.MANAGE_LINES,
    MANAGER_PERMISSIONS.MANAGE_LICENSES,
    MANAGER_PERMISSIONS.MANAGE_VEHICLES,
    MANAGER_PERMISSIONS.MANAGE_PRICING,
    MANAGER_PERMISSIONS.VIEW_MONITORING,
    MANAGER_PERMISSIONS.MANAGE_ALERTS,
    MANAGER_PERMISSIONS.FORCE_CANCEL_TRIP,
  ],
  operations_manager: [
    MANAGER_PERMISSIONS.VIEW_DASHBOARD,
    MANAGER_PERMISSIONS.MANAGE_DRIVERS,
    MANAGER_PERMISSIONS.MANAGE_OFFICES,
    MANAGER_PERMISSIONS.MANAGE_LINES,
    MANAGER_PERMISSIONS.MANAGE_LICENSES,
    MANAGER_PERMISSIONS.MANAGE_VEHICLES,
    MANAGER_PERMISSIONS.MANAGE_PRICING,
    MANAGER_PERMISSIONS.VIEW_MONITORING,
    MANAGER_PERMISSIONS.FORCE_CANCEL_TRIP,
  ],
  dispatcher: [
    MANAGER_PERMISSIONS.VIEW_DASHBOARD,
    MANAGER_PERMISSIONS.MANAGE_DRIVERS,
    MANAGER_PERMISSIONS.MANAGE_LINES,
    MANAGER_PERMISSIONS.MANAGE_VEHICLES,
    MANAGER_PERMISSIONS.FORCE_CANCEL_TRIP,
  ],
  support: [
    MANAGER_PERMISSIONS.VIEW_DASHBOARD,
    MANAGER_PERMISSIONS.VIEW_MONITORING,
    MANAGER_PERMISSIONS.FORCE_CANCEL_TRIP,
  ],
};

const MANAGER_PERMISSION_SET = new Set(
  Object.values(MANAGER_PERMISSIONS)
);
const MANAGER_ROLE_SET = new Set<ManagerRole>(MANAGER_ROLE_VALUES);

export function normalizeManagerRole(
  value: unknown
): ManagerRole | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return MANAGER_ROLE_SET.has(trimmed as ManagerRole)
    ? (trimmed as ManagerRole)
    : null;
}

export function normalizeManagerPermissions(
  values: unknown
): ManagerPermission[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const output = new Set<ManagerPermission>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (MANAGER_PERMISSION_SET.has(trimmed as ManagerPermission)) {
      output.add(trimmed as ManagerPermission);
    }
  }
  return Array.from(output.values());
}

export function getDefaultManagerPermissions(
  role: ManagerRole
): ManagerPermission[] {
  return [...MANAGER_ROLE_DEFAULT_PERMISSIONS[role]];
}
