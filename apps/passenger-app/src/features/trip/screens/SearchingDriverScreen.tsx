import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { Button } from '../../../ui';
import { subscribeToTripRequest } from '../../../services/realtime';

interface SearchingDriverScreenProps {
  requestId: string;
  onCancel: () => void;
  onDriverAssigned: (tripId: string) => void;
  distanceKm: number;
  durationMin: number;
  priceIls: number;
}

/**
 * Screen shown while searching for a driver
 * Displays a loading animation and trip summary
 */
export function SearchingDriverScreen({
  requestId,
  onCancel,
  onDriverAssigned,
  distanceKm,
  durationMin,
  priceIls,
}: SearchingDriverScreenProps) {
  const [dots, setDots] = useState('');
  const [pulseAnim] = useState(new Animated.Value(1));
  const [isMatched, setIsMatched] = useState(false);

  // Subscribe to trip request status changes
  useEffect(() => {
    const unsubscribe = subscribeToTripRequest(
      requestId,
      (request) => {
        if (request?.status === 'matched' && request.matchedTripId) {
          setIsMatched(true);
          // Small delay to show matched state before navigating
          setTimeout(() => {
            onDriverAssigned(request.matchedTripId!);
          }, 500);
        }
      },
      (error) => {
        console.error('Error subscribing to trip request:', error);
      }
    );
    return () => unsubscribe();
  }, [requestId, onDriverAssigned]);

  // Animate loading dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Pulse animation for the car icon
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {isMatched ? 'Driver assigned 🎉' : `Searching for a driver${dots}`}
        </Text>
        <Text style={styles.subtitle}>
          {isMatched
            ? 'Your driver is on the way to pick you up'
            : 'Please wait while we connect you with a nearby driver'}
        </Text>
      </View>

      {/* Animated car icon */}
      <View style={styles.animationContainer}>
        <Animated.View
          style={[
            styles.iconContainer,
            isMatched && styles.matchedIconContainer,
            { transform: [{ scale: isMatched ? 1 : pulseAnim }] },
          ]}
        >
          <Text style={styles.carIcon}>{isMatched ? '✅' : '🚕'}</Text>
        </Animated.View>
        {!isMatched && (
          <ActivityIndicator
            size="large"
            color="#007AFF"
            style={styles.spinner}
          />
        )}
      </View>

      {/* Trip summary card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Trip Summary</Text>
        
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Distance</Text>
          <Text style={styles.summaryValue}>{distanceKm} km</Text>
        </View>
        
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Est. Duration</Text>
          <Text style={styles.summaryValue}>
            {durationMin < 60
              ? `${Math.round(durationMin)} min`
              : `${Math.floor(durationMin / 60)}h ${Math.round(durationMin % 60)}m`}
          </Text>
        </View>
        
        <View style={[styles.summaryRow, styles.priceRow]}>
          <Text style={styles.priceLabel}>Estimated Fare</Text>
          <Text style={styles.priceValue}>₪{priceIls}</Text>
        </View>
      </View>

      {/* Request ID (for debugging) */}
      <Text style={styles.requestId}>Request ID: {requestId}</Text>

      {/* Cancel button */}
      <View style={styles.cancelContainer}>
        {!isMatched && (
          <Button
            title="Cancel Request"
            onPress={onCancel}
            variant="secondary"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
  },
  animationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 150,
    marginBottom: 40,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  matchedIconContainer: {
    backgroundColor: '#E8F5E9',
  },
  carIcon: {
    fontSize: 40,
  },
  spinner: {
    position: 'absolute',
    bottom: 20,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 20,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  summaryLabel: {
    fontSize: 16,
    color: '#8E8E93',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  priceRow: {
    borderBottomWidth: 0,
    paddingTop: 16,
    marginTop: 4,
  },
  priceLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  priceValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#34C759',
  },
  requestId: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 20,
  },
  cancelContainer: {
    marginTop: 'auto',
    paddingBottom: 20,
  },
});
