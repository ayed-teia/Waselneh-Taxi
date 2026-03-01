import React, { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ErrorState, LoadingState, ScreenContainer } from '@waselneh/ui';
import { TripStatus } from '@taxi-line/shared';
import { ActiveTripScreen } from '../src/features/trip';
import { TripData, subscribeToTrip } from '../src/services/realtime';
import { useAuthStore } from '../src/store';
import { BackButton } from '../src/ui';

export default function Trip() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const params = useLocalSearchParams<{ tripId: string }>();

  const [trip, setTrip] = useState<TripData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tripId = params.tripId;

  useEffect(() => {
    if (!tripId) return;

    const unsubscribe = subscribeToTrip(
      tripId,
      (tripData) => {
        setTrip(tripData);
        setLoading(false);
      },
      (tripError) => {
        setError(tripError.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tripId]);

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (!tripId) {
    return <Redirect href="/home" />;
  }

  const handleTripCompleted = () => {
    router.replace('/home');
  };

  if (loading) {
    return (
      <ScreenContainer padded={false} edges={[]}>
        <BackButton fallbackRoute="/home" />
        <LoadingState title="Loading trip..." />
      </ScreenContainer>
    );
  }

  if (error || !trip) {
    return (
      <ScreenContainer padded={false} edges={[]}>
        <BackButton fallbackRoute="/home" />
        <ErrorState
          title="Trip error"
          message={error || 'Trip not found'}
          onRetry={() => router.replace('/home')}
          retryLabel="Back to Home"
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false} edges={[]}>
      <BackButton fallbackRoute="/home" />
      <ActiveTripScreen
        tripId={tripId}
        status={trip.status as TripStatus}
        estimatedPriceIls={trip.estimatedPriceIls}
        pickup={trip.pickup}
        dropoff={trip.dropoff}
        onTripCompleted={handleTripCompleted}
      />
    </ScreenContainer>
  );
}
