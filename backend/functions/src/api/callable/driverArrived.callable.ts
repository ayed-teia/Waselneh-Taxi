import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { publishTripStatusNotifications } from '../../modules/notifications';
import { assertDriverIsLicensedLineOwner } from '../../modules/auth';

/**
 * ============================================================================
 * DRIVER ARRIVED - Cloud Function
 * ============================================================================
 * 
 * Called when driver arrives at pickup location.
 * 
 * FLOW: ACCEPTED → DRIVER_ARRIVED
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ ARRIVED FLOW:
 *    LOG: "📍 [DriverArrived] START - driverId: {id}, tripId: {id}"
 *    LOG: "🔒 [DriverArrived] Current status: accepted ✓"
 *    LOG: "📝 [DriverArrived] Trip status → driver_arrived"
 *    LOG: "✅ [DriverArrived] COMPLETE"
 * 
 * ✅ INVALID STATUS:
 *    LOG: "⚠️ [DriverArrived] Invalid status: {status}"
 * 
 * ============================================================================
 */

/**
 * Request schema for driver arrived
 */
const DriverArrivedSchema = z.object({
  tripId: z.string().min(1),
});

/**
 * Response type
 */
interface DriverArrivedResponse {
  success: boolean;
  status: string;
}

/**
 * Mark driver as arrived at pickup location
 * 
 * Valid transition: ACCEPTED → DRIVER_ARRIVED
 * 
 * Validates:
 * - Driver is authenticated
 * - Driver owns the trip (trip.driverId === auth.uid)
 * - Trip status is ACCEPTED
 */
export const driverArrived = onCall<unknown, Promise<DriverArrivedResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Require authentication
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) {
        throw new UnauthorizedError('Authentication required');
      }
      await assertDriverIsLicensedLineOwner(driverId);

      // Validate input
      const parsed = DriverArrivedSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request',
          parsed.error.flatten()
        );
      }

      const { tripId } = parsed.data;

      logger.info('📍 [DriverArrived] START', { driverId, tripId });

      const db = getFirestore();
      const tripRef = db.collection('trips').doc(tripId);
      let passengerIdForNotify = '';

      // Use transaction to prevent race conditions
      const newStatus = await db.runTransaction(async (transaction) => {
        const tripDoc = await transaction.get(tripRef);

        if (!tripDoc.exists) {
          logger.warn('🚫 [DriverArrived] Trip not found', { tripId });
          throw new NotFoundError('Trip', tripId);
        }

        const tripData = tripDoc.data()!;

        // Validate driver ownership
        if (tripData.driverId !== driverId) {
          logger.warn('🚫 [DriverArrived] Driver not assigned to trip', { driverId, tripId, assignedDriver: tripData.driverId });
          throw new ForbiddenError('You are not assigned to this trip');
        }

        // Validate current status - must be ACCEPTED
        if (tripData.status !== TripStatus.ACCEPTED) {
          logger.warn('⚠️ [DriverArrived] Invalid status', { tripId, currentStatus: tripData.status, expected: TripStatus.ACCEPTED });
          throw new ForbiddenError(
            `Cannot mark arrived from status '${tripData.status}'. Expected '${TripStatus.ACCEPTED}'.`
          );
        }

        logger.info('🔒 [DriverArrived] Current status: accepted ✓', { tripId });
        passengerIdForNotify = String(tripData.passengerId || '');

        // Update trip status within transaction
        transaction.update(tripRef, {
          status: TripStatus.DRIVER_ARRIVED,
          arrivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return TripStatus.DRIVER_ARRIVED;
      });

      logger.info('📝 [DriverArrived] Trip status → driver_arrived', { tripId });

      await publishTripStatusNotifications({
        tripId,
        status: TripStatus.DRIVER_ARRIVED,
        recipients: passengerIdForNotify
          ? [
              {
                userId: passengerIdForNotify,
                role: 'passenger',
              },
            ]
          : [],
        metadata: {
          driverId,
        },
      });
      
      // Log trip lifecycle event
      logger.tripEvent('TRIP_DRIVER_ARRIVED', tripId, { driverId });
      
      logger.info('✅ [DriverArrived] COMPLETE', { tripId, driverId });

      return {
        success: true,
        status: newStatus,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
