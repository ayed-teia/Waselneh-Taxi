/**
 * ============================================================================
 * MAPBOX TOKEN INITIALISATION - LAZY, AND DELIBERATELY SO
 * ============================================================================
 *
 * WHY THIS IS NOT DONE AT IMPORT TIME ANY MORE
 *
 * This module used to run `Mapbox.setAccessToken()` as a side effect of being
 * imported by app/_layout.tsx - the ROOT of the router. On the Android emulator the
 * native module behind it fails to initialise:
 *
 *   Exception in HostObject::get for prop 'RNMBXLocationModule'
 *     java.lang.ExceptionInInitializerError
 *     Caused by: lateinit property appContext has not been initialized
 *       at com.mapbox.common.MapboxSDKCommon.getContext
 *       at com.mapbox.common.location.LocationServiceImpl.<clinit>
 *
 * Because that happened while _layout was still being evaluated, the router never
 * mounted: no screen rendered, onAuthStateChanged never fired, and the app sat on
 * the "auth.starting" spinner forever with nothing on screen to explain why.
 *
 * It surfaced first in the passenger app, whose home screen reaches a map
 * immediately; the driver app reaches its map through a separate route and so
 * happened to survive. Both carry the identical hazard, so both are fixed.
 *
 * A map that fails is a degraded screen. A router that fails is a dead app. So the
 * token is now applied on FIRST MAP USE, inside a try/catch, and nothing here can
 * take the app down at startup.
 *
 * Call `ensureMapboxInitialized()` from a map component before rendering a map. It
 * is safe to call repeatedly - the work happens once.
 * ============================================================================
 */

const mapboxToken = (process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '').trim();

const missingTokenMessage =
  '[Mapbox] EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is missing. Add it to apps/passenger-app/.env and rebuild the dev client.';

let initialized = false;

/**
 * Apply the Mapbox access token, once.
 *
 * @returns true if Mapbox is usable, false if the caller should fall back to the
 *          alternate (OSM/MapLibre) style. NEVER throws.
 */
export function ensureMapboxInitialized(): boolean {
  if (initialized) return true;

  if (!mapboxToken) {
    console.error(missingTokenMessage);
    return false;
  }

  try {
    // Required lazily: importing @rnmapbox/maps touches native modules that can
    // fail to initialise, and that must not happen while the router is loading.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Mapbox = require('@rnmapbox/maps').default;
    Mapbox.setAccessToken(mapboxToken);
    initialized = true;
    return true;
  } catch (error) {
    console.error(
      '[Mapbox] Failed to initialize Mapbox. Maps fall back to the alternate style; the rest of the app is unaffected.',
      error
    );
    return false;
  }
}
