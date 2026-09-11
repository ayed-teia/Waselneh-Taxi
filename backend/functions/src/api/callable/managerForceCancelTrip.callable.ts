import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { ACTIVE_TRIP_STATUSES, TripStatus } from '@taxi-line/shared';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { REGION } from '../../core/env';
import { logger } from '../../core/logger';
import { assertManagerPermission, publishTripStatusNotifications } from '../../modules';
import { restoreBenefits } from '../../modules/promotions';
import { docData, getString } from '../../core/firestore/doc-data';
import { buildDriverReleasePatch } from '../../modules/drivers/driver-seat-release';

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

      await assertManagerPermission(managerId, 'force_cancel_trip');
      const db = getFirestore();

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

      let driverIdForNotify = '';
      let passengerIdForNotify = '';

      await db.runTransaction(async (transaction) => {
        const tripRef = db.collection('trips').doc(tripId);
        const tripDoc = await transaction.get(tripRef);
        if (!tripDoc.exists) {
          throw new NotFoundError('Trip', tripId);
        }

        const tripData = docData(tripDoc);
        driverIdForNotify = getString(tripData, 'driverId', '');
        passengerIdForNotify = getString(tripData, 'passengerId', '');
        const tripStatus = getString(tripData, 'status', '');
        // ACTIVE_TRIP_STATUSES is a readonly TripStatus[]; widen for the membership
        // test rather than casting the value we read out of Firestore.
        if (!(ACTIVE_TRIP_STATUSES as readonly string[]).includes(tripStatus)) {
          throw new ForbiddenError(`Trip is already ${tripStatus}`);
        }

        const driverId = tripData.driverId as string | undefined;
        let shouldUpdateDriverRequest = false;
        // Read the driver here, BEFORE any write in this transaction - Firestore
        // rejects a read that follows a write. Needed for the seat restore below.
        let driverData: FirebaseFirestore.DocumentData | undefined;

        if (driverId) {
          const driverRequestRef = db
            .collection('driverRequests')
            .doc(driverId)
            .collection('requests')
            .doc(tripId);

          const driverRequestDoc = await transaction.get(driverRequestRef);
          shouldUpdateDriverRequest = driverRequestDoc.exists;

          const driverSnap = await transaction.get(db.collection('drivers').doc(driverId));
          driverData = driverSnap.data();
        }

        // A manager force-cancel is not the passenger's doing, so their promo and
        // loyalty points are returned. This is the last read in the transaction:
        // restoreBenefits issues its own gets, and Firestore forbids a read after
        // any write.
        await restoreBenefits(
          transaction,
          db,
          tripRef,
          tripData,
          'manager_cancelled'
        );

        transaction.update(tripRef, {
          status: TripStatus.CANCELLED_BY_SYSTEM,
          cancelledAt: FieldValue.serverTimestamp(),
          cancellationReason: reason || 'manager_override',
          cancelledBy: managerId,
        });

        if (driverId) {
          const driverRef = db.collection('drivers').doc(driverId);
          // R8: this used to write { isAvailable: true, currentTripId: null } and
          // nothing else, leaving availableSeats decremented and fullTaxiReserved
          // stuck true - so a force-cancelled driver silently lost seats forever, or
          // became unbookable entirely. The shared helper returns them to their
          // pre-trip seat state, and only marks them available if they are online.
          transaction.set(
            driverRef,
            buildDriverReleasePatch(driverData, tripData, tripId),
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

      await publishTripStatusNotifications({
        tripId,
        status: TripStatus.CANCELLED_BY_SYSTEM,
        recipients: [
          ...(driverIdForNotify
            ? [
                {
                  userId: driverIdForNotify,
                  role: 'driver' as const,
                },
              ]
            : []),
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
          cancelledBy: managerId,
          reason: reason || 'manager_override',
        },
      });

      logger.info('[ManagerCancel] COMPLETE', { tripId, managerId });
      return { tripId, cancelled: true };
    } catch (error) {
      logger.error('[ManagerCancel] FAILED', error);
      throw handleError(error);
    }
  }
);
