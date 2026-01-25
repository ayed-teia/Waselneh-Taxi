import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Button } from '../../../ui';
import { estimateTrip, EstimateTripResponse } from '../../../services/api';
import { LatLng } from '@taxi-line/shared';

// Sample locations in the West Bank for testing
const SAMPLE_LOCATIONS = {
  nablus: { lat: 32.2211, lng: 35.2544, name: 'Nablus' },
  ramallah: { lat: 31.9038, lng: 35.2034, name: 'Ramallah' },
  jenin: { lat: 32.4607, lng: 35.3033, name: 'Jenin' },
  bethlehem: { lat: 31.7054, lng: 35.2024, name: 'Bethlehem' },
};

/**
 * Screen to test trip estimation
 * Allows entering pickup/dropoff coordinates and displays estimated price
 */
export function EstimateTripScreen() {
  // Form state
  const [pickupLat, setPickupLat] = useState('32.2211');
  const [pickupLng, setPickupLng] = useState('35.2544');
  const [dropoffLat, setDropoffLat] = useState('31.9038');
  const [dropoffLng, setDropoffLng] = useState('35.2034');

  // Result state
  const [estimate, setEstimate] = useState<EstimateTripResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle estimate
  const handleEstimate = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setEstimate(null);

    try {
      const pickup: LatLng = {
        lat: parseFloat(pickupLat),
        lng: parseFloat(pickupLng),
      };

      const dropoff: LatLng = {
        lat: parseFloat(dropoffLat),
        lng: parseFloat(dropoffLng),
      };

      // Validate coordinates
      if (isNaN(pickup.lat) || isNaN(pickup.lng)) {
        throw new Error('Invalid pickup coordinates');
      }
      if (isNaN(dropoff.lat) || isNaN(dropoff.lng)) {
        throw new Error('Invalid dropoff coordinates');
      }

      const result = await estimateTrip(pickup, dropoff);
      setEstimate(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to estimate trip';
      setError(message);
      Alert.alert('Error', message);
    } finally {
      setIsLoading(false);
    }
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  // Preset route buttons
  const setNablusToRamallah = () => {
    setPickupLat(SAMPLE_LOCATIONS.nablus.lat.toString());
    setPickupLng(SAMPLE_LOCATIONS.nablus.lng.toString());
    setDropoffLat(SAMPLE_LOCATIONS.ramallah.lat.toString());
    setDropoffLng(SAMPLE_LOCATIONS.ramallah.lng.toString());
  };

  const setRamallahToJenin = () => {
    setPickupLat(SAMPLE_LOCATIONS.ramallah.lat.toString());
    setPickupLng(SAMPLE_LOCATIONS.ramallah.lng.toString());
    setDropoffLat(SAMPLE_LOCATIONS.jenin.lat.toString());
    setDropoffLng(SAMPLE_LOCATIONS.jenin.lng.toString());
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Estimate Trip</Text>
        <Text style={styles.subtitle}>
          Enter pickup and dropoff coordinates to get a price estimate
        </Text>

        {/* Preset routes */}
        <View style={styles.presetsSection}>
          <Text style={styles.sectionTitle}>Quick Presets</Text>
          <View style={styles.presetButtons}>
            <Button
              title="Nablus → Ramallah"
              onPress={setNablusToRamallah}
              variant="secondary"
            />
            <Button
              title="Ramallah → Jenin"
              onPress={setRamallahToJenin}
              variant="secondary"
            />
          </View>
        </View>

        {/* Pickup coordinates */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📍 Pickup Location</Text>
          <View style={styles.coordInputs}>
            <View style={styles.coordField}>
              <Text style={styles.label}>Latitude</Text>
              <TextInput
                style={styles.input}
                value={pickupLat}
                onChangeText={setPickupLat}
                keyboardType="numeric"
                placeholder="32.2211"
              />
            </View>
            <View style={styles.coordField}>
              <Text style={styles.label}>Longitude</Text>
              <TextInput
                style={styles.input}
                value={pickupLng}
                onChangeText={setPickupLng}
                keyboardType="numeric"
                placeholder="35.2544"
              />
            </View>
          </View>
        </View>

        {/* Dropoff coordinates */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎯 Dropoff Location</Text>
          <View style={styles.coordInputs}>
            <View style={styles.coordField}>
              <Text style={styles.label}>Latitude</Text>
              <TextInput
                style={styles.input}
                value={dropoffLat}
                onChangeText={setDropoffLat}
                keyboardType="numeric"
                placeholder="31.9038"
              />
            </View>
            <View style={styles.coordField}>
              <Text style={styles.label}>Longitude</Text>
              <TextInput
                style={styles.input}
                value={dropoffLng}
                onChangeText={setDropoffLng}
                keyboardType="numeric"
                placeholder="35.2034"
              />
            </View>
          </View>
        </View>

        {/* Estimate button */}
        <View style={styles.buttonSection}>
          <Button
            title={isLoading ? 'Estimating...' : 'Get Estimate'}
            onPress={handleEstimate}
            disabled={isLoading}
          />
        </View>

        {/* Loading indicator */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Calculating route...</Text>
          </View>
        )}

        {/* Error display */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>❌ {error}</Text>
          </View>
        )}

        {/* Results */}
        {estimate && (
          <View style={styles.resultsSection}>
            <Text style={styles.resultsTitle}>Trip Estimate</Text>
            
            <View style={styles.resultCard}>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Distance</Text>
                <Text style={styles.resultValue}>{estimate.distanceKm} km</Text>
              </View>
              
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Duration</Text>
                <Text style={styles.resultValue}>
                  {estimate.durationMin < 60
                    ? `${Math.round(estimate.durationMin)} min`
                    : `${Math.floor(estimate.durationMin / 60)}h ${Math.round(estimate.durationMin % 60)}m`}
                </Text>
              </View>
              
              <View style={[styles.resultRow, styles.priceRow]}>
                <Text style={styles.priceLabel}>Estimated Price</Text>
                <Text style={styles.priceValue}>₪{estimate.priceIls}</Text>
              </View>
            </View>

            <Text style={styles.pricingNote}>
              Pricing: ₪1 per 2 km (minimum ₪5)
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 24,
  },
  presetsSection: {
    marginBottom: 24,
  },
  presetButtons: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  coordInputs: {
    flexDirection: 'row',
    gap: 12,
  },
  coordField: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  buttonSection: {
    marginTop: 8,
    marginBottom: 24,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#8E8E93',
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
    padding: 16,
    borderRadius: 10,
    marginBottom: 20,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
  },
  resultsSection: {
    marginTop: 8,
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  resultLabel: {
    fontSize: 16,
    color: '#8E8E93',
  },
  resultValue: {
    fontSize: 18,
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
    fontSize: 28,
    fontWeight: 'bold',
    color: '#34C759',
  },
  pricingNote: {
    marginTop: 16,
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
