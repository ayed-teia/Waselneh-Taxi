import React, { useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TripStatus } from '@taxi-line/shared';
import { BottomSheetCard, StatusChip } from '@waselneh/ui';
import { Button } from '../../../ui';
import { completeTrip, driverArrived, startTrip } from '../../../services/api';
import { DriverMapView } from '../../map';
import { useDriverStore } from '../../../store';
import { TripChatMessage } from '../../../services/realtime';
import {
  LiveEtaCard,
  PassengerRatingCard,
  SafetyToolsCard,
  TripChatPanel,
  TripTimeline,
} from '../components';
import { useI18n } from '../../../localization';

interface ActiveTripScreenProps {
  tripId: string;
  status: TripStatus;
  estimatedPriceIls?: number;
  fareAmount?: number;
  paymentStatus?: 'pending' | 'paid';
  pickup?: { lat: number; lng: number };
  dropoff?: { lat: number; lng: number };
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
  onCallDispatch?: () => void;
  passengerRatingValue?: number;
  passengerRatingComment?: string;
  passengerLowRatingReason?: string | null;
  passengerRatingSubmitted?: boolean;
  isSubmittingPassengerRating?: boolean;
  onPassengerRatingChange?: (rating: number) => void;
  onPassengerRatingCommentChange?: (comment: string) => void;
  onPassengerLowRatingReasonSelect?: (reason: string) => void;
  onSubmitPassengerRating?: () => void;
  onTripCompleted: () => void;
}

function getStatusMeta(
  status: TripStatus,
  isRTL: boolean,
): { title: string; description: string; tone: 'neutral' | 'info' | 'success' | 'warning'; action: string | null } {
  switch (status) {
    case 'accepted':
      return {
        title: isRTL ? 'متجه إلى نقطة الالتقاط' : 'Heading to pickup',
        description: isRTL
          ? 'اتجه إلى موقع الراكب لتأكيد الوصول.'
          : 'Drive to the pickup point and confirm arrival.',
        tone: 'info',
        action: isRTL ? 'وصلت إلى الالتقاط' : 'Arrived at Pickup',
      };
    case 'driver_arrived':
      return {
        title: isRTL ? 'بانتظار الراكب' : 'Waiting for passenger',
        description: isRTL
          ? 'الراكب على نقطة الالتقاط. ابدأ الرحلة عند الصعود.'
          : 'Passenger is at pickup. Start the trip once boarded.',
        tone: 'success',
        action: isRTL ? 'ابدأ الرحلة' : 'Start Trip',
      };
    case 'in_progress':
      return {
        title: isRTL ? 'الرحلة قيد التنفيذ' : 'Trip in progress',
        description: isRTL
          ? 'تابع المسار نحو الوجهة ثم أنهِ الرحلة.'
          : 'Follow the route to destination and complete the trip.',
        tone: 'info',
        action: isRTL ? 'إنهاء الرحلة' : 'Complete Trip',
      };
    case 'completed':
      return {
        title: isRTL ? 'اكتملت الرحلة' : 'Trip completed',
        description: isRTL
          ? 'تحقق من الدفعة النهائية ثم انتقل للطلب التالي.'
          : 'Review the final fare and proceed to the next request.',
        tone: 'success',
        action: null,
      };
    default:
      return {
        title: isRTL ? 'تحديث الرحلة' : 'Trip update',
        description: isRTL ? 'تم تغيير حالة الرحلة.' : 'Trip status changed.',
        tone: 'neutral',
        action: null,
      };
  }
}

export function ActiveTripScreen({
  tripId,
  status,
  estimatedPriceIls,
  fareAmount,
  paymentStatus = 'pending',
  pickup,
  dropoff,
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
  onCallDispatch,
  passengerRatingValue = 0,
  passengerRatingComment = '',
  passengerLowRatingReason = null,
  passengerRatingSubmitted = false,
  isSubmittingPassengerRating = false,
  onPassengerRatingChange,
  onPassengerRatingCommentChange,
  onPassengerLowRatingReasonSelect,
  onSubmitPassengerRating,
  onTripCompleted,
}: ActiveTripScreenProps) {
  const { isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isNarrow = width < 400;
  const { currentLocation } = useDriverStore();
  const [isUpdating, setIsUpdating] = React.useState(false);

  const statusMeta = getStatusMeta(status, isRTL);
  const cardWidth = width >= 768 ? 560 : width;
  const topPadding = Math.max(74, insets.top + 52);
  const mapHeightRatio = isNarrow ? 0.6 : 0.64;
  const safeEstimatedFare = Number.isFinite(estimatedPriceIls ?? NaN) ? estimatedPriceIls : 0;
  const safeFareAmount = Number.isFinite(fareAmount ?? NaN) ? fareAmount : safeEstimatedFare;
  const hasAction =
    statusMeta.action != null &&
    (status === 'accepted' || status === 'driver_arrived' || status === 'in_progress');

  const routeMode =
    status === 'in_progress'
      ? 'toDropoff'
      : status === 'accepted' || status === 'driver_arrived'
        ? 'toPickup'
        : 'auto';

  const handleAction = useCallback(async () => {
    setIsUpdating(true);
    try {
      if (status === 'accepted') {
        await driverArrived(tripId);
      } else if (status === 'driver_arrived') {
        await startTrip(tripId);
      } else if (status === 'in_progress') {
        const result = await completeTrip(tripId);
        Alert.alert(
          isRTL ? 'اكتملت الرحلة' : 'Trip completed',
          `${isRTL ? 'الأجرة النهائية' : 'Final fare'}: ${isRTL ? '₪' : 'NIS '} ${result.finalPriceIls}`,
          [{ text: isRTL ? 'حسنًا' : 'OK', onPress: onTripCompleted }],
        );
        return;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : isRTL ? 'تعذر تحديث الرحلة' : 'Failed to update trip';
      Alert.alert(isRTL ? 'خطأ' : 'Error', message);
    } finally {
      setIsUpdating(false);
    }
  }, [isRTL, onTripCompleted, status, tripId]);

  const driverLocation = currentLocation
    ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
    : null;

  const showPassengerRating =
    status === 'completed' &&
    !passengerRatingSubmitted &&
    Boolean(
      onPassengerRatingChange &&
        onPassengerRatingCommentChange &&
        onPassengerLowRatingReasonSelect &&
        onSubmitPassengerRating,
    );

  return (
    <View style={styles.container}>
      <DriverMapView
        driverLocation={driverLocation}
        followUser
        pickup={pickup ?? null}
        dropoff={dropoff ?? null}
        routeMode={routeMode}
        mapHeightRatio={mapHeightRatio}
        overlayBottomOffset={16}
        showLegend={false}
        showControls={false}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <StatusChip
          label={statusMeta.title}
          tone={statusMeta.tone}
          style={[styles.statusChip, { marginTop: topPadding }]}
        />

        <BottomSheetCard
          withHandle
          style={[styles.bottomCard, { width: cardWidth, paddingBottom: Math.max(14, insets.bottom + 8) }]}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.title, isNarrow && styles.titleNarrow]}>{statusMeta.title}</Text>
            <Text style={styles.description}>{statusMeta.description}</Text>

            <View style={styles.divider} />

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{isRTL ? 'رقم الرحلة' : 'Trip ID'}</Text>
              <Text style={styles.metaValue}>{tripId.slice(0, 8)}...</Text>
            </View>

            <LiveEtaCard
              etaToPickupMin={etaToPickupMin}
              etaToDestinationMin={etaToDropoffMin}
              updatedAt={etaUpdatedAt}
            />

            <TripTimeline status={status} />

            {estimatedPriceIls != null ? (
              <View style={styles.metaRow}>
                <Text style={styles.fareLabel}>{isRTL ? 'الأجرة' : 'Fare'}</Text>
                <Text style={styles.fareValue}>{isRTL ? '₪' : 'NIS '} {safeEstimatedFare}</Text>
              </View>
            ) : null}

            {pickup ? (
              <Text style={styles.metaHint}>
                {isRTL ? 'الالتقاط' : 'Pickup'}: {pickup.lat.toFixed(4)}, {pickup.lng.toFixed(4)}
              </Text>
            ) : null}
            {dropoff ? (
              <Text style={styles.metaHint}>
                {isRTL ? 'الوصول' : 'Dropoff'}: {dropoff.lat.toFixed(4)}, {dropoff.lng.toFixed(4)}
              </Text>
            ) : null}

            {retryQueueCount > 0 ? (
              <View style={styles.retryBanner}>
                <Text style={styles.retryBannerText}>
                  {isRTL
                    ? `تم اكتشاف مشكلة شبكة. هناك ${retryQueueCount} إجراء بانتظار إعادة المحاولة.`
                    : `Network issue detected. ${retryQueueCount} action(s) waiting to retry.`}
                </Text>
                {onRetryQueue ? (
                  <Button title={isRTL ? 'إعادة الآن' : 'Retry now'} onPress={onRetryQueue} />
                ) : null}
              </View>
            ) : null}

            {onSendChat ? (
              <TripChatPanel
                messages={chatMessages}
                myRole="driver"
                onSend={onSendChat}
                sending={chatSending}
              />
            ) : null}

            {onShareTrip && onEmergencyCall && onCallDispatch ? (
              <SafetyToolsCard
                onShareTrip={onShareTrip}
                onEmergencyCall={onEmergencyCall}
                onCallDispatch={onCallDispatch}
              />
            ) : null}

            {showPassengerRating ? (
              <PassengerRatingCard
                rating={passengerRatingValue}
                comment={passengerRatingComment}
                lowRatingReason={passengerLowRatingReason}
                submitting={isSubmittingPassengerRating}
                onChangeRating={onPassengerRatingChange!}
                onChangeComment={onPassengerRatingCommentChange!}
                onSelectReason={onPassengerLowRatingReasonSelect!}
                onSubmit={onSubmitPassengerRating!}
              />
            ) : null}

            {hasAction && statusMeta.action ? (
              <View style={styles.actions}>
                <Button
                  title={isUpdating ? (isRTL ? 'جاري التحديث...' : 'Updating...') : statusMeta.action}
                  onPress={handleAction}
                  disabled={isUpdating}
                  loading={isUpdating}
                />
              </View>
            ) : null}

            {status === 'completed' && paymentStatus === 'pending' ? (
              <View style={styles.paymentBox}>
                <Text style={styles.paymentTitle}>
                  {isRTL ? 'استلم النقد من الراكب' : 'Collect cash from passenger'}
                </Text>
                <Text style={styles.paymentAmount}>{isRTL ? '₪' : 'NIS '} {safeFareAmount}</Text>
              </View>
            ) : null}
          </ScrollView>
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  bottomCard: {
    alignSelf: 'stretch',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '66%',
    gap: 10,
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
  metaHint: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748B',
  },
  retryBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCD34D',
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
    marginTop: 2,
    gap: 10,
  },
  paymentBox: {
    marginTop: 4,
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
