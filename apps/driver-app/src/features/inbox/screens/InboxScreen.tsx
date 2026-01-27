import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../../ui';
import { useAuthStore } from '../../../store';
import { subscribeToInbox, InboxItem } from '../../../services/realtime';
import { acceptTripRequest } from '../../../services/api';

/**
 * Inbox screen showing pending trip requests for the driver
 */
export function InboxScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to inbox
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

  // Handle accept trip
  const handleAccept = useCallback(async (requestId: string) => {
    setAcceptingId(requestId);
    try {
      const result = await acceptTripRequest(requestId);
      
      // Navigate to active trip screen
      router.replace({
        pathname: '/trip',
        params: { tripId: result.tripId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept trip';
      Alert.alert('Error', message);
    } finally {
      setAcceptingId(null);
    }
  }, [router]);

  // Render inbox item
  const renderItem = useCallback(({ item }: { item: InboxItem }) => {
    const isAccepting = acceptingId === item.requestId;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.priceText}>₪{item.estimatedPriceIls}</Text>
          <Text style={styles.distanceText}>{item.estimatedDistanceKm} km</Text>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.locationRow}>
            <Text style={styles.locationIcon}>📍</Text>
            <Text style={styles.locationText} numberOfLines={1}>
              {item.pickup.lat.toFixed(4)}, {item.pickup.lng.toFixed(4)}
            </Text>
          </View>
          <View style={styles.locationRow}>
            <Text style={styles.locationIcon}>🎯</Text>
            <Text style={styles.locationText} numberOfLines={1}>
              {item.dropoff.lat.toFixed(4)}, {item.dropoff.lng.toFixed(4)}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.durationText}>
            ~{Math.round(item.estimatedDurationMin)} min
          </Text>
          <Button
            title={isAccepting ? 'Accepting...' : 'Accept'}
            onPress={() => handleAccept(item.requestId)}
            disabled={isAccepting || acceptingId !== null}
            loading={isAccepting}
          />
        </View>
      </View>
    );
  }, [acceptingId, handleAccept]);

  // Empty state
  const renderEmpty = () => {
    if (isLoading) return null;

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📭</Text>
        <Text style={styles.emptyTitle}>No Trip Requests</Text>
        <Text style={styles.emptySubtitle}>
          New trip requests will appear here when passengers request rides
        </Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16213E" />
        <Text style={styles.loadingText}>Loading inbox...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trip Requests</Text>
        <Text style={styles.subtitle}>
          {inboxItems.length} pending request{inboxItems.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>❌ {error}</Text>
        </View>
      )}

      <FlatList
        data={inboxItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={inboxItems.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {}}
            tintColor="#16213E"
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#16213E',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#8E8E93',
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
    padding: 16,
    margin: 16,
    borderRadius: 10,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
  },
  list: {
    padding: 16,
  },
  emptyList: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  priceText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#34C759',
  },
  distanceText: {
    fontSize: 16,
    color: '#8E8E93',
    fontWeight: '600',
  },
  cardBody: {
    marginBottom: 12,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationIcon: {
    fontSize: 16,
    marginRight: 8,
    width: 24,
  },
  locationText: {
    fontSize: 14,
    color: '#1C1C1E',
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  durationText: {
    fontSize: 14,
    color: '#8E8E93',
  },
});
