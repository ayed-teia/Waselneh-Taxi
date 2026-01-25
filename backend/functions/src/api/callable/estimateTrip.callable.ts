import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { LatLngSchema } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { handleError, ValidationError } from '../../core/errors';
import { logger } from '../../core/logger';
import { calculateRoute } from '../../modules/pricing/services';
import { calculatePrice } from '../../modules/pricing/utils';

/**
 * Request schema for trip estimation
 */
const EstimateTripRequestSchema = z.object({
  pickup: LatLngSchema,
  dropoff: LatLngSchema,
});

/**
 * Response type for trip estimation
 */
interface EstimateTripResponse {
  distanceKm: number;
  durationMin: number;
  priceIls: number;
}

/**
 * Estimate trip cost based on pickup and dropoff locations
 *
 * This function:
 * 1. Validates input coordinates using Zod schemas from @taxi-line/shared
 * 2. Calls Mapbox Directions API to get actual route distance and duration
 * 3. Applies pricing rules (every 2km = 1 ILS, minimum 5 ILS)
 * 4. Returns the estimate (no Firestore writes)
 *
 * Note: If MAPBOX_ACCESS_TOKEN is not configured, uses Haversine distance calculation
 */
export const estimateTrip = onCall<unknown, Promise<EstimateTripResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Validate input
      const parsed = EstimateTripRequestSchema.safeParse(request.data);

      if (!parsed.success) {
        throw new ValidationError(
          'Invalid pickup or dropoff coordinates',
          parsed.error.flatten()
        );
      }

      const { pickup, dropoff } = parsed.data;
      const userId = request.auth?.uid ?? 'anonymous';

      logger.info('Estimating trip', {
        userId,
        pickup,
        dropoff,
      });

      // Calculate route using Mapbox (or mock if token not configured)
      const route = await calculateRoute(pickup, dropoff);

      // Apply pricing rules
      const priceIls = calculatePrice(route.distanceKm);

      // Round to reasonable precision
      const distanceKm = Math.round(route.distanceKm * 100) / 100;
      const durationMin = Math.round(route.durationMin * 10) / 10;

      logger.info('Trip estimated', {
        userId,
        distanceKm,
        durationMin,
        priceIls,
      });

      return {
        distanceKm,
        durationMin,
        priceIls,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
