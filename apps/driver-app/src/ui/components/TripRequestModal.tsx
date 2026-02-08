import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Vibration,
} from 'react-native';
import { Button } from './Button';
import { useTripRequestStore } from '../../store/trip-request.store';
import { acceptTripRequest, rejectTripRequest } from '../../services/api';
import { useRouter } from 'expo-router';

/**
 * ============================================================================
 * TRIP REQUEST MODAL
 * ============================================================================
 * 
 * Full-screen modal displayed when a new trip request arrives.
 * Shows pickup distance, estimated price, and accept/reject buttons.
 * 
 * AUTO-DISMISS: Request expires after 30 seconds if not acted upon.
 * 
 * ============================================================================
 */

export function TripRequestModal() {
  const router = useRouter();
  const {
    pendingRequest,
    isModalVisible,
    isProcessing,
    processingAction,
    errorMessage,
    hideRequest,
    setProcessing,
    setError,
  } = useTripRequestStore();

  // Animation for the modal slide-up
  const [slideAnim] = useState(new Animated.Value(300));
  
  // Countdown timer
  const [countdown, setCountdown] = useState(30);

  // Vibrate when request appears
  useEffect(() => {
    if (isModalVisible && pendingRequest) {
      Vibration.vibrate([0, 500, 200, 500]); // Pattern: pause, vibrate, pause, vibrate
      setCountdown(30);

      // Slide up animation
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }).start();
    }
  }, [isModalVisible, pendingRequest]);

  // Countdown timer
  useEffect(() => {
    if (!isModalVisible || !pendingRequest) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Time expired - auto dismiss
          console.log('⏰ [TripRequestModal] Request expired');
          hideRequest();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isModalVisible, pendingRequest, hideRequest]);

  // Handle accept
  const handleAccept = useCallback(async () => {
    if (!pendingRequest) return;

    setProcessing(true, 'accept');
    console.log('✅ [TripRequestModal] Accepting trip:', pendingRequest.tripId);

    try {
      const result = await acceptTripRequest(pendingRequest.tripId);
      console.log('🎉 [TripRequestModal] Trip accepted:', result.tripId);

      hideRequest();
      
      // Navigate to active trip screen
      router.replace({
        pathname: '/trip',
        params: { tripId: result.tripId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to accept trip';
      console.error('❌ [TripRequestModal] Accept error:', message);
      setError(message);
    }
  }, [pendingRequest, router, hideRequest, setProcessing, setError]);

  // Handle reject
  const handleReject = useCallback(async () => {
    if (!pendingRequest) return;

    setProcessing(true, 'reject');
    console.log('❌ [TripRequestModal] Rejecting trip:', pendingRequest.tripId);

    try {
      await rejectTripRequest(pendingRequest.tripId);
      console.log('👋 [TripRequestModal] Trip rejected');
      hideRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject trip';
      console.error('❌ [TripRequestModal] Reject error:', message);
      setError(message);
    }
  }, [pendingRequest, hideRequest, setProcessing, setError]);

  if (!pendingRequest) return null;

  return (
    <Modal
      visible={isModalVisible}
      animationType="fade"
      transparent
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.container,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Header with countdown */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>🚕 New Trip Request</Text>
            <View style={styles.timerContainer}>
              <Text style={styles.timerText}>{countdown}s</Text>
            </View>
          </View>

          {/* Price highlight */}
          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>Estimated Fare</Text>
            <Text style={styles.priceValue}>₪{pendingRequest.estimatedPriceIls}</Text>
          </View>

          {/* Trip details */}
          <View style={styles.detailsContainer}>
            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>📍</Text>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Pickup Distance</Text>
                <Text style={styles.detailValue}>
                  {pendingRequest.pickupDistanceKm} km away
                </Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>🧭</Text>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Pickup Location</Text>
                <Text style={styles.detailValue}>
                  {pendingRequest.pickup.lat.toFixed(4)}, {pendingRequest.pickup.lng.toFixed(4)}
                </Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>🎯</Text>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Dropoff Location</Text>
                <Text style={styles.detailValue}>
                  {pendingRequest.dropoff.lat.toFixed(4)}, {pendingRequest.dropoff.lng.toFixed(4)}
                </Text>
              </View>
            </View>
          </View>

          {/* Error message */}
          {errorMessage && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.buttonsContainer}>
            <Button
              title={processingAction === 'reject' ? 'Rejecting...' : 'Reject'}
              variant="outline"
              onPress={handleReject}
              loading={processingAction === 'reject'}
              disabled={isProcessing}
              style={styles.rejectButton}
            />
            <Button
              title={processingAction === 'accept' ? 'Accepting...' : 'Accept'}
              variant="primary"
              onPress={handleAccept}
              loading={processingAction === 'accept'}
              disabled={isProcessing}
              style={styles.acceptButton}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  timerContainer: {
    backgroundColor: '#FF9500',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  priceContainer: {
    backgroundColor: '#34C759',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  priceLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 4,
  },
  priceValue: {
    fontSize: 42,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  detailsContainer: {
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  detailIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 13,
    color: '#8E8E93',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  errorContainer: {
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#856404',
    fontSize: 14,
    textAlign: 'center',
  },
  buttonsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  rejectButton: {
    flex: 1,
  },
  acceptButton: {
    flex: 2,
  },
});
