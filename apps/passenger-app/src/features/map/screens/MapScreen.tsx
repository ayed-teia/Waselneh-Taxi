import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PassengerMapView } from '../PassengerMapView';
import { createTripRequest, estimateTrip } from '../../../services/api';
import { colors } from '../../../ui/theme';

const DEFAULT_PICKUP = { lat: 32.2211, lng: 35.2544 };
const DEFAULT_DESTINATION = { lat: 31.9038, lng: 35.2034 };

const QUICK_LOCATIONS = [
  { id: 'home', title: 'Home', subtitle: 'Saved address' },
  { id: 'work', title: 'Work', subtitle: 'Saved address' },
  { id: 'recent', title: 'Recent', subtitle: 'Last route' },
];

/**
 * Passenger map with a responsive, ride-hailing style action panel.
 */
export function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);

  const isCompact = height < 760;
  const panelWidth = Math.min(width - 20, 520);
  const sheetPaddingBottom = Math.max(14, insets.bottom + 8);

  const handleRequestTrip = useCallback(async () => {
    setIsCreatingTrip(true);

    try {
      const estimate = await estimateTrip(DEFAULT_PICKUP, DEFAULT_DESTINATION);
      const result = await createTripRequest(DEFAULT_PICKUP, DEFAULT_DESTINATION, estimate);

      if (result.status === 'matched' && result.tripId) {
        router.push({
          pathname: '/trip',
          params: {
            tripId: result.tripId,
          },
        });
        return;
      }

      router.push({
        pathname: '/searching',
        params: {
          requestId: result.requestId,
          distanceKm: estimate.distanceKm.toString(),
          durationMin: estimate.durationMin.toString(),
          priceIls: estimate.priceIls.toString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request trip.';
      console.error('[MapScreen] Trip request failed:', message);
      Alert.alert('Unable to request trip', message);
    } finally {
      setIsCreatingTrip(false);
    }
  }, [router]);

  const quickChips = useMemo(
    () =>
      QUICK_LOCATIONS.map((item) => (
        <TouchableOpacity key={item.id} style={styles.quickChip} activeOpacity={0.85}>
          <Text style={styles.quickChipTitle}>{item.title}</Text>
          <Text style={styles.quickChipSubtitle}>{item.subtitle}</Text>
        </TouchableOpacity>
      )),
    []
  );

  return (
    <View style={styles.container}>
      <PassengerMapView pickup={DEFAULT_PICKUP} dropoff={DEFAULT_DESTINATION} />

      <View style={styles.sheetLayer} pointerEvents="box-none">
        <View
          style={[
            styles.bottomSheet,
            {
              width: panelWidth,
              paddingBottom: sheetPaddingBottom,
              paddingHorizontal: isCompact ? 16 : 20,
              paddingTop: isCompact ? 10 : 14,
            },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Where to?</Text>
            <View style={styles.scheduleBadge}>
              <Text style={styles.scheduleBadgeText}>Now</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.searchBox} activeOpacity={0.9}>
            <View style={styles.searchDot} />
            <Text style={styles.searchPlaceholder}>Choose destination</Text>
          </TouchableOpacity>

          <View style={styles.quickChipsRow}>{quickChips}</View>

          <TouchableOpacity
            style={[styles.requestButton, isCreatingTrip && styles.requestButtonDisabled]}
            onPress={handleRequestTrip}
            disabled={isCreatingTrip}
            activeOpacity={0.9}
          >
            {isCreatingTrip ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.requestButtonText}>Matching driver...</Text>
              </>
            ) : (
              <>
                <View style={styles.requestButtonIndicator} />
                <Text style={styles.requestButtonText}>Request Ride</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#DDE7F7',
  },
  sheetLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
    gap: 14,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  scheduleBadge: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  scheduleBadgeText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 13,
  },
  searchBox: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  searchDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  searchPlaceholder: {
    color: '#475569',
    fontSize: 16,
    fontWeight: '500',
  },
  quickChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 2,
  },
  quickChipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  quickChipSubtitle: {
    fontSize: 11,
    color: '#64748B',
  },
  requestButton: {
    minHeight: 56,
    borderRadius: 15,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  requestButtonDisabled: {
    backgroundColor: '#64748B',
  },
  requestButtonIndicator: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#93C5FD',
  },
  requestButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});
