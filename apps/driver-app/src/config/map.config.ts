import Constants from 'expo-constants';

/**
 * Map configuration for mobile apps
 * 
 * Uses environment variable for Mapbox token.
 * Falls back to default OpenStreetMap if no token provided.
 */

// Get Mapbox token from environment
const MAPBOX_TOKEN = Constants.expoConfig?.extra?.mapboxAccessToken
  || Constants.expoConfig?.extra?.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
  || process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
  || Constants.expoConfig?.extra?.EXPO_PUBLIC_MAPBOX_TOKEN
  || process.env.EXPO_PUBLIC_MAPBOX_TOKEN
  || '';

/**
 * Check if Mapbox is configured
 */
export function isMapboxConfigured(): boolean {
  return MAPBOX_TOKEN.length > 0;
}

/**
 * Get Mapbox access token
 * Returns empty string if not configured
 */
export function getMapboxToken(): string {
  return MAPBOX_TOKEN;
}

/**
 * Default map region (Addis Ababa, Ethiopia)
 */
export const DEFAULT_REGION = {
  latitude: 32.2211,
  longitude: 35.2544,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

/**
 * Navigation-focused style gives cleaner roads and better contrast.
 */
export const MAP_STYLE_URL = 'mapbox://styles/mapbox/navigation-day-v1';

/**
 * Camera defaults tuned for driver navigation.
 */
export const CAMERA_DEFAULTS = {
  zoomLevel: 15,
  pitch: 42,
  heading: 0,
};

/**
 * Map update throttle interval (ms)
 * Prevents excessive re-renders
 */
export const MAP_UPDATE_THROTTLE_MS = 1000;

/**
 * Marker colors for different statuses
 */
export const MARKER_COLORS = {
  driver: {
    self: '#007AFF',      // Blue for current driver
    online: '#34C759',    // Green for other online drivers
    offline: '#8E8E93',   // Gray for offline
  },
  roadblock: {
    open: '#34C759',      // Green - road is open
    closed: '#FF3B30',    // Red - road is closed
    congested: '#FF9500', // Orange - heavy traffic
  },
  trip: {
    pickup: '#007AFF',    // Blue
    dropoff: '#34C759',   // Green
  },
};

/**
 * Log prefix for map-related operations
 */
export const MAP_LOG_PREFIX = '[Map]';
