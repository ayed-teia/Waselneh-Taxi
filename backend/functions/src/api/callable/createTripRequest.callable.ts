import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { LatLngSchema, TripEstimateSchema, TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, UnauthorizedError, NotFoundError } from '../../core/errors';
import { logger } from '../../core/logger';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * ============================================================================
 * CREATE TRIP REQUEST - Cloud Function
 * ============================================================================
 * 
 * Flow:
 * 1. Validate authenticated passenger
 * 2. Validate input (pickup, dropoff, estimate)
 * 3. Query driverLive for online drivers
 * 4. Compute distance from pickup using Haversine formula
 * 5. Select nearest driver
 * 6. Create trips/{tripId} document
 * 7. Create driverRequests/{driverId}/{tripId} record
 * 8. Return { tripId, driverId }
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ PASSENGER REQUEST FLOW:
 *    LOG: "🚕 [CreateTrip] START - passengerId: {id}"
 *    LOG: "🔍 [CreateTrip] Querying online drivers..."
 *    LOG: "🚗 [CreateTrip] Found {N} online driver(s)"
 *    LOG: "✅ [CreateTrip] Selected driver: {driverId} ({distance} km away)"
 *    LOG: "📝 [CreateTrip] Trip created: {tripId}"
 *    LOG: "📨 [CreateTrip] Request sent to driver: {driverId}"
 *    LOG: "🎉 [CreateTrip] COMPLETE - tripId: {id}, driverId: {id}"
 * 
 * ✅ NO DRIVERS AVAILABLE:
 *    LOG: "🚫 [CreateTrip] No online drivers - returning error"
 * 
 * ✅ SINGLE DRIVER SELECTION:
 *    - Only the NEAREST driver receives the request
 *    - Only ONE document created in driverRequests/{driverId}/requests
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
 */
interface CreateTripRequestResponse {
  tripId: string;
  driverId: string;
}

/**
 * Driver live location document from Firestore
 */
interface DriverLiveDoc {
  driverId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  status: string;
  updatedAt: FirebaseFirestore.Timestamp;
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
  expiresAt: FirebaseFirestore.FieldValue;
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
      if (!request.auth?.uid) {
        throw new UnauthorizedError('Authentication required to create a trip request');
      }

      const passengerId = request.auth.uid;

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
      // 3. Query driverLive for online drivers
      // ========================================
      logger.info('🔍 [CreateTrip] Querying online drivers...');
      
      const driversSnapshot = await db
        .collection('driverLive')
        .where('status', '==', 'online')
        .get();

      if (driversSnapshot.empty) {
        logger.warn('🚫 [CreateTrip] No online drivers - returning error');
        throw new NotFoundError('No drivers available at the moment');
      }

      logger.info(`🚗 [CreateTrip] Found ${driversSnapshot.size} online driver(s)`);

      // ========================================
      // 4. Compute distance using Haversine formula
      // ========================================
      const driversWithDistance: Array<{
        driverId: string;
        distance: number;
        doc: DriverLiveDoc;
      }> = [];

      driversSnapshot.forEach((doc) => {
        const driverData = doc.data() as DriverLiveDoc;
        const distance = haversineDistance(
          pickup.lat,
          pickup.lng,
          driverData.lat,
          driverData.lng
        );

        driversWithDistance.push({
          driverId: doc.id,
          distance,
          doc: driverData,
        });

        logger.debug(`Driver ${doc.id}: ${distance.toFixed(2)} km away`);
      });

      // ========================================
      // 5. Select nearest driver
      // ========================================
      if (driversWithDistance.length === 0) {
        throw new NotFoundError('No drivers available at the moment');
      }

      driversWithDistance.sort((a, b) => a.distance - b.distance);
      const nearestDriver = driversWithDistance[0]!;

      logger.info(`✅ [CreateTrip] Selected driver: ${nearestDriver.driverId}`, {
        distance: `${nearestDriver.distance.toFixed(2)} km`,
        totalCandidates: driversWithDistance.length,
      });

      // ========================================
      // 6. Create trips/{tripId} document
      // ========================================
      const tripRef = db.collection('trips').doc();
      const tripId = tripRef.id;

      const tripDoc: TripDocument = {
        tripId,
        passengerId,
        driverId: nearestDriver.driverId,
        status: TripStatus.PENDING,
        pickup: { lat: pickup.lat, lng: pickup.lng },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng },
        estimatedDistanceKm: estimate.distanceKm,
        estimatedDurationMin: estimate.durationMin,
        estimatedPriceIls: estimate.priceIls,
        createdAt: FieldValue.serverTimestamp(),
      };

      await tripRef.set(tripDoc);

      logger.info(`📝 [CreateTrip] Trip created: ${tripId}`);

      // ========================================
      // 7. Create driverRequests/{driverId}/{tripId}
      // ========================================
      const driverRequestRef = db
        .collection('driverRequests')
        .doc(nearestDriver.driverId)
        .collection('requests')
        .doc(tripId);

      const driverRequestDoc: DriverRequestDocument = {
        tripId,
        passengerId,
        pickup: { lat: pickup.lat, lng: pickup.lng },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng },
        estimatedPriceIls: estimate.priceIls,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        // Request expires in 30 seconds if driver doesn't respond
        expiresAt: FieldValue.serverTimestamp(),
      };

      await driverRequestRef.set(driverRequestDoc);

      logger.info(`📨 [CreateTrip] Request sent to driver: ${nearestDriver.driverId}`);

      // ========================================
      // 8. Return tripId + driverId
      // ========================================
      logger.info('🎉 [CreateTrip] COMPLETE', {
        tripId,
        driverId: nearestDriver.driverId,
        distance: `${nearestDriver.distance.toFixed(2)} km`,
      });

      return {
        tripId,
        driverId: nearestDriver.driverId,
      };
    } catch (error) {
      logger.error('❌ [CreateTrip] FAILED', { error });
      throw handleError(error);
    }
  }
);
