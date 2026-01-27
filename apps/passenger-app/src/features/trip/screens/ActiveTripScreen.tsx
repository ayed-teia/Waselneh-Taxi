import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TripStatus } from '@taxi-line/shared';
import { Button } from '../../../ui';

interface ActiveTripScreenProps {
  tripId: string;
  status: TripStatus;
  onCancel: () => void;
}

/**
 * Active Trip Screen - shows trip progress
 * All data comes from Firestore realtime subscription (read-only)
 */
export function ActiveTripScreen({ tripId, status, onCancel }: ActiveTripScreenProps) {
  const getStatusDisplay = (status: TripStatus) => {
    switch (status) {
      case 'pending':
        return { text: 'Finding a driver...', icon: '🔍' };
      case 'driver_assigned':
        return { text: 'Driver assigned!', icon: '🎉' };
      case 'accepted':
        return { text: 'Driver is on the way', icon: '🚗' };
      case 'driver_arrived':
        return { text: 'Driver has arrived', icon: '📍' };
      case 'in_progress':
        return { text: 'Trip in progress', icon: '🛣️' };
      case 'completed':
        return { text: 'Trip completed', icon: '✅' };
      default:
        return { text: 'Unknown status', icon: '❓' };
    }
  };

  const statusDisplay = getStatusDisplay(status);
  const canCancel = status === 'pending' || status === 'driver_assigned' || status === 'accepted';

  return (
    <View style={styles.container}>
      {/* Map placeholder */}
      <View style={styles.mapPlaceholder}>
        <Text style={styles.mapEmoji}>🗺️</Text>
      </View>

      {/* Trip info card */}
      <View style={styles.tripCard}>
        <View style={styles.statusContainer}>
          <Text style={styles.statusIcon}>{statusDisplay.icon}</Text>
          <Text style={styles.statusText}>{statusDisplay.text}</Text>
        </View>

        <View style={styles.tripDetails}>
          <Text style={styles.tripId}>Trip: {tripId.slice(0, 8)}...</Text>
        </View>

        {canCancel && (
          <Button title="Cancel Trip" variant="outline" onPress={onCancel} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E5E5E5',
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#D4E4D4',
  },
  mapEmoji: {
    fontSize: 64,
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
    color: '#333333',
  },
  tripDetails: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    marginBottom: 16,
  },
  tripId: {
    fontSize: 14,
    color: '#999999',
  },
});
