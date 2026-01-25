import { defineString, defineInt } from 'firebase-functions/params';

/** Firebase project region */
export const REGION = defineString('REGION', { default: 'europe-west1' });

/** Environment name */
export const ENVIRONMENT = defineString('ENVIRONMENT', { default: 'development' });

/** Log level */
export const LOG_LEVEL = defineString('LOG_LEVEL', { default: 'info' });

/** Maximum trip search radius in meters */
export const MAX_SEARCH_RADIUS_METERS = defineInt('MAX_SEARCH_RADIUS_METERS', { default: 5000 });

/** Trip request timeout in seconds */
export const TRIP_REQUEST_TIMEOUT_SECONDS = defineInt('TRIP_REQUEST_TIMEOUT_SECONDS', {
  default: 120,
});

/** Mapbox Access Token for directions API */
export const MAPBOX_ACCESS_TOKEN = defineString('MAPBOX_ACCESS_TOKEN', { default: '' });

export const env = {
  get region() {
    return REGION.value();
  },
  get environment() {
    return ENVIRONMENT.value();
  },
  get logLevel() {
    return LOG_LEVEL.value();
  },
  get maxSearchRadiusMeters() {
    return MAX_SEARCH_RADIUS_METERS.value();
  },
  get tripRequestTimeoutSeconds() {
    return TRIP_REQUEST_TIMEOUT_SECONDS.value();
  },
  get mapboxAccessToken() {
    return MAPBOX_ACCESS_TOKEN.value();
  },
  get isDevelopment() {
    return this.environment === 'development';
  },
  get isProduction() {
    return this.environment === 'production';
  },
};

