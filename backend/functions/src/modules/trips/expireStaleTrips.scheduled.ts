import { onSchedule } from 'firebase-functions/v2/scheduler';
import { TripStatus, TripRequestStatus, PILOT_LIMITS } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { logger } from '../../core/logger';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { docData, getString } from '../../core/firestore/doc-data';
import { buildDriverReleasePatch } from '../drivers/driver-seat-release';
import { restoreBenefits, restoreTripRequestBenefits } from '../promotions';

/**
 * ============================================================================
 * EXPIRE STALE TRIPS - Scheduled Cloud Function
 * ============================================================================
 * 
 * Step 32: Pilot Hardening & Kill Switches
 * 
 * Runs every minute to check for stale trips.
 * 
 * FLOW:
 * 1. Query tripRequests where status='open' AND createdAt < (now - 2 minutes)
 *    → Auto-cancel with reason "no_driver_found"
 * 
 * 2. Query trips where status='accepted' AND acceptedAt < (now - 5 minutes)
 *    → Auto-cancel with reason "driver_no_show"
 *    → Reset driver availability
 * 
 * PILOT SAFETY:
 * - Ensures passengers don't wait forever for drivers
 * - Ensures drivers that don't show up don't block the system
 * 
 * ============================================================================
 */

/**
 * Scheduled function to expire stale trips
 * Runs every minute
 */
export const expireStaleTrips = onSchedule(
  {
    region: REGION,
    schedule: 'every 1 minutes',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    const startTime = Date.now();
    logger.info('⏰ [ExpireStaleTrips] START - checking stale trips');

    const db = getFirestore();
    const now = Timestamp.now();
    
    let searchingExpired = 0;
    let acceptedExpired = 0;
    let errorCount = 0;

    try {
      // ========================================
      // 1. Expire "searching" trip requests (> 2 minutes)
      // ========================================
      const searchingCutoff = Timestamp.fromMillis(
        now.toMillis() - PILOT_LIMITS.TRIP_SEARCH_TIMEOUT_SECONDS * 1000
      );

      const staleRequestsSnapshot = await db
        .collection('tripRequests')
        .where('status', '==', TripRequestStatus.OPEN)
        .where('createdAt', '<', searchingCutoff)
        .get();

      if (!staleRequestsSnapshot.empty) {
        logger.info(`🔍 [ExpireStaleTrips] Found ${staleRequestsSnapshot.size} stale searching request(s)`);

        for (const requestDoc of staleRequestsSnapshot.docs) {
          try {
            await db.runTransaction(
      async (transaction) => {
              const current = await transaction.get(requestDoc.ref);
              const currentData = current.data() ?? {};
              if (currentData.status !== TripRequestStatus.OPEN) return;
              await restoreTripRequestBenefits(transaction, db, requestDoc.id, currentData, 'search_expired');
              // Update trip request to expired
              transaction.update(requestDoc.ref, {
                status: TripRequestStatus.EXPIRED,
                expiredAt: FieldValue.serverTimestamp(),
                expirationReason: 'no_driver_found',
              });
            });

            logger.info('📋 [ExpireStaleTrips] Request expired', {
              requestId: requestDoc.id,
              reason: 'no_driver_found',
              waitTimeSeconds: PILOT_LIMITS.TRIP_SEARCH_TIMEOUT_SECONDS,
            });

            searchingExpired++;
          } catch (error) {
            logger.error('❌ [ExpireStaleTrips] Failed to expire request', {
              requestId: requestDoc.id,
              error,
            });
            errorCount++;
          }
        }
      }

      // ========================================
      // 2. Expire "accepted" trips with driver no-show (> 5 minutes)
      // ========================================
      const acceptedCutoff = Timestamp.fromMillis(
        now.toMillis() - PILOT_LIMITS.DRIVER_ARRIVAL_TIMEOUT_SECONDS * 1000
      );

      const staleAcceptedTripsSnapshot = await db
        .collection('trips')
        .where('status', '==', TripStatus.ACCEPTED)
        .where('acceptedAt', '<', acceptedCutoff)
        .get();

      if (!staleAcceptedTripsSnapshot.empty) {
        logger.info(`🔍 [ExpireStaleTrips] Found ${staleAcceptedTripsSnapshot.size} stale accepted trip(s)`);

        for (const tripDoc of staleAcceptedTripsSnapshot.docs) {
          try {
            const tripData = docData(tripDoc);
            const driverId = getString(tripData, 'driverId', '');

            await db.runTransaction(async (transaction) => {
              // ---- READS FIRST (Firestore requires it) ----
              // R8: this branch previously wrote { isAvailable: true,
              // currentTripId: null } and nothing else, so a no-show left the
              // driver's availableSeats decremented and any full-taxi reservation
              // stuck true. It never read the driver at all, which is why the seats
              // could not be restored. Read it here, before any write.
              const driverRef = driverId ? db.collection('drivers').doc(driverId) : null;
              const driverSnap = driverRef ? await transaction.get(driverRef) : null;

              // A no-show is not the passenger's fault, so their promo and loyalty
              // points are returned. Still in the READ phase - restoreBenefits does
              // its own gets, and a transaction may not read after it writes.
              await restoreBenefits(transaction, db, tripDoc.ref, tripData, 'driver_no_show');

              // ---- WRITES ----
              transaction.update(tripDoc.ref, {
                status: TripStatus.CANCELLED_BY_SYSTEM,
                cancelledAt: FieldValue.serverTimestamp(),
                cancellationReason: 'driver_no_show',
              });

              if (driverRef) {
                transaction.set(
                  driverRef,
                  buildDriverReleasePatch(driverSnap?.data(), tripData, tripDoc.id),
                  { merge: true }
                );
              }
            });

            logger.tripEvent('TRIP_CANCELLED', tripDoc.id, {
              reason: 'driver_no_show',
              driverId,
              waitTimeSeconds: PILOT_LIMITS.DRIVER_ARRIVAL_TIMEOUT_SECONDS,
            });

            logger.info(`✅ [ExpireStaleTrips] Trip cancelled for no-show`, {
              tripId: tripDoc.id,
              driverId,
            });

            acceptedExpired++;
          } catch (error) {
            logger.error('❌ [ExpireStaleTrips] Failed to expire accepted trip', {
              tripId: tripDoc.id,
              error,
            });
            errorCount++;
          }
        }
      }

      const duration = Date.now() - startTime;
      logger.info('🎉 [ExpireStaleTrips] COMPLETE', {
        searchingExpired,
        acceptedExpired,
        errorCount,
        durationMs: duration,
      });

    } catch (error) {
      logger.error('❌ [ExpireStaleTrips] FAILED', { error });
      throw error;
    }
  }
);
