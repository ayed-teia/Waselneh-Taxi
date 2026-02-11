import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { LatLngSchema, TripEstimateSchema, TripStatus, TripRequestStatus, PILOT_LIMITS, ACTIVE_TRIP_STATUSES } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, UnauthorizedError, NotFoundError, ForbiddenError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { calculatePrice } from '../../modules/pricing/utils';

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
  estimatedPriceIls: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: FirebaseFirestore.FieldValue;
  expiresAt: FirebaseFirestore.Timestamp; // Actual timestamp for timeout checking
  timeoutSeconds: number; // For reference
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

      const { pickup, dropoff, estimate } = parsed.data;

      logger.info('� [CreateTrip] START', {
        passengerId,
        pickup: `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}`,
        dropoff: `${dropoff.lat.toFixed(4)}, ${dropoff.lng.toFixed(4)}`,
        estimatedPrice: estimate.priceIls,
      });

      const db = getFirestore();

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
      const serverCalculatedPriceIls = calculatePrice(estimate.distanceKm);
      
      // Log if client price differs from server calculation
      if (serverCalculatedPriceIls !== estimate.priceIls) {
        logger.warn('💰 [CreateTrip] Price mismatch - using server calculation', {
          clientPrice: estimate.priceIls,
          serverPrice: serverCalculatedPriceIls,
          distanceKm: estimate.distanceKm,
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
        status: TripRequestStatus.OPEN,
        createdAt: FieldValue.serverTimestamp(),
      };

      await tripRequestRef.set(tripRequestDoc);
      logger.info('📋 [CreateTrip] Trip request created', { requestId });

      // ========================================
      // 5. Query drivers where isOnline=true AND isAvailable=true
      // ========================================
      logger.info('🔍 [CreateTrip] Querying available drivers...');
      
      const driversSnapshot = await db
        .collection('drivers')
        .where('isOnline', '==', true)
        .where('isAvailable', '==', true)
        .get();

      if (driversSnapshot.empty) {
        logger.warn('🚫 [CreateTrip] No available drivers - keeping request open');
        logger.dispatchFailed(requestId, 'No available drivers', { passengerId });
        
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
      const driversWithDistance: Array<{
        driverId: string;
        distance: number;
        doc: DriverDoc;
      }> = [];

      driversSnapshot.forEach((doc) => {
        const driverData = doc.data() as DriverDoc;
        
        // Skip drivers without location data
        if (!driverData.lastLocation) {
          logger.debug(`Driver ${doc.id}: No location data - skipping`);
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
          doc: driverData,
        });

        logger.debug(`Driver ${doc.id}: ${distance.toFixed(2)} km away`);
      });

      // ========================================
      // 6. Select nearest driver
      // ========================================
      if (driversWithDistance.length === 0) {
        logger.dispatchFailed(requestId, 'No drivers with location data', { passengerId, driversQueried: driversSnapshot.size });
        
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
          estimatedPriceIls: serverCalculatedPriceIls,
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
          matchedAt: FieldValue.serverTimestamp(),
        });
      });

      logger.info(`📝 [CreateTrip] Trip created: ${tripId}`);
      logger.info(`🚗 [CreateTrip] Driver isAvailable → false`, { driverId: nearestDriver.driverId });
      logger.info(`📨 [CreateTrip] Request sent to driver: ${nearestDriver.driverId}`);
      
      // Log trip lifecycle event
      logger.tripEvent('TRIP_CREATED', tripId, {
        passengerId,
        driverId: nearestDriver.driverId,
        estimatedPriceIls: serverCalculatedPriceIls,
        distanceKm: estimate.distanceKm,
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
