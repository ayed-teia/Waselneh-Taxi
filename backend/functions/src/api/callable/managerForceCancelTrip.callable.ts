import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { ACTIVE_TRIP_STATUSES, TripStatus } from '@taxi-line/shared';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { REGION } from '../../core/env';
import { logger } from '../../core/logger';

const ForceCancelTripSchema = z.object({
  tripId: z.string().min(1),
  reason: z.string().optional(),
});

interface ForceCancelTripResponse {
  tripId: string;
  cancelled: boolean;
}

export const managerForceCancelTrip = onCall<unknown, Promise<ForceCancelTripResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) {
        throw new UnauthorizedError('Authentication required');
      }

      const db = getFirestore();
      const managerDoc = await db.collection('users').doc(managerId).get();
      if (!managerDoc.exists) {
        throw new ForbiddenError('User not found');
      }

      const managerData = managerDoc.data();
      if (managerData?.role !== 'manager' && managerData?.role !== 'admin') {
        throw new ForbiddenError('Only managers can force cancel trips');
      }

      const parsed = ForceCancelTripSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid cancel request', parsed.error.flatten());
      }

      const { tripId, reason } = parsed.data;
      logger.info('[ManagerCancel] START', {
        managerId,
        tripId,
        reason: reason || 'manager_override',
      });

      await db.runTransaction(async (transaction) => {
        const tripRef = db.collection('trips').doc(tripId);
        const tripDoc = await transaction.get(tripRef);
        if (!tripDoc.exists) {
          throw new NotFoundError('Trip', tripId);
        }

        const tripData = tripDoc.data()!;
        if (!ACTIVE_TRIP_STATUSES.includes(tripData.status)) {
          throw new ForbiddenError(`Trip is already ${tripData.status}`);
        }

        const driverId = tripData.driverId as string | undefined;
        let shouldUpdateDriverRequest = false;

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
          status: TripStatus.CANCELLED_BY_SYSTEM,
          cancelledAt: FieldValue.serverTimestamp(),
          cancellationReason: reason || 'manager_override',
          cancelledBy: managerId,
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
        reason: reason || 'manager_override',
        cancelledBy: managerId,
        cancellerRole: 'manager',
      });

      logger.info('[ManagerCancel] COMPLETE', { tripId, managerId });
      return { tripId, cancelled: true };
    } catch (error) {
      logger.error('[ManagerCancel] FAILED', error);
      throw handleError(error);
    }
  }
);
