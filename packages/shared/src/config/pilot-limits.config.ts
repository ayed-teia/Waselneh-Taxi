/**
 * ============================================================================
 * PILOT SAFETY LIMITS - Configuration
 * ============================================================================
 * 
 * These limits are safety guards for the pilot phase.
 * They can be adjusted as the system matures.
 * 
 * ============================================================================
 */

export const PILOT_LIMITS = {
  /**
   * Maximum active trips per driver at once
   * During pilot, drivers can only handle 1 trip at a time
   */
  MAX_ACTIVE_TRIPS_PER_DRIVER: 1,

  /**
   * Maximum active trips per passenger at once
   * Prevents passengers from creating multiple simultaneous trips
   */
  MAX_ACTIVE_TRIPS_PER_PASSENGER: 1,

  /**
   * Driver response timeout in seconds
   * If driver doesn't accept/reject within this time, request expires
   */
  DRIVER_RESPONSE_TIMEOUT_SECONDS: 20,

  /**
   * Maximum search radius for drivers in kilometers
   */
  MAX_DRIVER_SEARCH_RADIUS_KM: 15,

  /**
   * Minimum fare amount in ILS
   */
  MIN_FARE_ILS: 10,
} as const;

// Note: ACTIVE_TRIP_STATUSES is already exported from enums/trip-status.enum.ts
