import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TripStatus } from '@taxi-line/shared';
import { StatusChip } from '@waselneh/ui';
import { PassengerMapView } from '../../map';
import { Button } from '../../../ui';
import { DriverLocation, DriverProfile, TripChatMessage } from '../../../services/realtime';
import { LiveEtaCard, SafetyToolsCard, TripChatPanel, TripTimeline } from '../components';
import { useI18n } from '../../../localization';

interface LocationCoords {
  lat: number;
  lng: number;
}

interface ActiveTripScreenProps {
  tripId: string;
  status: TripStatus;
  estimatedPriceIls?: number;
  driverLocation?: DriverLocation | null;
  driverProfile?: DriverProfile | null;
  driverId?: string;
  pickup?: LocationCoords;
  dropoff?: LocationCoords;
  bookingType?: 'seat_only' | 'full_taxi';
  requestedSeats?: number;
  reservedSeats?: number;
  destinationLabel?: string | null;
  destinationCity?: string | null;
  etaToPickupMin?: number | null;
  etaToDropoffMin?: number | null;
  etaUpdatedAt?: Date | null;
  chatMessages?: TripChatMessage[];
  onSendChat?: (message: string, quickReply?: boolean) => void;
  chatSending?: boolean;
  retryQueueCount?: number;
  onRetryQueue?: () => void;
  onShareTrip?: () => void;
  onEmergencyCall?: () => void;
  onCallTrustedContact?: () => void;
  trustedContactLabel?: string;
  onCancel: () => void;
  onGoHome?: () => void;
  isCancelling?: boolean;
}

const DEFAULT_PICKUP = { lat: 32.2211, lng: 35.2544 };

function getStatusMeta(status: TripStatus, isRTL: boolean): {
  title: string;
  description: string;
  tone: 'neutral' | 'info' | 'success' | 'warning';
} {
  switch (status) {
    case 'pending':
      return {
        title: isRTL ? 'جاري البحث عن سائق' : 'Searching for driver',
        description: isRTL ? 'الرجاء الانتظار بينما نطابقك مع سائق قريب.' : 'Please wait while we match you with a nearby driver.',
        tone: 'neutral',
      };
    case 'accepted':
      return {
        title: isRTL ? 'تم تعيين السائق' : 'Driver assigned',
        description: isRTL ? 'السائق في طريقه إلى نقطة الالتقاط.' : 'Your driver is heading to the pickup point.',
        tone: 'info',
      };
    case 'driver_arrived':
      return {
        title: isRTL ? 'وصل السائق' : 'Driver arrived',
        description: isRTL ? 'السائق بانتظارك عند نقطة الالتقاط.' : 'Your driver is waiting at pickup.',
        tone: 'success',
      };
    case 'in_progress':
      return {
        title: isRTL ? 'في الطريق' : 'On the way',
        description: isRTL ? 'الرحلة قيد التنفيذ.' : 'Trip is in progress.',
        tone: 'info',
      };
    case 'completed':
      return {
        title: isRTL ? 'اكتملت الرحلة' : 'Trip completed',
        description: isRTL ? 'شكراً لاستخدامك وصلني.' : 'Thanks for riding with us.',
        tone: 'success',
      };
    case 'cancelled_by_passenger':
    case 'cancelled_by_driver':
    case 'cancelled_by_system':
    case 'no_driver_available':
      return {
        title: isRTL ? 'انتهت الرحلة' : 'Trip ended',
        description: isRTL ? 'هذه الرحلة لم تعد نشطة.' : 'This trip is no longer active.',
        tone: 'warning',
      };
    default:
      return {
        title: isRTL ? 'تحديث الرحلة' : 'Trip update',
        description: isRTL ? 'تم تغيير الحالة.' : 'Status changed.',
        tone: 'neutral',
      };
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
  driverProfile,
  driverId,
  pickup,
  dropoff,
  bookingType,
  requestedSeats,
  reservedSeats,
  destinationLabel,
  destinationCity,
  etaToPickupMin = null,
  etaToDropoffMin = null,
  etaUpdatedAt = null,
  chatMessages = [],
  onSendChat,
  chatSending = false,
  retryQueueCount = 0,
  onRetryQueue,
  onShareTrip,
  onEmergencyCall,
  onCallTrustedContact,
  trustedContactLabel = 'Trusted contact',
  onCancel,
  onGoHome,
  isCancelling = false,
}: ActiveTripScreenProps) {
  const { isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isNarrow = width < 390;
  const cardWidth = width >= 768 ? 560 : width;
  const [cardHeight, setCardHeight] = useState(300);

  const meta = getStatusMeta(status, isRTL);
  const canCancel = status === 'pending' || status === 'accepted';
  const isEnded =
    status === 'completed' ||
    status === 'cancelled_by_passenger' ||
    status === 'cancelled_by_driver' ||
    status === 'cancelled_by_system' ||
    status === 'no_driver_available';

  const mappedPickup = pickup ?? DEFAULT_PICKUP;
  const topPadding = Math.max(74, insets.top + 52);
  const safeEstimatedFare = Number.isFinite(estimatedPriceIls ?? NaN) ? estimatedPriceIls : 0;
  const mapHeightRatio = isNarrow ? 0.6 : 0.64;
  const hasDriverCoordinates =
    Boolean(driverLocation) &&
    Number.isFinite(driverLocation?.lat) &&
    Number.isFinite(driverLocation?.lng);
  const routeMode =
    status === 'in_progress'
      ? 'toDropoff'
      : status === 'accepted' || status === 'driver_arrived'
        ? 'toPickup'
        : 'auto';
  const driverName = driverProfile?.name || (isRTL ? 'السائق المعين' : 'Assigned driver');
  const driverInitial = driverName.slice(0, 1).toUpperCase();
  const ratingText =
    typeof driverProfile?.rating === 'number' ? driverProfile.rating.toFixed(1) : isRTL ? 'جديد' : 'New';
  const tripsText =
    typeof driverProfile?.completedTrips === 'number' ? `${driverProfile.completedTrips}` : '--';
  const vehicleText =
    [driverProfile?.vehicleModel, driverProfile?.plateNumber].filter(Boolean).join(' | ') ||
    (isRTL ? 'معلومات المركبة قيد التحديث' : 'Vehicle info pending');
  const bookingTypeLabel =
    bookingType === 'full_taxi'
      ? isRTL
        ? 'تكسي كامل'
        : 'Full taxi'
      : isRTL
        ? 'مقعد واحد'
        : 'One seat';
  const seatsLabel = (() => {
    if (bookingType === 'full_taxi') {
      return isRTL ? 'كل المقاعد محجوزة' : 'All seats reserved';
    }
    const seatCount =
      typeof reservedSeats === 'number' && Number.isFinite(reservedSeats)
        ? Math.max(1, Math.round(reservedSeats))
        : typeof requestedSeats === 'number' && Number.isFinite(requestedSeats)
          ? Math.max(1, Math.round(requestedSeats))
          : 1;
    return isRTL ? `${seatCount} مقعد` : `${seatCount} seat`;
  })();
  const routeText =
    [driverProfile?.lineNumber, driverProfile?.routePath || driverProfile?.routeName]
      .filter(Boolean)
      .join(' | ') || (isRTL ? 'المسار غير متاح' : 'Route not available');
  const vehicleTypeText = driverProfile?.vehicleType
    ? driverProfile.vehicleType
    : isRTL
      ? 'غير محدد'
      : 'N/A';
  const availableSeatsText =
    typeof driverProfile?.availableSeats === 'number'
      ? String(driverProfile.availableSeats)
      : isRTL
        ? 'غير متاح'
        : 'N/A';
  const destinationText =
    [destinationLabel, destinationCity].filter(Boolean).join(' | ') ||
    (isRTL ? 'غير محدد' : 'N/A');

  return (
    <View style={styles.container}>
      <PassengerMapView
        driverId={driverId}
        pickup={mappedPickup}
        dropoff={dropoff ?? null}
        routeMode={routeMode}
        mapHeightRatio={mapHeightRatio}
        overlayBottomOffset={cardHeight + 10}
        showLegend={false}
        showControls={false}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <StatusChip label={meta.title} tone={meta.tone === 'neutral' ? 'neutral' : meta.tone} style={[styles.statusChip, { marginTop: topPadding }]} />

        <View
          onLayout={(event) => {
            const nextHeight = Math.round(event.nativeEvent.layout.height);
            if (nextHeight > 0) {
              setCardHeight(nextHeight);
            }
          }}
          style={[styles.bottomCard, { width: cardWidth, paddingBottom: Math.max(14, insets.bottom + 8) }]}
        >
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={[styles.title, isNarrow && styles.titleNarrow]}>{meta.title}</Text>
            <Text style={styles.description}>{meta.description}</Text>

            <View style={styles.divider} />

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{isRTL ? 'رقم الرحلة' : 'Trip ID'}</Text>
              <Text style={styles.metaValue}>{tripId.slice(0, 8)}...</Text>
            </View>

            <LiveEtaCard
              etaToDriverMin={etaToPickupMin}
              etaToDestinationMin={etaToDropoffMin}
              updatedAt={etaUpdatedAt}
            />
            <TripTimeline status={status} />

            {(driverId || driverProfile) ? (
              <View style={styles.driverCard}>
                <View style={styles.driverHeader}>
                  {driverProfile?.photoUrl ? (
                    <Image source={{ uri: driverProfile.photoUrl }} style={styles.driverAvatar} />
                  ) : (
                    <View style={styles.driverAvatarFallback}>
                      <Text style={styles.driverAvatarInitial}>{driverInitial}</Text>
                    </View>
                  )}
                  <View style={styles.driverIdentity}>
                    <Text style={styles.driverName}>{driverName}</Text>
                    <Text style={styles.driverVehicle}>{vehicleText}</Text>
                  </View>
                </View>
                <View style={styles.driverMetaRow}>
                  <Text style={styles.driverMetaItem}>{isRTL ? `التقييم ${ratingText}` : `Rating ${ratingText}`}</Text>
                  <Text style={styles.driverMetaDivider}>|</Text>
                  <Text style={styles.driverMetaItem}>{isRTL ? `${tripsText} رحلة` : `${tripsText} trips`}</Text>
                </View>
                <View style={styles.driverFactsGrid}>
                  <View style={styles.driverFactItem}>
                    <Text style={styles.driverFactLabel}>{isRTL ? 'نوع الحجز' : 'Booking'}</Text>
                    <Text style={styles.driverFactValue}>{bookingTypeLabel}</Text>
                  </View>
                  <View style={styles.driverFactItem}>
                    <Text style={styles.driverFactLabel}>{isRTL ? 'المقاعد' : 'Seats'}</Text>
                    <Text style={styles.driverFactValue}>{seatsLabel}</Text>
                  </View>
                  <View style={styles.driverFactItem}>
                    <Text style={styles.driverFactLabel}>{isRTL ? 'الخط / المسار' : 'Line / Route'}</Text>
                    <Text style={styles.driverFactValue}>{routeText}</Text>
                  </View>
                  <View style={styles.driverFactItem}>
                    <Text style={styles.driverFactLabel}>{isRTL ? 'نوع المركبة' : 'Vehicle type'}</Text>
                    <Text style={styles.driverFactValue}>{vehicleTypeText}</Text>
                  </View>
                  <View style={styles.driverFactItem}>
                    <Text style={styles.driverFactLabel}>{isRTL ? 'المقاعد المتاحة الآن' : 'Live available seats'}</Text>
                    <Text style={styles.driverFactValue}>{availableSeatsText}</Text>
                  </View>
                  <View style={styles.driverFactItem}>
                    <Text style={styles.driverFactLabel}>{isRTL ? 'الوجهة' : 'Destination'}</Text>
                    <Text style={styles.driverFactValue}>{destinationText}</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {estimatedPriceIls != null ? (
              <View style={styles.metaRow}>
                <Text style={styles.fareLabel}>{isRTL ? 'الأجرة' : 'Fare'}</Text>
                <Text style={styles.fareValue}>{isRTL ? '₪' : 'NIS '} {safeEstimatedFare}</Text>
              </View>
            ) : null}

            {hasDriverCoordinates ? (
              <Text style={styles.driverLive}>
                {isRTL ? 'موقع السائق المباشر' : 'Driver live'}: {driverLocation?.lat.toFixed(4)}, {driverLocation?.lng.toFixed(4)}
              </Text>
            ) : null}

            {retryQueueCount > 0 ? (
              <View style={styles.retryBanner}>
                <Text style={styles.retryBannerText}>
                  {isRTL
                    ? `تم اكتشاف مشكلة شبكة. هناك ${retryQueueCount} إجراء بانتظار إعادة المحاولة.`
                    : `Network issue detected. ${retryQueueCount} action(s) waiting to retry.`}
                </Text>
                {onRetryQueue ? <Button title={isRTL ? 'إعادة الآن' : 'Retry now'} onPress={onRetryQueue} /> : null}
              </View>
            ) : null}

            {onSendChat ? (
              <TripChatPanel
                messages={chatMessages}
                myRole="passenger"
                onSend={onSendChat}
                sending={chatSending}
              />
            ) : null}

            {onShareTrip && onEmergencyCall && onCallTrustedContact ? (
              <SafetyToolsCard
                onShareTrip={onShareTrip}
                onEmergencyCall={onEmergencyCall}
                onCallTrustedContact={onCallTrustedContact}
                trustedContactLabel={trustedContactLabel}
              />
            ) : null}

            <View style={styles.actions}>
              {canCancel ? (
                <Button
                  title={isCancelling ? (isRTL ? 'جاري الإلغاء...' : 'Cancelling...') : isRTL ? 'إلغاء الرحلة' : 'Cancel Trip'}
                  variant="secondary"
                  onPress={onCancel}
                  loading={isCancelling}
                  disabled={isCancelling}
                />
              ) : null}

              {isEnded && onGoHome ? <Button title={isRTL ? 'العودة للرئيسية' : 'Back to Home'} onPress={onGoHome} /> : null}
            </View>
          </ScrollView>
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
  statusChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
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
    alignSelf: 'stretch',
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
    maxHeight: '66%',
  },
  scroll: {
    width: '100%',
  },
  scrollContent: {
    gap: 10,
    paddingBottom: 6,
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
    marginTop: 2,
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
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
    marginTop: 2,
    fontSize: 12,
    color: '#64748B',
  },
  driverCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  driverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  driverAvatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
  },
  driverAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarInitial: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  driverIdentity: {
    flex: 1,
    gap: 2,
  },
  driverName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  driverVehicle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  driverMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  driverMetaItem: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '700',
  },
  driverMetaDivider: {
    fontSize: 12,
    color: '#94A3B8',
  },
  driverFactsGrid: {
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
    gap: 6,
  },
  driverFactItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  driverFactLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  driverFactValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    color: '#334155',
    fontWeight: '700',
  },
  retryBanner: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  retryBannerText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '600',
  },
  actions: {
    marginTop: 4,
    gap: 10,
  },
});
