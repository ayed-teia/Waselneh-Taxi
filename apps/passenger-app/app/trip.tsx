import React, { useCallback, useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { TripStatus } from '@taxi-line/shared';
import { ActiveTripScreen, RatingScreen } from '../src/features/trip';
import { passengerCancelTrip, submitRating } from '../src/services/api';
import { DriverLocation, TripData, subscribeToDriverLocation, subscribeToTrip } from '../src/services/realtime';
import { useAuthStore } from '../src/store';
import { BackButton } from '../src/ui';

export default function Trip() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const params = useLocalSearchParams<{ tripId: string }>();

  const [trip, setTrip] = useState<TripData | null>(null);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [hasRated, setHasRated] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const tripId = params.tripId;

  useEffect(() => {
    if (!tripId) return;

    const unsubscribe = subscribeToTrip(
      tripId,
      (tripData) => {
        setTrip(tripData);
        setLoading(false);

        if (tripData?.status === 'completed' && !hasRated) {
          setShowRating(true);
        }

        const cancelledStatuses = [
          'cancelled_by_passenger',
          'cancelled_by_driver',
          'cancelled_by_system',
          'no_driver_available',
        ];
        if (tripData && cancelledStatuses.includes(tripData.status)) {
          setTimeout(() => {
            router.replace('/home');
          }, 3000);
        }
      },
      (tripError) => {
        setError(tripError.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tripId, router, hasRated]);

  useEffect(() => {
    if (!trip?.driverId) {
      setDriverLocation(null);
      return;
    }

    const activeStatuses = ['accepted', 'driver_arrived', 'in_progress'];
    if (!activeStatuses.includes(trip.status)) {
      setDriverLocation(null);
      return;
    }

    const unsubscribe = subscribeToDriverLocation(
      trip.driverId,
      (location) => {
        setDriverLocation(location);
      },
      (driverError) => {
        console.error('Error subscribing to driver location:', driverError);
      }
    );

    return () => unsubscribe();
  }, [trip?.driverId, trip?.status]);

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (!tripId) {
    return <Redirect href="/home" />;
  }

  const handleCancel = useCallback(async () => {
    if (!tripId || isCancelling) return;

    setIsCancelling(true);
    try {
      await passengerCancelTrip(tripId);
      router.replace('/home');
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : 'Failed to cancel trip';
      console.error('Failed to cancel trip:', message);
      Alert.alert('Cancel failed', message);
    } finally {
      setIsCancelling(false);
    }
  }, [tripId, router, isCancelling]);

  const handleGoHome = () => {
    router.replace('/home');
  };

  const handleSubmitRating = useCallback(
    async (rating: number, comment?: string) => {
      if (!tripId) return;

      await submitRating(tripId, rating, comment);
      setHasRated(true);
      setShowRating(false);
      router.replace('/home');
    },
    [tripId, router]
  );

  const handleSkipRating = useCallback(() => {
    setShowRating(false);
    router.replace('/home');
  }, [router]);

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

  if (showRating && trip.status === 'completed') {
    return (
      <View style={styles.routeContainer}>
        <BackButton fallbackRoute="/home" />
        <RatingScreen
          tripId={tripId}
          finalPriceIls={trip.finalPriceIls ?? trip.estimatedPriceIls}
          onSubmit={handleSubmitRating}
          onSkip={handleSkipRating}
        />
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
        driverLocation={driverLocation}
        driverId={trip.driverId}
        pickup={trip.pickup}
        dropoff={trip.dropoff}
        onCancel={handleCancel}
        onGoHome={handleGoHome}
        isCancelling={isCancelling}
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
