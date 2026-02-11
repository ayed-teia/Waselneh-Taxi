import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * Trip status types matching backend trip.status values
 */
export type TripStatusType =
  | 'pending'
  | 'accepted'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled_by_passenger'
  | 'cancelled_by_driver'
  | 'cancelled_by_system'
  | 'no_driver_available';

interface StatusDisplay {
  title: string;
  subtitle: string;
  icon: string;
}

/**
 * Maps backend trip.status to UI display strings
 *
 * Status mapping:
 * - pending          → "Searching for a driver…"
 * - accepted         → "Driver assigned"
 * - driver_arrived   → "Driver arrived"
 * - in_progress      → "On the way"
 * - completed        → "Trip completed"
 * - cancelled_*      → "Trip cancelled"
 */
function getStatusDisplay(status: TripStatusType): StatusDisplay {
  switch (status) {
    case 'pending':
      return {
        title: 'Searching for a driver…',
        subtitle: 'Please wait while we find you a driver',
        icon: '🔍',
      };
    case 'accepted':
      return {
        title: 'Driver assigned',
        subtitle: 'Your driver is on the way to pick you up',
        icon: '🚗',
      };
    case 'driver_arrived':
      return {
        title: 'Driver arrived',
        subtitle: 'Your driver is waiting at the pickup location',
        icon: '📍',
      };
    case 'in_progress':
      return {
        title: 'On the way',
        subtitle: 'Enjoy your ride!',
        icon: '🛣️',
      };
    case 'completed':
      return {
        title: 'Trip completed',
        subtitle: 'Thank you for riding with Waselneh!',
        icon: '✅',
      };
    case 'cancelled_by_passenger':
    case 'cancelled_by_driver':
    case 'cancelled_by_system':
      return {
        title: 'Trip cancelled',
        subtitle: 'This trip has been cancelled',
        icon: '❌',
      };
    case 'no_driver_available':
      return {
        title: 'No driver available',
        subtitle: 'Sorry, no drivers are available right now. Please try again.',
        icon: '😞',
      };
    default:
      return {
        title: 'Unknown status',
        subtitle: '',
        icon: '❓',
      };
  }
}

interface TripStatusCardProps {
  /** Current trip status from Firestore */
  status: TripStatusType;
  /** Optional extra info to display */
  tripId?: string;
  /** Estimated or final price */
  priceIls?: number;
}

/**
 * TripStatusCard - Displays current trip lifecycle state
 *
 * Updates in realtime via Firestore listener (parent handles subscription).
 * Shows:
 * - Status icon
 * - Title (main state text)
 * - Subtitle (short explanation)
 * - Trip ID (optional)
 * - Price (optional)
 */
export function TripStatusCard({ status, tripId, priceIls }: TripStatusCardProps) {
  const display = getStatusDisplay(status);

  return (
    <View style={styles.container}>
      {/* Status Icon */}
      <Text style={styles.icon}>{display.icon}</Text>

      {/* Status Text */}
      <View style={styles.textContainer}>
        <Text style={styles.title}>{display.title}</Text>
        <Text style={styles.subtitle}>{display.subtitle}</Text>
      </View>

      {/* Trip Details */}
      {(tripId || priceIls !== undefined) && (
        <View style={styles.details}>
          {tripId && (
            <Text style={styles.tripId}>Trip: {tripId.slice(0, 8)}...</Text>
          )}
          {priceIls !== undefined && (
            <Text style={styles.price}>₪{priceIls}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  icon: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 12,
  },
  textContainer: {
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  details: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripId: {
    fontSize: 12,
    color: '#8E8E93',
    fontFamily: 'monospace',
  },
  price: {
    fontSize: 18,
    fontWeight: '600',
    color: '#34C759',
  },
});
