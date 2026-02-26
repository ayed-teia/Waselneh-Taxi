import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  LocationPuck,
  MapView,
  PointAnnotation,
  ShapeSource,
} from '@rnmapbox/maps';
import Constants from 'expo-constants';
import {
  DriverLocation,
  RoadblockData,
  getRoadblockStatusDisplay,
  subscribeToAllRoadblocks,
  subscribeToDriverLocation,
} from '../../services/realtime';
import {
  CAMERA_DEFAULTS,
  DEFAULT_REGION,
  MAP_LOG_PREFIX,
  MAP_STYLE_URL,
  MAP_UPDATE_THROTTLE_MS,
  MARKER_COLORS,
} from '../../config/map.config';

const MAPBOX_TOKEN =
  Constants.expoConfig?.extra?.mapboxAccessToken || process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
Mapbox.setAccessToken(MAPBOX_TOKEN);

const SATELLITE_STYLE_URL = Mapbox.StyleURL.SatelliteStreet;

interface PassengerMapViewProps {
  driverId?: string | null;
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
}

/**
 * Passenger map designed for ride-hailing use:
 * clear navigation lines, compact controls, and responsive map overlays.
 */
export function PassengerMapView({ driverId, pickup, dropoff }: PassengerMapViewProps) {
  const { width } = useWindowDimensions();
  const isNarrow = width < 390;
  const cameraRef = useRef<Camera>(null);
  const lastRoadblockUpdateRef = useRef(0);
  const lastDriverUpdateRef = useRef(0);

  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapStyle, setMapStyle] = useState<string>(MAP_STYLE_URL);

  useEffect(() => {
    console.log(`${MAP_LOG_PREFIX} Subscribing to roadblocks...`);

    const unsubscribe = subscribeToAllRoadblocks(
      (data) => {
        const now = Date.now();
        if (now - lastRoadblockUpdateRef.current < MAP_UPDATE_THROTTLE_MS) {
          return;
        }

        lastRoadblockUpdateRef.current = now;
        setRoadblocks(data);
        setLoading(false);
      },
      (err) => {
        console.error(`${MAP_LOG_PREFIX} Roadblocks error:`, err);
        setError('Could not load live road conditions.');
        setLoading(false);
      }
    );

    return () => {
      console.log(`${MAP_LOG_PREFIX} Unsubscribing from roadblocks`);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!driverId) {
      setDriverLocation(null);
      return;
    }

    const unsubscribe = subscribeToDriverLocation(
      driverId,
      (location) => {
        const now = Date.now();
        if (now - lastDriverUpdateRef.current < MAP_UPDATE_THROTTLE_MS) {
          return;
        }

        lastDriverUpdateRef.current = now;
        setDriverLocation(location);
      },
      (err) => {
        console.error(`${MAP_LOG_PREFIX} Driver location error:`, err);
      }
    );

    return () => unsubscribe();
  }, [driverId]);

  useEffect(() => {
    if (!cameraRef.current) {
      return;
    }

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

    if (coordinates.length < 2) {
      return;
    }

    const lngs = coordinates.map((item) => item[0]);
    const lats = coordinates.map((item) => item[1]);

    const ne: [number, number] = [Math.max(...lngs) + 0.02, Math.max(...lats) + 0.015];
    const sw: [number, number] = [Math.min(...lngs) - 0.02, Math.min(...lats) - 0.015];
    cameraRef.current.fitBounds(ne, sw, [72, 56, 280, 56], 700);
  }, [pickup, dropoff, driverLocation]);

  const initialCenter: [number, number] = pickup
    ? [pickup.lng, pickup.lat]
    : [DEFAULT_REGION.longitude, DEFAULT_REGION.latitude];

  const roadblockCirclesGeoJSON = {
    type: 'FeatureCollection' as const,
    features: roadblocks.map((roadblock) => ({
      type: 'Feature' as const,
      properties: {
        id: roadblock.id,
        color: MARKER_COLORS.roadblock[roadblock.status] || MARKER_COLORS.roadblock.closed,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [roadblock.lng, roadblock.lat],
      },
    })),
  };

  const routeLineGeoJSON =
    pickup && dropoff
      ? {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [pickup.lng, pickup.lat],
              [dropoff.lng, dropoff.lat],
            ],
          },
        }
      : null;

  const handleRecenter = () => {
    if (!cameraRef.current) {
      return;
    }

    const centerCoordinate: [number, number] = driverLocation
      ? [driverLocation.lng, driverLocation.lat]
      : pickup
        ? [pickup.lng, pickup.lat]
        : [DEFAULT_REGION.longitude, DEFAULT_REGION.latitude];

    cameraRef.current.setCamera({
      centerCoordinate,
      zoomLevel: CAMERA_DEFAULTS.zoomLevel,
      pitch: CAMERA_DEFAULTS.pitch,
      animationDuration: 500,
    });
  };

  const toggleStyle = () => {
    setMapStyle((previous) => (previous === MAP_STYLE_URL ? SATELLITE_STYLE_URL : MAP_STYLE_URL));
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading live map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        styleURL={mapStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
        rotateEnabled
        pitchEnabled
        scaleBarEnabled={false}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter,
            zoomLevel: CAMERA_DEFAULTS.zoomLevel,
            pitch: CAMERA_DEFAULTS.pitch,
            heading: CAMERA_DEFAULTS.heading,
          }}
        />

        <LocationPuck visible />

        {routeLineGeoJSON && (
          <ShapeSource id="route-line" shape={routeLineGeoJSON}>
            <LineLayer
              id="route-line-backdrop"
              style={{
                lineColor: '#0F172A',
                lineOpacity: 0.18,
                lineWidth: 8,
              }}
            />
            <LineLayer
              id="route-line-main"
              style={{
                lineColor: '#2563EB',
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        <ShapeSource id="roadblocks" shape={roadblockCirclesGeoJSON}>
          <CircleLayer
            id="roadblock-circles"
            style={{
              circleRadius: 22,
              circleColor: ['get', 'color'],
              circleOpacity: 0.2,
              circleStrokeWidth: 1.8,
              circleStrokeColor: ['get', 'color'],
            }}
          />
        </ShapeSource>

        {pickup && (
          <PointAnnotation id="pickup-marker" coordinate={[pickup.lng, pickup.lat]}>
            <View style={styles.pickupMarkerOuter}>
              <View style={styles.pickupMarkerInner} />
            </View>
          </PointAnnotation>
        )}

        {dropoff && (
          <PointAnnotation id="dropoff-marker" coordinate={[dropoff.lng, dropoff.lat]}>
            <View style={styles.dropoffMarker}>
              <View style={styles.dropoffMarkerCenter} />
            </View>
          </PointAnnotation>
        )}

        {driverLocation && (
          <PointAnnotation id="driver-marker" coordinate={[driverLocation.lng, driverLocation.lat]}>
            <View style={styles.driverMarker}>
              <View style={styles.driverMarkerCabin} />
            </View>
          </PointAnnotation>
        )}

        {roadblocks.map((roadblock) => {
          const statusDisplay = getRoadblockStatusDisplay(roadblock.status);
          return (
            <PointAnnotation
              key={roadblock.id}
              id={`roadblock-${roadblock.id}`}
              coordinate={[roadblock.lng, roadblock.lat]}
              title={roadblock.name}
              snippet={roadblock.note || statusDisplay.label}
            >
              <View
                style={[
                  styles.roadblockMarker,
                  {
                    backgroundColor:
                      MARKER_COLORS.roadblock[roadblock.status] || MARKER_COLORS.roadblock.closed,
                  },
                ]}
              />
            </PointAnnotation>
          );
        })}
      </MapView>

      <View style={styles.topOverlay} pointerEvents="none">
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live road conditions</Text>
        </View>
      </View>

      <View style={[styles.legend, isNarrow && styles.legendNarrow]}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#2563EB' }]} />
          <Text style={styles.legendText}>Pickup</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#22C55E' }]} />
          <Text style={styles.legendText}>Dropoff</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
          <Text style={styles.legendText}>Closed road</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.controlButton} onPress={toggleStyle}>
          <Text style={styles.controlButtonText}>Layer</Text>
        </Pressable>
        <Pressable style={styles.controlButton} onPress={handleRecenter}>
          <Text style={styles.controlButtonText}>Center</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
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
    backgroundColor: '#E8EEF8',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#475569',
    fontWeight: '500',
  },
  pickupMarkerOuter: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    borderColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickupMarkerInner: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#2563EB',
  },
  dropoffMarker: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropoffMarkerCenter: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  driverMarker: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: '#0F172A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  driverMarkerCabin: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: '#F8FAFC',
  },
  roadblockMarker: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  topOverlay: {
    position: 'absolute',
    top: 16,
    left: 14,
    right: 14,
  },
  liveBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#22C55E',
  },
  liveText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  legend: {
    position: 'absolute',
    left: 14,
    bottom: 250,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 5,
  },
  legendNarrow: {
    bottom: 265,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  legendText: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '600',
  },
  controls: {
    position: 'absolute',
    right: 14,
    bottom: 252,
    gap: 8,
  },
  controlButton: {
    minWidth: 64,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  controlButtonText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '700',
  },
  errorBanner: {
    position: 'absolute',
    top: 60,
    left: 14,
    right: 14,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
});
