import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import MapView, { Marker, Circle, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { 
  subscribeToAllRoadblocks, 
  RoadblockData, 
  getRoadblockStatusDisplay,
  subscribeToDriverLocation,
  DriverLocation 
} from '../../services/realtime';
import { DEFAULT_REGION, MAP_UPDATE_THROTTLE_MS, MARKER_COLORS, MAP_LOG_PREFIX } from '../../config/map.config';

/**
 * ============================================================================
 * PASSENGER MAP VIEW
 * ============================================================================
 * 
 * Map view for passengers showing:
 * - Assigned driver location (when on active trip)
 * - Pickup point marker
 * - Dropoff point marker
 * - Roadblocks with status colors
 * 
 * Features:
 * - Realtime driver location updates
 * - Realtime roadblock updates from Firestore
 * - Throttled updates
 * - Auto-fit to show pickup, dropoff, and driver
 * 
 * ============================================================================
 */

interface PassengerMapViewProps {
  /** Driver ID to track (for active trips) */
  driverId?: string | null;
  /** Pickup location */
  pickup?: { lat: number; lng: number } | null;
  /** Dropoff location */
  dropoff?: { lat: number; lng: number } | null;
}

export function PassengerMapView({ driverId, pickup, dropoff }: PassengerMapViewProps) {
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const mapRef = useRef<MapView>(null);
  const lastRoadblockUpdateRef = useRef<number>(0);
  const lastDriverUpdateRef = useRef<number>(0);

  // Subscribe to roadblocks
  useEffect(() => {
    console.log(`${MAP_LOG_PREFIX} Subscribing to roadblocks...`);
    
    const unsubscribe = subscribeToAllRoadblocks(
      (data) => {
        // Throttle updates
        const now = Date.now();
        if (now - lastRoadblockUpdateRef.current < MAP_UPDATE_THROTTLE_MS) {
          return;
        }
        lastRoadblockUpdateRef.current = now;
        
        setRoadblocks(data);
        setLoading(false);
        console.log(`${MAP_LOG_PREFIX} Roadblocks updated: ${data.length}`);
      },
      (err) => {
        console.error(`${MAP_LOG_PREFIX} Roadblocks error:`, err);
        setError('Failed to load roadblocks');
        setLoading(false);
      }
    );

    return () => {
      console.log(`${MAP_LOG_PREFIX} Unsubscribing from roadblocks`);
      unsubscribe();
    };
  }, []);

  // Subscribe to driver location when driver is assigned
  useEffect(() => {
    if (!driverId) {
      setDriverLocation(null);
      return;
    }

    console.log(`${MAP_LOG_PREFIX} Subscribing to driver location: ${driverId}`);
    
    const unsubscribe = subscribeToDriverLocation(
      driverId,
      (location) => {
        // Throttle updates
        const now = Date.now();
        if (now - lastDriverUpdateRef.current < MAP_UPDATE_THROTTLE_MS) {
          return;
        }
        lastDriverUpdateRef.current = now;
        
        setDriverLocation(location);
        console.log(`${MAP_LOG_PREFIX} Driver location updated`);
      },
      (err) => {
        console.error(`${MAP_LOG_PREFIX} Driver location error:`, err);
      }
    );

    return () => {
      console.log(`${MAP_LOG_PREFIX} Unsubscribing from driver location`);
      unsubscribe();
    };
  }, [driverId]);

  // Fit map to show all markers
  useEffect(() => {
    if (!mapRef.current) return;

    const coordinates: { latitude: number; longitude: number }[] = [];
    
    if (pickup) {
      coordinates.push({ latitude: pickup.lat, longitude: pickup.lng });
    }
    if (dropoff) {
      coordinates.push({ latitude: dropoff.lat, longitude: dropoff.lng });
    }
    if (driverLocation) {
      coordinates.push({ latitude: driverLocation.lat, longitude: driverLocation.lng });
    }

    if (coordinates.length >= 2) {
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: { top: 50, right: 50, bottom: 100, left: 50 },
        animated: true,
      });
    }
  }, [pickup, dropoff, driverLocation]);

  // Calculate initial region
  const getInitialRegion = () => {
    if (pickup) {
      return {
        latitude: pickup.lat,
        longitude: pickup.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
    }
    return DEFAULT_REGION;
  };

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
        initialRegion={getInitialRegion()}
        showsUserLocation={true}
        showsMyLocationButton={true}
        showsCompass={true}
        rotateEnabled={true}
        zoomEnabled={true}
      >
        {/* Pickup marker */}
        {pickup && (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            title="Pickup"
            description="Your pickup location"
            pinColor={MARKER_COLORS.trip.pickup}
          />
        )}

        {/* Dropoff marker */}
        {dropoff && (
          <Marker
            coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
            title="Destination"
            description="Your destination"
            pinColor={MARKER_COLORS.trip.dropoff}
          />
        )}

        {/* Route line between pickup and dropoff */}
        {pickup && dropoff && (
          <Polyline
            coordinates={[
              { latitude: pickup.lat, longitude: pickup.lng },
              { latitude: dropoff.lat, longitude: dropoff.lng },
            ]}
            strokeColor="#007AFF"
            strokeWidth={3}
            lineDashPattern={[5, 5]}
          />
        )}

        {/* Driver marker */}
        {driverLocation && (
          <Marker
            coordinate={{ latitude: driverLocation.lat, longitude: driverLocation.lng }}
            title="Your Driver"
            description={driverLocation.speed ? `${Math.round(driverLocation.speed * 3.6)} km/h` : 'Waiting'}
            pinColor={MARKER_COLORS.driver.assigned}
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
        <Text style={styles.legendTitle}>Map Legend</Text>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.trip.pickup }]} />
          <Text style={styles.legendText}>Pickup</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.trip.dropoff }]} />
          <Text style={styles.legendText}>Destination</Text>
        </View>
        {driverId && (
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.driver.assigned }]} />
            <Text style={styles.legendText}>Driver</Text>
          </View>
        )}
        <View style={styles.legendDivider} />
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.roadblock.closed }]} />
          <Text style={styles.legendText}>Closed Road</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.roadblock.congested }]} />
          <Text style={styles.legendText}>Congested</Text>
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
  legendDivider: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginVertical: 6,
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
