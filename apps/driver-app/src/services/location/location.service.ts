import { LatLng } from '../../types/shared';

/**
 * Location Service Placeholder
 *
 * This will be implemented with expo-location for real GPS tracking.
 * For now, provides mock functionality for development.
 */

export type LocationCallback = (location: LatLng) => void;

let watchId: ReturnType<typeof setInterval> | null = null;
let mockLocation: LatLng = { lat: 32.2211, lng: 35.2544 }; // Nablus city center

/**
 * Request location permissions
 * Placeholder - will use expo-location requestForegroundPermissionsAsync
 */
export async function requestLocationPermission(): Promise<boolean> {
  // TODO: Implement with expo-location
  // const { status } = await Location.requestForegroundPermissionsAsync();
  // return status === 'granted';
  console.log('Location permission requested (placeholder)');
  return true;
}

/**
 * Request background location permissions
 * Required for tracking during active trips
 */
export async function requestBackgroundLocationPermission(): Promise<boolean> {
  // TODO: Implement with expo-location
  // const { status } = await Location.requestBackgroundPermissionsAsync();
  // return status === 'granted';
  console.log('Background location permission requested (placeholder)');
  return true;
}

/**
 * Get current location
 * Placeholder - returns mock location
 */
export async function getCurrentLocation(): Promise<LatLng> {
  // TODO: Implement with expo-location
  // const location = await Location.getCurrentPositionAsync({});
  // return { lat: location.coords.latitude, lng: location.coords.longitude };
  console.log('Getting current location (placeholder)');
  return mockLocation;
}

/**
 * Start watching location updates
 * Placeholder - simulates location updates
 */
export function startLocationUpdates(
  callback: LocationCallback,
  intervalMs: number = 5000
): void {
  if (watchId) {
    stopLocationUpdates();
  }

  console.log('Started location updates (placeholder)');

  // Simulate location updates with small random movements
  watchId = setInterval(() => {
    mockLocation = {
      lat: mockLocation.lat + (Math.random() - 0.5) * 0.001,
      lng: mockLocation.lng + (Math.random() - 0.5) * 0.001,
    };
    callback(mockLocation);
  }, intervalMs);

  // Send initial location
  callback(mockLocation);
}

/**
 * Stop watching location updates
 */
export function stopLocationUpdates(): void {
  if (watchId) {
    clearInterval(watchId);
    watchId = null;
    console.log('Stopped location updates');
  }
}

/**
 * Check if location services are enabled
 */
export async function isLocationEnabled(): Promise<boolean> {
  // TODO: Implement with expo-location
  // return await Location.hasServicesEnabledAsync();
  return true;
}
