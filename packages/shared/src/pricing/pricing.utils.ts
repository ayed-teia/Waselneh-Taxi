import {
  VehicleType,
  VEHICLE_MAX_CAPACITY,
  VEHICLE_PRICE_MULTIPLIER,
  normalizeSeatCapacity,
  normalizeVehicleType,
} from '../config/vehicle.config';

/**
 * ============================================================================
 * PRICING UTILITIES
 * ============================================================================
 * 
 * Shared pricing logic for Waselneh taxi platform.
 * Used by both frontend (estimate display) and backend (trip creation).
 * 
 * PRICING RULES (MVP):
 * - Rate: 1 ILS per 2 KM (0.5 ILS per KM)
 * - Minimum price: 5 ILS
 * - Distance rounded up to nearest 0.1 km
 * 
 * ============================================================================
 */

/**
 * Pricing configuration (MVP)
 */
export const PRICING_CONFIG = {
  /** Price rate: ILS per kilometer */
  RATE_PER_KM: 0.5,
  
  /** Minimum trip price in ILS */
  MINIMUM_PRICE_ILS: 5,
  
  /** Distance rounding precision (0.1 km) */
  DISTANCE_ROUNDING_KM: 0.1,
} as const;

export interface RidePricingOptions {
  requiredSeats?: number;
  vehicleType?: VehicleType | null;
}

/**
 * Round distance up to nearest 0.1 km
 * 
 * @param distanceKm - Raw distance in kilometers
 * @returns Distance rounded up to nearest 0.1 km
 * 
 * @example
 * roundDistanceKm(1.23) // 1.3
 * roundDistanceKm(5.01) // 5.1
 * roundDistanceKm(2.0) // 2.0
 */
export function roundDistanceKm(distanceKm: number): number {
  const precision = PRICING_CONFIG.DISTANCE_ROUNDING_KM;
  return Math.ceil(distanceKm / precision) * precision;
}

/**
 * Calculate trip price based on distance
 * 
 * PRICING RULE:
 * - Every 2 KM = 1 ILS (0.5 ILS per KM)
 * - Minimum price: 5 ILS
 * 
 * @param distanceKm - Distance in kilometers (will be rounded up to 0.1 km)
 * @returns Price in ILS (integer, rounded up)
 * 
 * @example
 * calculatePrice(10)  // 5 ILS (10 * 0.5 = 5, meets minimum)
 * calculatePrice(4)   // 5 ILS (4 * 0.5 = 2, below minimum → 5)
 * calculatePrice(20)  // 10 ILS (20 * 0.5 = 10)
 * calculatePrice(15.3) // 8 ILS (15.3 → 15.3, * 0.5 = 7.65 → 8)
 */
export function calculatePrice(distanceKm: number): number {
  // Round distance up to nearest 0.1 km
  const roundedDistance = roundDistanceKm(distanceKm);
  
  // Calculate base price
  const basePrice = roundedDistance * PRICING_CONFIG.RATE_PER_KM;
  
  // Apply minimum price
  const price = Math.max(basePrice, PRICING_CONFIG.MINIMUM_PRICE_ILS);
  
  // Round up to nearest integer (ILS)
  return Math.ceil(price);
}

export function calculateRidePrice(distanceKm: number, options?: RidePricingOptions): number {
  const basePrice = calculatePrice(distanceKm);
  const normalizedVehicleType = normalizeVehicleType(options?.vehicleType);
  const seatCapacityRequest = normalizeSeatCapacity(options?.requiredSeats, normalizedVehicleType);

  // Group trips that need more than 4 seats add incremental cost.
  const extraSeatSurcharge = seatCapacityRequest > 4 ? (seatCapacityRequest - 4) * 2 : 0;
  const vehicleMultiplier = normalizedVehicleType
    ? VEHICLE_PRICE_MULTIPLIER[normalizedVehicleType]
    : 1;

  const adjusted = (basePrice + extraSeatSurcharge) * vehicleMultiplier;
  return Math.ceil(Math.max(adjusted, PRICING_CONFIG.MINIMUM_PRICE_ILS));
}

/**
 * Format price for display
 * 
 * @param priceIls - Price in ILS
 * @returns Formatted string like "₪10"
 */
export function formatPrice(priceIls: number): string {
  return `₪${priceIls}`;
}

/**
 * Format distance for display
 * 
 * @param distanceKm - Distance in kilometers
 * @returns Formatted string like "5.2 km"
 */
export function formatDistance(distanceKm: number): string {
  return `${distanceKm.toFixed(1)} km`;
}

/**
 * Calculate trip estimate with price
 * 
 * @param distanceKm - Distance in kilometers
 * @param durationMin - Duration in minutes
 * @returns Object with rounded distance, duration, and calculated price
 */
export function calculateTripEstimate(distanceKm: number, durationMin: number): {
  distanceKm: number;
  durationMin: number;
  priceIls: number;
} {
  const roundedDistance = roundDistanceKm(distanceKm);
  const roundedDuration = Math.ceil(durationMin);
  const priceIls = calculatePrice(distanceKm);
  
  return {
    distanceKm: Math.round(roundedDistance * 10) / 10, // Clean up floating point
    durationMin: roundedDuration,
    priceIls,
  };
}

export function normalizeRequestedSeats(value: number | undefined): number {
  return normalizeSeatCapacity(value, null);
}

export function clampRequestedSeats(value: number): number {
  return Math.min(Math.max(Math.round(value), 1), VEHICLE_MAX_CAPACITY);
}
