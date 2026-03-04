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

export async function getManagerProfile(userId: string): Promise<ManagerProfile> {
  const db = getFirestore();
  const [userDoc, managerRoleDoc] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('managerRoles').doc(userId).get(),
  ]);

  const userData = userDoc.data() ?? {};
  const managerRoleData = managerRoleDoc.data() ?? {};

  const roleFromRoleDoc = normalizeManagerRole(managerRoleData.role);
  const roleFromUserDoc = normalizeManagerRole(userData.role);
  const role = ensureManagerRole(roleFromRoleDoc ?? roleFromUserDoc);

  const explicitPermissions = normalizeManagerPermissions(
    managerRoleData.permissions ?? userData.permissions
  );
  const permissions =
    explicitPermissions.length > 0
      ? explicitPermissions
      : getDefaultManagerPermissions(role);

  const officeIds = normalizeScopeList(
    managerRoleData.officeIds ??
      userData.officeIds ??
      (normalizeOptionalString(userData.officeId) ? [userData.officeId] : [])
  );
  const lineIds = normalizeScopeList(
    managerRoleData.lineIds ??
      userData.lineIds ??
      (normalizeOptionalString(userData.lineId) ? [userData.lineId] : [])
  );

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
