import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { FindNearbyRouteRunsInputSchema } from '@taxi-line/shared';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { distanceToRouteSegmentKm, readGeoPoint } from '../../modules/routes/route-proximity';

interface NearbyRouteRun {
  runId: string;
  lineId: string;
  driverId: string;
  status: string;
  availableSeats: number;
  seatCapacity: number;
  departureTime: string | null;
  originLabel: string | null;
  destinationLabel: string | null;
  distanceToRouteKm: number;
}

export const findNearbyRouteRuns = onCall<unknown, Promise<{ runs: NearbyRouteRun[] }>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    try {
      if (!getAuthenticatedUserId(request)) throw new UnauthorizedError('Authentication required');
      const parsed = FindNearbyRouteRunsInputSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid nearby route search', parsed.error.flatten());
      }

      const snapshot = await getFirestore()
        .collection('routeRuns')
        .where('status', '==', 'boarding')
        .limit(100)
        .get();
      const now = Date.now();
      const runs: NearbyRouteRun[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const origin = readGeoPoint(data.originPoint);
        const destination = readGeoPoint(data.destinationPoint);
        const availableSeats = Number(data.availableSeats ?? 0);
        const departure = data.departureTime as Timestamp | undefined;
        if (!origin || !destination || availableSeats < parsed.data.seats) continue;
        if (departure && departure.toMillis() <= now) continue;

        const distance = distanceToRouteSegmentKm(parsed.data.location, origin, destination);
        if (distance > parsed.data.maxRouteDistanceKm) continue;
        runs.push({
          runId: doc.id,
          lineId: String(data.lineId ?? ''),
          driverId: String(data.driverId ?? ''),
          status: String(data.status ?? ''),
          availableSeats,
          seatCapacity: Number(data.seatCapacity ?? 0),
          departureTime: departure?.toDate().toISOString() ?? null,
          originLabel: typeof data.originLabel === 'string' ? data.originLabel : null,
          destinationLabel: typeof data.destinationLabel === 'string' ? data.destinationLabel : null,
          distanceToRouteKm: Math.round(distance * 10) / 10,
        });
      }

      runs.sort((left, right) => left.distanceToRouteKm - right.distanceToRouteKm ||
        String(left.departureTime).localeCompare(String(right.departureTime)));
      return { runs: runs.slice(0, 20) };
    } catch (error) {
      throw handleError(error);
    }
  }
);
