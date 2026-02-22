import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Mapbox, { MapView, Camera, PointAnnotation, CircleLayer, ShapeSource, LocationPuck } from '@rnmapbox/maps';
import { subscribeToAllRoadblocks, RoadblockData, getRoadblockStatusDisplay } from '../../services/realtime';
import { DEFAULT_REGION, MAP_UPDATE_THROTTLE_MS, MARKER_COLORS, MAP_LOG_PREFIX } from '../../config/map.config';
import Constants from 'expo-constants';

// Initialize Mapbox with access token
const MAPBOX_TOKEN = Constants.expoConfig?.extra?.mapboxAccessToken || process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
Mapbox.setAccessToken(MAPBOX_TOKEN);

/**
 * ============================================================================
 * DRIVER MAP VIEW (MAPBOX)
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
  
  const cameraRef = useRef<Camera>(null);
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
    if (cameraRef.current && followUser) {
      cameraRef.current.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel: 14,
        animationDuration: 500,
      });
    }
  }, [followUser]);

  useEffect(() => {
    if (driverLocation) {
      animateToLocation(driverLocation.latitude, driverLocation.longitude);
    }
  }, [driverLocation, animateToLocation]);

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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  const initialCenter = driverLocation 
    ? [driverLocation.longitude, driverLocation.latitude]
    : [DEFAULT_REGION.longitude, DEFAULT_REGION.latitude];

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
            centerCoordinate: initialCenter,
            zoomLevel: 14,
          }}
          followUserLocation={followUser}
          followUserMode="normal"
        />

        {/* Show user location puck */}
        <LocationPuck
          puckBearing="heading"
          puckBearingEnabled={true}
          visible={true}
        />

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
