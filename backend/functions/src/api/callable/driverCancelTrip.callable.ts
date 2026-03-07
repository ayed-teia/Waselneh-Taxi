import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { BOOKING_TYPES, TripStatus, normalizeSeatCapacity } from '@taxi-line/shared';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { REGION } from '../../core/env';
import { logger } from '../../core/logger';
import { publishTripStatusNotifications } from '../../modules/notifications';

const CancelTripSchema = z.object({
  tripId: z.string().min(1),
  reason: z.string().optional(),
});

interface CancelTripResponse {
  tripId: string;
  cancelled: boolean;
}

const DRIVER_CANCELLABLE_STATUSES: string[] = [TripStatus.PENDING, TripStatus.ACCEPTED];

export const driverCancelTrip = onCall<unknown, Promise<CancelTripResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) {
        throw new UnauthorizedError('Authentication required to cancel a trip');
      }

      const parsed = CancelTripSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid cancel request', parsed.error.flatten());
      }

      const { tripId, reason } = parsed.data;
      logger.info('[DriverCancel] START', { driverId, tripId, reason });

      const db = getFirestore();
      let passengerIdForNotify = '';

      await db.runTransaction(async (transaction) => {
        const tripRef = db.collection('trips').doc(tripId);
        const tripDoc = await transaction.get(tripRef);

        if (!tripDoc.exists) {
          throw new NotFoundError('Trip', tripId);
        }

        const tripData = tripDoc.data()!;
        if (tripData.driverId !== driverId) {
          throw new ForbiddenError('You are not assigned to this trip');
        }
        passengerIdForNotify = String(tripData.passengerId || '');

        if (!DRIVER_CANCELLABLE_STATUSES.includes(tripData.status)) {
          throw new ForbiddenError(`Cannot cancel trip with status: ${tripData.status}`);
        }

        const driverRef = db.collection('drivers').doc(driverId);
        const driverDoc = await transaction.get(driverRef);
        const driverData = (driverDoc.data() ?? {}) as Record<string, unknown>;

        const seatCapacity = normalizeSeatCapacity(driverData.seatCapacity, driverData.vehicleType as any);
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

        transaction.update(tripRef, {
          status: TripStatus.CANCELLED_BY_DRIVER,
          cancelledAt: FieldValue.serverTimestamp(),
          cancellationReason: reason || 'driver_cancelled',
        });

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

        const driverRequestRef = db
          .collection('driverRequests')
          .doc(driverId)
          .collection('requests')
          .doc(tripId);
        const driverRequestDoc = await transaction.get(driverRequestRef);
        if (driverRequestDoc.exists) {
          transaction.update(driverRequestRef, {
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
          });
        }
      });

      logger.tripEvent('TRIP_CANCELLED', tripId, {
        reason: reason || 'driver_cancelled',
        cancelledBy: driverId,
        cancellerRole: 'driver',
      });

      await publishTripStatusNotifications({
        tripId,
        status: TripStatus.CANCELLED_BY_DRIVER,
        recipients: [
          {
            userId: driverId,
            role: 'driver',
          },
          ...(passengerIdForNotify
            ? [
                {
                  userId: passengerIdForNotify,
                  role: 'passenger' as const,
                },
              ]
            : []),
        ],
        metadata: {
          cancelledBy: driverId,
        },
      });

      logger.info('[DriverCancel] COMPLETE', { tripId, driverId });
      return { tripId, cancelled: true };
    } catch (error) {
      logger.error('[DriverCancel] FAILED', error);
      throw handleError(error);
    }
  }
);
