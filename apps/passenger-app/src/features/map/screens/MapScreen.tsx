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
import { useI18n } from '../../../localization';
import { LanguageToggle } from '../../../ui';
import { VehicleType, VEHICLE_TYPES } from '@taxi-line/shared';

const DEFAULT_PICKUP = { lat: 32.2211, lng: 35.2544 };
const DEFAULT_DESTINATION = { lat: 31.9038, lng: 35.2034 };
const VEHICLE_TYPE_ORDER: VehicleType[] = [
  VEHICLE_TYPES.TAXI_STANDARD,
  VEHICLE_TYPES.FAMILY_VAN,
  VEHICLE_TYPES.MINIBUS,
  VEHICLE_TYPES.PREMIUM,
];
const SEAT_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

/**
 * Passenger map with a polished ride-hailing style bottom sheet.
 */
export function MapScreen() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(306);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<SavedPlace['id']>('favorite');
  const [selectedVehicleType, setSelectedVehicleType] = useState<VehicleType>(VEHICLE_TYPES.TAXI_STANDARD);
  const [requiredSeats, setRequiredSeats] = useState(1);

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
  const rideOptions = useMemo(
    () => ({
      requiredSeats,
      vehicleType: selectedVehicleType,
    }),
    [requiredSeats, selectedVehicleType]
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
      const estimate = await estimateTrip(DEFAULT_PICKUP, destination, rideOptions);
      const result = await createTripRequest(DEFAULT_PICKUP, destination, estimate, rideOptions);

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
      Alert.alert(isRTL ? 'تعذر طلب الرحلة' : 'Unable to request trip', message);
    } finally {
      setIsCreatingTrip(false);
    }
  }, [destination, isRTL, rideOptions, router]);

  const vehicleLabelByType = useMemo(
    () => ({
      [VEHICLE_TYPES.TAXI_STANDARD]: isRTL ? 'تاكسي عادي' : 'Standard',
      [VEHICLE_TYPES.FAMILY_VAN]: isRTL ? 'فان عائلي' : 'Family Van',
      [VEHICLE_TYPES.MINIBUS]: isRTL ? 'ميني باص' : 'Minibus',
      [VEHICLE_TYPES.PREMIUM]: isRTL ? 'بريميوم' : 'Premium',
    }),
    [isRTL]
  );

  const handleSelectPlace = useCallback(
    async (place: SavedPlace) => {
      setSelectedPlaceId(place.id);
      const nextPlaces = savedPlaces.map((item) =>
        item.id === place.id
          ? {
              ...item,
              subtitle: isRTL ? 'الوجهة المختارة' : 'Selected destination',
            }
          : {
              ...item,
              subtitle: item.id === 'favorite' ? (isRTL ? 'وجهة سريعة' : 'Quick destination') : isRTL ? 'عنوان محفوظ' : 'Saved address',
            }
      );
      setSavedPlaces(nextPlaces);
      try {
        await saveSavedPlaces(nextPlaces);
      } catch (error) {
        console.warn('Failed to persist saved places:', error);
      }
    },
    [isRTL, savedPlaces]
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

          <View style={[styles.topActionsRow, isRTL && styles.rowReverse]}>
            <LanguageToggle />
            <TouchableOpacity style={styles.topActionChip} onPress={() => router.push('/history')}>
              <Text style={styles.topActionText}>{isRTL ? 'السجل' : 'History'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.topActionChip} onPress={() => router.push('/promo')}>
              <Text style={styles.topActionText}>{isRTL ? 'العروض' : 'Promo'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.topActionChip} onPress={() => router.push('/support')}>
              <Text style={styles.topActionText}>{isRTL ? 'الدعم' : 'Support'}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.sheetHeaderRow, isRTL && styles.rowReverse]}>
            <View>
              <Text style={[styles.sheetTitle, { fontSize: titleFontSize, lineHeight: titleLineHeight }]}>
                {isRTL ? 'إلى أين؟' : 'Where to?'}
              </Text>
              <Text style={[styles.sheetSubtitle, { fontSize: subtitleFontSize }]}>
                {isRTL ? 'احجز رحلتك خلال ثوانٍ.' : 'Book a ride in seconds.'}
              </Text>
            </View>
            <View style={styles.scheduleBadge}>
              <Text style={styles.scheduleBadgeText}>{isRTL ? 'الآن' : 'Now'}</Text>
            </View>
          </View>

          <TouchableOpacity style={[styles.searchBox, isRTL && styles.rowReverse]} activeOpacity={0.92}>
            <View style={styles.searchDot} />
            <Text style={styles.searchPlaceholder}>
              {isRTL ? 'الوجهة' : 'Destination'}: {selectedPlace?.title ?? (isRTL ? 'اختر وجهة' : 'Choose destination')}
            </Text>
          </TouchableOpacity>

          <View style={styles.rideOptionsContainer}>
            <Text style={styles.rideOptionsTitle}>{isRTL ? 'خيارات الرحلة' : 'Ride options'}</Text>

            <View style={[styles.vehicleChipsRow, isRTL && styles.rowReverse]}>
              {VEHICLE_TYPE_ORDER.map((vehicleType) => {
                const selected = selectedVehicleType === vehicleType;
                return (
                  <TouchableOpacity
                    key={vehicleType}
                    style={[styles.vehicleChip, selected && styles.vehicleChipSelected]}
                    onPress={() => setSelectedVehicleType(vehicleType)}
                    activeOpacity={0.88}
                  >
                    <Text style={[styles.vehicleChipText, selected && styles.vehicleChipTextSelected]}>
                      {vehicleLabelByType[vehicleType]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.seatOptionsRow, isRTL && styles.rowReverse]}>
              <Text style={styles.seatOptionsLabel}>{isRTL ? 'عدد المقاعد' : 'Seats'}</Text>
              <View style={styles.seatChipsWrap}>
                {SEAT_OPTIONS.map((seat) => {
                  const selected = requiredSeats === seat;
                  return (
                    <TouchableOpacity
                      key={seat}
                      style={[styles.seatChip, selected && styles.seatChipSelected]}
                      onPress={() => setRequiredSeats(seat)}
                      activeOpacity={0.88}
                    >
                      <Text style={[styles.seatChipText, selected && styles.seatChipTextSelected]}>{seat}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={[styles.quickChipsRow, isRTL && styles.rowReverse]}>{quickChips}</View>

          <TouchableOpacity
            style={[styles.requestButton, isCreatingTrip && styles.requestButtonDisabled]}
            onPress={handleRequestTrip}
            disabled={isCreatingTrip}
            activeOpacity={0.9}
          >
            {isCreatingTrip ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.requestButtonText}>{isRTL ? 'جاري مطابقة سائق...' : 'Matching driver...'}</Text>
              </>
            ) : (
              <>
                <View style={styles.requestButtonIndicator} />
                <Text style={styles.requestButtonText}>{isRTL ? 'اطلب رحلة' : 'Request Ride'}</Text>
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
  rideOptionsContainer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    padding: 10,
    gap: 10,
  },
  rideOptionsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  vehicleChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  vehicleChip: {
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F8FAFC',
  },
  vehicleChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  vehicleChipText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  vehicleChipTextSelected: {
    color: '#1D4ED8',
  },
  seatOptionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  seatOptionsLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  seatChipsWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  seatChip: {
    minWidth: 34,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  seatChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#DBEAFE',
  },
  seatChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  seatChipTextSelected: {
    color: '#1D4ED8',
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
  rowReverse: {
    flexDirection: 'row-reverse',
  },
});
