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
  StatusChip,
  Text as UIText,
  getModeColors,
  waselnehRadius,
  waselnehShadows,
  waselnehSpacing,
} from '@waselneh/ui';
import { useAuthStore } from '../../../store';
import { InboxItem, subscribeToInbox } from '../../../services/realtime';
import { acceptTripRequest } from '../../../services/api';
import { useI18n } from '../../../localization';

export function InboxScreen() {
  const router = useRouter();
  const colors = getModeColors('light');
  const { user } = useAuthStore();
  const { isRTL } = useI18n();
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatVehicleType = (vehicleType: string | null | undefined): string => {
    if (!vehicleType) return '--';
    const labels: Record<string, string> = {
      taxi_standard: isRTL ? 'تاكسي عادي' : 'Standard',
      family_van: isRTL ? 'فان عائلي' : 'Family Van',
      minibus: isRTL ? 'ميني باص' : 'Minibus',
      premium: isRTL ? 'مميز' : 'Premium',
    };
    return labels[vehicleType] ?? vehicleType;
  };

  const formatBookingType = (bookingType: InboxItem['bookingType']): string => {
    if (bookingType === 'full_taxi') return isRTL ? 'تكسي كامل' : 'Full Taxi';
    if (bookingType === 'seat_only') return isRTL ? 'مقعد واحد' : 'One Seat';
    return '--';
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
        setError(isRTL ? 'تعذّر تحميل طلبات الرحلات' : 'Failed to load trip requests');
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [isRTL, user?.uid]);

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
        const message = err instanceof Error ? err.message : isRTL ? 'تعذّر قبول الطلب' : 'Failed to accept trip';
        Alert.alert(isRTL ? 'خطأ' : 'Error', message);
      } finally {
        setAcceptingId(null);
      }
    },
    [isRTL, router]
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
            <View style={styles.headerMeta}>
              <UIText style={styles.priceText}>NIS {item.estimatedPriceIls ?? 0}</UIText>
              <UIText muted style={styles.distanceText}>
                {estimatedDistanceKm !== null ? `${estimatedDistanceKm.toFixed(1)} km` : '-- km'}
              </UIText>
            </View>
            <StatusChip label={isRTL ? 'طلب جديد' : 'New request'} tone="warning" />
          </View>

          <View style={styles.cardBody}>
            <View style={styles.coordRow}>
              <UIText muted style={styles.coordLabel}>{isRTL ? 'الالتقاط' : 'Pickup'}</UIText>
              <UIText style={styles.coordValue}>
                {item.pickup.lat.toFixed(4)}, {item.pickup.lng.toFixed(4)}
              </UIText>
            </View>
            <View style={styles.coordRow}>
              <UIText muted style={styles.coordLabel}>{isRTL ? 'الوجهة' : 'Dropoff'}</UIText>
              <UIText style={styles.coordValue}>
                {item.dropoff.lat.toFixed(4)}, {item.dropoff.lng.toFixed(4)}
              </UIText>
            </View>
          </View>

          <View style={styles.metaBlock}>
            <UIText muted style={styles.durationText}>
              {estimatedDurationMin !== null
                ? isRTL
                  ? `حوالي ${Math.round(estimatedDurationMin)} دقيقة`
                  : `~${Math.round(estimatedDurationMin)} min`
                : '--'}
            </UIText>
            <UIText muted style={styles.metaLine}>
              {isRTL ? 'نوع الحجز' : 'Booking'}: {formatBookingType(item.bookingType)}
              {'  |  '}
              {isRTL ? 'المقاعد' : 'Seats'}: {item.requestedSeats ?? item.requiredSeats ?? '--'}
            </UIText>
            <UIText muted style={styles.metaLine}>
              {isRTL ? 'نوع المركبة' : 'Vehicle'}: {formatVehicleType(item.requestedVehicleType)}
            </UIText>
            {(item.destinationLabel || item.destinationCity) ? (
              <UIText muted style={styles.metaLine}>
                {isRTL ? 'معلومة الوجهة' : 'Destination'}: {item.destinationLabel ?? '--'}
                {item.destinationCity ? ` | ${item.destinationCity}` : ''}
              </UIText>
            ) : null}
          </View>

          <Button
            title={isAccepting ? (isRTL ? 'جارٍ القبول...' : 'Accepting...') : isRTL ? 'قبول الطلب' : 'Accept request'}
            onPress={() => handleAccept(item.requestId)}
            disabled={isAccepting || acceptingId !== null}
            loading={isAccepting}
            style={styles.acceptButton}
          />
        </Card>
      );
    },
    [acceptingId, handleAccept, isRTL]
  );

  return (
    <View style={styles.container}>
      <Header
        title={isRTL ? 'صندوق الطلبات' : 'Trip Requests'}
        subtitle={isRTL ? `${inboxItems.length} طلب بانتظارك` : `${inboxItems.length} pending request${inboxItems.length !== 1 ? 's' : ''}`}
        leftAction={
          <TouchableOpacity onPress={handleBack} style={styles.headerAction} activeOpacity={0.85}>
            <UIText style={styles.headerActionText}>{isRTL ? 'عودة' : '< Back'}</UIText>
          </TouchableOpacity>
        }
      />

      {isLoading ? (
        <LoadingState title={isRTL ? 'جارٍ تحميل الطلبات...' : 'Loading inbox...'} />
      ) : error ? (
        <ErrorState
          title={isRTL ? 'خطأ في الصندوق' : 'Inbox error'}
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
              title={isRTL ? 'لا توجد طلبات حالياً' : 'No trip requests'}
              subtitle={isRTL ? 'ستظهر الطلبات الجديدة هنا فور وصولها.' : 'New requests will appear here as soon as they arrive.'}
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
    paddingBottom: waselnehSpacing.xxl,
    gap: waselnehSpacing.sm,
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
    borderRadius: waselnehRadius.xl,
    ...waselnehShadows.sm,
    gap: waselnehSpacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  headerMeta: {
    gap: 2,
  },
  priceText: {
    fontSize: 24,
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
    backgroundColor: getModeColors('light').surfaceMuted,
    paddingVertical: waselnehSpacing.sm,
    paddingHorizontal: waselnehSpacing.md,
    gap: 10,
  },
  coordRow: {
    gap: 3,
  },
  coordLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  coordValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  metaBlock: {
    gap: 3,
  },
  durationText: {
    fontSize: 13,
    fontWeight: '700',
  },
  metaLine: {
    fontSize: 12,
    fontWeight: '500',
  },
  acceptButton: {
    marginTop: 2,
  },
});
