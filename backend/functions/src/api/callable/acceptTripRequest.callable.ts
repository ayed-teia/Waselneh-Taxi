import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { publishTripStatusNotifications } from '../../modules/notifications';

/**
 * ============================================================================
 * ACCEPT TRIP REQUEST - Cloud Function
 * ============================================================================
 * 
 * Called when a driver accepts a trip request.
 * 
 * TRANSACTION FLOW:
 * 1. Validate driver is authenticated
 * 2. Read driverRequests/{driverId}/requests/{tripId} 
 * 3. Check status is 'pending' (prevent double acceptance)
 * 4. Read trips/{tripId} - verify trip is still in 'pending' status
 * 5. Update trips/{tripId} status to 'accepted'
 * 6. Update driverRequests/{driverId}/requests/{tripId} status to 'accepted'
 * 
 * SECURITY:
 * - Only the assigned driver can accept their request
 * - Transaction ensures atomicity
 * - Double acceptance prevented by status check
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ ACCEPT FLOW:
 *    LOG: "✅ [AcceptTrip] START - driverId: {id}, tripId: {id}"
 *    LOG: "🔒 [AcceptTrip] Request status: pending ✓"
 *    LOG: "🔒 [AcceptTrip] Trip status: pending ✓"
 *    LOG: "🔒 [AcceptTrip] Driver assignment verified ✓"
 *    LOG: "📝 [AcceptTrip] Trip status → accepted"
 *    LOG: "🎉 [AcceptTrip] COMPLETE"
 * 
 * ✅ DOUBLE ACCEPT PREVENTION:
 *    LOG: "⚠️ [AcceptTrip] Request already {status} - blocking"
 *    LOG: "⚠️ [AcceptTrip] Trip already accepted - blocking"
 * 
 * ✅ UNAUTHORIZED DRIVER:
 *    LOG: "🚫 [AcceptTrip] Driver not assigned to this trip"
 * 
 * ============================================================================
 */

/**
 * Request schema for accepting a trip request
 */
const AcceptTripRequestSchema = z.object({
  tripId: z.string().min(1),
});

/**
 * Response type for accept
 */
interface AcceptTripRequestResponse {
  tripId: string;
}

/**
 * Accept a trip request (driver action)
 */
export const acceptTripRequest = onCall<unknown, Promise<AcceptTripRequestResponse>>(
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
        throw new UnauthorizedError('Authentication required to accept a trip request');
      }

      // ========================================
      // 2. Validate input
      // ========================================
      const parsed = AcceptTripRequestSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid accept request',
          parsed.error.flatten()
        );
      }

      const { tripId } = parsed.data;

      logger.info('✅ [AcceptTrip] START', { driverId, tripId });

      const db = getFirestore();
      let passengerIdForNotify = '';

      // ========================================
      // 3. Run transaction for atomicity
      // ========================================
      await db.runTransaction(async (transaction) => {
        // Read driver request document
        const driverRequestRef = db
          .collection('driverRequests')
          .doc(driverId)
          .collection('requests')
          .doc(tripId);

        const driverRequestDoc = await transaction.get(driverRequestRef);

        if (!driverRequestDoc.exists) {
          logger.error('🚫 [AcceptTrip] Request not found for driver');
          throw new NotFoundError('Trip request not found for this driver');
        }

        const requestData = driverRequestDoc.data()!;

        // ========================================
        // 4. Check request is still pending (prevent double accept)
        // ========================================
        if (requestData.status !== 'pending') {
          logger.warn(`⚠️ [AcceptTrip] Request already ${requestData.status} - blocking`);
          throw new ForbiddenError(
            `Trip request already ${requestData.status}`
          );
        }

        // ========================================
        // 4b. Check request hasn't expired (PILOT SAFETY GUARD)
        // ========================================
        const expiresAt = requestData.expiresAt as Timestamp | undefined;
        if (expiresAt && expiresAt.toMillis() < Date.now()) {
          logger.warn('⏰ [AcceptTrip] Request has expired - blocking', {
            expiresAt: expiresAt.toDate().toISOString(),
            now: new Date().toISOString(),
          });
          throw new ForbiddenError('This trip request has expired');
        }

        logger.info('🔒 [AcceptTrip] Request status: pending ✓');

        // ========================================
        // 5. Read trip document
        // ========================================
        const tripRef = db.collection('trips').doc(tripId);
        const tripDoc = await transaction.get(tripRef);

        if (!tripDoc.exists) {
          logger.error('🚫 [AcceptTrip] Trip not found');
          throw new NotFoundError('Trip not found');
        }

        const tripData = tripDoc.data()!;

        // ========================================
        // 6. Verify trip is still pending
        // ========================================
        if (tripData.status !== TripStatus.PENDING) {
          logger.warn(`⚠️ [AcceptTrip] Trip already ${tripData.status} - blocking`);
          throw new ForbiddenError(
            'This trip has already been accepted by another driver'
          );
        }

        logger.info('🔒 [AcceptTrip] Trip status: pending ✓');

        // ========================================
        // 7. Verify this is the assigned driver
        // ========================================
        if (tripData.driverId !== driverId) {
          logger.warn('🚫 [AcceptTrip] Driver not assigned to this trip', {
            assignedDriver: tripData.driverId,
            attemptingDriver: driverId,
          });
          throw new ForbiddenError('You are not assigned to this trip');
        }

        logger.info('🔒 [AcceptTrip] Driver assignment verified ✓');
        passengerIdForNotify = String(tripData.passengerId || '');

        // ========================================
        // 8. Update trip status to ACCEPTED
        // ========================================
        transaction.update(tripRef, {
          status: TripStatus.ACCEPTED,
          acceptedAt: FieldValue.serverTimestamp(),
        });

        logger.info('📝 [AcceptTrip] Trip status → accepted');

        // ========================================
        // 9. Update driver request status
        // ========================================
        transaction.update(driverRequestRef, {
          status: 'accepted',
          acceptedAt: FieldValue.serverTimestamp(),
        });

        // ========================================
        // 10. Set driver as unavailable (on a trip)
        // ========================================
        const driverDocRef = db.collection('drivers').doc(driverId);
        transaction.set(driverDocRef, {
          isAvailable: false,
          currentTripId: tripId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        logger.info('🚗 [AcceptTrip] Driver isAvailable → false');

        // Log trip lifecycle event
        logger.tripEvent('TRIP_ACCEPTED', tripId, {
          driverId,
          passengerId: tripData.passengerId,
        });

        logger.info('🎉 [AcceptTrip] COMPLETE', {
          tripId,
          driverId,
          passengerId: tripData.passengerId,
        });
      });

      await publishTripStatusNotifications({
        tripId,
        status: TripStatus.ACCEPTED,
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

      return { tripId };
    } catch (error) {
      logger.error('❌ [AcceptTrip] FAILED', { error });
      throw handleError(error);
    }
  }
);
