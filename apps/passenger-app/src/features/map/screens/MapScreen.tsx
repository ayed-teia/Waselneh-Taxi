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
import { BottomSheetCard, StatusChip } from '@waselneh/ui';
import { PassengerMapView } from '../PassengerMapView';
import { createTripRequest, estimateTrip } from '../../../services/api';
import { colors } from '../../../ui/theme';
import { SavedPlace, loadSavedPlaces } from '../../../services';
import { useI18n } from '../../../localization';
import { LanguageToggle } from '../../../ui';
import { BOOKING_TYPES, BookingType, VehicleType, VEHICLE_TYPES } from '@taxi-line/shared';

const DEFAULT_PICKUP = { lat: 32.2211, lng: 35.2544 };
const DEFAULT_DESTINATION = { lat: 31.9038, lng: 35.2034 };
const VEHICLE_TYPE_ORDER: VehicleType[] = [
  VEHICLE_TYPES.TAXI_STANDARD,
  VEHICLE_TYPES.FAMILY_VAN,
  VEHICLE_TYPES.MINIBUS,
  VEHICLE_TYPES.PREMIUM,
];

const BOOKING_TYPE_OPTIONS: Array<{ value: BookingType; labelEn: string; labelAr: string }> = [
  { value: BOOKING_TYPES.SEAT_ONLY, labelEn: 'One Seat', labelAr: 'مقعد واحد' },
  { value: BOOKING_TYPES.FULL_TAXI, labelEn: 'Full Taxi', labelAr: 'تكسي كامل' },
];

export function MapScreen() {
  const { isRTL } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(318);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<SavedPlace['id']>('favorite');
  const [selectedVehicleType, setSelectedVehicleType] = useState<VehicleType>(VEHICLE_TYPES.TAXI_STANDARD);
  const [bookingType, setBookingType] = useState<BookingType>(BOOKING_TYPES.SEAT_ONLY);

  const isCompact = height < 760;
  const panelWidth = width >= 768 ? 560 : width;
  const sheetPaddingBottom = Math.max(14, insets.bottom + 8);
  const mapOverlayBottom = sheetHeight + 14;

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

  const rideOptions = useMemo(
    () => ({
      bookingType,
      requiredSeats: 1,
      vehicleType: selectedVehicleType,
      ...(selectedPlace?.title ? { destinationLabel: selectedPlace.title } : {}),
      ...(selectedPlace?.subtitle ? { destinationCity: selectedPlace.subtitle } : {}),
    }),
    [bookingType, selectedPlace?.subtitle, selectedPlace?.title, selectedVehicleType]
  );

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
      Alert.alert(isRTL ? 'تعذّر طلب الرحلة' : 'Unable to request trip', message);
    } finally {
      setIsCreatingTrip(false);
    }
  }, [destination, isRTL, rideOptions, router]);

  const vehicleLabelByType = useMemo(
    () => ({
      [VEHICLE_TYPES.TAXI_STANDARD]: isRTL ? 'تاكسي عادي' : 'Standard',
      [VEHICLE_TYPES.FAMILY_VAN]: isRTL ? 'فان عائلي' : 'Family Van',
      [VEHICLE_TYPES.MINIBUS]: isRTL ? 'ميني باص' : 'Minibus',
      [VEHICLE_TYPES.PREMIUM]: isRTL ? 'مميز' : 'Premium',
    }),
    [isRTL]
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
            onPress={() => setSelectedPlaceId(item.id)}
          >
            <Text style={styles.quickChipTitle}>{item.title}</Text>
            <Text style={styles.quickChipSubtitle}>{item.subtitle}</Text>
          </TouchableOpacity>
        );
      }),
    [savedPlaces, selectedPlaceId]
  );

  return (
    <View style={styles.container}>
      <PassengerMapView
        pickup={DEFAULT_PICKUP}
        dropoff={destination}
        mapHeightRatio={0.64}
        overlayBottomOffset={mapOverlayBottom}
      />

      <View style={styles.sheetLayer} pointerEvents="box-none">
        <BottomSheetCard
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
            <View style={styles.headerTextWrap}>
              <Text style={styles.sheetTitle}>{isRTL ? 'إلى أين؟' : 'Where to?'}</Text>
              <Text style={styles.sheetSubtitle}>
                {isRTL ? 'احجز رحلتك خلال ثوانٍ.' : 'Book your ride in seconds.'}
              </Text>
            </View>
            <StatusChip
              label={isRTL ? 'حي الآن' : 'Live now'}
              tone="info"
              style={styles.statusChip}
            />
          </View>

          <TouchableOpacity style={[styles.searchBox, isRTL && styles.rowReverse]} activeOpacity={0.92}>
            <View style={styles.searchDot} />
            <Text style={styles.searchPlaceholder}>
              {isRTL ? 'الوجهة' : 'Destination'}: {selectedPlace?.title ?? (isRTL ? 'اختر وجهة' : 'Choose destination')}
            </Text>
          </TouchableOpacity>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{isRTL ? 'خيارات الرحلة' : 'Ride options'}</Text>
            <View style={[styles.chipsRow, isRTL && styles.rowReverse]}>
              {VEHICLE_TYPE_ORDER.map((vehicleType) => {
                const selected = selectedVehicleType === vehicleType;
                return (
                  <TouchableOpacity
                    key={vehicleType}
                    style={[styles.optionChip, selected && styles.optionChipSelected]}
                    onPress={() => setSelectedVehicleType(vehicleType)}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>
                      {vehicleLabelByType[vehicleType]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{isRTL ? 'نوع الحجز' : 'Booking type'}</Text>
            <View style={[styles.chipsRow, isRTL && styles.rowReverse]}>
              {BOOKING_TYPE_OPTIONS.map((option) => {
                const selected = bookingType === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.optionChip, selected && styles.optionChipSelected]}
                    onPress={() => setBookingType(option.value)}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>
                      {isRTL ? option.labelAr : option.labelEn}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.bookingTypeHint}>
              {bookingType === BOOKING_TYPES.FULL_TAXI
                ? isRTL
                  ? 'حجز التكسي الكامل يخصص كل المقاعد لك.'
                  : 'Full taxi reserves all seats for your trip.'
                : isRTL
                  ? 'سيتم حجز مقعد واحد فقط.'
                  : 'Only one seat will be reserved.'}
            </Text>
          </View>

          <View style={[styles.quickChipsRow, isRTL && styles.rowReverse]}>{quickChips}</View>

          <TouchableOpacity
            style={[styles.requestButton, isCreatingTrip && styles.requestButtonDisabled]}
            onPress={handleRequestTrip}
            disabled={isCreatingTrip}
            activeOpacity={0.92}
          >
            {isCreatingTrip ? (
              <>
                <ActivityIndicator size="small" color="#0F172A" />
                <Text style={styles.requestButtonText}>{isRTL ? 'جاري مطابقة سائق...' : 'Matching driver...'}</Text>
              </>
            ) : (
              <>
                <View style={styles.requestButtonIndicator} />
                <Text style={styles.requestButtonText}>{isRTL ? 'اطلب رحلة الآن' : 'Request ride now'}</Text>
              </>
            )}
          </TouchableOpacity>
        </BottomSheetCard>
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
    gap: 12,
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
  headerTextWrap: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.7,
  },
  sheetSubtitle: {
    marginTop: 2,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  statusChip: {
    marginTop: 6,
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
    color: '#334155',
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    padding: 10,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F8FAFC',
  },
  optionChipSelected: {
    borderColor: '#1D4ED8',
    backgroundColor: '#EFF6FF',
  },
  optionChipText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '700',
  },
  optionChipTextSelected: {
    color: '#1D4ED8',
  },
  bookingTypeHint: {
    fontSize: 12,
    lineHeight: 17,
    color: '#64748B',
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
    borderColor: '#1D4ED8',
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
    backgroundColor: '#F5C518',
    borderWidth: 1,
    borderColor: '#D89C05',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  requestButtonDisabled: {
    opacity: 0.72,
  },
  requestButtonIndicator: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#1D4ED8',
  },
  requestButtonText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 18,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
});
