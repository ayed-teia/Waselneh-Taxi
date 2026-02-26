import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '../../../ui';
import { useAuthStore } from '../../../store';
import { InboxItem, subscribeToInbox } from '../../../services/realtime';
import { acceptTripRequest } from '../../../services/api';

/**
 * Driver inbox for pending trip requests.
 */
export function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isNarrow = width < 390;
  const { user } = useAuthStore();
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;

    setIsLoading(true);
    const unsubscribe = subscribeToInbox(
      user.uid,
      (items) => {
        setInboxItems(items);
        setIsLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Inbox subscription error:', err);
        setError('Failed to load trip requests');
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const handleAccept = useCallback(
    async (requestId: string) => {
      setAcceptingId(requestId);
      try {
        const result = await acceptTripRequest(requestId);
        router.push({
          pathname: '/trip',
          params: { tripId: result.tripId },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to accept trip';
        Alert.alert('Error', message);
      } finally {
        setAcceptingId(null);
      }
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: InboxItem }) => {
      const isAccepting = acceptingId === item.requestId;
      return (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.priceText}>NIS {item.estimatedPriceIls}</Text>
            <Text style={styles.distanceText}>{item.estimatedDistanceKm.toFixed(1)} km</Text>
          </View>

          <View style={styles.cardBody}>
            <Text style={styles.coordLabel}>Pickup</Text>
            <Text style={styles.coordValue}>
              {item.pickup.lat.toFixed(4)}, {item.pickup.lng.toFixed(4)}
            </Text>

            <Text style={[styles.coordLabel, styles.coordLabelSpacer]}>Dropoff</Text>
            <Text style={styles.coordValue}>
              {item.dropoff.lat.toFixed(4)}, {item.dropoff.lng.toFixed(4)}
            </Text>
          </View>

          <View style={styles.cardFooter}>
            <Text style={styles.durationText}>~{Math.round(item.estimatedDurationMin)} min</Text>
            <Button
              title={isAccepting ? 'Accepting...' : 'Accept'}
              onPress={() => handleAccept(item.requestId)}
              disabled={isAccepting || acceptingId !== null}
              loading={isAccepting}
              style={styles.acceptButton}
            />
          </View>
        </View>
      );
    },
    [acceptingId, handleAccept]
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0F172A" />
        <Text style={styles.loadingText}>Loading inbox...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(96, insets.top + 74),
            paddingLeft: 78,
            paddingRight: 18,
          },
        ]}
      >
        <Text style={[styles.title, isNarrow && styles.titleNarrow]}>Trip Requests</Text>
        <Text style={styles.subtitle}>
          {inboxItems.length} pending request{inboxItems.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={inboxItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No trip requests</Text>
            <Text style={styles.emptySubtitle}>
              New requests will appear here when passengers request rides.
            </Text>
          </View>
        }
        contentContainerStyle={inboxItems.length === 0 ? styles.emptyList : styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => {}} tintColor="#0F172A" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F7FB',
  },
  header: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.5,
  },
  titleNarrow: {
    fontSize: 30,
    lineHeight: 34,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 15,
    color: '#94A3B8',
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F6F7FB',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748B',
  },
  errorContainer: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 14,
  },
  list: {
    padding: 16,
    paddingBottom: 26,
    gap: 12,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 28,
  },
  emptyContainer: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: '#64748B',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  priceText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#16A34A',
  },
  distanceText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '700',
  },
  cardBody: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  coordLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  coordLabelSpacer: {
    marginTop: 10,
  },
  coordValue: {
    marginTop: 2,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  cardFooter: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  durationText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
  acceptButton: {
    minWidth: 138,
  },
});
