import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
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
  LineLayer,
  LocationPuck,
  MapView,
  PointAnnotation,
  ShapeSource,
} from '@rnmapbox/maps';
import { RoadblockData, getRoadblockStatusDisplay, subscribeToAllRoadblocks } from '../../services/realtime';
import {
  CAMERA_DEFAULTS,
  DEFAULT_REGION,
  MAP_FALLBACK_STYLE_URL,
  MAP_LOG_PREFIX,
  MAP_STYLE_URL,
  MAP_UPDATE_THROTTLE_MS,
  MARKER_COLORS,
  getMapboxToken,
} from '../../config/map.config';

const MAPBOX_TOKEN = getMapboxToken();
const STREET_STYLE_URL = Mapbox.StyleURL?.Street ?? MAP_STYLE_URL;

if (__DEV__ && !Mapbox.StyleURL?.Street) {
  console.warn('[Mapbox] Mapbox.StyleURL.Street unavailable in driver app; using MAP_STYLE_URL fallback.');
}

interface DriverMapViewProps {
  driverLocation?: {
    latitude: number;
    longitude: number;
  } | null;
  followUser?: boolean;
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  routeMode?: 'auto' | 'toPickup' | 'toDropoff';
  mapHeightRatio?: number;
  overlayBottomOffset?: number;
  showLegend?: boolean;
  showControls?: boolean;
}

const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving';
const ROUTE_REFRESH_MS = 10000;

/**
 * Driver map focused on live road conditions and route awareness.
 */
export function DriverMapView({
  driverLocation,
  followUser = true,
  pickup,
  dropoff,
  routeMode = 'auto',
  mapHeightRatio,
  overlayBottomOffset = 244,
  showLegend = true,
  showControls = true,
}: DriverMapViewProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isNarrow = width < 390;
  const cameraRef = useRef<Camera>(null);
  const lastUpdateRef = useRef(0);
  const lastRouteFetchAtRef = useRef(0);
  const lastRouteFromRef = useRef<{ lat: number; lng: number } | null>(null);

  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStyleURL, setActiveStyleURL] = useState<string>(STREET_STYLE_URL);
  const [styleLoaded, setStyleLoaded] = useState(false);

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

  const straightLineFallback = useMemo(() => {
    if (driverLocation && pickup && (routeMode === 'toPickup' || routeMode === 'auto')) {
      const nearPickup =
        Math.abs(driverLocation.latitude - pickup.lat) < 0.0013 &&
        Math.abs(driverLocation.longitude - pickup.lng) < 0.0013;

      if (routeMode === 'toPickup' || (routeMode === 'auto' && !nearPickup)) {
        return [
          [driverLocation.longitude, driverLocation.latitude] as [number, number],
          [pickup.lng, pickup.lat] as [number, number],
        ];
      }
    }

    if (driverLocation && dropoff && (routeMode === 'toDropoff' || routeMode === 'auto')) {
      return [
        [driverLocation.longitude, driverLocation.latitude] as [number, number],
        [dropoff.lng, dropoff.lat] as [number, number],
      ];
    }

    if (pickup && dropoff) {
      return [
        [pickup.lng, pickup.lat] as [number, number],
        [dropoff.lng, dropoff.lat] as [number, number],
      ];
    }

    return null;
  }, [driverLocation, pickup, dropoff, routeMode]);

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setRouteCoordinates(straightLineFallback);
      return;
    }

    const toCoordinate = (() => {
      if (routeMode === 'toPickup') return pickup ? { lat: pickup.lat, lng: pickup.lng } : null;
      if (routeMode === 'toDropoff') return dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null;

      if (driverLocation && pickup) {
        const nearPickup =
          Math.abs(driverLocation.latitude - pickup.lat) < 0.0013 &&
          Math.abs(driverLocation.longitude - pickup.lng) < 0.0013;
        if (!nearPickup) return { lat: pickup.lat, lng: pickup.lng };
      }

      if (dropoff) return { lat: dropoff.lat, lng: dropoff.lng };
      if (pickup) return { lat: pickup.lat, lng: pickup.lng };
      return null;
    })();

    const fromCoordinate = driverLocation
      ? { lat: driverLocation.latitude, lng: driverLocation.longitude }
      : pickup
        ? { lat: pickup.lat, lng: pickup.lng }
        : null;

    if (!fromCoordinate || !toCoordinate) {
      setRouteCoordinates(straightLineFallback);
      return;
    }

    const now = Date.now();
    const lastFrom = lastRouteFromRef.current;
    const movedEnough =
      !lastFrom ||
      Math.abs(lastFrom.lat - fromCoordinate.lat) > 0.0013 ||
      Math.abs(lastFrom.lng - fromCoordinate.lng) > 0.0013;
    const canFetch = now - lastRouteFetchAtRef.current >= ROUTE_REFRESH_MS || movedEnough;

    if (!canFetch) {
      return;
    }

    lastRouteFetchAtRef.current = now;
    lastRouteFromRef.current = fromCoordinate;

    const controller = new AbortController();
    const url =
      `${MAPBOX_DIRECTIONS_URL}/` +
      `${fromCoordinate.lng},${fromCoordinate.lat};${toCoordinate.lng},${toCoordinate.lat}` +
      `?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

    fetch(url, { signal: controller.signal })
      .then((response) => response.json())
      .then((json) => {
        const coordinates = json?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(coordinates) && coordinates.length > 1) {
          setRouteCoordinates(
            coordinates.filter(
              (point: unknown) =>
                Array.isArray(point) &&
                point.length === 2 &&
                typeof point[0] === 'number' &&
                typeof point[1] === 'number'
            ) as [number, number][]
          );
          return;
        }
        setRouteCoordinates(straightLineFallback);
      })
      .catch(() => {
        setRouteCoordinates(straightLineFallback);
      });

    return () => controller.abort();
  }, [driverLocation, pickup, dropoff, routeMode, straightLineFallback]);

  useEffect(() => {
    if (styleLoaded || activeStyleURL === MAP_FALLBACK_STYLE_URL) return;

    const timeout = setTimeout(() => {
      if (!styleLoaded) {
        console.warn(`${MAP_LOG_PREFIX} Mapbox style timeout. Switching to fallback style.`);
        setActiveStyleURL(MAP_FALLBACK_STYLE_URL);
        setError((current) => current ?? 'Mapbox style timed out. Using fallback style.');
      }
    }, 6000);

    return () => clearTimeout(timeout);
  }, [activeStyleURL, styleLoaded]);

  const routeLineGeoJSON =
    routeCoordinates && routeCoordinates.length > 1
      ? {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: routeCoordinates,
          },
        }
      : null;

  const handleMapLoadError = (event?: unknown) => {
    if (activeStyleURL !== MAP_FALLBACK_STYLE_URL) {
      console.warn(`${MAP_LOG_PREFIX} Mapbox style failed. Switching to fallback style.`, event);
      setActiveStyleURL(MAP_FALLBACK_STYLE_URL);
      setError((current) => current ?? 'Mapbox style failed. Using fallback style.');
      return;
    }

    setError((current) => current ?? 'Map failed to load. Please check network or map token.');
    console.error(`${MAP_LOG_PREFIX} Map style failed to load`, event);
  };

  const handleStyleLoaded = () => {
    setStyleLoaded(true);
    setError((current) => (current?.includes('fallback') ? null : current));
    console.log(`${MAP_LOG_PREFIX} Style loaded:`, activeStyleURL);
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
  const resolvedWindowHeight = height > 0 ? height : Dimensions.get('window').height;
  const mapHeight = mapHeightRatio ? Math.round(resolvedWindowHeight * mapHeightRatio) : null;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, mapHeight ? { height: mapHeight, flexGrow: 0 } : null]}>
      <MapView
        style={styles.map}
        styleURL={activeStyleURL}
        onDidFinishLoadingStyle={handleStyleLoaded}
        onDidFailLoadingMap={handleMapLoadError}
        surfaceView
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

        {routeLineGeoJSON && (
          <ShapeSource id="driver-route-line" shape={routeLineGeoJSON}>
            <LineLayer
              id="driver-route-line-backdrop"
              style={{
                lineColor: '#0F172A',
                lineOpacity: 0.18,
                lineWidth: 8,
              }}
            />
            <LineLayer
              id="driver-route-line-main"
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
              circleOpacity: 0.18,
              circleStrokeWidth: 1.8,
              circleStrokeColor: ['get', 'color'],
            }}
          />
        </ShapeSource>

        {pickup ? (
          <PointAnnotation id="driver-pickup-marker" coordinate={[pickup.lng, pickup.lat]}>
            <View style={styles.pickupMarker} />
          </PointAnnotation>
        ) : null}

        {dropoff ? (
          <PointAnnotation id="driver-dropoff-marker" coordinate={[dropoff.lng, dropoff.lat]}>
            <View style={styles.dropoffMarker} />
          </PointAnnotation>
        ) : null}

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
  pickupMarker: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: '#2563EB',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  dropoffMarker: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: '#22C55E',
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
