import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripRequestStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { getAuthenticatedUserId } from '../../core/auth';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  handleError,
} from '../../core/errors';

const CancelTripRequestSchema = z.object({
  requestId: z.string().trim().min(1),
});

interface CancelTripRequestResponse {
  requestId: string;
  cancelled: boolean;
  status: 'open' | 'matched' | 'expired' | 'cancelled';
  matchedTripId?: string;
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const cancelTripRequest = onCall<unknown, Promise<CancelTripRequestResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 20,
  },
  async (request) => {
    try {
      const passengerId = getAuthenticatedUserId(request);
      if (!passengerId) {
        throw new UnauthorizedError('Authentication required to cancel trip request');
      }

      const parsed = CancelTripRequestSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid cancel trip request payload', parsed.error.flatten());
      }

      const { requestId } = parsed.data;
      const db = getFirestore();
      const tripRequestRef = db.collection('tripRequests').doc(requestId);

      let responseStatus: CancelTripRequestResponse['status'] = TripRequestStatus.OPEN;
      let cancelled = false;
      let matchedTripId: string | null = null;

      await db.runTransaction(async (transaction) => {
        const tripRequestDoc = await transaction.get(tripRequestRef);
        if (!tripRequestDoc.exists) {
          throw new NotFoundError('Trip request not found');
        }

        const tripRequestData = tripRequestDoc.data() ?? {};
        if (tripRequestData.passengerId !== passengerId) {
          throw new ForbiddenError('You can only cancel your own trip request');
        }

        const status = sanitizeString(tripRequestData.status);
        if (status !== TripRequestStatus.OPEN &&
            status !== TripRequestStatus.MATCHED &&
            status !== TripRequestStatus.EXPIRED &&
            status !== TripRequestStatus.CANCELLED) {
          throw new ValidationError('Trip request has invalid status');
        }

        responseStatus = status;
        matchedTripId = sanitizeString(tripRequestData.matchedTripId);

        if (status !== TripRequestStatus.OPEN) {
          cancelled = false;
          return;
        }

        transaction.update(tripRequestRef, {
          status: TripRequestStatus.CANCELLED,
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: passengerId,
        });

        responseStatus = TripRequestStatus.CANCELLED;
        cancelled = true;
      });

      return {
        requestId,
        cancelled,
        status: responseStatus,
        ...(matchedTripId ? { matchedTripId } : {}),
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
