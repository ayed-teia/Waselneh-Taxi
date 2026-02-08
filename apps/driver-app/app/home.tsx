import React, { useCallback, useEffect } from 'react';
import { Redirect } from 'expo-router';
import { Alert } from 'react-native';
import { useAuthStore, useDriverStore } from '../src/store';
import { HomeScreen } from '../src/features/home';
import { TripRequestModal } from '../src/ui';
import { 
  startLocationTracking, 
  stopLocationTracking,
  requestLocationPermissions,
  setDriverAvailability,
  getCurrentLocation,
} from '../src/services/location';
import {
  startDriverRequestsListener,
  stopDriverRequestsListener,
} from '../src/services/realtime';

/**
 * ============================================================================
 * DRIVER HOME SCREEN
 * ============================================================================
 * 
 * ONLINE FLOW:
 * 1. Driver taps "Go Online"
 * 2. Request location permissions
 * 3. Start location tracking → writes to driverLive/{driverId}
 * 4. Start driver requests listener → listens to driverRequests/{driverId}/requests
 * 5. When request arrives → TripRequestModal shows
 * 
 * OFFLINE FLOW:
 * 1. Driver taps "Go Offline"
 * 2. Stop location tracking → deletes driverLive/{driverId}
 * 3. Stop driver requests listener → clears any pending modal
 * 
 * ============================================================================
 */

export default function Home() {
  const { isAuthenticated, user } = useAuthStore();
  const { status, setStatus } = useDriverStore();

  // Handle location tracking AND request listener based on online status
  useEffect(() => {
    if (!user?.uid) return;

    const manageTracking = async () => {
      if (status === 'online') {
        // Start location tracking
        const started = await startLocationTracking(user.uid);
        if (!started) {
          console.warn('Failed to start location tracking');
        }

        // Start listening for trip requests
        await startDriverRequestsListener(user.uid);
      } else {
        // Stop location tracking
        await stopLocationTracking();

        // Stop listening for trip requests
        await stopDriverRequestsListener();
      }
    };

    manageTracking();

    // Cleanup on unmount
    return () => {
      stopLocationTracking();
      stopDriverRequestsListener();
    };
  }, [status, user?.uid]);

  // Handle status toggle with location tracking
  const handleToggleStatus = useCallback(
    async (goOnline: boolean) => {
      if (!user?.uid) return;

      if (goOnline) {
        // Request permissions first
        const hasPermission = await requestLocationPermissions();
        if (!hasPermission) {
          Alert.alert(
            'Location Required',
            'Location permission is required to go online. Please enable location access in settings.',
            [{ text: 'OK' }]
          );
          return;
        }

        // Get current location for availability
        const location = await getCurrentLocation();
        
        // Update Firestore availability
        try {
          await setDriverAvailability(user.uid, true, location ?? undefined);
          setStatus('online');
        } catch (error) {
          console.error('Failed to go online:', error);
          Alert.alert('Error', 'Failed to go online. Please try again.');
        }
      } else {
        // Go offline
        try {
          await setDriverAvailability(user.uid, false);
          setStatus('offline');
        } catch (error) {
          console.error('Failed to go offline:', error);
        }
      }
    },
    [user?.uid, setStatus]
  );

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  // Render home screen with trip request modal overlay
  return (
    <>
      <HomeScreen onToggleStatus={handleToggleStatus} />
      <TripRequestModal />
    </>
  );
}
