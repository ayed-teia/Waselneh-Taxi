import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Request schema for start trip
 */
const StartTripSchema = z.object({
  tripId: z.string().min(1),
});

/**
 * Response type
 */
interface StartTripResponse {
  success: boolean;
  status: string;
}

/**
 * Start the trip (passenger picked up)
 * 
 * Valid transition: DRIVER_ARRIVED → IN_PROGRESS
 * 
 * Validates:
 * - Driver is authenticated
 * - Driver owns the trip (trip.driverId === auth.uid)
 * - Trip status is DRIVER_ARRIVED
 */
export const startTrip = onCall<unknown, Promise<StartTripResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Require authentication
      if (!request.auth?.uid) {
        throw new UnauthorizedError('Authentication required');
      }

      const driverId = request.auth.uid;

      // Validate input
      const parsed = StartTripSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request',
          parsed.error.flatten()
        );
      }

      const { tripId } = parsed.data;

      logger.info('Driver starting trip', { driverId, tripId });

      const db = getFirestore();
      const tripRef = db.collection('trips').doc(tripId);
      const tripDoc = await tripRef.get();

      if (!tripDoc.exists) {
        throw new NotFoundError('Trip', tripId);
      }

      const tripData = tripDoc.data()!;

      // Validate driver ownership
      if (tripData.driverId !== driverId) {
        throw new ForbiddenError('You are not assigned to this trip');
      }

      // Validate current status
      if (tripData.status !== TripStatus.DRIVER_ARRIVED) {
        throw new ForbiddenError(
          `Cannot start trip from status '${tripData.status}'. Expected '${TripStatus.DRIVER_ARRIVED}'.`
        );
      }

      // Update trip status
      await tripRef.update({
        status: TripStatus.IN_PROGRESS,
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('Trip started', { tripId, driverId });

      return {
        success: true,
        status: TripStatus.IN_PROGRESS,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
