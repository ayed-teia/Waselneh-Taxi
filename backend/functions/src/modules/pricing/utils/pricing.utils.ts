/**
 * Pricing calculation utilities
 *
 * Re-exports shared pricing logic from @taxi-line/shared
 * Ensures consistency between frontend estimates and backend calculations
 *
 * Pricing Rule: Every 2km = 1 ILS (0.5 ILS/km), minimum 5 ILS
 */

// Re-export all pricing utilities from shared package
export {
  PRICING_CONFIG,
  calculatePrice,
  calculateRidePrice,
  roundDistanceKm,
  formatPrice,
  formatDistance,
  calculateTripEstimate,
  normalizeRequestedSeats,
  clampRequestedSeats,
} from '@taxi-line/shared';

/**
 * Price breakdown for transparency
 */
export interface PriceBreakdown {
  distanceKm: number;
  pricePerUnit: number; // ILS per km
  calculatedPrice: number;
  minimumFare: number;
  finalPrice: number;
}

/**
 * Get detailed price breakdown
 */
import { PRICING_CONFIG, roundDistanceKm } from '@taxi-line/shared';

export function getPriceBreakdown(distanceKm: number): PriceBreakdown {
  const roundedDistance = roundDistanceKm(distanceKm);
  const calculatedPrice = Math.ceil(roundedDistance * PRICING_CONFIG.RATE_PER_KM);
  const finalPrice = Math.max(calculatedPrice, PRICING_CONFIG.MINIMUM_PRICE_ILS);

  return {
    distanceKm: roundedDistance,
    pricePerUnit: PRICING_CONFIG.RATE_PER_KM,
    calculatedPrice,
    minimumFare: PRICING_CONFIG.MINIMUM_PRICE_ILS,
    finalPrice,
  };
}
