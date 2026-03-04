import { onCall } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  MANAGER_ROLE_VALUES,
  ManagerPermission,
  ManagerRole,
  VEHICLE_MAX_CAPACITY,
  VEHICLE_TYPE_VALUES,
  getDefaultManagerPermissions,
  normalizeManagerPermissions,
  normalizeManagerRole,
  normalizeSeatCapacity,
  normalizeVehicleType,
} from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  handleError,
} from '../../core/errors';
import { logger } from '../../core/logger';
import { assertManagerPermission } from '../../modules/auth';

const ManagerUpsertOfficeSchema = z.object({
  officeId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(2),
  code: z.string().trim().min(2),
  city: z.string().trim().min(2),
  status: z.enum(['active', 'inactive']).default('active'),
  contactPhone: z.string().trim().optional(),
  dispatchMode: z.enum(['line_based', 'hybrid']).default('line_based'),
});

const ManagerUpsertLineSchema = z.object({
  lineId: z.string().trim().min(1).optional(),
  officeId: z.string().trim().min(1),
  name: z.string().trim().min(2),
  code: z.string().trim().min(2),
  status: z.enum(['active', 'inactive']).default('active'),
  minSeats: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).default(1),
  maxSeats: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).default(4),
  allowedVehicleTypes: z.array(z.enum(VEHICLE_TYPE_VALUES as [string, ...string[]])).optional(),
  pricingProfileId: z.string().trim().optional(),
  serviceAreaLabel: z.string().trim().optional(),
});

const ManagerUpsertLicenseSchema = z.object({
  licenseId: z.string().trim().min(1).optional(),
  officeId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
  licenseNumber: z.string().trim().min(3),
  holderName: z.string().trim().min(2),
  status: z.enum(['active', 'suspended', 'expired']).default('active'),
  issuedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

const ManagerUpsertVehicleSchema = z.object({
  vehicleId: z.string().trim().min(1).optional(),
  officeId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
  licenseId: z.string().trim().min(1).optional(),
  plateNumber: z.string().trim().min(3),
  vehicleType: z.string().trim().min(1),
  seatCapacity: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY),
  status: z.enum(['active', 'maintenance', 'suspended']).default('active'),
  assignedDriverId: z.string().trim().optional(),
});

const ManagerLinkDriverSchema = z.object({
  driverId: z.string().trim().min(1),
  officeId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
  licenseId: z.string().trim().optional(),
  vehicleId: z.string().trim().optional(),
  vehicleType: z.string().trim().optional(),
  seatCapacity: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).optional(),
});

const PeakWindowSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  multiplier: z.number().positive().max(5),
});

const ManagerUpsertPricingProfileSchema = z.object({
  profileId: z.string().trim().min(1).default('default'),
  name: z.string().trim().min(2),
  status: z.enum(['active', 'inactive']).default('active'),
  baseRatePerKm: z.number().positive().max(20),
  minimumFareIls: z.number().positive().max(200),
  seatSurchargePerSeat: z.number().min(0).max(50).default(2),
  peakWindows: z.array(PeakWindowSchema).default([]),
  vehicleMultipliers: z
    .record(z.enum(VEHICLE_TYPE_VALUES as [string, ...string[]]), z.number().positive().max(5))
    .default({}),
  officeMultipliers: z.record(z.string().min(1), z.number().positive().max(5)).default({}),
  lineMultipliers: z.record(z.string().min(1), z.number().positive().max(5)).default({}),
  notes: z.string().trim().max(500).optional(),
});

const ManagerUpsertPricingZoneSchema = z.object({
  zoneId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(2),
  officeId: z.string().trim().optional(),
  lineId: z.string().trim().optional(),
  center: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  radiusKm: z.number().positive().max(200),
  multiplier: z.number().positive().max(5).default(1),
  flatSurchargeIls: z.number().min(0).max(500).default(0),
  appliesTo: z.enum(['pickup', 'dropoff', 'both']).default('both'),
  status: z.enum(['active', 'inactive']).default('active'),
});

const ManagerUpsertStaffRoleSchema = z.object({
  targetUserId: z.string().trim().min(1),
  role: z.enum(MANAGER_ROLE_VALUES),
  permissions: z.array(z.string()).optional(),
  officeIds: z.array(z.string().trim().min(1)).optional(),
  lineIds: z.array(z.string().trim().min(1)).optional(),
  isActive: z.boolean().default(true),
});

function normalizeOptional(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIdFromCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toTimestampOrNull(value: string | undefined): Timestamp | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

async function ensureOfficeExists(officeId: string): Promise<void> {
  const db = getFirestore();
  const officeDoc = await db.collection('offices').doc(officeId).get();
  if (!officeDoc.exists) {
    throw new NotFoundError('Office', officeId);
  }
}

async function ensureLineExists(lineId: string): Promise<FirebaseFirestore.DocumentData> {
  const db = getFirestore();
  const lineDoc = await db.collection('lines').doc(lineId).get();
  if (!lineDoc.exists) {
    throw new NotFoundError('Line', lineId);
  }
  return lineDoc.data() ?? {};
}

async function ensureLicenseExists(licenseId: string): Promise<FirebaseFirestore.DocumentData> {
  const db = getFirestore();
  const licenseDoc = await db.collection('licenses').doc(licenseId).get();
  if (!licenseDoc.exists) {
    throw new NotFoundError('License', licenseId);
  }
  return licenseDoc.data() ?? {};
}

export const managerUpsertOffice = onCall<unknown, Promise<{ officeId: string; success: true }>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const parsed = ManagerUpsertOfficeSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid office payload', parsed.error.flatten());
      }

      const data = parsed.data;
      const officeId = normalizeOptional(data.officeId) ?? `OFFICE_${normalizeIdFromCode(data.code)}`;
      const profile = await assertManagerPermission(managerId, 'manage_offices', {
        officeId,
      });
      if (!profile.isGlobalScope && profile.officeIds.length > 0 && !profile.officeIds.includes(officeId)) {
        throw new ForbiddenError('You cannot create/update this office');
      }

      const db = getFirestore();
      await db.collection('offices').doc(officeId).set(
        {
          officeId,
          name: data.name,
          code: data.code.toUpperCase(),
          city: data.city,
          status: data.status,
          contactPhone: normalizeOptional(data.contactPhone),
          dispatchMode: data.dispatchMode,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { officeId, success: true };
    } catch (error) {
      throw handleError(error);
    }
  }
);

export const managerUpsertLine = onCall<unknown, Promise<{ lineId: string; success: true }>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const parsed = ManagerUpsertLineSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid line payload', parsed.error.flatten());
      }
      const data = parsed.data;
      const lineId = normalizeOptional(data.lineId) ?? `LINE_${normalizeIdFromCode(data.code)}`;

      await assertManagerPermission(managerId, 'manage_lines', {
        officeId: data.officeId,
        lineId,
      });
      await ensureOfficeExists(data.officeId);

      const minSeats = Math.min(data.minSeats, data.maxSeats);
      const maxSeats = Math.max(data.minSeats, data.maxSeats);

      const db = getFirestore();
      await db.collection('lines').doc(lineId).set(
        {
          lineId,
          officeId: data.officeId,
          name: data.name,
          code: data.code.toUpperCase(),
          status: data.status,
          minSeats,
          maxSeats,
          allowedVehicleTypes:
            data.allowedVehicleTypes && data.allowedVehicleTypes.length > 0
              ? data.allowedVehicleTypes
              : [...VEHICLE_TYPE_VALUES],
          pricingProfileId: normalizeOptional(data.pricingProfileId) ?? 'default',
          serviceAreaLabel: normalizeOptional(data.serviceAreaLabel),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { lineId, success: true };
    } catch (error) {
      throw handleError(error);
    }
  }
);

export const managerUpsertLicense = onCall<unknown, Promise<{ licenseId: string; success: true }>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const parsed = ManagerUpsertLicenseSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid license payload', parsed.error.flatten());
      }
      const data = parsed.data;
      const licenseId =
        normalizeOptional(data.licenseId) ?? `LIC_${normalizeIdFromCode(data.licenseNumber)}`;

      await assertManagerPermission(managerId, 'manage_licenses', {
        officeId: data.officeId,
        lineId: data.lineId,
      });
      await ensureOfficeExists(data.officeId);
      const lineData = await ensureLineExists(data.lineId);
      if (lineData.officeId !== data.officeId) {
        throw new ValidationError('lineId does not belong to officeId');
      }

      const db = getFirestore();
      await db.collection('licenses').doc(licenseId).set(
        {
          licenseId,
          officeId: data.officeId,
          lineId: data.lineId,
          licenseNumber: data.licenseNumber,
          holderName: data.holderName,
          status: data.status,
          issuedAt: toTimestampOrNull(data.issuedAt),
          expiresAt: toTimestampOrNull(data.expiresAt),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { licenseId, success: true };
    } catch (error) {
      throw handleError(error);
    }
  }
);

export const managerUpsertVehicle = onCall<unknown, Promise<{ vehicleId: string; success: true }>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const parsed = ManagerUpsertVehicleSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid vehicle payload', parsed.error.flatten());
      }
      const data = parsed.data;
      const vehicleId = normalizeOptional(data.vehicleId) ?? `VEH_${normalizeIdFromCode(data.plateNumber)}`;

      await assertManagerPermission(managerId, 'manage_vehicles', {
        officeId: data.officeId,
        lineId: data.lineId,
      });

      await ensureOfficeExists(data.officeId);
      const lineData = await ensureLineExists(data.lineId);
      if (lineData.officeId !== data.officeId) {
        throw new ValidationError('lineId does not belong to officeId');
      }

      const licenseId = normalizeOptional(data.licenseId);
      if (licenseId) {
        const licenseData = await ensureLicenseExists(licenseId);
        if (licenseData.officeId !== data.officeId || licenseData.lineId !== data.lineId) {
          throw new ValidationError('licenseId does not match office/line');
        }
      }

      const normalizedVehicleType = normalizeVehicleType(data.vehicleType);
      if (!normalizedVehicleType) {
        throw new ValidationError('Invalid vehicleType');
      }
      const normalizedSeatCapacity = normalizeSeatCapacity(
        data.seatCapacity,
        normalizedVehicleType
      );

      const db = getFirestore();
      await db.collection('vehicles').doc(vehicleId).set(
        {
          vehicleId,
          officeId: data.officeId,
          lineId: data.lineId,
          licenseId,
          plateNumber: data.plateNumber.toUpperCase(),
          vehicleType: normalizedVehicleType,
          seatCapacity: normalizedSeatCapacity,
          status: data.status,
          assignedDriverId: normalizeOptional(data.assignedDriverId),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { vehicleId, success: true };
    } catch (error) {
      throw handleError(error);
    }
  }
);

export const managerLinkDriverToOperations = onCall<
  unknown,
  Promise<{ success: true; driverId: string; vehicleId: string | null }>
>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const parsed = ManagerLinkDriverSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid driver link payload', parsed.error.flatten());
      }
      const data = parsed.data;
      await assertManagerPermission(managerId, 'manage_drivers', {
        officeId: data.officeId,
        lineId: data.lineId,
      });

      await ensureOfficeExists(data.officeId);
      const lineData = await ensureLineExists(data.lineId);
      if (lineData.officeId !== data.officeId) {
        throw new ValidationError('lineId does not belong to officeId');
      }

      const licenseId = normalizeOptional(data.licenseId);
      if (licenseId) {
        const licenseData = await ensureLicenseExists(licenseId);
        if (licenseData.officeId !== data.officeId || licenseData.lineId !== data.lineId) {
          throw new ValidationError('licenseId does not match office/line');
        }
      }

      const vehicleId = normalizeOptional(data.vehicleId);
      let vehicleData: FirebaseFirestore.DocumentData | null = null;
      if (vehicleId) {
        const db = getFirestore();
        const vehicleDoc = await db.collection('vehicles').doc(vehicleId).get();
        if (!vehicleDoc.exists) {
          throw new NotFoundError('Vehicle', vehicleId);
        }
        vehicleData = vehicleDoc.data() ?? {};
        if (vehicleData.officeId !== data.officeId || vehicleData.lineId !== data.lineId) {
          throw new ValidationError('vehicleId does not match office/line');
        }
      }

      const normalizedVehicleType = normalizeVehicleType(
        data.vehicleType ?? vehicleData?.vehicleType
      );
      if (data.vehicleType !== undefined && !normalizedVehicleType) {
        throw new ValidationError('Invalid vehicleType');
      }

      const seatCapacity = normalizeSeatCapacity(
        data.seatCapacity ?? vehicleData?.seatCapacity,
        normalizedVehicleType
      );

      const db = getFirestore();
      await db.collection('drivers').doc(data.driverId).set(
        {
          driverId: data.driverId,
          officeId: data.officeId,
          lineId: data.lineId,
          licenseId,
          vehicleId,
          vehicleType: normalizedVehicleType,
          seatCapacity,
          driverType: 'licensed_line_owner',
          verificationStatus: 'approved',
          eligibilityUpdatedBy: managerId,
          eligibilityUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (vehicleId) {
        await db.collection('vehicles').doc(vehicleId).set(
          {
            assignedDriverId: data.driverId,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: managerId,
          },
          { merge: true }
        );
      }

      return {
        success: true,
        driverId: data.driverId,
        vehicleId,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);

export const managerUpsertPricingProfile = onCall<
  unknown,
  Promise<{ success: true; profileId: string }>
>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const parsed = ManagerUpsertPricingProfileSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid pricing profile payload', parsed.error.flatten());
      }
      const data = parsed.data;
      await assertManagerPermission(managerId, 'manage_pricing');

      const db = getFirestore();
      await db.collection('pricingProfiles').doc(data.profileId).set(
        {
          profileId: data.profileId,
          name: data.name,
          status: data.status,
          baseRatePerKm: data.baseRatePerKm,
          minimumFareIls: data.minimumFareIls,
          seatSurchargePerSeat: data.seatSurchargePerSeat,
          peakWindows: data.peakWindows,
          vehicleMultipliers: data.vehicleMultipliers,
          officeMultipliers: data.officeMultipliers,
          lineMultipliers: data.lineMultipliers,
          notes: normalizeOptional(data.notes),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { success: true, profileId: data.profileId };
    } catch (error) {
      throw handleError(error);
    }
  }
);

export const managerUpsertPricingZone = onCall<
  unknown,
  Promise<{ success: true; zoneId: string }>
>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const parsed = ManagerUpsertPricingZoneSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid pricing zone payload', parsed.error.flatten());
      }
      const data = parsed.data;

      await assertManagerPermission(managerId, 'manage_pricing', {
        officeId: normalizeOptional(data.officeId),
        lineId: normalizeOptional(data.lineId),
      });

      const zoneId =
        normalizeOptional(data.zoneId) ??
        `ZONE_${normalizeIdFromCode(`${data.name}_${data.center.lat}_${data.center.lng}`)}`;

      const db = getFirestore();
      await db.collection('pricingZones').doc(zoneId).set(
        {
          zoneId,
          name: data.name,
          officeId: normalizeOptional(data.officeId),
          lineId: normalizeOptional(data.lineId),
          center: data.center,
          radiusKm: data.radiusKm,
          multiplier: data.multiplier,
          flatSurchargeIls: data.flatSurchargeIls,
          appliesTo: data.appliesTo,
          status: data.status,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { success: true, zoneId };
    } catch (error) {
      throw handleError(error);
    }
  }
);

export const managerUpsertStaffRole = onCall<
  unknown,
  Promise<{ success: true; userId: string; role: ManagerRole }>
>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');
      await assertManagerPermission(managerId, 'manage_rbac');

      const parsed = ManagerUpsertStaffRoleSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid staff role payload', parsed.error.flatten());
      }
      const data = parsed.data;

      const normalizedRole = normalizeManagerRole(data.role);
      if (!normalizedRole) {
        throw new ValidationError('Invalid manager role');
      }

      const explicitPermissions = normalizeManagerPermissions(data.permissions);
      const permissions: ManagerPermission[] =
        explicitPermissions.length > 0
          ? explicitPermissions
          : getDefaultManagerPermissions(normalizedRole);

      const officeIds = Array.from(
        new Set(
          (data.officeIds ?? [])
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        )
      );
      const lineIds = Array.from(
        new Set(
          (data.lineIds ?? [])
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        )
      );

      const db = getFirestore();
      await db.collection('managerRoles').doc(data.targetUserId).set(
        {
          uid: data.targetUserId,
          role: normalizedRole,
          permissions,
          officeIds,
          lineIds,
          isActive: data.isActive,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await db.collection('users').doc(data.targetUserId).set(
        {
          uid: data.targetUserId,
          role: normalizedRole,
          permissions,
          officeIds,
          lineIds,
          status: data.isActive ? 'active' : 'inactive',
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
        },
        { merge: true }
      );

      logger.info('[ManagerRBAC] Updated manager role', {
        managerId,
        targetUserId: data.targetUserId,
        role: normalizedRole,
        permissions,
      });

      return {
        success: true,
        userId: data.targetUserId,
        role: normalizedRole,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
