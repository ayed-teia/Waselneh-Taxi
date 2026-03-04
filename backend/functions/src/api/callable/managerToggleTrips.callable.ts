import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { REGION } from '../../core/env';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore, invalidateConfigCache } from '../../core/config';
import { handleError, UnauthorizedError, ValidationError } from '../../core/errors';
import { logger } from '../../core/logger';
import { assertManagerPermission } from '../../modules/auth';

const ToggleTripsSchema = z.object({
  enabled: z.boolean(),
});

const ToggleFeatureFlagSchema = z.object({
  flag: z.enum(['tripsEnabled', 'roadblocksEnabled', 'paymentsEnabled']),
  enabled: z.boolean(),
});

interface ToggleTripsResponse {
  tripsEnabled: boolean;
  updatedAt: string;
}

interface SystemConfigResponse {
  tripsEnabled: boolean;
  roadblocksEnabled: boolean;
  paymentsEnabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

interface ToggleFeatureFlagResponse {
  flag: string;
  enabled: boolean;
  updatedAt: string;
}

export const managerToggleTrips = onCall<unknown, Promise<ToggleTripsResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) {
        throw new UnauthorizedError('Authentication required');
      }
      await assertManagerPermission(managerId, 'manage_system_flags');

      const parsed = ToggleTripsSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid toggle request', parsed.error.flatten());
      }

      const { enabled } = parsed.data;
      const db = getFirestore();
      const now = new Date();

      await db.collection('system').doc('config').set(
        {
          tripsEnabled: enabled,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
        },
        { merge: true }
      );

      invalidateConfigCache();
      logger.info('[ToggleTrips] Updated tripsEnabled', { managerId, enabled });

      return {
        tripsEnabled: enabled,
        updatedAt: now.toISOString(),
      };
    } catch (error) {
      logger.error('[ToggleTrips] FAILED', error);
      throw handleError(error);
    }
  }
);

export const getSystemConfigCallable = onCall<unknown, Promise<SystemConfigResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const userId = getAuthenticatedUserId(request);
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }
      await assertManagerPermission(userId, 'view_dashboard');

      const db = getFirestore();
      const configDoc = await db.collection('system').doc('config').get();

      if (!configDoc.exists) {
        return {
          tripsEnabled: true,
          roadblocksEnabled: true,
          paymentsEnabled: false,
        };
      }

      const data = configDoc.data() ?? {};
      return {
        tripsEnabled: data.tripsEnabled ?? true,
        roadblocksEnabled: data.roadblocksEnabled ?? true,
        paymentsEnabled: data.paymentsEnabled ?? false,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.(),
        updatedBy: data.updatedBy,
      };
    } catch (error) {
      logger.error('[GetSystemConfig] FAILED', error);
      throw handleError(error);
    }
  }
);

export const managerToggleFeatureFlag = onCall<
  unknown,
  Promise<ToggleFeatureFlagResponse>
>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) {
        throw new UnauthorizedError('Authentication required');
      }
      await assertManagerPermission(managerId, 'manage_system_flags');

      const parsed = ToggleFeatureFlagSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid toggle request', parsed.error.flatten());
      }

      const { flag, enabled } = parsed.data;
      const db = getFirestore();
      const now = new Date();

      await db.collection('system').doc('config').set(
        {
          [flag]: enabled,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
        },
        { merge: true }
      );

      invalidateConfigCache();
      logger.info('[ToggleFeatureFlag] Updated flag', { managerId, flag, enabled });

      return {
        flag,
        enabled,
        updatedAt: now.toISOString(),
      };
    } catch (error) {
      logger.error('[ToggleFeatureFlag] FAILED', error);
      throw handleError(error);
    }
  }
);
