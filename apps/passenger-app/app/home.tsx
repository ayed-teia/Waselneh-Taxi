import React, { useCallback, useEffect, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useAuthStore, useTripStore } from '../src/store';
import { MapScreen } from '../src/features/map';
import { ActiveTripScreen } from '../src/features/trip';
import { subscribeToActiveTrip } from '../src/services/realtime';
import { passengerCancelTrip } from '../src/services/api';
import { TripStatus } from '@taxi-line/shared';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const { activeTripId, tripStatus, setActiveTrip, clearTrip } = useTripStore();
  const [isCancelling, setIsCancelling] = useState(false);

  // Check for active trip on mount (handles app reload mid-trip)
  useEffect(() => {
    if (!isAuthenticated || !user?.uid) return;

    console.log('🔄 [Home] Checking for active trip...');

    const unsubscribe = subscribeToActiveTrip(
      user.uid,
      (trip) => {
        if (trip) {
          console.log('📍 [Home] Found active trip:', trip.id, 'status:', trip.status);
          setActiveTrip(trip.id, trip.status as TripStatus);
          // Navigate to trip screen
          router.replace({
            pathname: '/trip',
            params: { tripId: trip.id },
          });
        } else {
          // No active trip found
          clearTrip();
        }
      },
      (error) => {
        console.error('❌ [Home] Error checking active trip:', error);
      }
    );

    return () => unsubscribe();
  }, [isAuthenticated, user?.uid, setActiveTrip, clearTrip, router]);

  const handleCancelTrip = useCallback(async () => {
    if (!activeTripId || isCancelling) return;

    setIsCancelling(true);
    try {
      await passengerCancelTrip(activeTripId);
      clearTrip();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel trip';
      console.error('Failed to cancel trip:', message);
      Alert.alert('Cancel failed', message);
    } finally {
      setIsCancelling(false);
    }
  }, [activeTripId, isCancelling, clearTrip]);

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  // Show active trip screen if there's an ongoing trip (fallback, normally redirects)
  if (activeTripId && tripStatus) {
    return (
      <ActiveTripScreen
        tripId={activeTripId}
        status={tripStatus}
        onCancel={handleCancelTrip}
        isCancelling={isCancelling}
      />
    );
  }

  // Default: show map screen
  return <MapScreen />;
}
