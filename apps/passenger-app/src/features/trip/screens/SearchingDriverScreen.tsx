import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PassengerMapView } from '../../map';
import { Button } from '../../../ui';
import { subscribeToTripRequest } from '../../../services/realtime';
import { useI18n } from '../../../localization';

interface SearchingDriverScreenProps {
  requestId: string;
  onCancel: () => void;
  onDriverAssigned: (tripId: string) => void;
  onRequestEnded?: (status: 'expired' | 'cancelled') => void;
  cancelling?: boolean;
  distanceKm: number;
  durationMin: number;
  priceIls: number;
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
}

export function SearchingDriverScreen({
  requestId,
  onCancel,
  onDriverAssigned,
  onRequestEnded,
  cancelling = false,
  distanceKm,
  durationMin,
  priceIls,
  pickup,
  dropoff,
}: SearchingDriverScreenProps) {
  const { isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = width >= 768 ? 560 : width;

  const [dots, setDots] = useState('');
  const [isMatched, setIsMatched] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState<'expired' | 'cancelled' | null>(null);
  const [cardHeight, setCardHeight] = useState(236);
  const [pulseAnim] = useState(new Animated.Value(1));

  const isMatchedRef = useRef(false);
  const terminalStatusRef = useRef<'expired' | 'cancelled' | null>(null);

  const safeDistance = Number.isFinite(distanceKm) ? distanceKm : 0;
  const safeDuration = Number.isFinite(durationMin) ? durationMin : 0;
  const safePrice = Number.isFinite(priceIls) ? priceIls : 0;
  const overlayBottomOffset = cardHeight + 10;
  const topPadding = Math.max(74, insets.top + 52);

  useEffect(() => {
    isMatchedRef.current = isMatched;
  }, [isMatched]);

  useEffect(() => {
    terminalStatusRef.current = terminalStatus;
  }, [terminalStatus]);

  useEffect(() => {
    const unsubscribe = subscribeToTripRequest(
      requestId,
      (request) => {
        if (request?.status === 'matched' && request.matchedTripId) {
          if (terminalStatusRef.current || isMatchedRef.current) {
            return;
          }
          setIsMatched(true);
          setTimeout(() => {
            onDriverAssigned(request.matchedTripId as string);
          }, 500);
          return;
        }

        if (request?.status === 'expired' || request?.status === 'cancelled') {
          setTerminalStatus(request.status);
          setIsMatched(false);
        }
      },
      (error) => {
        console.error('Error subscribing to trip request:', error);
      }
    );

    return () => unsubscribe();
  }, [requestId, onDriverAssigned]);

  useEffect(() => {
    if (!terminalStatus || !onRequestEnded) {
      return;
    }
    onRequestEnded(terminalStatus);
  }, [onRequestEnded, terminalStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : `${prev}.`));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.12,
          duration: 780,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 780,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const title = isMatched
    ? isRTL
      ? 'تم تعيين السائق'
      : 'Driver assigned'
    : terminalStatus === 'expired'
      ? isRTL
        ? 'لم يتم العثور على سائق'
        : 'No driver found'
      : terminalStatus === 'cancelled'
        ? isRTL
          ? 'انتهى الطلب'
          : 'Request ended'
        : isRTL
          ? 'جارٍ البحث عن سائق'
          : 'Searching for driver';

  const subtitle = isMatched
    ? isRTL
      ? 'السائق في الطريق إلى نقطة الالتقاط.'
      : 'Your driver is heading to pickup.'
    : terminalStatus === 'expired'
      ? isRTL
        ? 'لم نجد سائقاً متوافقاً ضمن المهلة المحددة.'
        : 'We could not find a compatible driver in time.'
      : terminalStatus === 'cancelled'
        ? isRTL
          ? 'الطلب لم يعد نشطاً.'
          : 'This request is no longer active.'
        : isRTL
          ? 'نطابقك مع أقرب سائق متاح.'
          : 'Matching you with the nearest available driver.';

  return (
    <View style={styles.container}>
      <PassengerMapView
        pickup={pickup}
        dropoff={dropoff}
        routeMode={isMatched ? 'toPickup' : 'auto'}
        mapHeightRatio={0.64}
        overlayBottomOffset={overlayBottomOffset}
        showLegend={false}
        showControls={false}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.topBadge, { marginTop: topPadding }]}>
          <Text style={styles.topBadgeText}>
            {isMatched
              ? isRTL
                ? 'السائق في الطريق'
                : 'Driver on the way'
              : terminalStatus === 'expired'
                ? isRTL
                  ? 'لم يتوفر سائق'
                  : 'No driver available'
                : terminalStatus === 'cancelled'
                  ? isRTL
                    ? 'تم إنهاء الطلب'
                    : 'Request ended'
                  : `${isRTL ? 'جارٍ البحث' : `Searching${dots}`}`}
          </Text>
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
          <View style={styles.cardHeader}>
            <Animated.View
              style={[
                styles.iconWrap,
                { transform: [{ scale: isMatched || terminalStatus ? 1 : pulseAnim }] },
                isMatched && styles.iconWrapMatched,
                terminalStatus && styles.iconWrapEnded,
              ]}
            >
              <Text style={styles.iconText}>
                {isMatched ? 'OK' : terminalStatus ? 'END' : 'CAB'}
              </Text>
            </Animated.View>
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            {!isMatched && !terminalStatus ? <ActivityIndicator size="small" color="#1D4ED8" /> : null}
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{isRTL ? 'المسافة' : 'Distance'}</Text>
              <Text style={styles.summaryValue}>{safeDistance.toFixed(1)} km</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{isRTL ? 'الوقت المتوقع' : 'ETA'}</Text>
              <Text style={styles.summaryValue}>
                {safeDuration < 60
                  ? `${Math.round(safeDuration)} min`
                  : `${Math.floor(safeDuration / 60)}h ${Math.round(safeDuration % 60)}m`}
              </Text>
            </View>
            <View style={[styles.summaryRow, styles.summaryRowNoBorder]}>
              <Text style={styles.fareLabel}>{isRTL ? 'الأجرة' : 'Fare'}</Text>
              <Text style={styles.fareValue}>NIS {safePrice}</Text>
            </View>
          </View>

          {!isMatched ? (
            <Button
              title={
                terminalStatus
                  ? isRTL
                    ? 'العودة للرئيسية'
                    : 'Back to Home'
                  : cancelling
                    ? isRTL
                      ? 'جارٍ الإلغاء...'
                      : 'Cancelling...'
                    : isRTL
                      ? 'إلغاء الطلب'
                      : 'Cancel Trip'
              }
              variant="outline"
              onPress={onCancel}
              disabled={cancelling}
            />
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
    paddingBottom: 0,
  },
  topBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  topBadgeText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
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
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  iconWrapMatched: {
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
  },
  iconWrapEnded: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  iconText: {
    fontSize: 11,
    color: '#1E3A8A',
    fontWeight: '800',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748B',
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  summaryRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  summaryRowNoBorder: {
    borderBottomWidth: 0,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 15,
    color: '#0F172A',
    fontWeight: '700',
  },
  fareLabel: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '700',
  },
  fareValue: {
    fontSize: 22,
    color: '#16A34A',
    fontWeight: '800',
  },
});
