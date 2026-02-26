import React from 'react';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useAuthStore } from '../src/store';
import { SearchingDriverScreen } from '../src/features/trip';
import { BackButton } from '../src/ui';

export default function Searching() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const params = useLocalSearchParams<{
    requestId: string;
    distanceKm: string;
    durationMin: string;
    priceIls: string;
  }>();

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  // Validate required params
  if (!params.requestId) {
    return <Redirect href="/home" />;
  }

  const handleCancel = () => {
    // TODO: Call Cloud Function to cancel trip request
    console.log('Cancel request - will call Cloud Function');
    router.replace('/home');
  };

  const handleDriverAssigned = (tripId: string) => {
    // Navigate to trip screen when driver is assigned
    router.push({
      pathname: '/trip',
      params: { tripId },
    });
  };

  return (
    <View style={styles.container}>
      <BackButton fallbackRoute="/home" />
      <SearchingDriverScreen
        requestId={params.requestId}
        distanceKm={parseFloat(params.distanceKm || '0')}
        durationMin={parseFloat(params.durationMin || '0')}
        priceIls={parseInt(params.priceIls || '0', 10)}
        onCancel={handleCancel}
        onDriverAssigned={handleDriverAssigned}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
