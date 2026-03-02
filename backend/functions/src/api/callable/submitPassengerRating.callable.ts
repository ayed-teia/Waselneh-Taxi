import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  handleError,
} from '../../core/errors';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { TripStatus } from '@taxi-line/shared';

const SubmitPassengerRatingSchema = z.object({
  tripId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
  lowRatingReason: z.string().max(120).optional(),
});

interface SubmitPassengerRatingResponse {
  success: boolean;
  ratingId: string;
}

export const submitPassengerRating = onCall<unknown, Promise<SubmitPassengerRatingResponse>>(
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

      const parsed = SubmitPassengerRatingSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid passenger rating payload', parsed.error.flatten());
      }

      const { tripId, rating, comment, lowRatingReason } = parsed.data;
      const db = getFirestore();
      const tripRef = db.collection('trips').doc(tripId);
      const ratingRef = db.collection('passengerRatings').doc(tripId);

      await db.runTransaction(async (transaction) => {
        const [tripDoc, existingRating] = await Promise.all([
          transaction.get(tripRef),
          transaction.get(ratingRef),
        ]);

        if (!tripDoc.exists) {
          throw new NotFoundError('Trip', tripId);
        }

        if (existingRating.exists) {
          throw new ForbiddenError('Passenger rating already submitted for this trip');
        }

        const trip = tripDoc.data()!;
        if (trip.driverId !== driverId) {
          throw new ForbiddenError('You are not assigned to this trip');
        }

        const validStatuses = [TripStatus.COMPLETED, TripStatus.RATED];
        if (!validStatuses.includes(trip.status)) {
          throw new ForbiddenError('Trip must be completed before rating passenger');
        }

        const ratingPayload = {
          tripId,
          driverId,
          passengerId: trip.passengerId,
          rating,
          comment: comment ?? null,
          lowRatingReason: lowRatingReason ?? null,
          createdAt: FieldValue.serverTimestamp(),
        };

        transaction.set(ratingRef, ratingPayload);
        transaction.set(
          tripRef,
          {
            passengerRatingByDriver: {
              rating,
              comment: comment ?? null,
              lowRatingReason: lowRatingReason ?? null,
              createdAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      return {
        success: true,
        ratingId: tripId,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
