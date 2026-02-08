import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { TripStatus } from '@taxi-line/shared';
import { Button } from '../../../ui';
import { driverArrived, startTrip, completeTrip } from '../../../services/api';

interface ActiveTripScreenProps {
  tripId: string;
  status: TripStatus;
  estimatedPriceIls?: number;
  onTripCompleted: () => void;
}

/**
 * Active Trip Screen for Driver
 * Shows current trip details and allows status updates via Cloud Functions
 */
export function ActiveTripScreen({ 
  tripId, 
  status, 
  estimatedPriceIls,
  onTripCompleted 
}: ActiveTripScreenProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const getStatusDisplay = (tripStatus: TripStatus) => {
    switch (tripStatus) {
      case 'accepted':
        return { text: 'Heading to pickup', icon: '🚗', action: 'Arrived at Pickup' };
      case 'driver_arrived':
        return { text: 'Waiting for passenger', icon: '📍', action: 'Start Trip' };
      case 'in_progress':
        return { text: 'Trip in progress', icon: '🛣️', action: 'Complete Trip' };
      case 'completed':
        return { text: 'Trip completed', icon: '✅', action: null };
      default:
        return { text: 'Unknown status', icon: '❓', action: null };
    }
  };

  const handleAction = useCallback(async () => {
    setIsUpdating(true);
    console.log(`🚗 [ActiveTrip] Action triggered for status: ${status}`);
    
    try {
      switch (status) {
        case 'accepted':
          console.log('📍 [ActiveTrip] Calling driverArrived...');
          await driverArrived(tripId);
          console.log('✅ [ActiveTrip] Driver marked as arrived');
          break;
        case 'driver_arrived':
          console.log('🛣️ [ActiveTrip] Calling startTrip...');
          await startTrip(tripId);
          console.log('✅ [ActiveTrip] Trip started');
          break;
        case 'in_progress':
          console.log('🏁 [ActiveTrip] Calling completeTrip...');
          const result = await completeTrip(tripId);
          console.log('✅ [ActiveTrip] Trip completed, fare:', result.finalPriceIls);
          Alert.alert(
            'Trip Completed!',
            `Final fare: ₪${result.finalPriceIls}`,
            [{ text: 'OK', onPress: onTripCompleted }]
          );
          return; // Don't reset isUpdating, we're navigating away
        default:
          console.log('⚠️ [ActiveTrip] Unknown status, no action');
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update trip';
      console.error('❌ [ActiveTrip] Action failed:', message);
      Alert.alert('Error', message);
    } finally {
      setIsUpdating(false);
    }
  }, [tripId, status, onTripCompleted]);

  const statusDisplay = getStatusDisplay(status);
  const hasAction = status === 'accepted' || status === 'driver_arrived' || status === 'in_progress';

  return (
    <View style={styles.container}>
      {/* Map placeholder */}
      <View style={styles.mapPlaceholder}>
        <Text style={styles.mapEmoji}>🗺️</Text>
        <Text style={styles.routeText}>Route to destination</Text>
      </View>

      {/* Trip info card */}
      <View style={styles.tripCard}>
        <View style={styles.statusContainer}>
          <Text style={styles.statusIcon}>{statusDisplay.icon}</Text>
          <Text style={styles.statusText}>{statusDisplay.text}</Text>
        </View>

        <View style={styles.tripDetails}>
          <Text style={styles.tripId}>Trip: {tripId.slice(0, 8)}...</Text>
          
          {estimatedPriceIls && (
            <Text style={styles.priceText}>Fare: ₪{estimatedPriceIls}</Text>
          )}
          
          {/* Placeholder passenger info */}
          <View style={styles.passengerInfo}>
            <Text style={styles.passengerName}>👤 Passenger Name</Text>
            <Text style={styles.passengerPhone}>📞 +972-XXX-XXXX</Text>
          </View>
        </View>

        {hasAction && statusDisplay.action && (
          <Button
            title={isUpdating ? 'Updating...' : statusDisplay.action}
            onPress={handleAction}
            disabled={isUpdating}
            loading={isUpdating}
          />
        )}

        {status === 'completed' && (
          <View style={styles.completedMessage}>
            <Text style={styles.completedText}>Trip completed successfully!</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#C8D6C5',
  },
  mapEmoji: {
    fontSize: 64,
  },
  routeText: {
    marginTop: 8,
    fontSize: 16,
    color: '#666666',
  },
  tripCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  statusText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  tripDetails: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E5EA',
    marginBottom: 16,
  },
  tripId: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 12,
  },
  priceText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#34C759',
    marginBottom: 12,
  },
  passengerInfo: {
    gap: 8,
  },
  passengerName: {
    fontSize: 16,
    color: '#1C1C1E',
    fontWeight: '500',
  },
  passengerPhone: {
    fontSize: 16,
    color: '#3C3C43',
  },
  completedMessage: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  completedText: {
    fontSize: 18,
    color: '#34C759',
    fontWeight: '600',
  },
});
