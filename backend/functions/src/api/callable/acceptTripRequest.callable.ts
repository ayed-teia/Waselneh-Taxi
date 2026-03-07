import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { BOOKING_TYPES, TripStatus, normalizeSeatCapacity } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { publishTripStatusNotifications } from '../../modules/notifications';
import { assertDriverIsLicensedLineOwner } from '../../modules/auth';

const AcceptTripRequestSchema = z.object({
  tripId: z.string().min(1),
});

interface AcceptTripRequestResponse {
  tripId: string;
}

function resolveDriverSeatState(driverData: Record<string, unknown>): {
  seatCapacity: number;
  availableSeats: number;
} {
  const vehicleType =
    typeof driverData.vehicleType === 'string' ? driverData.vehicleType : undefined;
  const seatCapacity = normalizeSeatCapacity(driverData.seatCapacity, vehicleType as any);
  const availableSeatsRaw =
    typeof driverData.availableSeats === 'number' && Number.isFinite(driverData.availableSeats)
      ? Math.round(driverData.availableSeats)
      : seatCapacity;
  const availableSeats = Math.max(0, Math.min(availableSeatsRaw, seatCapacity));

  return { seatCapacity, availableSeats };
}

export const acceptTripRequest = onCall<unknown, Promise<AcceptTripRequestResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) {
        throw new UnauthorizedError('Authentication required to accept a trip request');
      }
      await assertDriverIsLicensedLineOwner(driverId);

      const parsed = AcceptTripRequestSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid accept request', parsed.error.flatten());
      }

      const { tripId } = parsed.data;
      logger.info('[AcceptTrip] START', { driverId, tripId });

      const db = getFirestore();
      let passengerIdForNotify = '';

      await db.runTransaction(async (transaction) => {
        const driverRequestRef = db
          .collection('driverRequests')
          .doc(driverId)
          .collection('requests')
          .doc(tripId);

        const driverRequestDoc = await transaction.get(driverRequestRef);
        if (!driverRequestDoc.exists) {
          throw new NotFoundError('Trip request not found for this driver');
        }

        const requestData = driverRequestDoc.data()!;
        if (requestData.status !== 'pending') {
          throw new ForbiddenError(`Trip request already ${requestData.status}`);
        }

        const expiresAt = requestData.expiresAt as Timestamp | undefined;
        if (expiresAt && expiresAt.toMillis() < Date.now()) {
          throw new ForbiddenError('This trip request has expired');
        }

        const tripRef = db.collection('trips').doc(tripId);
        const tripDoc = await transaction.get(tripRef);
        if (!tripDoc.exists) {
          throw new NotFoundError('Trip not found');
        }

        const tripData = tripDoc.data()!;
        if (tripData.status !== TripStatus.PENDING) {
          throw new ForbiddenError('This trip has already been accepted by another driver');
        }

        if (tripData.driverId !== driverId) {
          throw new ForbiddenError('You are not assigned to this trip');
        }

        passengerIdForNotify = String(tripData.passengerId || '');

        const driverDocRef = db.collection('drivers').doc(driverId);
        const driverDoc = await transaction.get(driverDocRef);
        if (!driverDoc.exists) {
          throw new NotFoundError('Driver profile not found');
        }

        const driverData = driverDoc.data() as Record<string, unknown>;
        const { seatCapacity, availableSeats } = resolveDriverSeatState(driverData);

        if (driverData.fullTaxiReserved === true) {
          throw new ForbiddenError('Driver already has a full taxi reservation');
        }

        const bookingType =
          tripData.bookingType === BOOKING_TYPES.FULL_TAXI
            ? BOOKING_TYPES.FULL_TAXI
            : BOOKING_TYPES.SEAT_ONLY;

        const requestedSeats =
          typeof tripData.requestedSeats === 'number' && Number.isFinite(tripData.requestedSeats)
            ? Math.max(1, Math.round(tripData.requestedSeats))
            : 1;

        const seatsToReserve =
          bookingType === BOOKING_TYPES.FULL_TAXI ? Math.max(1, availableSeats) : requestedSeats;

        if (availableSeats < seatsToReserve) {
          logger.warn('[AcceptTrip] Not enough seats', {
            driverId,
            tripId,
            bookingType,
            requestedSeats,
            seatsToReserve,
            availableSeats,
          });
          throw new ForbiddenError('Driver has no available seats for this request');
        }

        const nextAvailableSeats = Math.max(0, availableSeats - seatsToReserve);
        const fullTaxiReserved = bookingType === BOOKING_TYPES.FULL_TAXI;

        transaction.update(tripRef, {
          status: TripStatus.ACCEPTED,
          acceptedAt: FieldValue.serverTimestamp(),
          bookingType,
          requestedSeats,
          reservedSeats: seatsToReserve,
        });

        transaction.update(driverRequestRef, {
          status: 'accepted',
          acceptedAt: FieldValue.serverTimestamp(),
          reservedSeats: seatsToReserve,
        });

        transaction.set(
          driverDocRef,
          {
            availableSeats: nextAvailableSeats,
            isAvailable: nextAvailableSeats > 0 && !fullTaxiReserved,
            currentTripId:
              typeof driverData.currentTripId === 'string' && driverData.currentTripId.trim().length > 0
                ? driverData.currentTripId
                : tripId,
            ...(fullTaxiReserved
              ? {
                  fullTaxiReserved: true,
                  fullTaxiReservedTripId: tripId,
                }
              : {}),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        logger.info('[AcceptTrip] Seat reservation updated', {
          driverId,
          seatCapacity,
          availableSeats,
          seatsToReserve,
          nextAvailableSeats,
          fullTaxiReserved,
        });

        logger.tripEvent('TRIP_ACCEPTED', tripId, {
          driverId,
          passengerId: tripData.passengerId,
          bookingType,
          reservedSeats: seatsToReserve,
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

      logger.info('[AcceptTrip] COMPLETE', { tripId, driverId });
      return { tripId };
    } catch (error) {
      logger.error('[AcceptTrip] FAILED', { error });
      throw handleError(error);
    }
  }
);
