import { onCall } from 'firebase-functions/v2/https';
import {
  getDefaultManagerPermissions,
  ManagerPermission,
  ManagerRole,
  normalizeManagerPermissions,
  normalizeManagerRole,
} from '@taxi-line/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { REGION } from '../../core/env';
import { getAuth, getFirestore, isEmulatorEnvironment } from '../../core/config';
import { ValidationError } from '../../core/errors';

interface DevIssueManagerTokenResponse {
  uid: string;
  role: ManagerRole;
  token: string;
  permissions: ManagerPermission[];
}

export const devIssueManagerToken = onCall<unknown, Promise<DevIssueManagerTokenResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (request) => {
    if (!isEmulatorEnvironment()) {
      throw new ValidationError('This function is available only in emulator mode.');
    }

    const raw = request.data as {
      uid?: unknown;
      role?: unknown;
      permissions?: unknown;
      officeIds?: unknown;
      lineIds?: unknown;
    } | undefined;

    const uid = typeof raw?.uid === 'string' && raw.uid.trim()
      ? raw.uid.trim()
      : 'dev-manager-001';
    const role = normalizeManagerRole(raw?.role) ?? 'admin';
    const explicitPermissions = normalizeManagerPermissions(raw?.permissions);
    const permissions =
      explicitPermissions.length > 0
        ? explicitPermissions
        : getDefaultManagerPermissions(role);

    const officeIds = Array.isArray(raw?.officeIds)
      ? raw.officeIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : [];
    const lineIds = Array.isArray(raw?.lineIds)
      ? raw.lineIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : [];

    const db = getFirestore();

    await db.collection('users').doc(uid).set(
      {
        uid,
        role,
        permissions,
        officeIds,
        lineIds,
        status: 'active',
        displayName: role === 'admin' ? 'Dev Admin' : 'Dev Manager',
        updatedAt: FieldValue.serverTimestamp(),
        devProvisionedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await db.collection('managerRoles').doc(uid).set(
      {
        uid,
        role,
        permissions,
        officeIds,
        lineIds,
        isActive: true,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
      { merge: true }
    );

    const token = await getAuth().createCustomToken(uid, {
      role: role === 'admin' ? 'admin' : 'manager',
      managerRole: role,
      permissions,
    });

    return {
      uid,
      role,
      token,
      permissions,
    };
  }
);
