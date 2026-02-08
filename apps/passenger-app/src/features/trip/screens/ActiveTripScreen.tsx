import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TripStatus } from '@taxi-line/shared';
import { Button } from '../../../ui';
import { DriverLocation } from '../../../services/realtime';

interface ActiveTripScreenProps {
  tripId: string;
  status: TripStatus;
  estimatedPriceIls?: number;
  driverLocation?: DriverLocation | null;
  onCancel: () => void;
  onGoHome?: () => void;
}

/**
 * Active Trip Screen - shows trip progress
 * All data comes from Firestore realtime subscription (read-only)
 */
export function ActiveTripScreen({ 
  tripId, 
  status, 
  estimatedPriceIls,
  driverLocation,
  onCancel,
  onGoHome 
}: ActiveTripScreenProps) {
  const getStatusDisplay = (status: TripStatus) => {
    switch (status) {
      case 'pending':
        return { text: 'Finding a driver...', icon: '🔍', description: 'Please wait while we find you a driver' };
      case 'accepted':
        return { text: 'Driver on the way!', icon: '🚗', description: 'Your driver is heading to pick you up' };
      case 'driver_arrived':
        return { text: 'Driver has arrived', icon: '📍', description: 'Your driver is waiting at the pickup location' };
      case 'in_progress':
        return { text: 'Trip in progress', icon: '🛣️', description: 'Enjoy your ride!' };
      case 'completed':
        return { text: 'Trip completed', icon: '✅', description: 'Thank you for riding with us!' };
      case 'cancelled_by_passenger':
      case 'cancelled_by_driver':
      case 'cancelled_by_system':
        return { text: 'Trip cancelled', icon: '❌', description: 'This trip has been cancelled' };
      case 'no_driver_available':
        return { text: 'No driver available', icon: '😞', description: 'Sorry, no drivers are available right now' };
      default:
        return { text: 'Unknown status', icon: '❓', description: '' };
    }
  };

  const statusDisplay = getStatusDisplay(status);
  const canCancel = status === 'pending' || status === 'accepted';
  const isCompleted = status === 'completed';
  const isCancelled = status === 'cancelled_by_passenger' || status === 'cancelled_by_driver' || status === 'cancelled_by_system' || status === 'no_driver_available';

  return (
    <View style={styles.container}>
      {/* Map placeholder with driver location */}
      <View style={styles.mapPlaceholder}>
        <Text style={styles.mapEmoji}>🗺️</Text>
        {driverLocation && (
          <View style={styles.driverMarker}>
            <Text style={styles.driverMarkerIcon}>🚗</Text>
            <Text style={styles.driverCoords}>
              {driverLocation.lat.toFixed(4)}, {driverLocation.lng.toFixed(4)}
            </Text>
            {driverLocation.speed !== null && driverLocation.speed > 0 && (
              <Text style={styles.driverSpeed}>
                {Math.round(driverLocation.speed * 3.6)} km/h
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Trip info card */}
      <View style={styles.tripCard}>
        <View style={styles.statusContainer}>
          <Text style={styles.statusIcon}>{statusDisplay.icon}</Text>
          <View style={styles.statusTextContainer}>
            <Text style={styles.statusText}>{statusDisplay.text}</Text>
            <Text style={styles.statusDescription}>{statusDisplay.description}</Text>
          </View>
        </View>

        <View style={styles.tripDetails}>
          <Text style={styles.tripId}>Trip: {tripId.slice(0, 8)}...</Text>
          {estimatedPriceIls && (
            <Text style={styles.priceText}>Fare: ₪{estimatedPriceIls}</Text>
          )}
        </View>

        {canCancel && (
          <Button title="Cancel Trip" variant="outline" onPress={onCancel} />
        )}

        {(isCompleted || isCancelled) && onGoHome && (
          <Button title="Back to Home" onPress={onGoHome} />
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
  driverMarker: {
    position: 'absolute',
    bottom: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  driverMarkerIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  driverCoords: {
    fontSize: 12,
    color: '#666666',
  },
  driverSpeed: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
    marginTop: 2,
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
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  statusIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  statusTextContainer: {
    flex: 1,
  },
  statusText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333333',
  },
  statusDescription: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
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
  priceText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#34C759',
    marginTop: 8,
  },
});
