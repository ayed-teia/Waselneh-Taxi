import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Card, EmptyState, Header, LoadingState, ScreenContainer, Text } from '@waselneh/ui';
import { useAuthStore } from '../src/store';
import { PassengerTripHistoryItem, subscribeToPassengerTripHistory } from '../src/services/realtime';

function formatDate(value: Date | null | undefined): string {
  if (!value) return '--';
  return value.toLocaleString();
}

export default function History() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<PassengerTripHistoryItem[]>([]);

  useEffect(() => {
    if (!user?.uid) return;

    const unsubscribe = subscribeToPassengerTripHistory(
      user.uid,
      (items) => {
        setTrips(items);
        setLoading(false);
      },
      (error) => {
        console.error('Passenger history subscription failed:', error);
        setTrips([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const totalSpent = useMemo(
    () =>
      trips.reduce((total, trip) => {
        const fare = Number(trip.finalPriceIls ?? trip.estimatedPriceIls ?? 0);
        return Number.isFinite(fare) ? total + fare : total;
      }, 0),
    [trips]
  );

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title="Trip History"
        subtitle={`Total spent: NIS ${Math.round(totalSpent)}`}
        leftAction={
          <Pressable onPress={() => router.replace('/home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>{'< Back'}</Text>
          </Pressable>
        }
      />

      {loading ? (
        <LoadingState title="Loading history..." />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={trips.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={<EmptyState title="No trips yet" subtitle="Your completed and cancelled trips will appear here." />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.tripId}>Trip {item.id.slice(0, 8)}</Text>
                <Text>{item.status}</Text>
              </View>
              <Text muted style={styles.detailText}>
                Pickup: {item.pickup.lat.toFixed(4)}, {item.pickup.lng.toFixed(4)}
              </Text>
              <Text muted style={styles.detailText}>
                Dropoff: {item.dropoff.lat.toFixed(4)}, {item.dropoff.lng.toFixed(4)}
              </Text>
              <View style={styles.cardRow}>
                <Text>Fare</Text>
                <Text style={styles.fare}>NIS {Math.round(item.finalPriceIls ?? item.estimatedPriceIls)}</Text>
              </View>
              <Text muted style={styles.detailText}>
                {formatDate(item.completedAt ?? item.createdAt)}
              </Text>
            </Card>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  backButton: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  list: {
    padding: 16,
    gap: 10,
  },
  emptyList: {
    flexGrow: 1,
    padding: 16,
  },
  card: {
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripId: {
    fontSize: 14,
    fontWeight: '700',
  },
  detailText: {
    marginTop: 3,
    fontSize: 12,
  },
  fare: {
    fontSize: 17,
    fontWeight: '800',
    color: '#16A34A',
  },
});
