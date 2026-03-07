import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  BOOKING_TYPES,
  TripStatus,
  PaymentStatus,
  PaymentMethod,
  normalizeSeatCapacity,
} from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { publishTripStatusNotifications } from '../../modules/notifications';
import { assertDriverIsLicensedLineOwner } from '../../modules/auth';

const CompleteTripSchema = z.object({
  tripId: z.string().min(1),
});

interface CompleteTripResponse {
  success: boolean;
  status: string;
  finalPriceIls: number;
  paymentId: string;
}

export const completeTrip = onCall<unknown, Promise<CompleteTripResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) {
        throw new UnauthorizedError('Authentication required');
      }
      await assertDriverIsLicensedLineOwner(driverId);

      const parsed = CompleteTripSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid request', parsed.error.flatten());
      }

      const { tripId } = parsed.data;
      logger.info('[CompleteTrip] START', { driverId, tripId });

      const db = getFirestore();
      const tripRef = db.collection('trips').doc(tripId);
      let passengerIdForNotify = '';

      const result = await db.runTransaction(async (transaction) => {
        const tripDoc = await transaction.get(tripRef);
        if (!tripDoc.exists) {
          throw new NotFoundError('Trip', tripId);
        }

        const tripData = tripDoc.data()!;
        const paymentId = `payment_${tripId}`;
        const paymentRef = db.collection('payments').doc(paymentId);
        const existingPayment = await transaction.get(paymentRef);
        const driverDocRef = db.collection('drivers').doc(driverId);
        const driverDoc = await transaction.get(driverDocRef);
        const driverData = (driverDoc.data() ?? {}) as Record<string, unknown>;

        if (tripData.driverId !== driverId) {
          throw new ForbiddenError('You are not assigned to this trip');
        }

        if (tripData.status !== TripStatus.IN_PROGRESS) {
          throw new ForbiddenError(
            `Cannot complete trip from status '${tripData.status}'. Expected '${TripStatus.IN_PROGRESS}'.`
          );
        }

        passengerIdForNotify = String(tripData.passengerId || '');
        const finalPriceIls = tripData.estimatedPriceIls;

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
            : bookingType === BOOKING_TYPES.FULL_TAXI
              ? seatCapacity
              : 1;
        const reservedSeats = Math.max(1, reservedSeatsRaw);
        const nextAvailableSeats = Math.max(0, Math.min(seatCapacity, availableSeats + reservedSeats));

        const isOnline = driverData.isOnline === true;
        const shouldClearFullTaxiReservation =
          bookingType === BOOKING_TYPES.FULL_TAXI &&
          driverData.fullTaxiReservedTripId === tripId;

        transaction.update(tripRef, {
          status: TripStatus.COMPLETED,
          finalPriceIls,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.set(
          driverDocRef,
          {
            availableSeats: nextAvailableSeats,
            isAvailable: isOnline && nextAvailableSeats > 0,
            currentTripId:
              typeof driverData.currentTripId === 'string' && driverData.currentTripId === tripId
                ? null
                : driverData.currentTripId ?? null,
            ...(shouldClearFullTaxiReservation
              ? {
                  fullTaxiReserved: false,
                  fullTaxiReservedTripId: null,
                }
              : {}),
            tripsCount:
              typeof driverData.tripsCount === 'number' && Number.isFinite(driverData.tripsCount)
                ? Math.max(0, Math.round(driverData.tripsCount) + 1)
                : 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (!existingPayment.exists) {
          transaction.set(paymentRef, {
            paymentId,
            tripId,
            passengerId: tripData.passengerId,
            driverId,
            amount: finalPriceIls,
            currency: 'ILS',
            method: PaymentMethod.CASH,
            status: PaymentStatus.PENDING,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        logger.tripEvent('TRIP_COMPLETED', tripId, {
          driverId,
          finalPriceIls,
          bookingType,
          reservedSeats,
        });

        return {
          status: TripStatus.COMPLETED,
          finalPriceIls,
          paymentId,
        };
      });

      await publishTripStatusNotifications({
        tripId,
        status: TripStatus.COMPLETED,
        recipients: [
          ...(passengerIdForNotify
            ? [
                {
                  userId: passengerIdForNotify,
                  role: 'passenger' as const,
                },
              ]
            : []),
          {
            userId: driverId,
            role: 'driver',
          },
        ],
        metadata: {
          driverId,
          finalPriceIls: result.finalPriceIls,
        },
      });

      logger.info('[CompleteTrip] COMPLETE', {
        tripId,
        driverId,
        finalPriceIls: result.finalPriceIls,
      });

      return {
        success: true,
        status: result.status,
        finalPriceIls: result.finalPriceIls,
        paymentId: result.paymentId,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
