import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { ForbiddenError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { REGION } from '../../core/env';
import { logger } from '../../core/logger';
import { evaluateDriverEligibility } from '../../modules/auth';

const SetDriverEligibilitySchema = z.object({
  driverId: z.string().min(1),
  driverType: z.string().trim().min(1).optional(),
  verificationStatus: z.enum(['approved', 'pending', 'rejected']),
  lineId: z.string().trim().optional(),
  licenseId: z.string().trim().optional(),
  note: z.string().trim().max(400).optional(),
  forceOfflineIfIneligible: z.boolean().optional(),
});

interface ManagerSetDriverEligibilityResponse {
  success: true;
  driverId: string;
  isEligible: boolean;
  reasons: string[];
}

function normalizeOptional(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function assertManager(userId: string): Promise<void> {
  const db = getFirestore();
  const managerDoc = await db.collection('users').doc(userId).get();

  if (!managerDoc.exists) {
    throw new ForbiddenError('User not found');
  }

  const managerData = managerDoc.data();
  if (managerData?.role !== 'manager' && managerData?.role !== 'admin') {
    throw new ForbiddenError('Only managers can update driver eligibility');
  }
}

export const managerSetDriverEligibility = onCall<unknown, Promise<ManagerSetDriverEligibilityResponse>>(
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

      await assertManager(managerId);

      const parsed = SetDriverEligibilitySchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid driver eligibility payload', parsed.error.flatten());
      }

      const {
        driverId,
        driverType,
        verificationStatus,
        lineId,
        licenseId,
        note,
        forceOfflineIfIneligible = true,
      } = parsed.data;

      const db = getFirestore();
      const driverRef = db.collection('drivers').doc(driverId);

      const normalizedLineId = normalizeOptional(lineId);
      const normalizedLicenseId = normalizeOptional(licenseId);
      const normalizedDriverType = normalizeOptional(driverType);

      await db.runTransaction(async (transaction) => {
        const driverDoc = await transaction.get(driverRef);
        const currentData = driverDoc.data() ?? {};

        const nextData = {
          ...currentData,
          ...(normalizedDriverType ? { driverType: normalizedDriverType } : {}),
          verificationStatus,
          lineId: normalizedLineId,
          licenseId: normalizedLicenseId,
        };

        const eligibility = evaluateDriverEligibility(nextData);

        const updatePayload: Record<string, unknown> = {
          ...(normalizedDriverType ? { driverType: normalizedDriverType } : {}),
          verificationStatus,
          lineId: normalizedLineId,
          licenseId: normalizedLicenseId,
          eligibilityUpdatedAt: FieldValue.serverTimestamp(),
          eligibilityUpdatedBy: managerId,
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (note) {
          updatePayload.eligibilityNote = note;
        }

        if (!eligibility.isEligible && forceOfflineIfIneligible) {
          updatePayload.isOnline = false;
          updatePayload.isAvailable = false;
          updatePayload.status = 'offline';
          updatePayload.availability = 'offline';
        }

        transaction.set(driverRef, updatePayload, { merge: true });

        if (!eligibility.isEligible && forceOfflineIfIneligible) {
          const driverLiveRef = db.collection('driverLive').doc(driverId);
          transaction.delete(driverLiveRef);
        }
      });

      const updatedDoc = await driverRef.get();
      const updatedEligibility = evaluateDriverEligibility(updatedDoc.data());

      logger.info('[ManagerDriverEligibility] Updated driver eligibility', {
        managerId,
        driverId,
        driverType: normalizedDriverType,
        verificationStatus,
        lineId: normalizedLineId,
        licenseId: normalizedLicenseId,
        isEligible: updatedEligibility.isEligible,
        reasons: updatedEligibility.reasons,
      });

      return {
        success: true,
        driverId,
        isEligible: updatedEligibility.isEligible,
        reasons: updatedEligibility.reasons,
      };
    } catch (error) {
      logger.error('[ManagerDriverEligibility] FAILED', error);
      throw handleError(error);
    }
  }
);

