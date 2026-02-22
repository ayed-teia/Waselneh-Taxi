import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Mapbox, { MapView, Camera, PointAnnotation, CircleLayer, ShapeSource, LineLayer, LocationPuck } from '@rnmapbox/maps';
import Constants from 'expo-constants';

// Initialize Mapbox
const MAPBOX_TOKEN = Constants.expoConfig?.extra?.mapboxAccessToken || process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
Mapbox.setAccessToken(MAPBOX_TOKEN);
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
  
  const cameraRef = useRef<Camera>(null);
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
    if (!cameraRef.current) return;

    const coordinates: [number, number][] = [];
    
    if (pickup) {
      coordinates.push([pickup.lng, pickup.lat]);
    }
    if (dropoff) {
      coordinates.push([dropoff.lng, dropoff.lat]);
    }
    if (driverLocation) {
      coordinates.push([driverLocation.lng, driverLocation.lat]);
    }

    if (coordinates.length >= 2) {
      // Calculate bounds
      const lngs = coordinates.map(c => c[0]);
      const lats = coordinates.map(c => c[1]);
      const bounds = {
        ne: [Math.max(...lngs) + 0.01, Math.max(...lats) + 0.01] as [number, number],
        sw: [Math.min(...lngs) - 0.01, Math.min(...lats) - 0.01] as [number, number],
      };
      
      cameraRef.current.fitBounds(bounds.ne, bounds.sw, [50, 50, 100, 50], 500);
    }
  }, [pickup, dropoff, driverLocation]);

  // GeoJSON for roadblock circles
  const roadblockCirclesGeoJSON = {
    type: 'FeatureCollection' as const,
    features: roadblocks.map((rb) => ({
      type: 'Feature' as const,
      properties: {
        id: rb.id,
        status: rb.status,
        color: MARKER_COLORS.roadblock[rb.status] || MARKER_COLORS.roadblock.closed,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [rb.lng, rb.lat],
      },
    })),
  };

  // GeoJSON for route line
  const routeLineGeoJSON = pickup && dropoff ? {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [pickup.lng, pickup.lat],
        [dropoff.lng, dropoff.lat],
      ],
    },
  } : null;

  // Calculate initial center
  const getInitialCenter = (): [number, number] => {
    if (pickup) {
      return [pickup.lng, pickup.lat];
    }
    return [DEFAULT_REGION.longitude, DEFAULT_REGION.latitude];
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
        style={styles.map}
        styleURL={Mapbox.StyleURL.Street}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={true}
        scaleBarEnabled={true}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: getInitialCenter(),
            zoomLevel: 14,
          }}
        />

        {/* Show user location */}
        <LocationPuck visible={true} />

        {/* Route line between pickup and dropoff */}
        {routeLineGeoJSON && (
          <ShapeSource id="route-line" shape={routeLineGeoJSON}>
            <LineLayer
              id="route-line-layer"
              style={{
                lineColor: '#007AFF',
                lineWidth: 3,
                lineDasharray: [2, 2],
              }}
            />
          </ShapeSource>
        )}

        {/* Roadblock circles */}
        <ShapeSource id="roadblocks" shape={roadblockCirclesGeoJSON}>
          <CircleLayer
            id="roadblock-circles"
            style={{
              circleRadius: 30,
              circleColor: ['get', 'color'],
              circleOpacity: 0.3,
              circleStrokeWidth: 2,
              circleStrokeColor: ['get', 'color'],
            }}
          />
        </ShapeSource>

        {/* Pickup marker */}
        {pickup && (
          <PointAnnotation
            id="pickup-marker"
            coordinate={[pickup.lng, pickup.lat]}
            title="Pickup"
            snippet="Your pickup location"
          >
            <View style={[styles.markerContainer, { backgroundColor: MARKER_COLORS.trip.pickup }]}>
              <Text style={styles.markerEmoji}>📍</Text>
            </View>
          </PointAnnotation>
        )}

        {/* Dropoff marker */}
        {dropoff && (
          <PointAnnotation
            id="dropoff-marker"
            coordinate={[dropoff.lng, dropoff.lat]}
            title="Destination"
            snippet="Your destination"
          >
            <View style={[styles.markerContainer, { backgroundColor: MARKER_COLORS.trip.dropoff }]}>
              <Text style={styles.markerEmoji}>🏁</Text>
            </View>
          </PointAnnotation>
        )}

        {/* Driver marker */}
        {driverLocation && (
          <PointAnnotation
            id="driver-marker"
            coordinate={[driverLocation.lng, driverLocation.lat]}
            title="Your Driver"
            snippet={driverLocation.speed ? `${Math.round(driverLocation.speed * 3.6)} km/h` : 'Waiting'}
          >
            <View style={[styles.markerContainer, { backgroundColor: MARKER_COLORS.driver.assigned }]}>
              <Text style={styles.markerEmoji}>🚕</Text>
            </View>
          </PointAnnotation>
        )}

        {/* Roadblock markers */}
        {roadblocks.map((roadblock) => {
          const statusDisplay = getRoadblockStatusDisplay(roadblock.status);
          
          return (
            <PointAnnotation
              key={roadblock.id}
              id={`roadblock-${roadblock.id}`}
              coordinate={[roadblock.lng, roadblock.lat]}
              title={`${statusDisplay.emoji} ${roadblock.name}`}
              snippet={roadblock.note || `Status: ${statusDisplay.label}`}
            >
              <View style={[styles.markerContainer, { backgroundColor: MARKER_COLORS.roadblock[roadblock.status] || MARKER_COLORS.roadblock.closed }]}>
                <Text style={styles.markerEmoji}>{statusDisplay.emoji}</Text>
              </View>
            </PointAnnotation>
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
  markerContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  markerEmoji: {
    fontSize: 18,
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
