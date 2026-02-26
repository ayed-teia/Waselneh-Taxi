import { defineString, defineInt } from 'firebase-functions/params';

/** Firebase project region */
export const REGION: ReturnType<typeof defineString> = defineString('REGION', { default: 'europe-west1' });

/** 
 * Environment name: 'dev' | 'pilot' | 'prod'
 * - dev: Local development / emulator
 * - pilot: Limited production testing
 * - prod: Full production
 */
export const ENVIRONMENT: ReturnType<typeof defineString> = defineString('ENVIRONMENT', { default: 'dev' });

/** Log level */
export const LOG_LEVEL: ReturnType<typeof defineString> = defineString('LOG_LEVEL', { default: 'info' });

/** Maximum trip search radius in meters */
export const MAX_SEARCH_RADIUS_METERS: ReturnType<typeof defineInt> = defineInt('MAX_SEARCH_RADIUS_METERS', {
  default: 5000,
});

/** Trip request timeout in seconds */
export const TRIP_REQUEST_TIMEOUT_SECONDS: ReturnType<typeof defineInt> = defineInt('TRIP_REQUEST_TIMEOUT_SECONDS', {
  default: 120,
});

/** Mapbox Access Token for directions API */
export const MAPBOX_ACCESS_TOKEN: ReturnType<typeof defineString> = defineString('MAPBOX_ACCESS_TOKEN', {
  default: '',
});

export const env = {
  get region() {
    return REGION.value();
  },
  get environment(): 'dev' | 'pilot' | 'prod' {
    return ENVIRONMENT.value() as 'dev' | 'pilot' | 'prod';
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
    return this.environment === 'dev';
  },
  get isPilot() {
    return this.environment === 'pilot';
  },
  get isProduction() {
    return this.environment === 'prod';
  },
};

