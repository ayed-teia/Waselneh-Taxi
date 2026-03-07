import React from 'react';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { Alert } from 'react-native';
import { ScreenContainer } from '@waselneh/ui';
import { useAuthStore } from '../src/store';
import { SearchingDriverScreen } from '../src/features/trip';
import { BackButton } from '../src/ui';
import { cancelTripRequest } from '../src/services/api';

export default function Searching() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [isCancelling, setIsCancelling] = React.useState(false);
  const params = useLocalSearchParams<{
    requestId: string;
    distanceKm: string;
    durationMin: string;
    priceIls: string;
    pickupLat?: string;
    pickupLng?: string;
    dropoffLat?: string;
    dropoffLng?: string;
  }>();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  // Validate required params
  if (!params.requestId) {
    return <Redirect href="/home" />;
  }

  const handleCancel = React.useCallback(async () => {
    if (isCancelling) {
      return;
    }

    try {
      setIsCancelling(true);
      const response = await cancelTripRequest(params.requestId);

      if (response.status === 'matched' && response.matchedTripId) {
        router.replace({
          pathname: '/trip',
          params: { tripId: response.matchedTripId },
        });
        return;
      }

      router.replace('/home');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to cancel request right now.';
      Alert.alert('Cancel failed', message);
    } finally {
      setIsCancelling(false);
    }
  }, [isCancelling, params.requestId, router]);

  const handleDriverAssigned = React.useCallback((tripId: string) => {
    // Navigate to trip screen when driver is assigned
    router.push({
      pathname: '/trip',
      params: { tripId },
    });
  }, [router]);

  const handleRequestEnded = React.useCallback(
    (status: 'expired' | 'cancelled') => {
      const message =
        status === 'expired'
          ? 'No compatible driver was found in time.'
          : 'Trip request was cancelled.';

      Alert.alert('Request ended', message, [
        {
          text: 'OK',
          onPress: () => router.replace('/home'),
        },
      ]);
    },
    [router]
  );

  return (
    <ScreenContainer padded={false} edges={[]}>
      <BackButton fallbackRoute="/home" />
      <SearchingDriverScreen
        requestId={params.requestId}
        distanceKm={parseFloat(params.distanceKm || '0')}
        durationMin={parseFloat(params.durationMin || '0')}
        priceIls={parseInt(params.priceIls || '0', 10)}
        pickup={
          params.pickupLat && params.pickupLng
            ? { lat: parseFloat(params.pickupLat), lng: parseFloat(params.pickupLng) }
            : null
        }
        dropoff={
          params.dropoffLat && params.dropoffLng
            ? { lat: parseFloat(params.dropoffLat), lng: parseFloat(params.dropoffLng) }
            : null
        }
        onCancel={handleCancel}
        onDriverAssigned={handleDriverAssigned}
        onRequestEnded={handleRequestEnded}
        cancelling={isCancelling}
      />
    </ScreenContainer>
  );
}
