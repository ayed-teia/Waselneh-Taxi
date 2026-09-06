import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripRequestStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError } from '../../core/errors';
import { logger } from '../../core/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { evaluateDriverEligibility } from '../../modules/auth';
import { docData, getLatLng, getNumber, getRecord, getString } from '../../core/firestore/doc-data';

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Request schema for dispatching a trip request
 */
const DispatchTripRequestSchema = z.object({
  requestId: z.string().min(1),
});

/**
 * Response type for dispatch
 */
interface DispatchTripRequestResponse {
  dispatchedTo: number;
  driverIds: string[];
}

/**
 * Inbox document structure
 */
interface InboxDocument {
  requestId: string;
  passengerId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPriceIls: number;
  createdAt: FirebaseFirestore.FieldValue;
}

/**
 * Dispatch a trip request to available drivers
 *
 * This function:
 * 1. Fetches the trip request and validates it's OPEN
 * 2. Queries for online drivers (simple query, no geo filtering yet)
 * 3. Creates inbox documents for each driver
 * 4. Does NOT change the request status yet
 *
 * In v1, this is a simple broadcast to all online drivers.
 * Geo-filtering will be added in v2.
 */
export const dispatchTripRequest = onCall<unknown, Promise<DispatchTripRequestResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    try {
      // Validate input
      const parsed = DispatchTripRequestSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid dispatch request',
          parsed.error.flatten()
        );
      }

      const { requestId } = parsed.data;

      logger.info('Dispatching trip request', { requestId });

      const db = getFirestore();

      // Fetch trip request
      const requestDoc = await db.collection('tripRequests').doc(requestId).get();

      if (!requestDoc.exists) {
        throw new NotFoundError('Trip request', requestId);
      }

      const requestData = docData(requestDoc);
      const rideOptions = getRecord(requestData, 'rideOptions');
      const requestedOfficeId = sanitizeId(rideOptions.officeId);
      const requestedLineId = sanitizeId(rideOptions.lineId);

      // Ensure status is OPEN
      const requestStatus = getString(requestData, 'status', '');
      if (requestStatus !== TripRequestStatus.OPEN) {
        throw new ForbiddenError(
          `Cannot dispatch trip request with status '${requestStatus}'. Expected 'open'.`
        );
      }

      // Query for online drivers with scope-aware matching.
      let driversQuery: FirebaseFirestore.Query = db
        .collection('drivers')
        .where('isOnline', '==', true);
      if (requestedLineId) {
        driversQuery = driversQuery.where('lineId', '==', requestedLineId);
      } else if (requestedOfficeId) {
        driversQuery = driversQuery.where('officeId', '==', requestedOfficeId);
      }

      const driversSnapshot = await driversQuery
        .limit(50) // Limit to prevent overwhelming the system
        .get();

      if (driversSnapshot.empty) {
        logger.warn('No online drivers found for dispatch', { requestId });
        return { dispatchedTo: 0, driverIds: [] };
      }

      const driverIds: string[] = [];
      const batch = db.batch();
      let skippedIneligibleDrivers = 0;
      let skippedScopeDrivers = 0;

      // Create inbox document for each driver
      for (const driverDoc of driversSnapshot.docs) {
        const driverId = driverDoc.id;
        const eligibility = evaluateDriverEligibility(driverDoc.data());
        if (!eligibility.isEligible) {
          skippedIneligibleDrivers += 1;
          logger.debug('Skipping ineligible driver in dispatch', {
            driverId,
            reasons: eligibility.reasons,
            driverType: eligibility.driverType,
            verificationStatus: eligibility.verificationStatus,
            lineId: eligibility.lineId,
            licenseId: eligibility.licenseId,
          });
          continue;
        }

        const driverData = docData(driverDoc);
        const driverOfficeId = sanitizeId(driverData.officeId);
        const driverLineId = sanitizeId(driverData.lineId);
        if (requestedLineId && driverLineId !== requestedLineId) {
          skippedScopeDrivers += 1;
          continue;
        }
        if (requestedOfficeId && driverOfficeId !== requestedOfficeId) {
          skippedScopeDrivers += 1;
          continue;
        }

        driverIds.push(driverId);

        const inboxRef = db
          .collection('drivers')
          .doc(driverId)
          .collection('inbox')
          .doc(requestId);

        const inboxDoc: InboxDocument = {
          requestId,
          passengerId: getString(requestData, 'passengerId', ''),
          pickup: getLatLng(requestData, 'pickup') ?? { lat: 0, lng: 0 },
          dropoff: getLatLng(requestData, 'dropoff') ?? { lat: 0, lng: 0 },
          estimatedDistanceKm: getNumber(requestData, 'estimatedDistanceKm', 0),
          estimatedDurationMin: getNumber(requestData, 'estimatedDurationMin', 0),
          estimatedPriceIls: getNumber(requestData, 'estimatedPriceIls', 0),
          createdAt: FieldValue.serverTimestamp(),
        };

        batch.set(inboxRef, inboxDoc);
      }

      if (driverIds.length === 0) {
        logger.warn('No eligible drivers found for dispatch', {
          requestId,
          skippedIneligibleDrivers,
          skippedScopeDrivers,
          requestedOfficeId,
          requestedLineId,
        });
        return { dispatchedTo: 0, driverIds: [] };
      }

      // Commit all inbox writes
      await batch.commit();

      logger.info('Trip request dispatched', {
        requestId,
        dispatchedTo: driverIds.length,
        driverIds,
        skippedIneligibleDrivers,
        skippedScopeDrivers,
        requestedOfficeId,
        requestedLineId,
      });

      return {
        dispatchedTo: driverIds.length,
        driverIds,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
