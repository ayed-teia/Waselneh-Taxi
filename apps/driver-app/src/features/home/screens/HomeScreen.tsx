import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusToggle } from '../../../ui';
import { useDriverStore } from '../../../store';
import { DriverMapView } from '../../map';

interface HomeScreenProps {
  onToggleStatus: (goOnline: boolean) => void;
}

/**
 * Driver Home Screen
 * Shows status toggle, real map with roadblocks, and nearby trip requests
 */
export function HomeScreen({ onToggleStatus }: HomeScreenProps) {
  const router = useRouter();
  const { status, isUpdatingStatus, currentLocation } = useDriverStore();

  // Convert to format expected by DriverMapView
  const driverLocation = currentLocation
    ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
    : null;

  return (
    <View style={styles.container}>
      {/* Real driver map with roadblocks */}
      <View style={styles.mapContainer}>
        <DriverMapView driverLocation={driverLocation} followUser={true} />
      </View>

      {/* Bottom panel */}
      <View style={styles.bottomPanel}>
        <StatusToggle
          status={status}
          isLoading={isUpdatingStatus}
          onToggle={onToggleStatus}
        />

        {status === 'online' && (
          <View style={styles.requestsSection}>
            <Text style={styles.sectionTitle}>Trip Requests</Text>
            <TouchableOpacity
              style={styles.inboxButton}
              onPress={() => router.push('/inbox')}
            >
              <Text style={styles.inboxButtonIcon}>📥</Text>
              <View style={styles.inboxButtonText}>
                <Text style={styles.inboxButtonTitle}>View Inbox</Text>
                <Text style={styles.inboxButtonSubtitle}>
                  See pending trip requests
                </Text>
              </View>
              <Text style={styles.inboxButtonArrow}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'offline' && (
          <View style={styles.offlineMessage}>
            <Text style={styles.offlineText}>
              Go online to start receiving trip requests
            </Text>
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
  mapContainer: {
    flex: 1,
  },
  bottomPanel: {
    backgroundColor: '#F2F2F7',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    marginTop: -24,
  },
  requestsSection: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  inboxButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inboxButtonIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  inboxButtonText: {
    flex: 1,
  },
  inboxButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  inboxButtonSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 2,
  },
  inboxButtonArrow: {
    fontSize: 24,
    color: '#C7C7CC',
    fontWeight: '300',
  },
  offlineMessage: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  offlineText: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
  },
});
