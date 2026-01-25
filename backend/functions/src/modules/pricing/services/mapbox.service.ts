import { LatLng } from '@taxi-line/shared';
import { env } from '../../../core/env';
import { logger } from '../../../core/logger';
import { ExternalServiceError } from '../../../core/errors';

/**
 * Mapbox Directions API response types
 */
interface MapboxRoute {
  distance: number; // meters
  duration: number; // seconds
  geometry: unknown;
}

interface MapboxDirectionsResponse {
  code: string;
  routes: MapboxRoute[];
  waypoints: unknown[];
}

/**
 * Route calculation result
 */
export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  distanceKm: number;
  durationMin: number;
}

/**
 * Calculate route between two points using Mapbox Directions API
 *
 * @param pickup - Starting location
 * @param dropoff - Destination location
 * @returns Route information including distance and duration
 */
export async function calculateRoute(
  pickup: LatLng,
  dropoff: LatLng
): Promise<RouteResult> {
  const accessToken = env.mapboxAccessToken;

  // In development without token, return mock data
  if (!accessToken || accessToken === 'your-mapbox-token-here') {
    logger.warn('Mapbox token not configured, using mock route calculation');
    return calculateMockRoute(pickup, dropoff);
  }

  const coordinates = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?access_token=${accessToken}&geometries=geojson`;

  // Set up abort controller for timeout (10 seconds)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new ExternalServiceError(
        `Mapbox API error: ${response.status} ${response.statusText}`,
        'mapbox'
      );
    }

    const data = (await response.json()) as MapboxDirectionsResponse;

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new ExternalServiceError(
        `Mapbox returned no routes: ${data.code}`,
        'mapbox'
      );
    }

    const route = data.routes[0]!;
    const distanceMeters = route.distance;
    const durationSeconds = route.duration;

    logger.info('Route calculated via Mapbox', {
      distanceMeters,
      durationSeconds,
    });

    return {
      distanceMeters,
      durationSeconds,
      distanceKm: distanceMeters / 1000,
      durationMin: durationSeconds / 60,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof ExternalServiceError) {
      throw error;
    }
    // Handle timeout/abort
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('Mapbox API request timed out');
      throw new ExternalServiceError(
        'Mapbox API request timed out after 10 seconds',
        'mapbox'
      );
    }
    logger.error('Mapbox API call failed', { error });
    throw new ExternalServiceError(
      'Failed to calculate route via Mapbox',
      'mapbox'
    );
  }
}

/**
 * Calculate mock route using Haversine formula
 * Used when Mapbox token is not configured
 */
function calculateMockRoute(pickup: LatLng, dropoff: LatLng): RouteResult {
  const distanceMeters = haversineDistance(pickup, dropoff);
  // Estimate duration: ~30 km/h average speed in city
  const durationSeconds = (distanceMeters / 1000 / 30) * 3600;

  logger.info('Mock route calculated', { distanceMeters, durationSeconds });

  return {
    distanceMeters,
    durationSeconds,
    distanceKm: distanceMeters / 1000,
    durationMin: durationSeconds / 60,
  };
}

/**
 * Haversine formula to calculate distance between two points on Earth
 */
function haversineDistance(point1: LatLng, point2: LatLng): number {
  const R = 6371000; // Earth's radius in meters
  const lat1Rad = (point1.lat * Math.PI) / 180;
  const lat2Rad = (point2.lat * Math.PI) / 180;
  const deltaLat = ((point2.lat - point1.lat) * Math.PI) / 180;
  const deltaLng = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
