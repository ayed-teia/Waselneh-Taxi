import Mapbox from '@rnmapbox/maps';

const mapboxToken = (process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '').trim();

console.log('MAPBOX TOKEN MOBILE:', process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN);

const missingTokenMessage =
  '[Mapbox] EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is missing. Add it to apps/passenger-app/.env and rebuild the dev client.';

if (!mapboxToken) {
  console.error(missingTokenMessage);
  if (__DEV__) {
    throw new Error(missingTokenMessage);
  }
} else {
  try {
    Mapbox.setAccessToken(mapboxToken);
  } catch (error) {
    const initErrorMessage = '[Mapbox] Failed to initialize Mapbox token for passenger app.';
    console.error(initErrorMessage, error);
    if (__DEV__) {
      throw new Error(initErrorMessage);
    }
  }
}
