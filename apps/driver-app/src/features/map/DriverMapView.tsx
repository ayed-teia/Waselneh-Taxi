import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox, {
  Camera,
  CircleLayer,
  LocationPuck,
  MapView,
  PointAnnotation,
  ShapeSource,
} from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { RoadblockData, getRoadblockStatusDisplay, subscribeToAllRoadblocks } from '../../services/realtime';
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

interface DriverMapViewProps {
  driverLocation?: {
    latitude: number;
    longitude: number;
  } | null;
  followUser?: boolean;
  overlayBottomOffset?: number;
  showLegend?: boolean;
  showControls?: boolean;
}

/**
 * Driver map focused on live road conditions and route awareness.
 */
export function DriverMapView({
  driverLocation,
  followUser = true,
  overlayBottomOffset = 244,
  showLegend = true,
  showControls = true,
}: DriverMapViewProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isNarrow = width < 390;
  const cameraRef = useRef<Camera>(null);
  const lastUpdateRef = useRef(0);

  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapStyle, setMapStyle] = useState<string>(MAP_STYLE_URL);

  useEffect(() => {
    const unsubscribe = subscribeToAllRoadblocks(
      (data) => {
        const now = Date.now();
        if (now - lastUpdateRef.current < MAP_UPDATE_THROTTLE_MS) return;
        lastUpdateRef.current = now;
        setRoadblocks(data);
        setLoading(false);
      },
      (err) => {
        console.error(`${MAP_LOG_PREFIX} Error:`, err);
        setError('Could not load live road conditions.');
        setLoading(false);
      }
    );

    return () => {
      console.log(`${MAP_LOG_PREFIX} Unsubscribing from roadblocks`);
      unsubscribe();
    };
  }, []);

  const animateToLocation = useCallback(
    (latitude: number, longitude: number) => {
      if (!cameraRef.current || !followUser) return;
      cameraRef.current.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel: CAMERA_DEFAULTS.zoomLevel,
        pitch: CAMERA_DEFAULTS.pitch,
        animationDuration: 450,
      });
    },
    [followUser]
  );

  useEffect(() => {
    if (!driverLocation) return;
    animateToLocation(driverLocation.latitude, driverLocation.longitude);
  }, [driverLocation, animateToLocation]);

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

  const initialCenter: [number, number] = driverLocation
    ? [driverLocation.longitude, driverLocation.latitude]
    : [DEFAULT_REGION.longitude, DEFAULT_REGION.latitude];

  const toggleStyle = () => {
    setMapStyle((previous) => (previous === MAP_STYLE_URL ? SATELLITE_STYLE_URL : MAP_STYLE_URL));
  };

  const recenter = () => {
    if (!cameraRef.current) return;
    const centerCoordinate: [number, number] = driverLocation
      ? [driverLocation.longitude, driverLocation.latitude]
      : [DEFAULT_REGION.longitude, DEFAULT_REGION.latitude];

    cameraRef.current.setCamera({
      centerCoordinate,
      zoomLevel: CAMERA_DEFAULTS.zoomLevel,
      pitch: CAMERA_DEFAULTS.pitch,
      animationDuration: 500,
    });
  };

  const topOverlayOffset = Math.max(insets.top + 8, 16);
  const minBottomWithInset = (isNarrow ? 232 : 218) + insets.bottom;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading map...</Text>
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

        <LocationPuck puckBearing="heading" puckBearingEnabled visible />

        <ShapeSource id="roadblocks" shape={roadblockCirclesGeoJSON}>
          <CircleLayer
            id="roadblock-circles"
            style={{
              circleRadius: 22,
              circleColor: ['get', 'color'],
              circleOpacity: 0.18,
              circleStrokeWidth: 1.8,
              circleStrokeColor: ['get', 'color'],
            }}
          />
        </ShapeSource>

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

      <View style={[styles.topOverlay, { top: topOverlayOffset }]} pointerEvents="none">
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Driver navigation map</Text>
        </View>
      </View>

      {showLegend ? (
        <View
          style={[
            styles.legend,
            isNarrow && styles.legendNarrow,
            { bottom: Math.max(overlayBottomOffset, minBottomWithInset) },
          ]}
        >
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
      ) : null}

      {showControls ? (
        <View style={[styles.controls, { bottom: Math.max(overlayBottomOffset + 4, 220 + insets.bottom) }]}>
          <Pressable style={styles.controlButton} onPress={toggleStyle}>
            <Text style={styles.controlButtonText}>Layer</Text>
          </Pressable>
          <Pressable style={styles.controlButton} onPress={recenter}>
            <Text style={styles.controlButtonText}>Center</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.errorBanner, { top: topOverlayOffset + 46 }]}>
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
  roadblockMarker: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  topOverlay: {
    position: 'absolute',
    left: 14,
    right: 14,
    alignItems: 'center',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    borderRadius: 999,
    paddingVertical: 7,
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
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 5,
  },
  legendNarrow: {
    paddingHorizontal: 9,
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
