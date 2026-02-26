import React, { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
      <View style={styles.routeContainer}>
        <BackButton fallbackRoute="/home" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading trip...</Text>
        </View>
      </View>
    );
  }

  if (error || !trip) {
    return (
      <View style={styles.routeContainer}>
        <BackButton fallbackRoute="/home" />
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={styles.errorText}>{error || 'Trip not found'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.routeContainer}>
      <BackButton fallbackRoute="/home" />
      <ActiveTripScreen
        tripId={tripId}
        status={trip.status as TripStatus}
        estimatedPriceIls={trip.estimatedPriceIls}
        pickup={trip.pickup}
        dropoff={trip.dropoff}
        onTripCompleted={handleTripCompleted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  routeContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#8E8E93',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    padding: 20,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
  },
});
