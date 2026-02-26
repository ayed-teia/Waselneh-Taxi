import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PassengerMapView } from '../../map';
import { Button } from '../../../ui';
import { subscribeToTripRequest } from '../../../services/realtime';

interface SearchingDriverScreenProps {
  requestId: string;
  onCancel: () => void;
  onDriverAssigned: (tripId: string) => void;
  distanceKm: number;
  durationMin: number;
  priceIls: number;
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
}

/**
 * Searching state with live map background and a responsive booking card.
 */
export function SearchingDriverScreen({
  requestId,
  onCancel,
  onDriverAssigned,
  distanceKm,
  durationMin,
  priceIls,
  pickup,
  dropoff,
}: SearchingDriverScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 16, 560);
  const [dots, setDots] = useState('');
  const [isMatched, setIsMatched] = useState(false);
  const [pulseAnim] = useState(new Animated.Value(1));
  const [cardHeight, setCardHeight] = useState(236);
  const safeDistance = Number.isFinite(distanceKm) ? distanceKm : 0;
  const safeDuration = Number.isFinite(durationMin) ? durationMin : 0;
  const safePrice = Number.isFinite(priceIls) ? priceIls : 0;
  const overlayBottomOffset = cardHeight + 10;
  const topPadding = Math.max(74, insets.top + 52);

  useEffect(() => {
    const unsubscribe = subscribeToTripRequest(
      requestId,
      (request) => {
        if (request?.status === 'matched' && request.matchedTripId) {
          setIsMatched(true);
          setTimeout(() => {
            onDriverAssigned(request.matchedTripId as string);
          }, 500);
        }
      },
      (error) => {
        console.error('Error subscribing to trip request:', error);
      }
    );
    return () => unsubscribe();
  }, [requestId, onDriverAssigned]);

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
          toValue: 1.14,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.container}>
      <PassengerMapView
        pickup={pickup}
        dropoff={dropoff}
        overlayBottomOffset={overlayBottomOffset}
        showLegend={false}
        showControls={false}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.topBadge, { marginTop: topPadding }]}>
          <Text style={styles.topBadgeText}>
            {isMatched ? 'Driver assigned' : `Searching${dots}`}
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
                { transform: [{ scale: isMatched ? 1 : pulseAnim }] },
                isMatched && styles.iconWrapMatched,
              ]}
            >
              <Text style={styles.iconText}>{isMatched ? 'OK' : 'CAB'}</Text>
            </Animated.View>
            <View style={styles.headerText}>
              <Text style={styles.title}>{isMatched ? 'Driver is on the way' : 'Searching for a driver'}</Text>
              <Text style={styles.subtitle}>
                {isMatched
                  ? 'A driver accepted your trip request.'
                  : 'We are matching you with the nearest available driver.'}
              </Text>
            </View>
            {!isMatched ? <ActivityIndicator size="small" color="#1D4ED8" /> : null}
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Distance</Text>
              <Text style={styles.summaryValue}>{safeDistance.toFixed(1)} km</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>ETA</Text>
              <Text style={styles.summaryValue}>
                {safeDuration < 60
                  ? `${Math.round(safeDuration)} min`
                  : `${Math.floor(safeDuration / 60)}h ${Math.round(safeDuration % 60)}m`}
              </Text>
            </View>
            <View style={[styles.summaryRow, styles.summaryRowNoBorder]}>
              <Text style={styles.fareLabel}>Fare</Text>
              <Text style={styles.fareValue}>NIS {safePrice}</Text>
            </View>
          </View>

          {!isMatched ? <Button title="Cancel Trip" variant="outline" onPress={onCancel} /> : null}
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
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
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
