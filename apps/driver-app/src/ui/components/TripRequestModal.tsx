import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Vibration,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from './Button';
import { useTripRequestStore } from '../../store/trip-request.store';
import { acceptTripRequest, rejectTripRequest } from '../../services/api';

const DEFAULT_TIMEOUT_SECONDS = 30;

function getRemainingSeconds(expiresAt: Date | null | undefined): number {
  if (!expiresAt) {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  const remainingMs = expiresAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function isNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('not-found') || normalized.includes('not found');
}

/**
 * ============================================================================
 * TRIP REQUEST MODAL
 * ============================================================================
 *
 * Full-screen modal displayed when a new trip request arrives.
 * Shows pickup distance, estimated price, and accept/reject actions.
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

  const [slideAnim] = useState(new Animated.Value(300));
  const [countdown, setCountdown] = useState(DEFAULT_TIMEOUT_SECONDS);

  useEffect(() => {
    if (!isModalVisible || !pendingRequest) {
      return;
    }

    Vibration.vibrate([0, 500, 200, 500]);
    setCountdown(getRemainingSeconds(pendingRequest.expiresAt));

    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [isModalVisible, pendingRequest, slideAnim]);

  useEffect(() => {
    if (!isModalVisible || !pendingRequest) {
      return;
    }

    const timer = setInterval(() => {
      setCountdown((previous) => {
        if (!pendingRequest.expiresAt) {
          return Math.max(previous - 1, 0);
        }
        return getRemainingSeconds(pendingRequest.expiresAt);
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isModalVisible, pendingRequest]);

  useEffect(() => {
    if (!isModalVisible || !pendingRequest) {
      return;
    }
    if (countdown > 0) {
      return;
    }

    console.log('[TripRequestModal] Request expired');
    hideRequest();
  }, [countdown, hideRequest, isModalVisible, pendingRequest]);

  const handleAccept = useCallback(async () => {
    if (!pendingRequest) {
      return;
    }

    setProcessing(true, 'accept');
    console.log('[TripRequestModal] Accepting trip:', pendingRequest.tripId);

    try {
      const result = await acceptTripRequest(pendingRequest.tripId);
      console.log('[TripRequestModal] Trip accepted:', result.tripId);

      hideRequest();

      router.replace({
        pathname: '/trip',
        params: { tripId: result.tripId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to accept trip';
      console.error('[TripRequestModal] Accept error:', message);

      if (isNotFoundError(message)) {
        hideRequest();
        return;
      }

      setError(message);
    }
  }, [pendingRequest, router, hideRequest, setProcessing, setError]);

  const handleReject = useCallback(async () => {
    if (!pendingRequest) {
      return;
    }

    setProcessing(true, 'reject');
    console.log('[TripRequestModal] Rejecting trip:', pendingRequest.tripId);

    try {
      await rejectTripRequest(pendingRequest.tripId);
      console.log('[TripRequestModal] Trip rejected');
      hideRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject trip';
      console.error('[TripRequestModal] Reject error:', message);

      if (isNotFoundError(message)) {
        hideRequest();
        return;
      }

      setError(message);
    }
  }, [pendingRequest, hideRequest, setProcessing, setError]);

  if (!pendingRequest) {
    return null;
  }

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
          <View style={styles.header}>
            <Text style={styles.headerTitle}>New Trip Request</Text>
            <View style={styles.timerContainer}>
              <Text style={styles.timerText}>{countdown}s</Text>
            </View>
          </View>

          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>Estimated Fare</Text>
            <Text style={styles.priceValue}>NIS {pendingRequest.estimatedPriceIls}</Text>
          </View>

          <View style={styles.detailsContainer}>
            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>KM</Text>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Pickup Distance</Text>
                <Text style={styles.detailValue}>
                  {pendingRequest.pickupDistanceKm} km away
                </Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>PU</Text>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Pickup Location</Text>
                <Text style={styles.detailValue}>
                  {pendingRequest.pickup.lat.toFixed(4)}, {pendingRequest.pickup.lng.toFixed(4)}
                </Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailIcon}>DO</Text>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Dropoff Location</Text>
                <Text style={styles.detailValue}>
                  {pendingRequest.dropoff.lat.toFixed(4)}, {pendingRequest.dropoff.lng.toFixed(4)}
                </Text>
              </View>
            </View>
          </View>

          {errorMessage && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

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
    fontSize: 12,
    fontWeight: '700',
    marginRight: 12,
    color: '#8E8E93',
    minWidth: 20,
    marginTop: 5,
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
