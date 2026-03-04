import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  VEHICLE_MAX_CAPACITY,
  VEHICLE_TYPES,
  normalizeSeatCapacity,
  normalizeVehicleType,
} from '@taxi-line/shared';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { REGION } from '../../core/env';
import { logger } from '../../core/logger';
import { assertManagerPermission, evaluateDriverEligibility } from '../../modules/auth';

const SetDriverEligibilitySchema = z.object({
  driverId: z.string().min(1),
  driverType: z.string().trim().min(1).optional(),
  verificationStatus: z.enum(['approved', 'pending', 'rejected']),
  lineId: z.string().trim().optional(),
  licenseId: z.string().trim().optional(),
  vehicleType: z.string().trim().optional(),
  seatCapacity: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).optional(),
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
        vehicleType,
        seatCapacity,
        note,
        forceOfflineIfIneligible = true,
      } = parsed.data;
      await assertManagerPermission(managerId, 'manage_drivers', {
        lineId: normalizeOptional(lineId),
      });

      const db = getFirestore();
      const driverRef = db.collection('drivers').doc(driverId);

      const normalizedLineId = normalizeOptional(lineId);
      const normalizedLicenseId = normalizeOptional(licenseId);
      const normalizedDriverType = normalizeOptional(driverType);
      const normalizedVehicleTypeInput = normalizeVehicleType(vehicleType);
      if (vehicleType !== undefined && !normalizedVehicleTypeInput) {
        throw new ValidationError('Invalid vehicleType value');
      }

      await db.runTransaction(async (transaction) => {
        const driverDoc = await transaction.get(driverRef);
        const currentData = driverDoc.data() ?? {};
        const currentVehicleType = normalizeVehicleType(currentData.vehicleType);
        const resolvedVehicleType =
          normalizedVehicleTypeInput ||
          currentVehicleType ||
          VEHICLE_TYPES.TAXI_STANDARD;
        const resolvedSeatCapacity = normalizeSeatCapacity(
          seatCapacity ?? currentData.seatCapacity,
          resolvedVehicleType
        );

        const nextData = {
          ...currentData,
          ...(normalizedDriverType ? { driverType: normalizedDriverType } : {}),
          verificationStatus,
          lineId: normalizedLineId,
          licenseId: normalizedLicenseId,
          vehicleType: resolvedVehicleType,
          seatCapacity: resolvedSeatCapacity,
        };

        const eligibility = evaluateDriverEligibility(nextData);

        const updatePayload: Record<string, unknown> = {
          ...(normalizedDriverType ? { driverType: normalizedDriverType } : {}),
          verificationStatus,
          lineId: normalizedLineId,
          licenseId: normalizedLicenseId,
          vehicleType: resolvedVehicleType,
          seatCapacity: resolvedSeatCapacity,
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
        vehicleType: updatedDoc.data()?.vehicleType ?? null,
        seatCapacity: updatedDoc.data()?.seatCapacity ?? null,
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
