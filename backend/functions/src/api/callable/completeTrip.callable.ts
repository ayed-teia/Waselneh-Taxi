import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Request schema for complete trip
 */
const CompleteTripSchema = z.object({
  tripId: z.string().min(1),
});

/**
 * Response type
 */
interface CompleteTripResponse {
  success: boolean;
  status: string;
  finalPriceIls: number;
}

/**
 * Complete the trip (passenger dropped off)
 * 
 * Valid transition: IN_PROGRESS → COMPLETED
 * 
 * Validates:
 * - Driver is authenticated
 * - Driver owns the trip (trip.driverId === auth.uid)
 * - Trip status is IN_PROGRESS
 * 
 * For v1, final price = estimated price (no surge, no adjustments)
 */
export const completeTrip = onCall<unknown, Promise<CompleteTripResponse>>(
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
      const parsed = CompleteTripSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request',
          parsed.error.flatten()
        );
      }

      const { tripId } = parsed.data;

      logger.info('Driver completing trip', { driverId, tripId });

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
      if (tripData.status !== TripStatus.IN_PROGRESS) {
        throw new ForbiddenError(
          `Cannot complete trip from status '${tripData.status}'. Expected '${TripStatus.IN_PROGRESS}'.`
        );
      }

      // For v1, final price = estimated price
      const finalPriceIls = tripData.estimatedPriceIls;

      // Update trip status
      await tripRef.update({
        status: TripStatus.COMPLETED,
        finalPriceIls,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('Trip completed', { tripId, driverId, finalPriceIls });

      return {
        success: true,
        status: TripStatus.COMPLETED,
        finalPriceIls,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
