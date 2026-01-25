/**
 * Pricing calculation utilities
 *
 * Hardcoded pricing rule: Every 2km = 1 ILS
 * Final price = ceil(distanceKm / 2)
 */

/**
 * Calculate trip price based on distance
 * Rule: Every 2km costs 1 ILS, with ceiling rounding
 *
 * @param distanceKm - Distance in kilometers
 * @returns Price in ILS
 */
export function calculatePrice(distanceKm: number): number {
  // Minimum fare of 5 ILS
  const MIN_FARE = 5;

  // Every 2km = 1 ILS
  const KM_PER_ILS = 2;

  const calculatedPrice = Math.ceil(distanceKm / KM_PER_ILS);

  // Return at least the minimum fare
  return Math.max(calculatedPrice, MIN_FARE);
}

/**
 * Price breakdown for transparency
 */
export interface PriceBreakdown {
  distanceKm: number;
  pricePerUnit: number; // ILS per 2km
  calculatedPrice: number;
  minimumFare: number;
  finalPrice: number;
}

/**
 * Get detailed price breakdown
 */
export function getPriceBreakdown(distanceKm: number): PriceBreakdown {
  const MIN_FARE = 5;
  const KM_PER_ILS = 2;
  const calculatedPrice = Math.ceil(distanceKm / KM_PER_ILS);
  const finalPrice = Math.max(calculatedPrice, MIN_FARE);

  return {
    distanceKm,
    pricePerUnit: 1 / KM_PER_ILS, // 0.5 ILS per km
    calculatedPrice,
    minimumFare: MIN_FARE,
    finalPrice,
  };
}
