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

        if (!DRIVER_CANCELLABLE_STATUSES.includes(tripData.status)) {
          throw new ForbiddenError(`Cannot cancel trip with status: ${tripData.status}`);
        }

        let shouldUpdateDriverRequest = false;
        const driverRequestRef = db
          .collection('driverRequests')
          .doc(driverId)
          .collection('requests')
          .doc(tripId);

        // Read before writes.
        const driverRequestDoc = await transaction.get(driverRequestRef);
        shouldUpdateDriverRequest = driverRequestDoc.exists;

        transaction.update(tripRef, {
          status: TripStatus.CANCELLED_BY_DRIVER,
          cancelledAt: FieldValue.serverTimestamp(),
          cancellationReason: reason || 'driver_cancelled',
        });

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

      logger.info('[DriverCancel] COMPLETE', { tripId, driverId });
      return { tripId, cancelled: true };
    } catch (error) {
      logger.error('[DriverCancel] FAILED', error);
      throw handleError(error);
    }
  }
);
