import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { publishTripStatusNotifications } from '../../modules/notifications';

/**
 * ============================================================================
 * REJECT TRIP REQUEST - Cloud Function
 * ============================================================================
 * 
 * Called when a driver rejects a trip request.
 * 
 * MVP FLOW:
 * 1. Validate authenticated driver
 * 2. Update driverRequests/{driverId}/requests/{tripId} status to 'rejected'
 * 3. Update trips/{tripId} status to 'no_driver_available'
 * 4. Do NOT retry other drivers (MVP limitation)
 * 
 * FUTURE ENHANCEMENT:
 * - Dispatch to next nearest driver
 * - Implement retry queue with timeout
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ REJECT FLOW:
 *    LOG: "❌ [RejectTrip] START - driverId: {id}, tripId: {id}"
 *    LOG: "📝 [RejectTrip] Request status → rejected"
 *    LOG: "📝 [RejectTrip] Trip status → no_driver_available"
 *    LOG: "✅ [RejectTrip] COMPLETE"
 * 
 * ✅ ALREADY PROCESSED:
 *    LOG: "⚠️ [RejectTrip] Already {status} - skipping"
 * 
 * ✅ SYSTEM STABILITY:
 *    - Reject does NOT crash the system
 *    - Reject does NOT affect other trips
 *    - Transaction ensures consistency
 * 
 * ============================================================================
 */

/**
 * Request schema for rejecting a trip request
 */
const RejectTripRequestSchema = z.object({
  tripId: z.string().min(1),
});

/**
 * Response type for reject
 */
interface RejectTripRequestResponse {
  success: boolean;
}

/**
 * Reject a trip request (driver action)
 */
export const rejectTripRequest = onCall<unknown, Promise<RejectTripRequestResponse>>(
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
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) {
        throw new UnauthorizedError('Authentication required to reject a trip request');
      }

      // ========================================
      // 2. Validate input
      // ========================================
      const parsed = RejectTripRequestSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid reject request data',
          parsed.error.flatten()
        );
      }

      const { tripId } = parsed.data;

      logger.info('❌ [RejectTrip] START', {
        tripId,
        driverId,
      });

      const db = getFirestore();
      let passengerIdForNotify = '';
      let shouldNotifyPassenger = false;

      // ========================================
      // 3. Run transaction for consistency
      // ========================================
      await db.runTransaction(async (transaction) => {
        // Read driver request
        const driverRequestRef = db
          .collection('driverRequests')
          .doc(driverId)
          .collection('requests')
          .doc(tripId);

        const driverRequestDoc = await transaction.get(driverRequestRef);

        if (!driverRequestDoc.exists) {
          logger.error('🚫 [RejectTrip] Request not found');
          throw new NotFoundError('Trip request not found');
        }

        const requestData = driverRequestDoc.data()!;

        // Check if request is still pending
        if (requestData.status !== 'pending') {
          logger.warn(`⚠️ [RejectTrip] Already ${requestData.status} - skipping`);
          // Already processed, just return
          return;
        }

        // Read trip document
        const tripRef = db.collection('trips').doc(tripId);
        const tripDoc = await transaction.get(tripRef);

        if (!tripDoc.exists) {
          logger.error('🚫 [RejectTrip] Trip not found');
          throw new NotFoundError('Trip not found');
        }

        const tripData = tripDoc.data()!;
        passengerIdForNotify = String(tripData.passengerId || '');

        // ========================================
        // 4. Update driver request status
        // ========================================
        transaction.update(driverRequestRef, {
          status: 'rejected',
          rejectedAt: FieldValue.serverTimestamp(),
        });

        logger.info('📝 [RejectTrip] Request status → rejected');

        // ========================================
        // 5. Update trip status (MVP: no retry)
        // ========================================
        // Only update trip if it's still pending and this is the assigned driver
        if (tripData.status === TripStatus.PENDING && tripData.driverId === driverId) {
          transaction.update(tripRef, {
            status: TripStatus.NO_DRIVER_AVAILABLE,
            rejectedAt: FieldValue.serverTimestamp(),
            rejectedBy: driverId,
          });
          shouldNotifyPassenger = true;

          logger.info('📝 [RejectTrip] Trip status → no_driver_available');
        }

        // ========================================
        // 6. Set driver as available again
        // ========================================
        const driverDocRef = db.collection('drivers').doc(driverId);
        transaction.set(driverDocRef, {
          isAvailable: true,
          currentTripId: null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        logger.info('🚗 [RejectTrip] Driver isAvailable → true');
      });

      // Log trip lifecycle event
      logger.tripEvent('TRIP_REJECTED', tripId, { driverId });

      if (shouldNotifyPassenger && passengerIdForNotify) {
        await publishTripStatusNotifications({
          tripId,
          status: TripStatus.NO_DRIVER_AVAILABLE,
          recipients: [
            {
              userId: passengerIdForNotify,
              role: 'passenger',
            },
          ],
          metadata: {
            driverId,
          },
        });
      }

      logger.info('✅ [RejectTrip] COMPLETE', {
        tripId,
        driverId,
      });

      // TODO: Future enhancement - dispatch to next available driver

      return { success: true };
    } catch (error) {
      logger.error('❌ [RejectTrip] FAILED', { error });
      throw handleError(error);
    }
  }
);
