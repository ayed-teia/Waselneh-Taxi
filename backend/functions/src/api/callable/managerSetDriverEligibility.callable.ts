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
  officeId: z.string().trim().optional(),
  lineId: z.string().trim().optional(),
  licenseId: z.string().trim().optional(),
  fullName: z.string().trim().max(120).optional(),
  nationalId: z.string().trim().max(32).optional(),
  phone: z.string().trim().max(32).optional(),
  lineNumber: z.string().trim().max(40).optional(),
  routePath: z.string().trim().max(180).optional(),
  routeName: z.string().trim().max(180).optional(),
  routeCities: z.array(z.string().trim().max(80)).max(12).optional(),
  photoUrl: z.string().trim().url().optional(),
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

function normalizeRouteCities(value: string[] | undefined): string[] | null {
  if (!value) return null;
  const cities = value
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return cities.length > 0 ? cities : null;
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
        officeId,
        lineId,
        licenseId,
        fullName,
        nationalId,
        phone,
        lineNumber,
        routePath,
        routeName,
        routeCities,
        photoUrl,
        vehicleType,
        seatCapacity,
        note,
        forceOfflineIfIneligible = true,
      } = parsed.data;
      const normalizedLineId = normalizeOptional(lineId);
      await assertManagerPermission(managerId, 'manage_drivers', {
        lineId: normalizedLineId,
      });

      const db = getFirestore();
      const driverRef = db.collection('drivers').doc(driverId);

      let normalizedOfficeId = normalizeOptional(officeId);
      const normalizedLicenseId = normalizeOptional(licenseId);
      const normalizedDriverType = normalizeOptional(driverType);
      const normalizedFullName = normalizeOptional(fullName);
      const normalizedNationalId = normalizeOptional(nationalId);
      const normalizedPhone = normalizeOptional(phone);
      const normalizedLineNumber = normalizeOptional(lineNumber);
      const normalizedRoutePath = normalizeOptional(routePath);
      const normalizedRouteName = normalizeOptional(routeName);
      const normalizedRouteCities = normalizeRouteCities(routeCities);
      const normalizedPhotoUrl = normalizeOptional(photoUrl);
      const normalizedVehicleTypeInput = normalizeVehicleType(vehicleType);
      if (vehicleType !== undefined && !normalizedVehicleTypeInput) {
        throw new ValidationError('Invalid vehicleType value');
      }

      if (normalizedLineId) {
        const lineDoc = await db.collection('lines').doc(normalizedLineId).get();
        if (!lineDoc.exists) {
          throw new ValidationError('lineId does not exist');
        }

        const lineData = lineDoc.data() ?? {};
        const lineOfficeId = normalizeOptional(
          typeof lineData.officeId === 'string' ? lineData.officeId : undefined
        );

        if (normalizedOfficeId && lineOfficeId && normalizedOfficeId !== lineOfficeId) {
          throw new ValidationError('officeId does not match lineId scope');
        }

        if (!normalizedOfficeId && lineOfficeId) {
          normalizedOfficeId = lineOfficeId;
        }
      }

      await db.runTransaction(async (transaction) => {
        const driverDoc = await transaction.get(driverRef);
        const currentData = driverDoc.data() ?? {};
        const currentDriverType = normalizeOptional(
          typeof currentData.driverType === 'string' ? currentData.driverType : undefined
        );
        const currentOfficeId = normalizeOptional(
          typeof currentData.officeId === 'string' ? currentData.officeId : undefined
        );
        const currentLineId = normalizeOptional(
          typeof currentData.lineId === 'string' ? currentData.lineId : undefined
        );
        const currentLicenseId = normalizeOptional(
          typeof currentData.licenseId === 'string' ? currentData.licenseId : undefined
        );
        const currentVehicleType = normalizeVehicleType(currentData.vehicleType);
        const resolvedVehicleType =
          normalizedVehicleTypeInput ||
          currentVehicleType ||
          VEHICLE_TYPES.TAXI_STANDARD;
        const resolvedSeatCapacity = normalizeSeatCapacity(
          seatCapacity ?? currentData.seatCapacity,
          resolvedVehicleType
        );
        const currentAvailableSeatsRaw =
          typeof currentData.availableSeats === 'number' && Number.isFinite(currentData.availableSeats)
            ? Math.round(currentData.availableSeats)
            : resolvedSeatCapacity;
        const resolvedAvailableSeats = Math.max(
          0,
          Math.min(currentAvailableSeatsRaw, resolvedSeatCapacity)
        );
        const resolvedDriverType = normalizedDriverType ?? currentDriverType ?? 'licensed_line_owner';
        const resolvedOfficeId = normalizedOfficeId ?? currentOfficeId;
        const resolvedLineId = normalizedLineId ?? currentLineId;
        const resolvedLicenseId = normalizedLicenseId ?? currentLicenseId;

        const nextData = {
          ...currentData,
          driverType: resolvedDriverType,
          verificationStatus,
          officeId: resolvedOfficeId,
          lineId: resolvedLineId,
          licenseId: resolvedLicenseId,
          fullName: normalizedFullName ?? currentData.fullName ?? null,
          nationalId: normalizedNationalId ?? currentData.nationalId ?? null,
          phone: normalizedPhone ?? currentData.phone ?? null,
          lineNumber: normalizedLineNumber ?? currentData.lineNumber ?? null,
          routePath: normalizedRoutePath ?? currentData.routePath ?? null,
          routeName: normalizedRouteName ?? currentData.routeName ?? null,
          routeCities: normalizedRouteCities ?? currentData.routeCities ?? null,
          photoUrl: normalizedPhotoUrl ?? currentData.photoUrl ?? null,
          vehicleType: resolvedVehicleType,
          seatCapacity: resolvedSeatCapacity,
          availableSeats: resolvedAvailableSeats,
        };

        const eligibility = evaluateDriverEligibility(nextData);

        if (!driverDoc.exists && eligibility.isEligible) {
          if (
            !nextData.fullName ||
            !nextData.nationalId ||
            !nextData.phone ||
            !nextData.lineNumber ||
            !(nextData.routePath || nextData.routeName)
          ) {
            throw new ValidationError(
              'Creating a driver requires fullName, nationalId, phone, lineNumber, and routePath/routeName.'
            );
          }
        }

        const updatePayload: Record<string, unknown> = {
          driverType: resolvedDriverType,
          verificationStatus,
          officeId: resolvedOfficeId,
          lineId: resolvedLineId,
          licenseId: resolvedLicenseId,
          fullName: nextData.fullName,
          nationalId: nextData.nationalId,
          phone: nextData.phone,
          lineNumber: nextData.lineNumber,
          routePath: nextData.routePath,
          routeName: nextData.routeName,
          routeCities: nextData.routeCities,
          photoUrl: nextData.photoUrl,
          vehicleType: resolvedVehicleType,
          seatCapacity: resolvedSeatCapacity,
          availableSeats: resolvedAvailableSeats,
          isApproved: verificationStatus === 'approved',
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
          updatePayload.eligibilityBlocked = true;
          updatePayload.eligibilityBlockReasons = eligibility.reasons;
        } else if (eligibility.isEligible) {
          updatePayload.eligibilityBlocked = false;
          updatePayload.eligibilityBlockReasons = [];
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
        officeId: normalizedOfficeId,
        lineId: normalizedLineId,
        licenseId: normalizedLicenseId,
        fullName: updatedDoc.data()?.fullName ?? null,
        lineNumber: updatedDoc.data()?.lineNumber ?? null,
        routePath: updatedDoc.data()?.routePath ?? null,
        vehicleType: updatedDoc.data()?.vehicleType ?? null,
        seatCapacity: updatedDoc.data()?.seatCapacity ?? null,
        availableSeats: updatedDoc.data()?.availableSeats ?? null,
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
