import {
  getDefaultManagerPermissions,
  ManagerPermission,
  ManagerRole,
  normalizeManagerPermissions,
  normalizeManagerRole,
} from '@taxi-line/shared';
import { getFirestore } from '../../core/config';
import { ForbiddenError } from '../../core/errors';
import { logger } from '../../core/logger';

export interface ManagerProfile {
  userId: string;
  role: ManagerRole;
  permissions: ManagerPermission[];
  officeIds: string[];
  lineIds: string[];
  isGlobalScope: boolean;
}

interface ScopeCheckInput {
  officeId?: string | null;
  lineId?: string | null;
}

function normalizeScopeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed) {
      set.add(trimmed);
    }
  }
  return Array.from(set.values());
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureManagerRole(role: ManagerRole | null): ManagerRole {
  if (!role) {
    throw new ForbiddenError('Manager role is required');
  }
  return role;
}

function hasScopeAccess(profile: ManagerProfile, scope?: ScopeCheckInput): boolean {
  if (!scope) return true;
  if (profile.isGlobalScope) return true;

  const officeId = normalizeOptionalString(scope.officeId);
  const lineId = normalizeOptionalString(scope.lineId);

  if (lineId) {
    if (profile.lineIds.length === 0 || !profile.lineIds.includes(lineId)) {
      return false;
    }
  }

  if (officeId) {
    if (profile.officeIds.length === 0 || !profile.officeIds.includes(officeId)) {
      return false;
    }
  }

  return true;
}

/**
 * Resolve a manager's role, permissions and scope.
 *
 * SECURITY (R1): `managerRoles/{uid}` is the ONLY source of truth for RBAC.
 *
 * This previously fell back to `users/{uid}`.`role` / `.permissions` / `.officeIds` /
 * `.lineIds` when the managerRoles document was missing a field. Because Firestore rules
 * let a user write their own `users/{uid}` document, any authenticated user could set
 * `role: 'admin'` on themselves and be granted full manager permissions here - a direct
 * privilege escalation. Those fallbacks are removed: a manager who has no
 * `managerRoles/{uid}` document is not a manager, regardless of what `users/{uid}` says.
 *
 * `users/{uid}` is still written by managerUpsertStaffRole as a denormalized copy for
 * display, but it is never read for an authorization decision.
 */
export async function getManagerProfile(userId: string): Promise<ManagerProfile> {
  const db = getFirestore();
  const managerRoleDoc = await db.collection('managerRoles').doc(userId).get();

  if (!managerRoleDoc.exists) {
    logger.warn('[RBAC] No managerRoles document for user', { userId });
    throw new ForbiddenError('Manager role is required');
  }

  const managerRoleData = managerRoleDoc.data() ?? {};

  // A deactivated manager must lose access immediately, without needing the
  // document to be deleted.
  if (managerRoleData.isActive === false) {
    logger.warn('[RBAC] Manager role is deactivated', { userId });
    throw new ForbiddenError('Manager account is deactivated');
  }

  const role = ensureManagerRole(normalizeManagerRole(managerRoleData.role));

  const explicitPermissions = normalizeManagerPermissions(managerRoleData.permissions);
  const permissions =
    explicitPermissions.length > 0
      ? explicitPermissions
      : getDefaultManagerPermissions(role);

  const officeIds = normalizeScopeList(managerRoleData.officeIds);
  const lineIds = normalizeScopeList(managerRoleData.lineIds);

  const profile: ManagerProfile = {
    userId,
    role,
    permissions,
    officeIds,
    lineIds,
    isGlobalScope: officeIds.length === 0 && lineIds.length === 0,
  };

  return profile;
}

export async function assertManagerPermission(
  userId: string,
  permission: ManagerPermission,
  scope?: ScopeCheckInput
): Promise<ManagerProfile> {
  const profile = await getManagerProfile(userId);

  if (!profile.permissions.includes(permission)) {
    logger.warn('[RBAC] Manager permission denied', {
      userId,
      role: profile.role,
      permission,
      grantedPermissions: profile.permissions,
    });
    throw new ForbiddenError(`Missing required permission: ${permission}`);
  }

  if (!hasScopeAccess(profile, scope)) {
    logger.warn('[RBAC] Manager scope denied', {
      userId,
      role: profile.role,
      permission,
      officeIds: profile.officeIds,
      lineIds: profile.lineIds,
      requestedScope: scope,
    });
    throw new ForbiddenError('Requested office/line scope is not allowed for this account');
  }

  return profile;
}
