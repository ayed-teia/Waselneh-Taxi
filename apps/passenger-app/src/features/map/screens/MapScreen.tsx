import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { PassengerMapView } from '../PassengerMapView';
import { estimateTrip, createTripRequest } from '../../../services/api';

// Default test locations (Nablus to Ramallah)
const DEFAULT_PICKUP = { lat: 32.2211, lng: 35.2544 };
const DEFAULT_DESTINATION = { lat: 31.9038, lng: 35.2034 };

/**
 * Main Map Screen for Passengers
 * Shows real map with roadblocks and driver location (when on trip)
 */
export function MapScreen() {
  const router = useRouter();
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);

  /**
   * Backend-authoritative flow:
   * estimateTrip -> createTripRequest (callable)
   */
  const handleRequestTrip = useCallback(async () => {
    setIsCreatingTrip(true);

    try {
      const estimate = await estimateTrip(DEFAULT_PICKUP, DEFAULT_DESTINATION);
      const result = await createTripRequest(
        DEFAULT_PICKUP,
        DEFAULT_DESTINATION,
        estimate
      );

      if (result.status === 'matched' && result.tripId) {
        router.push({
          pathname: '/trip',
          params: {
            tripId: result.tripId,
          },
        });
      } else {
        router.push({
          pathname: '/searching',
          params: {
            requestId: result.requestId,
            distanceKm: estimate.distanceKm.toString(),
            durationMin: estimate.durationMin.toString(),
            priceIls: estimate.priceIls.toString(),
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request trip';
      console.error('[MapScreen] Trip request failed:', message);
      Alert.alert('Error', message);
    } finally {
      setIsCreatingTrip(false);
    }
  }, [router]);

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        <PassengerMapView />
      </View>

      <View style={styles.bottomSheet}>
        <View style={styles.handle} />
        <Text style={styles.greeting}>Where to?</Text>
        <View style={styles.searchBox}>
          <Text style={styles.searchPlaceholder}>Search destination...</Text>
        </View>

        <View style={styles.quickActions}>
          <View style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>H</Text>
            <Text style={styles.quickActionText}>Home</Text>
          </View>
          <View style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>W</Text>
            <Text style={styles.quickActionText}>Work</Text>
          </View>
          <View style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>S</Text>
            <Text style={styles.quickActionText}>Saved</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.estimateButton, isCreatingTrip && styles.estimateButtonDisabled]}
          onPress={handleRequestTrip}
          disabled={isCreatingTrip}
        >
          {isCreatingTrip ? (
            <>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.estimateButtonText}>Requesting Trip...</Text>
            </>
          ) : (
            <>
              <Text style={styles.estimateButtonIcon}>Ride</Text>
              <Text style={styles.estimateButtonText}>Request Trip</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E5E5E5',
  },
  mapContainer: {
    flex: 1,
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  searchBox: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  searchPlaceholder: {
    color: '#999999',
    fontSize: 16,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  quickAction: {
    alignItems: 'center',
  },
  quickActionIcon: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  quickActionText: {
    fontSize: 12,
    color: '#666666',
  },
  estimateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    gap: 8,
  },
  estimateButtonDisabled: {
    backgroundColor: '#999999',
  },
  estimateButtonIcon: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  estimateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
