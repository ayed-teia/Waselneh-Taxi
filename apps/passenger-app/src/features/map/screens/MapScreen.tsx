import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

/**
 * Placeholder Map Screen
 * Real Mapbox implementation will be added later
 */
export function MapScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      {/* Placeholder for map */}
      <View style={styles.mapPlaceholder}>
        <Text style={styles.mapText}>🗺️</Text>
        <Text style={styles.placeholderText}>Map will appear here</Text>
        <Text style={styles.subText}>Mapbox integration coming soon</Text>
      </View>

      {/* Bottom sheet placeholder */}
      <View style={styles.bottomSheet}>
        <View style={styles.handle} />
        <Text style={styles.greeting}>Where to?</Text>
        <View style={styles.searchBox}>
          <Text style={styles.searchPlaceholder}>Search destination...</Text>
        </View>

        <View style={styles.quickActions}>
          <View style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>🏠</Text>
            <Text style={styles.quickActionText}>Home</Text>
          </View>
          <View style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>💼</Text>
            <Text style={styles.quickActionText}>Work</Text>
          </View>
          <View style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>⭐</Text>
            <Text style={styles.quickActionText}>Saved</Text>
          </View>
        </View>

        {/* Estimate Trip button */}
        <TouchableOpacity
          style={styles.estimateButton}
          onPress={() => router.push('/estimate')}
        >
          <Text style={styles.estimateButtonIcon}>🧮</Text>
          <Text style={styles.estimateButtonText}>Estimate Trip Price</Text>
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
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#D4E4D4',
  },
  mapText: {
    fontSize: 64,
    marginBottom: 16,
  },
  placeholderText: {
    fontSize: 18,
    color: '#666666',
    fontWeight: '600',
  },
  subText: {
    fontSize: 14,
    color: '#999999',
    marginTop: 4,
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
    fontSize: 24,
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
  estimateButtonIcon: {
    fontSize: 20,
  },
  estimateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
