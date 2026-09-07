import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { isTaxiLineQueueEnabled } from '@taxi-line/shared';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, handleError, UnauthorizedError, ValidationError } from '../../core/errors';
import { docData, getString } from '../../core/firestore/doc-data';
import { evaluateDriverEligibility } from '../../modules/auth/driver-eligibility';
import {
  forfeitPlace,
  getWaitingQueue,
  joinQueue,
  leaveQueue,
} from '../../modules/queue/line-queue';

/**
 * ============================================================================
 * TAXI-LINE QUEUE CALLABLES
 * ============================================================================
 *
 * ⚠️  BEHIND TAXI_LINE_QUEUE_ENABLED, DEFAULT OFF. Needs driver sign-off on the
 *     fairness rules before it is ever switched on - see docs/REMAINING_PLAN.md.
 *
 * Positions are assigned ONLY here. The Firestore rule for
 * lines/{lineId}/queue/{driverId} is `allow write: if false`, so a driver cannot
 * write their own position - which is the first thing anyone would try.
 * ============================================================================
 */

const JoinSchema = z.object({ lineId: z.string().trim().min(1).max(200) });
const LeaveSchema = z.object({
  lineId: z.string().trim().min(1).max(200),
  reason: z.enum(['went_offline', 'left_service_area']).optional(),
});

function assertQueueEnabled(): void {
  if (!isTaxiLineQueueEnabled()) {
    throw new ForbiddenError('The taxi-line queue is not enabled for this deployment.');
  }
}

interface JoinQueueResponse {
  lineId: string;
  position: number;
  placesAhead: number;
}

/**
 * A driver joins their line's queue.
 *
 * Only an ELIGIBLE driver may join: letting an unverified driver hold a position
 * would mean the front of the line is someone who cannot legally take the fare.
 * The driver's own lineId is used, not one supplied by the client, so nobody can
 * queue on a line they do not belong to.
 */
export const joinLineQueue = onCall<unknown, Promise<JoinQueueResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 20 },
  async (request) => {
    try {
      assertQueueEnabled();

      const driverId = getAuthenticatedUserId(request);
      if (!driverId) throw new UnauthorizedError('Authentication required');

      const parsed = JoinSchema.safeParse(request.data);
      if (!parsed.success) throw new ValidationError('Invalid queue request');

      const db = getFirestore();
      const driverSnap = await db.collection('drivers').doc(driverId).get();
      if (!driverSnap.exists) throw new ValidationError('Driver profile not found');

      const driverData = docData(driverSnap);
      const eligibility = evaluateDriverEligibility(driverData);
      if (!eligibility.isEligible) {
        throw new ForbiddenError(
          `Not eligible to join a line: ${eligibility.reasons.join(', ')}`
        );
      }

      // Use the driver's OWN line, never a client-supplied one.
      const driverLineId = getString(driverData, 'lineId', '');
      if (!driverLineId || driverLineId !== parsed.data.lineId) {
        throw new ForbiddenError('You can only join the queue for your own line.');
      }

      const { position } = await joinQueue(db, driverLineId, driverId);
      const queue = await getWaitingQueue(db, driverLineId);
      const placesAhead = queue.findIndex((entry) => entry.driverId === driverId);

      return {
        lineId: driverLineId,
        position,
        placesAhead: placesAhead < 0 ? queue.length : placesAhead,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);

interface LeaveQueueResponse {
  lineId: string;
  left: boolean;
}

/** A driver leaves the queue (going offline, or leaving the service area). */
export const leaveLineQueue = onCall<unknown, Promise<LeaveQueueResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 20 },
  async (request) => {
    try {
      assertQueueEnabled();

      const driverId = getAuthenticatedUserId(request);
      if (!driverId) throw new UnauthorizedError('Authentication required');

      const parsed = LeaveSchema.safeParse(request.data);
      if (!parsed.success) throw new ValidationError('Invalid queue request');

      const db = getFirestore();
      await forfeitPlace(
        db,
        parsed.data.lineId,
        driverId,
        parsed.data.reason ?? 'went_offline'
      );

      return { lineId: parsed.data.lineId, left: true };
    } catch (error) {
      throw handleError(error);
    }
  }
);

interface QueueStatusResponse {
  lineId: string;
  entries: { driverId: string; position: number; status: string }[];
}

/** Read a line's queue. Drivers see their own line; managers see any. */
export const getLineQueue = onCall<unknown, Promise<QueueStatusResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 20 },
  async (request) => {
    try {
      assertQueueEnabled();

      const userId = getAuthenticatedUserId(request);
      if (!userId) throw new UnauthorizedError('Authentication required');

      const parsed = JoinSchema.safeParse(request.data);
      if (!parsed.success) throw new ValidationError('Invalid queue request');

      const db = getFirestore();
      const entries = await getWaitingQueue(db, parsed.data.lineId);

      return {
        lineId: parsed.data.lineId,
        entries: entries.map((e) => ({
          driverId: e.driverId,
          position: e.position,
          status: e.status,
        })),
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);

export { leaveQueue };
