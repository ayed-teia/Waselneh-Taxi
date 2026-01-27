import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripRequestStatus, TripStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Request schema for accepting a trip request
 */
const AcceptTripRequestSchema = z.object({
  requestId: z.string().min(1),
});

/**
 * Response type for accept
 */
interface AcceptTripRequestResponse {
  tripId: string;
}

/**
 * Trip document structure
 */
interface TripDocument {
  passengerId: string;
  driverId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPriceIls: number;
  status: string;
  createdAt: FirebaseFirestore.FieldValue;
  matchedAt: FirebaseFirestore.FieldValue;
}

/**
 * Accept a trip request (driver action)
 *
 * This function runs in a Firestore transaction to ensure:
 * 1. The trip request is still OPEN (not already matched)
 * 2. Only one driver can accept the request
 *
 * On success:
 * - Updates tripRequests/{requestId}.status to MATCHED
 * - Creates trips/{tripId} with status DRIVER_ASSIGNED
 * - Deletes the inbox document for this driver
 *
 * Returns the tripId for navigation
 */
export const acceptTripRequest = onCall<unknown, Promise<AcceptTripRequestResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Require authentication
      if (!request.auth?.uid) {
        throw new UnauthorizedError('Authentication required to accept a trip request');
      }

      const driverId = request.auth.uid;

      // Validate input
      const parsed = AcceptTripRequestSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid accept request',
          parsed.error.flatten()
        );
      }

      const { requestId } = parsed.data;

      logger.info('Driver accepting trip request', { driverId, requestId });

      const db = getFirestore();

      // Run transaction to ensure atomicity
      const tripId = await db.runTransaction(async (transaction) => {
        // Read trip request
        const requestRef = db.collection('tripRequests').doc(requestId);
        const requestDoc = await transaction.get(requestRef);

        if (!requestDoc.exists) {
          throw new NotFoundError('Trip request', requestId);
        }

        const requestData = requestDoc.data()!;

        // Ensure status is still OPEN
        if (requestData.status !== TripRequestStatus.OPEN) {
          throw new ForbiddenError(
            `Trip request is no longer available. Status: '${requestData.status}'`
          );
        }

        // Create trip document
        const tripRef = db.collection('trips').doc();
        const newTripId = tripRef.id;

        const tripDoc: TripDocument = {
          passengerId: requestData.passengerId,
          driverId,
          pickup: requestData.pickup,
          dropoff: requestData.dropoff,
          estimatedDistanceKm: requestData.estimatedDistanceKm,
          estimatedDurationMin: requestData.estimatedDurationMin,
          estimatedPriceIls: requestData.estimatedPriceIls,
          status: TripStatus.DRIVER_ASSIGNED,
          createdAt: requestData.createdAt,
          matchedAt: FieldValue.serverTimestamp(),
        };

        // Update trip request status to MATCHED
        transaction.update(requestRef, {
          status: TripRequestStatus.MATCHED,
          matchedDriverId: driverId,
          matchedTripId: newTripId,
          matchedAt: FieldValue.serverTimestamp(),
        });

        // Create the trip
        transaction.set(tripRef, tripDoc);

        // Delete the inbox document for this driver
        const inboxRef = db
          .collection('drivers')
          .doc(driverId)
          .collection('inbox')
          .doc(requestId);
        transaction.delete(inboxRef);

        return newTripId;
      });

      logger.info('Trip request accepted', {
        requestId,
        driverId,
        tripId,
      });

      return { tripId };
    } catch (error) {
      throw handleError(error);
    }
  }
);
