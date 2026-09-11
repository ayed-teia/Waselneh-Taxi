import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { BOOKING_TYPES, TripStatus, normalizeSeatCapacity, normalizeVehicleType } from '@taxi-line/shared';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { REGION } from '../../core/env';
import { logger } from '../../core/logger';
import { publishTripStatusNotifications } from '../../modules/notifications';
import { restoreBenefits } from '../../modules/promotions';
import { getString } from '../../core/firestore/doc-data';

const CancelTripSchema = z.object({
  tripId: z.string().min(1),
});

interface CancelTripResponse {
  tripId: string;
  cancelled: boolean;
}

const PASSENGER_CANCELLABLE_STATUSES: string[] = [TripStatus.PENDING, TripStatus.ACCEPTED];

export const passengerCancelTrip = onCall<unknown, Promise<CancelTripResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const passengerId = getAuthenticatedUserId(request);
      if (!passengerId) {
        throw new UnauthorizedError('Authentication required to cancel a trip');
      }

      const parsed = CancelTripSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid cancel request', parsed.error.flatten());
      }

      const { tripId } = parsed.data;
      logger.info('[PassengerCancel] START', { passengerId, tripId });

      const db = getFirestore();
      let driverIdForNotify = '';

      await db.runTransaction(async (transaction) => {
        const tripRef = db.collection('trips').doc(tripId);
        const tripDoc = await transaction.get(tripRef);

        if (!tripDoc.exists) {
          throw new NotFoundError('Trip', tripId);
        }

        const tripData = tripDoc.data()!;
        if (tripData.passengerId !== passengerId) {
          throw new ForbiddenError('You are not the owner of this trip');
        }

        const tripStatus = getString(tripData, 'status', '');
        if (!PASSENGER_CANCELLABLE_STATUSES.includes(tripStatus)) {
          throw new ForbiddenError(`Cannot cancel trip with status: ${tripStatus}`);
        }

        const driverId = typeof tripData.driverId === 'string' ? tripData.driverId : '';
        driverIdForNotify = driverId;

        let shouldUpdateDriverRequest = false;
        if (driverId) {
          const driverRequestRef = db
            .collection('driverRequests')
            .doc(driverId)
            .collection('requests')
            .doc(tripId);
          const driverRequestDoc = await transaction.get(driverRequestRef);
          shouldUpdateDriverRequest = driverRequestDoc.exists;

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

          const bookingType =
            tripData.bookingType === BOOKING_TYPES.FULL_TAXI
              ? BOOKING_TYPES.FULL_TAXI
              : BOOKING_TYPES.SEAT_ONLY;
          const reservedSeatsRaw =
            typeof tripData.reservedSeats === 'number' && Number.isFinite(tripData.reservedSeats)
              ? Math.round(tripData.reservedSeats)
              : 0;
          const reservedSeats = Math.max(0, reservedSeatsRaw);
          const nextAvailableSeats = Math.max(0, Math.min(seatCapacity, availableSeats + reservedSeats));
          const isOnline = driverData.isOnline === true;

        // Benefits are returned BEFORE any write: restoreBenefits issues its own
        // transaction.get calls, and Firestore forbids a read after a write. A
        // passenger who redeemed a promo and points, got matched, then cancelled
        // before the trip started previously lost both - nothing gave them back.
        const benefitsRestored = await restoreBenefits(
          transaction,
          db,
          tripRef,
          tripData as Record<string, unknown>,
          'passenger_cancelled'
        );
        void benefitsRestored;

          transaction.set(
            driverRef,
            {
              availableSeats: nextAvailableSeats,
              isAvailable: isOnline && nextAvailableSeats > 0,
              currentTripId:
                typeof driverData.currentTripId === 'string' && driverData.currentTripId === tripId
                  ? null
                  : driverData.currentTripId ?? null,
              ...(bookingType === BOOKING_TYPES.FULL_TAXI
                ? {
                    fullTaxiReserved: false,
                    fullTaxiReservedTripId:
                      driverData.fullTaxiReservedTripId === tripId
                        ? null
                        : driverData.fullTaxiReservedTripId ?? null,
                  }
                : {}),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          if (shouldUpdateDriverRequest) {
            transaction.update(driverRequestRef, {
              status: 'cancelled',
              cancelledAt: FieldValue.serverTimestamp(),
            });
          }
        }

        transaction.update(tripRef, {
          status: TripStatus.CANCELLED_BY_PASSENGER,
          cancelledAt: FieldValue.serverTimestamp(),
          cancellationReason: 'passenger_cancelled',
        });
      });

      logger.tripEvent('TRIP_CANCELLED', tripId, {
        reason: 'passenger_cancelled',
        cancelledBy: passengerId,
      });

      await publishTripStatusNotifications({
        tripId,
        status: TripStatus.CANCELLED_BY_PASSENGER,
        recipients: [
          {
            userId: passengerId,
            role: 'passenger',
          },
          ...(driverIdForNotify
            ? [
                {
                  userId: driverIdForNotify,
                  role: 'driver' as const,
                },
              ]
            : []),
        ],
        metadata: {
          cancelledBy: passengerId,
        },
      });

      logger.info('[PassengerCancel] COMPLETE', { tripId });
      return { tripId, cancelled: true };
    } catch (error) {
      logger.error('[PassengerCancel] FAILED', error);
      throw handleError(error);
    }
  }
);
