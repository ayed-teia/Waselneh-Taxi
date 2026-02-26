import React, { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TripStatus } from '@taxi-line/shared';
import { PassengerMapView } from '../../map';
import { Button } from '../../../ui';
import { DriverLocation } from '../../../services/realtime';

interface LocationCoords {
  lat: number;
  lng: number;
}

interface ActiveTripScreenProps {
  tripId: string;
  status: TripStatus;
  estimatedPriceIls?: number;
  driverLocation?: DriverLocation | null;
  driverId?: string;
  pickup?: LocationCoords;
  dropoff?: LocationCoords;
  onCancel: () => void;
  onGoHome?: () => void;
  isCancelling?: boolean;
}

const DEFAULT_PICKUP = { lat: 32.2211, lng: 35.2544 };

function getStatusMeta(status: TripStatus): {
  title: string;
  description: string;
  tone: 'neutral' | 'info' | 'success' | 'warning';
} {
  switch (status) {
    case 'pending':
      return {
        title: 'Searching for driver',
        description: 'Please wait while we match you with a nearby driver.',
        tone: 'neutral',
      };
    case 'accepted':
      return {
        title: 'Driver assigned',
        description: 'Your driver is heading to the pickup point.',
        tone: 'info',
      };
    case 'driver_arrived':
      return {
        title: 'Driver arrived',
        description: 'Your driver is waiting at pickup.',
        tone: 'success',
      };
    case 'in_progress':
      return {
        title: 'On the way',
        description: 'Trip is in progress.',
        tone: 'info',
      };
    case 'completed':
      return {
        title: 'Trip completed',
        description: 'Thanks for riding with us.',
        tone: 'success',
      };
    case 'cancelled_by_passenger':
    case 'cancelled_by_driver':
    case 'cancelled_by_system':
    case 'no_driver_available':
      return {
        title: 'Trip ended',
        description: 'This trip is no longer active.',
        tone: 'warning',
      };
    default:
      return {
        title: 'Trip update',
        description: 'Status changed.',
        tone: 'neutral',
      };
  }
}

function toneColor(tone: 'neutral' | 'info' | 'success' | 'warning'): string {
  switch (tone) {
    case 'info':
      return '#2563EB';
    case 'success':
      return '#16A34A';
    case 'warning':
      return '#F59E0B';
    default:
      return '#334155';
  }
}

/**
 * Passenger active trip screen with live map and responsive bottom details sheet.
 */
export function ActiveTripScreen({
  tripId,
  status,
  estimatedPriceIls,
  driverLocation,
  driverId,
  pickup,
  dropoff,
  onCancel,
  onGoHome,
  isCancelling = false,
}: ActiveTripScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isNarrow = width < 390;
  const cardWidth = Math.min(width - 16, 560);
  const [cardHeight, setCardHeight] = useState(254);

  const meta = getStatusMeta(status);
  const canCancel = status === 'pending' || status === 'accepted';
  const isEnded =
    status === 'completed' ||
    status === 'cancelled_by_passenger' ||
    status === 'cancelled_by_driver' ||
    status === 'cancelled_by_system' ||
    status === 'no_driver_available';

  const tone = toneColor(meta.tone);
  const mappedPickup = pickup ?? DEFAULT_PICKUP;
  const topPadding = Math.max(74, insets.top + 52);
  const safeEstimatedFare = Number.isFinite(estimatedPriceIls ?? NaN) ? estimatedPriceIls : 0;
  const hasDriverCoordinates =
    Boolean(driverLocation) &&
    Number.isFinite(driverLocation?.lat) &&
    Number.isFinite(driverLocation?.lng);

  return (
    <View style={styles.container}>
      <PassengerMapView
        driverId={driverId}
        pickup={mappedPickup}
        dropoff={dropoff ?? null}
        overlayBottomOffset={cardHeight + 10}
        showLegend={false}
        showControls={false}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.statusPill, { borderColor: `${tone}33`, marginTop: topPadding }]}>
          <View style={[styles.statusDot, { backgroundColor: tone }]} />
          <Text style={styles.statusPillText}>{meta.title}</Text>
        </View>

        <View
          onLayout={(event) => {
            const nextHeight = Math.round(event.nativeEvent.layout.height);
            if (nextHeight > 0) {
              setCardHeight(nextHeight);
            }
          }}
          style={[styles.bottomCard, { width: cardWidth, paddingBottom: Math.max(14, insets.bottom + 8) }]}
        >
          <Text style={[styles.title, isNarrow && styles.titleNarrow]}>{meta.title}</Text>
          <Text style={styles.description}>{meta.description}</Text>

          <View style={styles.divider} />

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Trip ID</Text>
            <Text style={styles.metaValue}>{tripId.slice(0, 8)}...</Text>
          </View>

          {estimatedPriceIls != null ? (
            <View style={styles.metaRow}>
              <Text style={styles.fareLabel}>Fare</Text>
              <Text style={styles.fareValue}>NIS {safeEstimatedFare}</Text>
            </View>
          ) : null}

          {hasDriverCoordinates ? (
            <Text style={styles.driverLive}>
              Driver live: {driverLocation?.lat.toFixed(4)}, {driverLocation?.lng.toFixed(4)}
            </Text>
          ) : null}

          <View style={styles.actions}>
            {canCancel ? (
              <Button
                title={isCancelling ? 'Cancelling...' : 'Cancel Trip'}
                variant="outline"
                onPress={onCancel}
                loading={isCancelling}
                disabled={isCancelling}
              />
            ) : null}

            {isEnded && onGoHome ? <Button title="Back to Home" onPress={onGoHome} /> : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8EEF8',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 0.2,
  },
  bottomCard: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: 'rgba(248, 250, 252, 0.98)',
    paddingHorizontal: 16,
    paddingTop: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 10,
  },
  title: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  titleNarrow: {
    fontSize: 26,
    lineHeight: 30,
  },
  description: {
    marginTop: 4,
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 12,
  },
  metaRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  metaValue: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '700',
  },
  fareLabel: {
    fontSize: 17,
    color: '#0F172A',
    fontWeight: '700',
  },
  fareValue: {
    fontSize: 23,
    color: '#16A34A',
    fontWeight: '800',
  },
  driverLive: {
    marginTop: 6,
    fontSize: 12,
    color: '#64748B',
  },
  actions: {
    marginTop: 12,
    gap: 10,
  },
});
