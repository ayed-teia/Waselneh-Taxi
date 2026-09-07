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
  DRIVER_RESPONSE_TIMEOUT_SECONDS: 45,

  /**
   * Maximum search radius for drivers in kilometers.
   *
   * @deprecated NOT the source of truth, and NOT read by matching. The dispatcher
   * enforces MAX_SEARCH_RADIUS_METERS from the backend function environment
   * (see backend/functions/src/core/env/env.ts and backend/functions/.env), because
   * that is tunable per environment without a code change. This constant is kept
   * only so existing imports do not break; it disagreed with the env value (15km vs
   * 5km) for as long as both were dead code. Do not add new readers.
   */
  MAX_DRIVER_SEARCH_RADIUS_KM: 15,

  /**
   * Minimum fare amount in ILS
   */
  MIN_FARE_ILS: 10,

  /**
   * Trip search timeout in seconds
   * If trip.status === "searching" for > this time, auto-cancel
   */
  TRIP_SEARCH_TIMEOUT_SECONDS: 120, // 2 minutes

  /**
   * Driver arrival timeout in seconds
   * If trip.status === "accepted" and driver doesn't arrive within this time, auto-cancel
   */
  DRIVER_ARRIVAL_TIMEOUT_SECONDS: 300, // 5 minutes
} as const;

// Note: ACTIVE_TRIP_STATUSES is already exported from enums/trip-status.enum.ts
