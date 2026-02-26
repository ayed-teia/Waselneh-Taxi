import React, { useCallback } from 'react';
import { Alert, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TripStatus } from '@taxi-line/shared';
import { Button } from '../../../ui';
import { completeTrip, driverArrived, startTrip } from '../../../services/api';
import { DriverMapView } from '../../map';
import { useDriverStore } from '../../../store';

interface ActiveTripScreenProps {
  tripId: string;
  status: TripStatus;
  estimatedPriceIls?: number;
  fareAmount?: number;
  paymentStatus?: 'pending' | 'paid';
  pickup?: { lat: number; lng: number };
  dropoff?: { lat: number; lng: number };
  onTripCompleted: () => void;
}

function getStatusMeta(status: TripStatus): { title: string; description: string; tone: string; action: string | null } {
  switch (status) {
    case 'accepted':
      return {
        title: 'Heading to pickup',
        description: 'Drive to passenger pickup location.',
        tone: '#2563EB',
        action: 'Arrived at Pickup',
      };
    case 'driver_arrived':
      return {
        title: 'Waiting for passenger',
        description: 'Passenger is expected at pickup.',
        tone: '#16A34A',
        action: 'Start Trip',
      };
    case 'in_progress':
      return {
        title: 'Trip in progress',
        description: 'Follow route to destination.',
        tone: '#2563EB',
        action: 'Complete Trip',
      };
    case 'completed':
      return {
        title: 'Trip completed',
        description: 'Collect payment and close trip.',
        tone: '#16A34A',
        action: null,
      };
    default:
      return {
        title: 'Trip update',
        description: 'Status changed.',
        tone: '#334155',
        action: null,
      };
  }
}

/**
 * Driver active trip screen with live map + professional action sheet.
 */
export function ActiveTripScreen({
  tripId,
  status,
  estimatedPriceIls,
  fareAmount,
  paymentStatus = 'pending',
  pickup,
  dropoff,
  onTripCompleted,
}: ActiveTripScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isNarrow = width < 390;
  const { currentLocation } = useDriverStore();
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [cardHeight, setCardHeight] = React.useState(252);

  const cardWidth = Math.min(width - 16, 560);
  const statusMeta = getStatusMeta(status);
  const hasAction = statusMeta.action != null && (status === 'accepted' || status === 'driver_arrived' || status === 'in_progress');
  const topPadding = Math.max(74, insets.top + 52);
  const safeEstimatedFare = Number.isFinite(estimatedPriceIls ?? NaN) ? estimatedPriceIls : 0;
  const safeFareAmount = Number.isFinite(fareAmount ?? NaN) ? fareAmount : safeEstimatedFare;

  const handleAction = useCallback(async () => {
    setIsUpdating(true);
    try {
      if (status === 'accepted') {
        await driverArrived(tripId);
      } else if (status === 'driver_arrived') {
        await startTrip(tripId);
      } else if (status === 'in_progress') {
        const result = await completeTrip(tripId);
        Alert.alert('Trip completed', `Final fare: NIS ${result.finalPriceIls}`, [
          { text: 'OK', onPress: onTripCompleted },
        ]);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update trip';
      Alert.alert('Error', message);
    } finally {
      setIsUpdating(false);
    }
  }, [status, tripId, onTripCompleted]);

  const driverLocation = currentLocation
    ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
    : null;

  return (
    <View style={styles.container}>
      <DriverMapView
        driverLocation={driverLocation}
        followUser
        overlayBottomOffset={cardHeight + 10}
        showLegend={false}
        showControls={false}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.statusPill, { borderColor: `${statusMeta.tone}33`, marginTop: topPadding }]}>
          <View style={[styles.statusDot, { backgroundColor: statusMeta.tone }]} />
          <Text style={styles.statusPillText}>{statusMeta.title}</Text>
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
          <Text style={[styles.title, isNarrow && styles.titleNarrow]}>{statusMeta.title}</Text>
          <Text style={styles.description}>{statusMeta.description}</Text>

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

          {pickup ? (
            <Text style={styles.metaHint}>Pickup: {pickup.lat.toFixed(4)}, {pickup.lng.toFixed(4)}</Text>
          ) : null}
          {dropoff ? (
            <Text style={styles.metaHint}>Dropoff: {dropoff.lat.toFixed(4)}, {dropoff.lng.toFixed(4)}</Text>
          ) : null}

          {hasAction && statusMeta.action ? (
            <View style={styles.actions}>
              <Button
                title={isUpdating ? 'Updating...' : statusMeta.action}
                onPress={handleAction}
                disabled={isUpdating}
                loading={isUpdating}
              />
            </View>
          ) : null}

          {status === 'completed' && paymentStatus === 'pending' ? (
            <View style={styles.paymentBox}>
              <Text style={styles.paymentTitle}>Collect cash from passenger</Text>
              <Text style={styles.paymentAmount}>NIS {safeFareAmount}</Text>
            </View>
          ) : null}
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
  metaHint: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748B',
  },
  actions: {
    marginTop: 12,
    gap: 10,
  },
  paymentBox: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  paymentTitle: {
    fontSize: 13,
    color: '#166534',
    fontWeight: '700',
  },
  paymentAmount: {
    marginTop: 2,
    fontSize: 24,
    color: '#166534',
    fontWeight: '800',
  },
});
