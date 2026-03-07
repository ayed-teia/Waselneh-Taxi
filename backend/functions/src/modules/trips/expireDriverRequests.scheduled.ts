import { onSchedule } from 'firebase-functions/v2/scheduler';
import { TripStatus, normalizeSeatCapacity, normalizeVehicleType } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { logger } from '../../core/logger';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const expireDriverRequests = onSchedule(
  {
    region: REGION,
    schedule: 'every 1 minutes',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    const startTime = Date.now();
    logger.info('[ExpireRequests] START - checking expired requests');

    const db = getFirestore();
    const now = Timestamp.now();

    let expiredCount = 0;
    let errorCount = 0;

    try {
      const expiredRequestsSnapshot = await db
        .collectionGroup('requests')
        .where('status', '==', 'pending')
        .where('expiresAt', '<', now)
        .get();

      if (expiredRequestsSnapshot.empty) {
        logger.info('[ExpireRequests] No expired requests found');
        return;
      }

      logger.info('[ExpireRequests] Found expired requests', {
        count: expiredRequestsSnapshot.size,
      });

      for (const requestDoc of expiredRequestsSnapshot.docs) {
        try {
          const requestData = requestDoc.data();
          const tripId = String(requestData.tripId || '');
          const pathParts = requestDoc.ref.path.split('/');
          const driverId = pathParts[1];

          if (!driverId || !tripId) {
            logger.error('[ExpireRequests] Invalid request path', {
              path: requestDoc.ref.path,
            });
            errorCount++;
            continue;
          }

          await db.runTransaction(async (transaction) => {
            const latestRequestDoc = await transaction.get(requestDoc.ref);
            if (!latestRequestDoc.exists) {
              return;
            }
            const latestRequestData = latestRequestDoc.data() ?? {};
            if (latestRequestData.status !== 'pending') {
              return;
            }

            transaction.update(requestDoc.ref, {
              status: 'expired',
              expiredAt: FieldValue.serverTimestamp(),
            });

            const tripRef = db.collection('trips').doc(tripId);
            const tripDoc = await transaction.get(tripRef);
            if (tripDoc.exists) {
              const tripData = tripDoc.data() ?? {};
              if (tripData.status === TripStatus.PENDING) {
                transaction.update(tripRef, {
                  status: TripStatus.NO_DRIVER_AVAILABLE,
                  cancelledAt: FieldValue.serverTimestamp(),
                  cancellationReason: 'Driver did not respond in time',
                });
              }
            }

            const driverRef = db.collection('drivers').doc(driverId);
            const driverDoc = await transaction.get(driverRef);
            const driverData = (driverDoc.data() ?? {}) as Record<string, unknown>;
            const seatCapacity = normalizeSeatCapacity(
              driverData.seatCapacity,
              normalizeVehicleType(driverData.vehicleType)
            );
            const availableSeatsRaw =
              typeof driverData.availableSeats === 'number' && Number.isFinite(driverData.availableSeats)
                ? Math.round(driverData.availableSeats)
                : seatCapacity;
            const availableSeats = Math.max(0, Math.min(availableSeatsRaw, seatCapacity));
            const isOnline = driverData.isOnline === true;
            const fullTaxiReserved = driverData.fullTaxiReserved === true;
            const currentTripId =
              typeof driverData.currentTripId === 'string' && driverData.currentTripId.trim().length > 0
                ? driverData.currentTripId
                : null;
            const shouldClearCurrentTrip = currentTripId === tripId;

            transaction.set(
              driverRef,
              {
                isAvailable:
                  isOnline &&
                  availableSeats > 0 &&
                  !fullTaxiReserved &&
                  (currentTripId == null || shouldClearCurrentTrip),
                currentTripId: shouldClearCurrentTrip ? null : currentTripId,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          });

          logger.tripEvent('TRIP_EXPIRED', tripId, {
            driverId,
            reason: 'Driver did not respond in time',
          });
          expiredCount++;
        } catch (docError) {
          logger.error('[ExpireRequests] Failed to expire request', {
            docId: requestDoc.id,
            error: docError,
          });
          errorCount++;
        }
      }

      logger.info('[ExpireRequests] COMPLETE', {
        expiredCount,
        errorCount,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      logger.error('[ExpireRequests] FAILED', { error });
      throw error;
    }
  }
);
