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

/**
 * ============================================================================
 * START TRIP - Cloud Function
 * ============================================================================
 * 
 * Called when driver picks up passenger and starts the trip.
 * 
 * FLOW: DRIVER_ARRIVED → IN_PROGRESS
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ START TRIP FLOW:
 *    LOG: "🛣️ [StartTrip] START - driverId: {id}, tripId: {id}"
 *    LOG: "🔒 [StartTrip] Current status: driver_arrived ✓"
 *    LOG: "📝 [StartTrip] Trip status → in_progress"
 *    LOG: "✅ [StartTrip] COMPLETE"
 * 
 * ✅ INVALID STATUS:
 *    LOG: "⚠️ [StartTrip] Invalid status: {status}"
 * 
 * ============================================================================
 */

/**
 * Request schema for start trip
 */
const StartTripSchema = z.object({
  tripId: z.string().min(1),
});

/**
 * Response type
 */
interface StartTripResponse {
  success: boolean;
  status: string;
}

/**
 * Start the trip (passenger picked up)
 * 
 * Valid transition: DRIVER_ARRIVED → IN_PROGRESS
 * 
 * Validates:
 * - Driver is authenticated
 * - Driver owns the trip (trip.driverId === auth.uid)
 * - Trip status is DRIVER_ARRIVED
 */
export const startTrip = onCall<unknown, Promise<StartTripResponse>>(
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

      // Validate input
      const parsed = StartTripSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request',
          parsed.error.flatten()
        );
      }

      const { tripId } = parsed.data;

      logger.info('🛣️ [StartTrip] START', { driverId, tripId });

      const db = getFirestore();
      const tripRef = db.collection('trips').doc(tripId);
      let passengerIdForNotify = '';

      // Use transaction to prevent race conditions
      const newStatus = await db.runTransaction(async (transaction) => {
        const tripDoc = await transaction.get(tripRef);

        if (!tripDoc.exists) {
          logger.warn('🚫 [StartTrip] Trip not found', { tripId });
          throw new NotFoundError('Trip', tripId);
        }

        const tripData = tripDoc.data()!;

        // Validate driver ownership
        if (tripData.driverId !== driverId) {
          logger.warn('🚫 [StartTrip] Driver not assigned to trip', { driverId, tripId, assignedDriver: tripData.driverId });
          throw new ForbiddenError('You are not assigned to this trip');
        }

        // Validate current status
        if (tripData.status !== TripStatus.DRIVER_ARRIVED) {
          logger.warn('⚠️ [StartTrip] Invalid status', { tripId, currentStatus: tripData.status, expected: TripStatus.DRIVER_ARRIVED });
          throw new ForbiddenError(
            `Cannot start trip from status '${tripData.status}'. Expected '${TripStatus.DRIVER_ARRIVED}'.`
          );
        }

        logger.info('🔒 [StartTrip] Current status: driver_arrived ✓', { tripId });
        passengerIdForNotify = String(tripData.passengerId || '');

        // Update trip status within transaction
        transaction.update(tripRef, {
          status: TripStatus.IN_PROGRESS,
          startedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return TripStatus.IN_PROGRESS;
      });

      logger.info('📝 [StartTrip] Trip status → in_progress', { tripId });

      await publishTripStatusNotifications({
        tripId,
        status: TripStatus.IN_PROGRESS,
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
      logger.tripEvent('TRIP_STARTED', tripId, { driverId });
      
      logger.info('✅ [StartTrip] COMPLETE', { tripId, driverId });

      return {
        success: true,
        status: newStatus,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
