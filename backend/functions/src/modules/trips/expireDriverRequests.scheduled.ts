import { onSchedule } from 'firebase-functions/v2/scheduler';
import { TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { logger } from '../../core/logger';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * ============================================================================
 * EXPIRE DRIVER REQUESTS - Scheduled Cloud Function
 * ============================================================================
 * 
 * Runs every minute to check for expired driver requests.
 * 
 * FLOW:
 * 1. Query all pending driver requests where expiresAt < now
 * 2. For each expired request:
 *    a. Update request status to 'expired'
 *    b. Update trip status to 'no_driver_available'
 *    c. Mark driver isAvailable=true again
 * 
 * PILOT SAFETY:
 * - Ensures drivers aren't stuck in unavailable state
 * - Ensures passengers get quick feedback when no driver responds
 * - Timeout is configurable via PILOT_LIMITS.DRIVER_RESPONSE_TIMEOUT_SECONDS
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ TIMEOUT DETECTION:
 *    LOG: "⏰ [ExpireRequests] START - checking expired requests"
 *    LOG: "🔍 [ExpireRequests] Found {N} expired request(s)"
 * 
 * ✅ EXPIRATION HANDLING:
 *    LOG: "⏰ [ExpireRequests] Expiring request: {tripId} for driver: {driverId}"
 *    LOG: "📝 [ExpireRequests] Request expired, trip cancelled"
 *    LOG: "🚗 [ExpireRequests] Driver {driverId} isAvailable → true"
 * 
 * ============================================================================
 */

/**
 * Scheduled function to expire driver requests that have timed out
 * Runs every minute
 */
export const expireDriverRequests = onSchedule(
  {
    region: REGION,
    schedule: 'every 1 minutes',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    const startTime = Date.now();
    logger.info('⏰ [ExpireRequests] START - checking expired requests');

    const db = getFirestore();
    const now = Timestamp.now();
    
    let expiredCount = 0;
    let errorCount = 0;

    try {
      // ========================================
      // 1. Query all drivers with pending requests
      // ========================================
      // We need to do a collection group query on 'requests' subcollection
      const expiredRequestsSnapshot = await db
        .collectionGroup('requests')
        .where('status', '==', 'pending')
        .where('expiresAt', '<', now)
        .get();

      if (expiredRequestsSnapshot.empty) {
        logger.info('✅ [ExpireRequests] No expired requests found');
        return;
      }

      logger.info(`🔍 [ExpireRequests] Found ${expiredRequestsSnapshot.size} expired request(s)`);

      // ========================================
      // 2. Process each expired request
      // ========================================
      for (const requestDoc of expiredRequestsSnapshot.docs) {
        try {
          const requestData = requestDoc.data();
          const tripId = requestData.tripId;
          
          // Extract driverId from the document path
          // Path: driverRequests/{driverId}/requests/{tripId}
          const pathParts = requestDoc.ref.path.split('/');
          const driverId = pathParts[1];

          if (!driverId || !tripId) {
            logger.error('❌ [ExpireRequests] Invalid request document path', {
              path: requestDoc.ref.path,
            });
            errorCount++;
            continue;
          }

          logger.info(`⏰ [ExpireRequests] Expiring request`, { tripId, driverId });

          // Use a transaction to ensure consistency
          await db.runTransaction(async (transaction) => {
            // a. Update the request status to 'expired'
            transaction.update(requestDoc.ref, {
              status: 'expired',
              expiredAt: FieldValue.serverTimestamp(),
            });

            // b. Update trip status to 'no_driver_available'
            const tripRef = db.collection('trips').doc(tripId);
            const tripDoc = await transaction.get(tripRef);
            
            if (tripDoc.exists) {
              const tripData = tripDoc.data();
              // Only update if still pending
              if (tripData?.status === TripStatus.PENDING) {
                transaction.update(tripRef, {
                  status: TripStatus.NO_DRIVER_AVAILABLE,
                  cancelledAt: FieldValue.serverTimestamp(),
                  cancellationReason: 'Driver did not respond in time',
                });
              }
            }

            // c. Mark driver as available again
            const driverRef = db.collection('drivers').doc(driverId);
            transaction.update(driverRef, {
              isAvailable: true,
              currentTripId: null,
              updatedAt: FieldValue.serverTimestamp(),
            });
          });

          // Log trip lifecycle event
          logger.tripEvent('TRIP_EXPIRED', tripId, { 
            driverId, 
            reason: 'Driver did not respond in time' 
          });
          
          logger.info(`✅ [ExpireRequests] Request expired successfully`, { tripId, driverId });
          expiredCount++;

        } catch (docError) {
          logger.error('❌ [ExpireRequests] Failed to expire request', {
            docId: requestDoc.id,
            error: docError,
          });
          errorCount++;
        }
      }

      const duration = Date.now() - startTime;
      logger.info('🎉 [ExpireRequests] COMPLETE', {
        expiredCount,
        errorCount,
        durationMs: duration,
      });

    } catch (error) {
      logger.error('❌ [ExpireRequests] FAILED', { error });
      throw error;
    }
  }
);
