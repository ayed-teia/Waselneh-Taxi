import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus } from '@taxi-line/shared';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { REGION } from '../../core/env';
import { logger } from '../../core/logger';

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

        if (!PASSENGER_CANCELLABLE_STATUSES.includes(tripData.status)) {
          throw new ForbiddenError(`Cannot cancel trip with status: ${tripData.status}`);
        }

        const driverId = tripData.driverId as string | undefined;
        let shouldUpdateDriverRequest = false;

        // Read optional docs before writes (required by Firestore transactions).
        if (driverId) {
          const driverRequestRef = db
            .collection('driverRequests')
            .doc(driverId)
            .collection('requests')
            .doc(tripId);

          const driverRequestDoc = await transaction.get(driverRequestRef);
          shouldUpdateDriverRequest = driverRequestDoc.exists;
        }

        transaction.update(tripRef, {
          status: TripStatus.CANCELLED_BY_PASSENGER,
          cancelledAt: FieldValue.serverTimestamp(),
          cancellationReason: 'passenger_cancelled',
        });

        if (driverId) {
          const driverRef = db.collection('drivers').doc(driverId);
          transaction.set(
            driverRef,
            {
              isAvailable: true,
              currentTripId: null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          if (shouldUpdateDriverRequest) {
            const driverRequestRef = db
              .collection('driverRequests')
              .doc(driverId)
              .collection('requests')
              .doc(tripId);

            transaction.update(driverRequestRef, {
              status: 'cancelled',
              cancelledAt: FieldValue.serverTimestamp(),
            });
          }
        }
      });

      logger.tripEvent('TRIP_CANCELLED', tripId, {
        reason: 'passenger_cancelled',
        cancelledBy: passengerId,
      });

      logger.info('[PassengerCancel] COMPLETE', { tripId });
      return { tripId, cancelled: true };
    } catch (error) {
      logger.error('[PassengerCancel] FAILED', error);
      throw handleError(error);
    }
  }
);
