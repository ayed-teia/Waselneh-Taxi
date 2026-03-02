import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
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
import { SavedPlace, loadSavedPlaces, saveSavedPlaces } from '../../../services';

const DEFAULT_PICKUP = { lat: 32.2211, lng: 35.2544 };
const DEFAULT_DESTINATION = { lat: 31.9038, lng: 35.2034 };

/**
 * Passenger map with a polished ride-hailing style bottom sheet.
 */
export function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(306);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<SavedPlace['id']>('favorite');

  const isCompact = height < 760;
  const isNarrow = width < 390;
  const panelWidth = width >= 768 ? 560 : width;
  const sheetPaddingBottom = Math.max(14, insets.bottom + 8);
  const mapOverlayBottom = sheetHeight + 14;
  const titleFontSize = isNarrow ? 34 : 40;
  const titleLineHeight = isNarrow ? 36 : 42;
  const subtitleFontSize = isNarrow ? 13 : 14;

  useEffect(() => {
    let mounted = true;
    loadSavedPlaces()
      .then((places) => {
        if (!mounted) return;
        setSavedPlaces(places);
        const hasSelected = places.some((place) => place.id === selectedPlaceId);
        if (!hasSelected && places[0]) {
          setSelectedPlaceId(places[0].id);
        }
      })
      .catch((error) => {
        console.error('Failed to load saved places:', error);
      });

    return () => {
      mounted = false;
    };
  }, [selectedPlaceId]);

  const selectedPlace = useMemo(
    () => savedPlaces.find((place) => place.id === selectedPlaceId) ?? null,
    [savedPlaces, selectedPlaceId]
  );

  const destination = selectedPlace
    ? { lat: selectedPlace.lat, lng: selectedPlace.lng }
    : DEFAULT_DESTINATION;

  const handleSheetLayout = (event: LayoutChangeEvent) => {
    const measuredHeight = event.nativeEvent.layout.height;
    if (measuredHeight > 0) {
      setSheetHeight(Math.round(measuredHeight));
    }
  };

  const handleRequestTrip = useCallback(async () => {
    setIsCreatingTrip(true);
    try {
      const estimate = await estimateTrip(DEFAULT_PICKUP, destination);
      const result = await createTripRequest(DEFAULT_PICKUP, destination, estimate);

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
          pickupLat: DEFAULT_PICKUP.lat.toString(),
          pickupLng: DEFAULT_PICKUP.lng.toString(),
          dropoffLat: destination.lat.toString(),
          dropoffLng: destination.lng.toString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request trip.';
      console.error('[MapScreen] Trip request failed:', message);
      Alert.alert('Unable to request trip', message);
    } finally {
      setIsCreatingTrip(false);
    }
  }, [destination, router]);

  const handleSelectPlace = useCallback(
    async (place: SavedPlace) => {
      setSelectedPlaceId(place.id);
      const nextPlaces = savedPlaces.map((item) =>
        item.id === place.id
          ? {
              ...item,
              subtitle: 'Selected destination',
            }
          : {
              ...item,
              subtitle: item.id === 'favorite' ? 'Quick destination' : 'Saved address',
            }
      );
      setSavedPlaces(nextPlaces);
      try {
        await saveSavedPlaces(nextPlaces);
      } catch (error) {
        console.warn('Failed to persist saved places:', error);
      }
    },
    [savedPlaces]
  );

  const quickChips = useMemo(
    () =>
      savedPlaces.map((item) => {
        const selected = item.id === selectedPlaceId;
        return (
          <TouchableOpacity
            key={item.id}
            style={[styles.quickChip, selected && styles.quickChipSelected]}
            activeOpacity={0.9}
            onPress={() => handleSelectPlace(item)}
          >
            <Text style={styles.quickChipTitle}>{item.title}</Text>
            <Text style={styles.quickChipSubtitle}>{item.subtitle}</Text>
          </TouchableOpacity>
        );
      }),
    [savedPlaces, selectedPlaceId, handleSelectPlace]
  );

  return (
    <View style={styles.container}>
      <PassengerMapView
        pickup={DEFAULT_PICKUP}
        dropoff={destination}
        mapHeightRatio={0.52}
        overlayBottomOffset={mapOverlayBottom}
      />

      <View style={styles.sheetLayer} pointerEvents="box-none">
        <View
          onLayout={handleSheetLayout}
          style={[
            styles.bottomSheet,
            {
              width: panelWidth,
              maxWidth: 560,
              paddingBottom: sheetPaddingBottom,
              paddingHorizontal: isCompact ? 14 : 18,
              paddingTop: isCompact ? 10 : 14,
            },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.topActionsRow}>
            <TouchableOpacity style={styles.topActionChip} onPress={() => router.push('/history')}>
              <Text style={styles.topActionText}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.topActionChip} onPress={() => router.push('/promo')}>
              <Text style={styles.topActionText}>Promo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.topActionChip} onPress={() => router.push('/support')}>
              <Text style={styles.topActionText}>Support</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.sheetHeaderRow}>
            <View>
              <Text style={[styles.sheetTitle, { fontSize: titleFontSize, lineHeight: titleLineHeight }]}>
                Where to?
              </Text>
              <Text style={[styles.sheetSubtitle, { fontSize: subtitleFontSize }]}>Book a ride in seconds.</Text>
            </View>
            <View style={styles.scheduleBadge}>
              <Text style={styles.scheduleBadgeText}>Now</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.searchBox} activeOpacity={0.92}>
            <View style={styles.searchDot} />
            <Text style={styles.searchPlaceholder}>Destination: {selectedPlace?.title ?? 'Choose destination'}</Text>
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
    paddingHorizontal: 0,
  },
  bottomSheet: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(248, 250, 252, 0.98)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 10,
    gap: 14,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
  },
  topActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  topActionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  topActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    fontSize: 40,
    lineHeight: 42,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.8,
  },
  sheetSubtitle: {
    marginTop: 2,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
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
    backgroundColor: '#EEF2F7',
    borderWidth: 1,
    borderColor: '#DDE3F0',
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
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 2,
  },
  quickChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  quickChipTitle: {
    fontSize: 16,
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
    fontSize: 18,
  },
});
