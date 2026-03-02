import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Card, EmptyState, Header, LoadingState, ScreenContainer, Text } from '@waselneh/ui';
import { useAuthStore } from '../src/store';
import { DriverTripHistoryItem, subscribeToDriverTripHistory } from '../src/services/realtime';
import { useI18n } from '../src/localization';

function formatDate(value: Date | null | undefined): string {
  if (!value) return '--';
  return value.toLocaleString();
}

export default function History() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<DriverTripHistoryItem[]>([]);

  useEffect(() => {
    if (!user?.uid) return;

    const unsubscribe = subscribeToDriverTripHistory(
      user.uid,
      (items) => {
        setTrips(items);
        setLoading(false);
      },
      (error) => {
        console.error('Driver history subscription failed:', error);
        setTrips([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const totalEarnings = useMemo(
    () =>
      trips.reduce((sum, trip) => {
        const fare = Number(trip.finalPriceIls ?? trip.estimatedPriceIls ?? 0);
        return Number.isFinite(fare) ? sum + fare : sum;
      }, 0),
    [trips]
  );

  if (!isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenContainer padded={false} edges={['right', 'left']}>
      <Header
        title={isRTL ? 'سجل الرحلات' : 'Trip History'}
        subtitle={isRTL ? `إجمالي الدخل: ₪${Math.round(totalEarnings)}` : `Total earnings: NIS ${Math.round(totalEarnings)}`}
        leftAction={
          <Pressable onPress={() => router.replace('/home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>{isRTL ? 'رجوع >' : '< Back'}</Text>
          </Pressable>
        }
      />

      {loading ? (
        <LoadingState title={isRTL ? 'جاري تحميل السجل...' : 'Loading history...'} />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={trips.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={
            <EmptyState
              title={isRTL ? 'لا توجد رحلات بعد' : 'No trips yet'}
              subtitle={isRTL ? 'سيظهر أرشيف الرحلات هنا.' : 'Your trip archive will appear here.'}
            />
          }
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.tripId}>{isRTL ? `رحلة ${item.id.slice(0, 8)}` : `Trip ${item.id.slice(0, 8)}`}</Text>
                <Text>{item.status}</Text>
              </View>
              <Text muted style={styles.detailText}>
                {isRTL ? 'الالتقاط' : 'Pickup'}: {item.pickup.lat.toFixed(4)}, {item.pickup.lng.toFixed(4)}
              </Text>
              <Text muted style={styles.detailText}>
                {isRTL ? 'الوصول' : 'Dropoff'}: {item.dropoff.lat.toFixed(4)}, {item.dropoff.lng.toFixed(4)}
              </Text>
              <View style={styles.cardRow}>
                <Text>{isRTL ? 'الأجرة' : 'Fare'}</Text>
                <Text style={styles.fare}>{isRTL ? '₪' : 'NIS '} {Math.round(item.finalPriceIls ?? item.estimatedPriceIls)}</Text>
              </View>
              <Text muted style={styles.detailText}>{formatDate(item.completedAt ?? item.createdAt)}</Text>
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
