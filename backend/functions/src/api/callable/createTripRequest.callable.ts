import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  ACTIVE_TRIP_STATUSES,
  LatLngSchema,
  PILOT_LIMITS,
  RideOptionsSchema,
  TripEstimateSchema,
  TripRequestStatus,
  TripStatus,
  VehicleType,
  normalizeRequestedSeats,
  normalizeSeatCapacity,
  normalizeVehicleType,
} from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore, areTripsEnabled } from '../../core/config';
import { handleError, ValidationError, UnauthorizedError, NotFoundError, ForbiddenError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { calculateDynamicRidePrice } from '../../modules/pricing/services';
import { publishTripStatusNotifications } from '../../modules/notifications';
import { evaluateDriverEligibility } from '../../modules/auth';

/**
 * ============================================================================
 * CREATE TRIP REQUEST - Cloud Function
 * ============================================================================
 * 
 * Step 31: Nearest Driver Assignment (MVP)
 * 
 * Flow:
 * 1. Validate authenticated passenger
 * 2. Validate input (pickup, dropoff, estimate)
 * 3. Check passenger has no active trips
 * 4. Create tripRequests/{requestId} with status OPEN
 * 5. Query drivers where isOnline=true AND isAvailable=true
 * 6. Compute distance from pickup using Haversine formula
 * 7. Select nearest driver
 * 8. TRANSACTION: atomically create trip, update driver, update request
 *    - Create trips/{tripId} document
 *    - Mark driver isAvailable=false
 *    - Create driverRequests/{driverId}/{tripId} notification
 *    - Update tripRequest status to MATCHED
 * 9. Return { requestId, tripId, driverId, status }
 * 
 * Data Safety:
 * - If no drivers available: keeps tripRequest OPEN, returns status='searching'
 * - Transaction prevents double assignment (re-checks driver availability)
 * - Assignment is idempotent (request can only be matched once)
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ PASSENGER REQUEST FLOW:
 *    LOG: "🚕 [CreateTrip] START - passengerId: {id}"
 *    LOG: "📋 [CreateTrip] Trip request created - requestId: {id}"
 *    LOG: "🔍 [CreateTrip] Querying available drivers..."
 *    LOG: "🚗 [CreateTrip] Found {N} available driver(s)"
 *    LOG: "✅ [CreateTrip] Selected driver: {driverId} ({distance} km away)"
 *    LOG: "📝 [CreateTrip] Trip created: {tripId}"
 *    LOG: "🚗 [CreateTrip] Driver isAvailable → false"
 *    LOG: "📨 [CreateTrip] Request sent to driver: {driverId}"
 *    LOG: "🎉 [CreateTrip] COMPLETE - requestId, tripId, driverId"
 * 
 * ✅ NO DRIVERS AVAILABLE:
 *    LOG: "🚫 [CreateTrip] No available drivers - keeping request open"
 *    Returns: { requestId, status: 'searching' }
 * 
 * ✅ TRANSACTION SAFETY:
 *    - Re-verifies driver availability inside transaction
 *    - Prevents race conditions when multiple passengers request simultaneously
 *    - Only the NEAREST driver receives the request
 * 
 * ============================================================================
 */

/**
 * Request schema for creating a trip request
 */
const CreateTripRequestSchema = z.object({
  pickup: LatLngSchema,
  dropoff: LatLngSchema,
  estimate: TripEstimateSchema,
  rideOptions: RideOptionsSchema.optional(),
});

/**
 * Response type for trip request creation
 * Returns requestId for passenger to track matching status
 */
interface CreateTripRequestResponse {
  requestId: string;
  tripId?: string;
  driverId?: string;
  status: 'matched' | 'searching';
}

/**
 * Driver document from drivers collection (availability)
 */
interface DriverDoc {
  driverId: string;
  isOnline: boolean;
  isAvailable: boolean;
  driverType?: string;
  verificationStatus?: string;
  officeId?: string | null;
  lineId?: string;
  licenseId?: string;
  vehicleType?: string | null;
  seatCapacity?: number | null;
  lastLocation: FirebaseFirestore.GeoPoint | null;
  currentTripId: string | null;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * Trip request document in tripRequests collection
 * Used for passenger to track matching status before trip creation
 */
interface TripRequestDocument {
  requestId: string;
  passengerId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPriceIls: number;
  rideOptions: {
    requiredSeats: number;
    vehicleType: VehicleType | null;
    officeId: string | null;
    lineId: string | null;
  };
  status: 'open' | 'matched' | 'expired' | 'cancelled';
  matchedDriverId?: string;
  matchedTripId?: string;
  matchedAt?: FirebaseFirestore.FieldValue;
  createdAt: FirebaseFirestore.FieldValue;
}

/**
 * Trip document structure in Firestore
 */
interface TripDocument {
  tripId: string;
  passengerId: string;
  driverId: string;
  status: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPriceIls: number;
  requiredSeats: number;
  requestedVehicleType: VehicleType | null;
  requestedOfficeId: string | null;
  requestedLineId: string | null;
  matchedVehicleType: VehicleType | null;
  matchedSeatCapacity: number;
  matchedOfficeId: string | null;
  matchedLineId: string | null;
  // Payment fields
  paymentMethod: 'cash';
  fareAmount: number;
  paymentStatus: 'pending' | 'paid';
  paidAt: null;
  createdAt: FirebaseFirestore.FieldValue;
}

/**
 * Driver request notification document
 */
interface DriverRequestDocument {
  tripId: string;
  passengerId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPriceIls: number;
  requiredSeats: number;
  requestedVehicleType: VehicleType | null;
  requestedOfficeId: string | null;
  requestedLineId: string | null;
  driverOfficeId: string | null;
  driverLineId: string | null;
  driverVehicleType: VehicleType | null;
  driverSeatCapacity: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: FirebaseFirestore.FieldValue;
  expiresAt: FirebaseFirestore.Timestamp; // Actual timestamp for timeout checking
  timeoutSeconds: number; // For reference
}

interface RideRequirements {
  requiredSeats: number;
  vehicleType: VehicleType | null;
  officeId: string | null;
  lineId: string | null;
}

/**
 * Haversine formula - calculates distance between two lat/lng points
 * Returns distance in kilometers
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Create a new trip request with driver matching
 */
export const createTripRequest = onCall<unknown, Promise<CreateTripRequestResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // ========================================
      // 0. Check kill switch (PILOT SAFETY GUARD)
      // ========================================
      const tripsEnabled = await areTripsEnabled();
      if (!tripsEnabled) {
        logger.warn('🚫 [CreateTrip] Trips are disabled by kill switch');
        throw new ForbiddenError('Trip requests are temporarily disabled. Please try again later.');
      }

      // ========================================
      // 1. Validate authentication
      // ========================================
      const passengerId = getAuthenticatedUserId(request);
      if (!passengerId) {
        throw new UnauthorizedError('Authentication required to create a trip request');
      }

      // ========================================
      // 2. Validate input
      // ========================================
      const parsed = CreateTripRequestSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid trip request data',
          parsed.error.flatten()
        );
      }

      const { pickup, dropoff, estimate, rideOptions } = parsed.data;
      const normalizedRideOptions: RideRequirements = {
        requiredSeats: normalizeRequestedSeats(rideOptions?.requiredSeats),
        vehicleType: normalizeVehicleType(rideOptions?.vehicleType),
        officeId: sanitizeId(rideOptions?.officeId),
        lineId: sanitizeId(rideOptions?.lineId),
      };

      logger.info('� [CreateTrip] START', {
        passengerId,
        pickup: `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}`,
        dropoff: `${dropoff.lat.toFixed(4)}, ${dropoff.lng.toFixed(4)}`,
        estimatedPrice: estimate.priceIls,
        rideOptions: normalizedRideOptions,
      });

      const db = getFirestore();
      let requestedOfficeId = normalizedRideOptions.officeId;
      let requestedLineId = normalizedRideOptions.lineId;

      if (requestedLineId) {
        const lineDoc = await db.collection('lines').doc(requestedLineId).get();
        if (!lineDoc.exists) {
          throw new ValidationError('Invalid rideOptions.lineId');
        }
        const lineData = lineDoc.data() ?? {};
        const lineOfficeId = sanitizeId(lineData.officeId);

        if (requestedOfficeId && lineOfficeId && requestedOfficeId !== lineOfficeId) {
          throw new ValidationError('rideOptions.officeId does not match selected lineId');
        }

        if (!requestedOfficeId && lineOfficeId) {
          requestedOfficeId = lineOfficeId;
        }
      }

      // ========================================
      // 3. Check passenger doesn't have active trip (PILOT SAFETY GUARD)
      // ========================================
      logger.info('🔒 [CreateTrip] Checking passenger active trips...');
      
      const passengerActiveTripsSnapshot = await db
        .collection('trips')
        .where('passengerId', '==', passengerId)
        .where('status', 'in', [...ACTIVE_TRIP_STATUSES])
        .limit(PILOT_LIMITS.MAX_ACTIVE_TRIPS_PER_PASSENGER)
        .get();

      if (!passengerActiveTripsSnapshot.empty) {
        logger.warn('🚫 [CreateTrip] Passenger already has active trip', {
          passengerId,
          activeTripId: passengerActiveTripsSnapshot.docs[0]?.id,
        });
        throw new ForbiddenError('You already have an active trip. Please complete or cancel it first.');
      }

      logger.info('✅ [CreateTrip] Passenger has no active trips');

      // ========================================
      // 4. Create tripRequest document for passenger tracking
      // ========================================
      const pricingResult = await calculateDynamicRidePrice({
        distanceKm: estimate.distanceKm,
        pickup,
        dropoff,
        rideOptions: normalizedRideOptions,
        officeId: requestedOfficeId,
        lineId: requestedLineId,
      });
      const serverCalculatedPriceIls = pricingResult.priceIls;
      
      // Log if client price differs from server calculation
      if (serverCalculatedPriceIls !== estimate.priceIls) {
        logger.warn('💰 [CreateTrip] Price mismatch - using server calculation', {
          clientPrice: estimate.priceIls,
          serverPrice: serverCalculatedPriceIls,
          distanceKm: estimate.distanceKm,
          pricingProfileId: pricingResult.breakdown.profileId,
        });
      }

      const tripRequestRef = db.collection('tripRequests').doc();
      const requestId = tripRequestRef.id;

      const tripRequestDoc: TripRequestDocument = {
        requestId,
        passengerId,
        pickup: { lat: pickup.lat, lng: pickup.lng },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng },
        estimatedDistanceKm: estimate.distanceKm,
        estimatedDurationMin: estimate.durationMin,
        estimatedPriceIls: serverCalculatedPriceIls,
        rideOptions: {
          ...normalizedRideOptions,
          officeId: requestedOfficeId,
          lineId: requestedLineId,
        },
        status: TripRequestStatus.OPEN,
        createdAt: FieldValue.serverTimestamp(),
      };

      await tripRequestRef.set(tripRequestDoc);
      logger.info('📋 [CreateTrip] Trip request created', { requestId });

      // ========================================
      // 5. Query drivers where isOnline=true AND isAvailable=true
      // ========================================
      logger.info('🔍 [CreateTrip] Querying available drivers...');
      
      let driversQuery: FirebaseFirestore.Query = db
        .collection('drivers')
        .where('isOnline', '==', true)
        .where('isAvailable', '==', true);

      if (requestedLineId) {
        driversQuery = driversQuery.where('lineId', '==', requestedLineId);
      } else if (requestedOfficeId) {
        driversQuery = driversQuery.where('officeId', '==', requestedOfficeId);
      }

      const driversSnapshot = await driversQuery.get();

      if (driversSnapshot.empty) {
        logger.warn('🚫 [CreateTrip] No available drivers - keeping request open');
        logger.dispatchFailed(requestId, 'No available drivers', {
          passengerId,
          requestedOfficeId,
          requestedLineId,
          rideOptions: normalizedRideOptions,
        });
        
        // Return with searching status - passenger can wait for drivers
        return {
          requestId,
          status: 'searching' as const,
        };
      }

      logger.info(`🚗 [CreateTrip] Found ${driversSnapshot.size} available driver(s)`);

      // ========================================
      // 4. Compute distance using Haversine formula
      // ========================================
      let skippedIneligibleDrivers = 0;
      let skippedVehicleTypeDrivers = 0;
      let skippedCapacityDrivers = 0;
      let skippedScopeDrivers = 0;
      const driversWithDistance: Array<{
        driverId: string;
        distance: number;
        vehicleType: VehicleType | null;
        seatCapacity: number;
        doc: DriverDoc;
      }> = [];

      driversSnapshot.forEach((doc) => {
        const driverData = doc.data() as DriverDoc;
        const eligibility = evaluateDriverEligibility(driverData);
        if (!eligibility.isEligible) {
          skippedIneligibleDrivers += 1;
          logger.debug(`Driver ${doc.id}: Ineligible - skipping`, {
            reasons: eligibility.reasons,
            driverType: eligibility.driverType,
            verificationStatus: eligibility.verificationStatus,
            lineId: eligibility.lineId,
            licenseId: eligibility.licenseId,
          });
          return;
        }

        const driverOfficeId = sanitizeId(driverData.officeId);
        const driverLineId = sanitizeId(driverData.lineId);
        if (requestedLineId && driverLineId !== requestedLineId) {
          skippedScopeDrivers += 1;
          logger.debug(`Driver ${doc.id}: Line scope mismatch - skipping`, {
            requestedLineId,
            driverLineId,
          });
          return;
        }

        if (requestedOfficeId && driverOfficeId !== requestedOfficeId) {
          skippedScopeDrivers += 1;
          logger.debug(`Driver ${doc.id}: Office scope mismatch - skipping`, {
            requestedOfficeId,
            driverOfficeId,
          });
          return;
        }
        
        // Skip drivers without location data
        if (!driverData.lastLocation) {
          logger.debug(`Driver ${doc.id}: No location data - skipping`);
          return;
        }

        const normalizedDriverVehicleType = normalizeVehicleType(driverData.vehicleType);
        const normalizedDriverSeatCapacity = normalizeSeatCapacity(
          driverData.seatCapacity,
          normalizedDriverVehicleType
        );

        if (
          normalizedRideOptions.vehicleType &&
          normalizedDriverVehicleType !== normalizedRideOptions.vehicleType
        ) {
          skippedVehicleTypeDrivers += 1;
          logger.debug(`Driver ${doc.id}: Vehicle type mismatch - skipping`, {
            requiredVehicleType: normalizedRideOptions.vehicleType,
            driverVehicleType: normalizedDriverVehicleType,
          });
          return;
        }

        if (normalizedDriverSeatCapacity < normalizedRideOptions.requiredSeats) {
          skippedCapacityDrivers += 1;
          logger.debug(`Driver ${doc.id}: Seat capacity mismatch - skipping`, {
            requiredSeats: normalizedRideOptions.requiredSeats,
            driverSeatCapacity: normalizedDriverSeatCapacity,
          });
          return;
        }

        const distance = haversineDistance(
          pickup.lat,
          pickup.lng,
          driverData.lastLocation.latitude,
          driverData.lastLocation.longitude
        );

        driversWithDistance.push({
          driverId: doc.id,
          distance,
          vehicleType: normalizedDriverVehicleType,
          seatCapacity: normalizedDriverSeatCapacity,
          doc: driverData,
        });

        logger.debug(`Driver ${doc.id}: ${distance.toFixed(2)} km away`);
      });
      
      if (skippedIneligibleDrivers > 0) {
        logger.info('🚫 [CreateTrip] Skipped ineligible drivers', {
          skippedIneligibleDrivers,
        });
      }

      // ========================================
      // 6. Select nearest driver
      // ========================================
      if (skippedVehicleTypeDrivers > 0 || skippedCapacityDrivers > 0 || skippedScopeDrivers > 0) {
        logger.info('[CreateTrip] Skipped drivers by ride options', {
          skippedVehicleTypeDrivers,
          skippedCapacityDrivers,
          skippedScopeDrivers,
          rideOptions: normalizedRideOptions,
        });
      }

      if (driversWithDistance.length === 0) {
        logger.dispatchFailed(requestId, 'No eligible drivers with location data', {
          passengerId,
          driversQueried: driversSnapshot.size,
          skippedIneligibleDrivers,
          skippedVehicleTypeDrivers,
          skippedCapacityDrivers,
          skippedScopeDrivers,
          rideOptions: normalizedRideOptions,
          requestedOfficeId,
          requestedLineId,
        });
        
        // Return with searching status - passenger can wait for drivers
        return {
          requestId,
          status: 'searching' as const,
        };
      }

      driversWithDistance.sort((a, b) => a.distance - b.distance);
      const nearestDriver = driversWithDistance[0]!;

      logger.info(`✅ [CreateTrip] Selected driver: ${nearestDriver.driverId}`, {
        distance: `${nearestDriver.distance.toFixed(2)} km`,
        totalCandidates: driversWithDistance.length,
      });

      // ========================================
      // 7. TRANSACTION: Create trip & assign driver atomically
      // ========================================
      const tripRef = db.collection('trips').doc();
      const tripId = tripRef.id;
      const driverDocRef = db.collection('drivers').doc(nearestDriver.driverId);
      const driverRequestRef = db
        .collection('driverRequests')
        .doc(nearestDriver.driverId)
        .collection('requests')
        .doc(tripId);
      let matchedVehicleType: VehicleType | null = nearestDriver.vehicleType;
      let matchedSeatCapacity = nearestDriver.seatCapacity;
      let matchedOfficeId: string | null = sanitizeId(nearestDriver.doc.officeId);
      let matchedLineId: string | null = sanitizeId(nearestDriver.doc.lineId);

      await db.runTransaction(async (transaction) => {
        // Re-verify driver is still available (prevent race condition)
        const driverDoc = await transaction.get(driverDocRef);
        if (!driverDoc.exists) {
          throw new NotFoundError('Driver not found');
        }
        
        const driverData = driverDoc.data() as DriverDoc;
        if (!driverData.isOnline || !driverData.isAvailable) {
          logger.warn('🚫 [CreateTrip] Driver no longer available in transaction', {
            driverId: nearestDriver.driverId,
            isOnline: driverData.isOnline,
            isAvailable: driverData.isAvailable,
          });
          throw new NotFoundError('Driver no longer available');
        }

        const eligibility = evaluateDriverEligibility(driverData);
        if (!eligibility.isEligible) {
          logger.warn('🚫 [CreateTrip] Driver no longer eligible in transaction', {
            driverId: nearestDriver.driverId,
            reasons: eligibility.reasons,
            driverType: eligibility.driverType,
            verificationStatus: eligibility.verificationStatus,
            lineId: eligibility.lineId,
            licenseId: eligibility.licenseId,
          });
          throw new NotFoundError('Driver no longer eligible');
        }

        const transactionDriverOfficeId = sanitizeId(driverData.officeId);
        const transactionDriverLineId = sanitizeId(driverData.lineId);
        if (requestedLineId && transactionDriverLineId !== requestedLineId) {
          logger.warn('[CreateTrip] Driver no longer matches requested line scope', {
            driverId: nearestDriver.driverId,
            requestedLineId,
            driverLineId: transactionDriverLineId,
          });
          throw new NotFoundError('Driver no longer matches requested line');
        }

        if (requestedOfficeId && transactionDriverOfficeId !== requestedOfficeId) {
          logger.warn('[CreateTrip] Driver no longer matches requested office scope', {
            driverId: nearestDriver.driverId,
            requestedOfficeId,
            driverOfficeId: transactionDriverOfficeId,
          });
          throw new NotFoundError('Driver no longer matches requested office');
        }

        const transactionDriverVehicleType = normalizeVehicleType(driverData.vehicleType);
        const transactionDriverSeatCapacity = normalizeSeatCapacity(
          driverData.seatCapacity,
          transactionDriverVehicleType
        );

        if (
          normalizedRideOptions.vehicleType &&
          transactionDriverVehicleType !== normalizedRideOptions.vehicleType
        ) {
          logger.warn('[CreateTrip] Driver no longer matches requested vehicle type', {
            driverId: nearestDriver.driverId,
            requestedVehicleType: normalizedRideOptions.vehicleType,
            driverVehicleType: transactionDriverVehicleType,
          });
          throw new NotFoundError('Driver no longer matches requested vehicle type');
        }

        if (transactionDriverSeatCapacity < normalizedRideOptions.requiredSeats) {
          logger.warn('[CreateTrip] Driver no longer matches required seats', {
            driverId: nearestDriver.driverId,
            requestedSeats: normalizedRideOptions.requiredSeats,
            driverSeatCapacity: transactionDriverSeatCapacity,
          });
          throw new NotFoundError('Driver no longer matches required seats');
        }

        matchedVehicleType = transactionDriverVehicleType;
        matchedSeatCapacity = transactionDriverSeatCapacity;
        matchedOfficeId = transactionDriverOfficeId;
        matchedLineId = transactionDriverLineId;

        // Create trip document
        const tripDoc: TripDocument = {
          tripId,
          passengerId,
          driverId: nearestDriver.driverId,
          status: TripStatus.PENDING,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          dropoff: { lat: dropoff.lat, lng: dropoff.lng },
          estimatedDistanceKm: estimate.distanceKm,
          estimatedDurationMin: estimate.durationMin,
          estimatedPriceIls: serverCalculatedPriceIls,
          requiredSeats: normalizedRideOptions.requiredSeats,
          requestedVehicleType: normalizedRideOptions.vehicleType,
          requestedOfficeId,
          requestedLineId,
          matchedVehicleType: transactionDriverVehicleType,
          matchedSeatCapacity: transactionDriverSeatCapacity,
          matchedOfficeId: transactionDriverOfficeId,
          matchedLineId: transactionDriverLineId,
          paymentMethod: 'cash',
          fareAmount: serverCalculatedPriceIls,
          paymentStatus: 'pending',
          paidAt: null,
          createdAt: FieldValue.serverTimestamp(),
        };
        transaction.set(tripRef, tripDoc);

        // Mark driver as busy
        transaction.set(driverDocRef, {
          isAvailable: false,
          currentTripId: tripId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Create driver request notification
        const expiresAt = Timestamp.fromMillis(
          Date.now() + PILOT_LIMITS.DRIVER_RESPONSE_TIMEOUT_SECONDS * 1000
        );

        const driverRequestDoc: DriverRequestDocument = {
          tripId,
          passengerId,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          dropoff: { lat: dropoff.lat, lng: dropoff.lng },
          estimatedDistanceKm: estimate.distanceKm,
          estimatedDurationMin: estimate.durationMin,
          estimatedPriceIls: serverCalculatedPriceIls,
          requiredSeats: normalizedRideOptions.requiredSeats,
          requestedVehicleType: normalizedRideOptions.vehicleType,
          requestedOfficeId,
          requestedLineId,
          driverOfficeId: transactionDriverOfficeId,
          driverLineId: transactionDriverLineId,
          driverVehicleType: transactionDriverVehicleType,
          driverSeatCapacity: transactionDriverSeatCapacity,
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
          expiresAt,
          timeoutSeconds: PILOT_LIMITS.DRIVER_RESPONSE_TIMEOUT_SECONDS,
        };
        transaction.set(driverRequestRef, driverRequestDoc);

        // Update tripRequest to MATCHED
        transaction.update(tripRequestRef, {
          status: TripRequestStatus.MATCHED,
          matchedDriverId: nearestDriver.driverId,
          matchedTripId: tripId,
          matchedVehicleType: transactionDriverVehicleType,
          matchedSeatCapacity: transactionDriverSeatCapacity,
          matchedOfficeId: transactionDriverOfficeId,
          matchedLineId: transactionDriverLineId,
          matchedAt: FieldValue.serverTimestamp(),
        });
      });

      logger.info(`📝 [CreateTrip] Trip created: ${tripId}`);
      logger.info(`🚗 [CreateTrip] Driver isAvailable → false`, { driverId: nearestDriver.driverId });
      logger.info(`📨 [CreateTrip] Request sent to driver: ${nearestDriver.driverId}`);

      await publishTripStatusNotifications({
        tripId,
        status: TripStatus.PENDING,
        recipients: [
          {
            userId: nearestDriver.driverId,
            role: 'driver',
          },
        ],
        metadata: {
          passengerId,
        },
      });
      
      // Log trip lifecycle event
      logger.tripEvent('TRIP_CREATED', tripId, {
        passengerId,
        driverId: nearestDriver.driverId,
        estimatedPriceIls: serverCalculatedPriceIls,
        distanceKm: estimate.distanceKm,
        requiredSeats: normalizedRideOptions.requiredSeats,
        requestedVehicleType: normalizedRideOptions.vehicleType,
        requestedOfficeId,
        requestedLineId,
        matchedVehicleType,
        matchedSeatCapacity,
        matchedOfficeId,
        matchedLineId,
        pricingProfileId: pricingResult.breakdown.profileId,
      });

      // ========================================
      // 8. Return requestId with matched status
      // ========================================
      logger.info('🎉 [CreateTrip] COMPLETE', {
        requestId,
        tripId,
        driverId: nearestDriver.driverId,
        distance: `${nearestDriver.distance.toFixed(2)} km`,
      });

      return {
        requestId,
        tripId,
        driverId: nearestDriver.driverId,
        status: 'matched' as const,
      };
    } catch (error) {
      logger.error('❌ [CreateTrip] FAILED', { error });
      throw handleError(error);
    }
  }
);
