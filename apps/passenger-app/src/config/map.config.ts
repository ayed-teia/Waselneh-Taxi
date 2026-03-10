/**
 * Map configuration for mobile apps.
 * Uses Expo public environment variable for Mapbox token.
 */

const MAPBOX_TOKEN = (process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '').trim();

/**
 * Check if Mapbox is configured.
 */
export function isMapboxConfigured(): boolean {
  return MAPBOX_TOKEN.length > 0;
}

/**
 * Get Mapbox access token.
 * Returns empty string if not configured.
 */
export function getMapboxToken(): string {
  return MAPBOX_TOKEN;
}

/**
 * Default map region (Nablus, Palestine).
 */
export const DEFAULT_REGION = {
  latitude: 32.2211,
  longitude: 35.2544,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

/**
 * Primary and secondary remote styles before offline-safe local fallback.
 */
export const MAP_STYLE_URL = 'mapbox://styles/mapbox/streets-v12';
export const MAP_ALT_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
export const MAP_FALLBACK_STYLE_URL = 'waselneh://offline-fallback-style';
export const MAP_FALLBACK_STYLE_JSON = JSON.stringify({
  version: 8,
  name: 'Waselneh Fallback OSM',
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      scheme: 'xyz',
    },
  },
  layers: [
    {
      id: 'fallback-background',
      type: 'background',
      paint: {
        'background-color': '#e7eef8',
      },
    },
    {
      id: 'osm-raster',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
      paint: {
        'raster-opacity': 0.95,
      },
    },
  ],
});

/**
 * Camera defaults tuned for urban ride-hailing UX.
 */
export const CAMERA_DEFAULTS = {
  zoomLevel: 14.5,
  pitch: 38,
  heading: 0,
};

/**
 * Map update throttle interval (ms).
 */
export const MAP_UPDATE_THROTTLE_MS = 1000;

/**
 * Marker colors for different statuses.
 */
export const MARKER_COLORS = {
  driver: {
    assigned: '#007AFF',
    online: '#34C759',
    offline: '#8E8E93',
  },
  roadblock: {
    open: '#34C759',
    closed: '#FF3B30',
    congested: '#FF9500',
  },
  trip: {
    pickup: '#007AFF',
    dropoff: '#34C759',
  },
};

/**
 * Log prefix for map-related operations.
 */
export const MAP_LOG_PREFIX = '[Map]';
