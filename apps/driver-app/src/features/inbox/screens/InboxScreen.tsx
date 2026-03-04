import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Text as UIText,
  getModeColors,
  waselnehRadius,
  waselnehShadows,
  waselnehSpacing,
} from '@waselneh/ui';
import { useAuthStore } from '../../../store';
import { InboxItem, subscribeToInbox } from '../../../services/realtime';
import { acceptTripRequest } from '../../../services/api';

/**
 * Driver inbox for pending trip requests.
 */
export function InboxScreen() {
  const router = useRouter();
  const colors = getModeColors('light');
  const { user } = useAuthStore();
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatVehicleType = (vehicleType: string | null | undefined): string => {
    if (!vehicleType) return '--';
    const labels: Record<string, string> = {
      taxi_standard: 'Standard',
      family_van: 'Family Van',
      minibus: 'Minibus',
      premium: 'Premium',
    };
    return labels[vehicleType] ?? vehicleType;
  };

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

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/home');
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: InboxItem }) => {
      const isAccepting = acceptingId === item.requestId;
      const estimatedDistanceKm =
        typeof item.estimatedDistanceKm === 'number' && Number.isFinite(item.estimatedDistanceKm)
          ? item.estimatedDistanceKm
          : null;
      const estimatedDurationMin =
        typeof item.estimatedDurationMin === 'number' && Number.isFinite(item.estimatedDurationMin)
          ? item.estimatedDurationMin
          : null;

      return (
        <Card elevated style={styles.card}>
          <View style={styles.cardHeader}>
            <UIText style={styles.priceText}>NIS {item.estimatedPriceIls ?? 0}</UIText>
            <UIText muted style={styles.distanceText}>
              {estimatedDistanceKm !== null ? `${estimatedDistanceKm.toFixed(1)} km` : '-- km'}
            </UIText>
          </View>

          <View style={styles.cardBody}>
            <UIText muted style={styles.coordLabel}>Pickup</UIText>
            <UIText style={styles.coordValue}>
              {item.pickup.lat.toFixed(4)}, {item.pickup.lng.toFixed(4)}
            </UIText>

            <UIText muted style={[styles.coordLabel, styles.coordLabelSpacer]}>
              Dropoff
            </UIText>
            <UIText style={styles.coordValue}>
              {item.dropoff.lat.toFixed(4)}, {item.dropoff.lng.toFixed(4)}
            </UIText>
          </View>

          <View style={styles.cardFooter}>
            <View style={styles.metaBlock}>
              <UIText muted style={styles.durationText}>
                {estimatedDurationMin !== null ? `~${Math.round(estimatedDurationMin)} min` : '--'}
              </UIText>
              <UIText muted style={styles.metaLine}>
                {`Seats: ${item.requiredSeats ?? '--'} • Vehicle: ${formatVehicleType(item.requestedVehicleType)}`}
              </UIText>
            </View>
            <Button
              title={isAccepting ? 'Accepting...' : 'Accept'}
              onPress={() => handleAccept(item.requestId)}
              disabled={isAccepting || acceptingId !== null}
              loading={isAccepting}
              style={styles.acceptButton}
            />
          </View>
        </Card>
      );
    },
    [acceptingId, handleAccept]
  );

  return (
    <View style={styles.container}>
      <Header
        title="Trip Requests"
        subtitle={`${inboxItems.length} pending request${inboxItems.length !== 1 ? 's' : ''}`}
        leftAction={
          <TouchableOpacity onPress={handleBack} style={styles.headerAction} activeOpacity={0.85}>
            <UIText style={styles.headerActionText}>{'< Back'}</UIText>
          </TouchableOpacity>
        }
      />

      {isLoading ? (
        <LoadingState title="Loading inbox..." />
      ) : error ? (
        <ErrorState
          title="Inbox error"
          message={error}
          onRetry={() => {
            setIsLoading(true);
            setError(null);
          }}
          style={styles.errorState}
        />
      ) : (
        <FlatList
          data={inboxItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={
            <EmptyState
              title="No trip requests"
              subtitle="New requests will appear here when passengers request rides."
              style={styles.emptyState}
            />
          }
          contentContainerStyle={inboxItems.length === 0 ? styles.emptyList : styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => {}} tintColor={colors.primary} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: getModeColors('light').background,
  },
  headerAction: {
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: waselnehSpacing.md,
    borderRadius: waselnehRadius.pill,
    borderWidth: 1,
    borderColor: getModeColors('light').border,
    backgroundColor: getModeColors('light').surface,
  },
  headerActionText: {
    fontWeight: '700',
    fontSize: 13,
  },
  errorState: {
    marginTop: -waselnehSpacing.sm,
  },
  list: {
    padding: waselnehSpacing.lg,
    paddingBottom: waselnehSpacing.xl,
  },
  emptyList: {
    flexGrow: 1,
    paddingHorizontal: waselnehSpacing.lg,
    paddingBottom: waselnehSpacing.lg,
  },
  emptyState: {
    marginTop: -waselnehSpacing.xl,
  },
  card: {
    marginBottom: waselnehSpacing.md,
    borderRadius: waselnehRadius.lg,
    ...waselnehShadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: waselnehSpacing.sm,
  },
  priceText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#16A34A',
  },
  distanceText: {
    fontWeight: '700',
    fontSize: 13,
  },
  cardBody: {
    borderWidth: 1,
    borderColor: getModeColors('light').border,
    borderRadius: waselnehRadius.md,
    backgroundColor: getModeColors('light').background,
    paddingVertical: waselnehSpacing.sm,
    paddingHorizontal: waselnehSpacing.md,
  },
  coordLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  coordLabelSpacer: {
    marginTop: waselnehSpacing.md,
  },
  coordValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '600',
  },
  cardFooter: {
    marginTop: waselnehSpacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: waselnehSpacing.md,
  },
  metaBlock: {
    flex: 1,
    gap: 2,
  },
  durationText: {
    fontSize: 13,
    fontWeight: '600',
  },
  metaLine: {
    fontSize: 12,
    fontWeight: '500',
  },
  acceptButton: {
    minWidth: 138,
  },
});
