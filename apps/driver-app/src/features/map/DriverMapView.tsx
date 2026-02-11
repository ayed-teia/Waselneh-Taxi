import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_DEFAULT } from 'react-native-maps';
import { subscribeToAllRoadblocks, RoadblockData, getRoadblockStatusDisplay } from '../../services/realtime';
import { DEFAULT_REGION, MAP_UPDATE_THROTTLE_MS, MARKER_COLORS, MAP_LOG_PREFIX } from '../../config/map.config';

/**
 * ============================================================================
 * DRIVER MAP VIEW
 * ============================================================================
 * 
 * Map view for drivers showing:
 * - Driver's current location (self marker)
 * - Roadblocks with status colors
 * 
 * Features:
 * - Realtime roadblock updates from Firestore
 * - Throttled location updates
 * - Auto-follow driver location
 * 
 * ============================================================================
 */

interface DriverMapViewProps {
  driverLocation?: {
    latitude: number;
    longitude: number;
  } | null;
  followUser?: boolean;
}

export function DriverMapView({ driverLocation, followUser = true }: DriverMapViewProps) {
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const mapRef = useRef<MapView>(null);
  const lastUpdateRef = useRef<number>(0);

  // Subscribe to roadblocks
  useEffect(() => {
    console.log(`${MAP_LOG_PREFIX} Subscribing to roadblocks...`);
    
    const unsubscribe = subscribeToAllRoadblocks(
      (data) => {
        // Throttle updates
        const now = Date.now();
        if (now - lastUpdateRef.current < MAP_UPDATE_THROTTLE_MS) {
          return;
        }
        lastUpdateRef.current = now;
        
        setRoadblocks(data);
        setLoading(false);
        console.log(`${MAP_LOG_PREFIX} Roadblocks updated: ${data.length}`);
      },
      (err) => {
        console.error(`${MAP_LOG_PREFIX} Error:`, err);
        setError('Failed to load roadblocks');
        setLoading(false);
      }
    );

    return () => {
      console.log(`${MAP_LOG_PREFIX} Unsubscribing from roadblocks`);
      unsubscribe();
    };
  }, []);

  // Follow driver location
  const animateToLocation = useCallback((latitude: number, longitude: number) => {
    if (mapRef.current && followUser) {
      mapRef.current.animateToRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    }
  }, [followUser]);

  useEffect(() => {
    if (driverLocation) {
      animateToLocation(driverLocation.latitude, driverLocation.longitude);
    }
  }, [driverLocation, animateToLocation]);

  // Initial region
  const initialRegion = driverLocation 
    ? {
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }
    : DEFAULT_REGION;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
        showsCompass={true}
        rotateEnabled={true}
        zoomEnabled={true}
      >
        {/* Driver self marker */}
        {driverLocation && (
          <Marker
            coordinate={driverLocation}
            title="You"
            description="Your current location"
            pinColor={MARKER_COLORS.driver.self}
          />
        )}

        {/* Roadblock markers */}
        {roadblocks.map((roadblock) => {
          const statusDisplay = getRoadblockStatusDisplay(roadblock.status);
          const color = MARKER_COLORS.roadblock[roadblock.status] || MARKER_COLORS.roadblock.closed;
          
          return (
            <React.Fragment key={roadblock.id}>
              {/* Circle for roadblock radius */}
              <Circle
                center={{ latitude: roadblock.lat, longitude: roadblock.lng }}
                radius={roadblock.radiusMeters}
                fillColor={`${color}33`}  // 20% opacity
                strokeColor={color}
                strokeWidth={2}
              />
              {/* Marker for roadblock center */}
              <Marker
                coordinate={{ latitude: roadblock.lat, longitude: roadblock.lng }}
                title={`${statusDisplay.emoji} ${roadblock.name}`}
                description={roadblock.note || `Status: ${statusDisplay.label}`}
                pinColor={color}
              />
            </React.Fragment>
          );
        })}
      </MapView>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Roadblocks</Text>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.roadblock.open }]} />
          <Text style={styles.legendText}>Open</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.roadblock.congested }]} />
          <Text style={styles.legendText}>Congested</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.roadblock.closed }]} />
          <Text style={styles.legendText}>Closed</Text>
        </View>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#8E8E93',
  },
  legend: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendText: {
    fontSize: 12,
    color: '#3C3C43',
  },
  errorBanner: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
  },
});
