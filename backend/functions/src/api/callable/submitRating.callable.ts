import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { publishTripStatusNotifications } from '../../modules/notifications';

/**
 * ============================================================================
 * SUBMIT RATING - Cloud Function
 * ============================================================================
 * 
 * Called when passenger rates a completed trip.
 * 
 * FLOW: COMPLETED → RATED
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ RATING FLOW:
 *    LOG: "⭐ [SubmitRating] START - passengerId: {id}, tripId: {id}, rating: {N}"
 *    LOG: "🔒 [SubmitRating] Passenger owns trip ✓"
 *    LOG: "🔒 [SubmitRating] Trip status: completed ✓"
 *    LOG: "📝 [SubmitRating] Rating saved to ratings/{tripId}"
 *    LOG: "📝 [SubmitRating] Trip status → rated"
 *    LOG: "🎉 [SubmitRating] COMPLETE"
 * 
 * ✅ DUPLICATE RATING:
 *    LOG: "⚠️ [SubmitRating] Rating already exists"
 * 
 * ============================================================================
 */

/**
 * Request schema for submitting a rating
 */
const SubmitRatingSchema = z.object({
  tripId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).nullable().optional(),
  lowRatingReason: z.string().max(120).nullable().optional(),
});

/**
 * Response type
 */
interface SubmitRatingResponse {
  success: boolean;
  ratingId: string;
}

/**
 * Submit a rating for a completed trip
 * 
 * Validates:
 * - Caller is authenticated
 * - Trip exists and status is COMPLETED
 * - Caller is the passenger of the trip
 * - No existing rating for this trip by this passenger
 * 
 * Stores rating in ratings/{tripId}
 */
export const submitRating = onCall<unknown, Promise<SubmitRatingResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Require authentication
      const passengerId = getAuthenticatedUserId(request);
      if (!passengerId) {
        throw new UnauthorizedError('Authentication required');
      }

      // Validate input
      const parsed = SubmitRatingSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request',
          parsed.error.flatten()
        );
      }

      const { tripId, rating, comment, lowRatingReason } = parsed.data;

      logger.info('⭐ [SubmitRating] START', { passengerId, tripId, rating });

      const db = getFirestore();
      const tripRef = db.collection('trips').doc(tripId);
      const ratingRef = db.collection('ratings').doc(tripId);
      let driverIdForNotify = '';

      // Use transaction to ensure atomicity
      const ratingId = await db.runTransaction(async (transaction) => {
        // Get the trip
        const tripDoc = await transaction.get(tripRef);

        if (!tripDoc.exists) {
          logger.warn('🚫 [SubmitRating] Trip not found', { tripId });
          throw new NotFoundError('Trip', tripId);
        }

        const tripData = tripDoc.data()!;
        driverIdForNotify = String(tripData.driverId || '');

        // Validate caller is the passenger
        if (tripData.passengerId !== passengerId) {
          logger.warn('🚫 [SubmitRating] Passenger mismatch', { passengerId, tripPassengerId: tripData.passengerId });
          throw new ForbiddenError('You are not the passenger of this trip');
        }

        logger.info('🔒 [SubmitRating] Passenger owns trip ✓', { tripId });

        // Validate trip is completed (not already rated)
        if (tripData.status !== TripStatus.COMPLETED) {
          logger.warn('⚠️ [SubmitRating] Invalid trip status', { tripId, status: tripData.status });
          throw new ForbiddenError(
            `Cannot rate trip with status '${tripData.status}'. Trip must be completed.`
          );
        }

        logger.info('🔒 [SubmitRating] Trip status: completed ✓', { tripId });

        // Check if rating already exists
        const existingRating = await transaction.get(ratingRef);

        if (existingRating.exists) {
          logger.warn('⚠️ [SubmitRating] Rating already exists', { tripId });
          throw new ForbiddenError('A rating has already been submitted for this trip');
        }

        // Create the rating
        const ratingData = {
          tripId,
          passengerId,
          driverId: tripData.driverId,
          rating,
          comment: comment || null,
          lowRatingReason: lowRatingReason || null,
          createdAt: FieldValue.serverTimestamp(),
        };

        transaction.set(ratingRef, ratingData);
        logger.info('📝 [SubmitRating] Rating saved to ratings/' + tripId, { rating });

        // Update trip status to rated
        transaction.update(tripRef, {
          status: TripStatus.RATED,
          ratedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        logger.info('📝 [SubmitRating] Trip status → rated', { tripId });

        return tripId;
      });

      logger.info('🎉 [SubmitRating] COMPLETE', { tripId, passengerId, rating });

      if (driverIdForNotify) {
        await publishTripStatusNotifications({
          tripId,
          status: TripStatus.RATED,
          recipients: [
            {
              userId: driverIdForNotify,
              role: 'driver',
            },
          ],
          metadata: {
            ratedBy: passengerId,
            rating,
          },
        });
      }

      return {
        success: true,
        ratingId,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
