import * as Location from 'expo-location';
import { updateDriverLocation, removeDriverLocation, LocationUpdate } from './driver-location.service';

/**
 * ============================================================================
 * DRIVER LIVE LOCATION TRACKING SERVICE
 * ============================================================================
 * 
 * QA VERIFICATION CHECKLIST:
 * 
 * ✅ ONLINE FLOW:
 *    1. Driver toggles Online → startLocationTracking(driverId) called
 *    2. LOG: "🚀 [LocationTracking] WATCHER STARTED for driver: {driverId}"
 *    3. First location received → driverLive/{driverId} document CREATED
 *    4. LOG: "📍 [LocationTracking] Location update #{count}: {lat}, {lng}"
 * 
 * ✅ LOCATION UPDATES:
 *    1. GPS position changes (every ~2 seconds or 5 meters)
 *    2. driverLive/{driverId} document UPDATED with new coordinates
 *    3. LOG: Throttled to every 10th update to reduce console spam
 *    4. Manager dashboard receives update via onSnapshot
 * 
 * ✅ OFFLINE FLOW:
 *    1. Driver toggles Offline → stopLocationTracking() called
 *    2. LOG: "🛑 [LocationTracking] WATCHER STOPPED for driver: {driverId}"
 *    3. driverLive/{driverId} document DELETED
 *    4. Manager dashboard removes marker via onSnapshot
 * 
 * ✅ GUARDS AGAINST ISSUES:
 *    - Duplicate listener check: trackingState.isTracking
 *    - Same driver check: trackingState.driverId === driverId
 *    - Cleanup on stop: watchId.remove() + state reset
 *    - Error handling: catch blocks with logging, no crashes
 * 
 * ============================================================================
 */

/**
 * Location tracking configuration
 */
const LOCATION_TRACKING_CONFIG = {
  /** Update interval in milliseconds */
  updateInterval: 2000,
  /** Minimum distance change (meters) to trigger update */
  distanceInterval: 5,
  /** Accuracy setting for battery efficiency */
  accuracy: Location.Accuracy.Balanced,
  /** Log every Nth update (throttle logs) */
  logEveryNthUpdate: 10,
};

/**
 * Location tracking state - SINGLETON to prevent duplicates
 */
interface TrackingState {
  isTracking: boolean;
  watchId: Location.LocationSubscription | null;
  driverId: string | null;
  lastUpdate: Date | null;
  updateCount: number;
}

const trackingState: TrackingState = {
  isTracking: false,
  watchId: null,
  driverId: null,
  lastUpdate: null,
  updateCount: 0,
};

/**
 * Request location permissions
 * Returns true if permissions granted, false otherwise
 */
export async function requestLocationPermissions(): Promise<boolean> {
  try {
    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    
    if (foregroundStatus !== 'granted') {
      console.warn('Foreground location permission denied');
      return false;
    }

    // For background tracking (optional, needed for when app is backgrounded)
    const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
    
    if (backgroundStatus !== 'granted') {
      console.warn('Background location permission denied - tracking only works in foreground');
    }

    return true;
  } catch (error) {
    console.error('Error requesting location permissions:', error);
    return false;
  }
}

/**
 * Check if location services are enabled
 */
export async function isLocationEnabled(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch (error) {
    console.error('Error checking location services:', error);
    return false;
  }
}

/**
 * Get current location once
 */
export async function getCurrentLocation(): Promise<LocationUpdate | null> {
  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      heading: location.coords.heading !== null ? location.coords.heading : undefined,
      speed: location.coords.speed !== null ? location.coords.speed : undefined,
    };
  } catch (error) {
    console.error('Error getting current location:', error);
    return null;
  }
}

/**
 * Start location tracking for a driver
 * Updates are sent to Firestore every ~2 seconds
 * 
 * QA: This should log "WATCHER STARTED" and create driverLive/{driverId} document
 */
export async function startLocationTracking(driverId: string): Promise<boolean> {
  // GUARD: Prevent duplicate listeners for same driver
  if (trackingState.isTracking && trackingState.driverId === driverId) {
    console.log('⚠️ [LocationTracking] Already tracking this driver, skipping duplicate:', driverId);
    return true;
  }

  // GUARD: Stop any existing tracking before starting new one
  if (trackingState.isTracking) {
    console.log('⚠️ [LocationTracking] Stopping existing tracker before starting new one');
    await stopLocationTracking();
  }

  try {
    // Check permissions
    const hasPermission = await requestLocationPermissions();
    if (!hasPermission) {
      console.error('❌ [LocationTracking] Location permissions not granted');
      return false;
    }

    // Check if location services are enabled
    const enabled = await isLocationEnabled();
    if (!enabled) {
      console.error('❌ [LocationTracking] Location services are disabled');
      return false;
    }

    console.log('🚀 [LocationTracking] WATCHER STARTED for driver:', driverId);
    console.log('   Config: interval=' + LOCATION_TRACKING_CONFIG.updateInterval + 'ms, distance=' + LOCATION_TRACKING_CONFIG.distanceInterval + 'm');

    // Reset update counter
    trackingState.updateCount = 0;

    // Start watching location
    const watchId = await Location.watchPositionAsync(
      {
        accuracy: LOCATION_TRACKING_CONFIG.accuracy,
        timeInterval: LOCATION_TRACKING_CONFIG.updateInterval,
        distanceInterval: LOCATION_TRACKING_CONFIG.distanceInterval,
      },
      async (location) => {
        const update: LocationUpdate = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          heading: location.coords.heading !== null ? location.coords.heading : undefined,
          speed: location.coords.speed !== null ? location.coords.speed : undefined,
        };

        try {
          await updateDriverLocation(driverId, update);
          trackingState.lastUpdate = new Date();
          trackingState.updateCount++;

          // Throttled logging - log every Nth update to reduce spam
          if (trackingState.updateCount === 1) {
            console.log('📍 [LocationTracking] First location update sent! Document created.');
          } else if (trackingState.updateCount % LOCATION_TRACKING_CONFIG.logEveryNthUpdate === 0) {
            console.log(`📍 [LocationTracking] Update #${trackingState.updateCount}: ${update.lat.toFixed(5)}, ${update.lng.toFixed(5)}`);
          }
        } catch (error) {
          console.error('❌ [LocationTracking] Firestore write failed:', error);
        }
      }
    );

    trackingState.isTracking = true;
    trackingState.watchId = watchId;
    trackingState.driverId = driverId;

    console.log('✅ [LocationTracking] Watcher registered successfully');
    return true;
  } catch (error) {
    console.error('❌ [LocationTracking] Failed to start tracking:', error);
    return false;
  }
}

/**
 * Stop location tracking
 * Also removes the driver's live location from Firestore
 * 
 * QA: This should log "WATCHER STOPPED" and delete driverLive/{driverId} document
 */
export async function stopLocationTracking(): Promise<void> {
  // GUARD: Don't try to stop if not tracking
  if (!trackingState.isTracking) {
    console.log('⚠️ [LocationTracking] Stop called but not tracking - no-op');
    return;
  }

  const driverId = trackingState.driverId;
  const updateCount = trackingState.updateCount;

  console.log('🛑 [LocationTracking] WATCHER STOPPED for driver:', driverId);
  console.log(`   Total updates sent: ${updateCount}`);

  try {
    // Stop the location watcher FIRST to prevent new writes
    if (trackingState.watchId) {
      trackingState.watchId.remove();
      console.log('   ✓ GPS watcher removed');
    }

    // Remove driver's live location from Firestore
    if (driverId) {
      await removeDriverLocation(driverId);
      console.log('   ✓ Firestore document deleted');
    }
  } catch (error) {
    console.error('❌ [LocationTracking] Error during cleanup:', error);
  } finally {
    // ALWAYS reset state to prevent stuck tracking
    trackingState.isTracking = false;
    trackingState.watchId = null;
    trackingState.driverId = null;
    trackingState.lastUpdate = null;
    trackingState.updateCount = 0;
    console.log('   ✓ Tracking state reset');
  }
}

/**
 * Get tracking status
 */
export function getTrackingStatus(): {
  isTracking: boolean;
  driverId: string | null;
  lastUpdate: Date | null;
} {
  return {
    isTracking: trackingState.isTracking,
    driverId: trackingState.driverId,
    lastUpdate: trackingState.lastUpdate,
  };
}
