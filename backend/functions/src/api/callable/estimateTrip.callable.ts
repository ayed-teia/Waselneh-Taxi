import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  LatLngSchema,
  RideOptionsSchema,
  normalizeRequestedSeats,
  normalizeVehicleType,
} from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { handleError, ValidationError } from '../../core/errors';
import { logger } from '../../core/logger';
import { calculateDynamicRidePrice, calculateRoute } from '../../modules/pricing/services';

/**
 * Request schema for trip estimation
 */
const EstimateTripRequestSchema = z.object({
  pickup: LatLngSchema,
  dropoff: LatLngSchema,
  rideOptions: RideOptionsSchema.optional(),
});

/**
 * Response type for trip estimation
 */
interface EstimateTripResponse {
  distanceKm: number;
  durationMin: number;
  priceIls: number;
  rideOptions?: {
    requiredSeats: number;
    vehicleType: string | null;
    officeId: string | null;
    lineId: string | null;
  };
  pricing?: {
    profileId: string;
    combinedMultiplier: number;
    appliedZoneIds: string[];
    appliedPeakWindowIds: string[];
  };
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

      const { pickup, dropoff, rideOptions } = parsed.data;
      const userId = request.auth?.uid ?? 'anonymous';
      const normalizedRideOptions = {
        requiredSeats: normalizeRequestedSeats(rideOptions?.requiredSeats),
        vehicleType: normalizeVehicleType(rideOptions?.vehicleType),
        officeId: typeof rideOptions?.officeId === 'string' ? rideOptions.officeId.trim() || null : null,
        lineId: typeof rideOptions?.lineId === 'string' ? rideOptions.lineId.trim() || null : null,
      };

      logger.info('Estimating trip', {
        userId,
        pickup,
        dropoff,
        rideOptions: normalizedRideOptions,
      });

      // Calculate route using Mapbox (or mock if token not configured)
      const route = await calculateRoute(pickup, dropoff);

      const pricing = await calculateDynamicRidePrice({
        distanceKm: route.distanceKm,
        pickup,
        dropoff,
        rideOptions: normalizedRideOptions,
      });
      const priceIls = pricing.priceIls;

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
        rideOptions: {
          requiredSeats: normalizedRideOptions.requiredSeats,
          vehicleType: normalizedRideOptions.vehicleType,
          officeId: normalizedRideOptions.officeId,
          lineId: normalizedRideOptions.lineId,
        },
        pricing: {
          profileId: pricing.breakdown.profileId,
          combinedMultiplier: Math.round(pricing.breakdown.combinedMultiplier * 1000) / 1000,
          appliedZoneIds: pricing.breakdown.appliedZoneIds,
          appliedPeakWindowIds: pricing.breakdown.appliedPeakWindowIds,
        },
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
