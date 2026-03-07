import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus, normalizeSeatCapacity, normalizeVehicleType } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { publishTripStatusNotifications } from '../../modules/notifications';

const RejectTripRequestSchema = z.object({
  tripId: z.string().min(1),
});

interface RejectTripRequestResponse {
  success: boolean;
}

export const rejectTripRequest = onCall<unknown, Promise<RejectTripRequestResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) {
        throw new UnauthorizedError('Authentication required to reject a trip request');
      }

      const parsed = RejectTripRequestSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid reject request data', parsed.error.flatten());
      }

      const { tripId } = parsed.data;
      logger.info('[RejectTrip] START', { tripId, driverId });

      const db = getFirestore();
      let passengerIdForNotify = '';
      let shouldNotifyPassenger = false;

      await db.runTransaction(async (transaction) => {
        const driverRequestRef = db
          .collection('driverRequests')
          .doc(driverId)
          .collection('requests')
          .doc(tripId);

        const driverRequestDoc = await transaction.get(driverRequestRef);
        if (!driverRequestDoc.exists) {
          throw new NotFoundError('Trip request not found');
        }

        const requestData = driverRequestDoc.data()!;
        if (requestData.status !== 'pending') {
          logger.warn(`[RejectTrip] Already ${requestData.status} - skipping`);
          return;
        }

        const tripRef = db.collection('trips').doc(tripId);
        const tripDoc = await transaction.get(tripRef);
        if (!tripDoc.exists) {
          throw new NotFoundError('Trip not found');
        }

        const tripData = tripDoc.data()!;
        passengerIdForNotify = String(tripData.passengerId || '');

        const driverDocRef = db.collection('drivers').doc(driverId);
        const driverDoc = await transaction.get(driverDocRef);
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

        transaction.update(driverRequestRef, {
          status: 'rejected',
          rejectedAt: FieldValue.serverTimestamp(),
        });

        if (tripData.status === TripStatus.PENDING && tripData.driverId === driverId) {
          transaction.update(tripRef, {
            status: TripStatus.NO_DRIVER_AVAILABLE,
            rejectedAt: FieldValue.serverTimestamp(),
            rejectedBy: driverId,
          });
          shouldNotifyPassenger = true;
        }

        transaction.set(
          driverDocRef,
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

        logger.info('[RejectTrip] Driver availability recomputed', {
          driverId,
          isOnline,
          availableSeats,
          fullTaxiReserved,
          currentTripId,
          shouldClearCurrentTrip,
        });
      });

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

      logger.info('[RejectTrip] COMPLETE', { tripId, driverId });
      return { success: true };
    } catch (error) {
      logger.error('[RejectTrip] FAILED', { error });
      throw handleError(error);
    }
  }
);
