import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  console.warn('[Mapbox] Mapbox.StyleURL.Street unavailable in passenger app; using MAP_STYLE_URL fallback.');
}

interface PassengerMapViewProps {
  driverId?: string | null | undefined;
  pickup?: { lat: number; lng: number } | null | undefined;
  dropoff?: { lat: number; lng: number } | null | undefined;
  routeMode?: 'auto' | 'toPickup' | 'toDropoff';
  mapHeightRatio?: number;
  overlayBottomOffset?: number;
  showLegend?: boolean;
  showControls?: boolean;
}

const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving';
const ROUTE_REFRESH_MS = 10000;

/**
 * Passenger map focused on ride-hailing clarity:
 * route emphasis, clean overlays, and responsive floating controls.
 */
export function PassengerMapView({
  driverId,
  pickup,
  dropoff,
  routeMode = 'auto',
  mapHeightRatio,
  overlayBottomOffset = 252,
  showLegend = true,
  showControls = true,
}: PassengerMapViewProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isNarrow = width < 390;
  const cameraRef = useRef<Camera>(null);
  const lastRoadblockUpdateRef = useRef(0);
  const lastDriverUpdateRef = useRef(0);
  const lastRouteFetchAtRef = useRef(0);
  const lastRouteFromRef = useRef<{ lat: number; lng: number } | null>(null);

  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStyleURL, setActiveStyleURL] = useState<string>(STREET_STYLE_URL);
  const [styleLoaded, setStyleLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAllRoadblocks(
      (data) => {
        const now = Date.now();
        if (now - lastRoadblockUpdateRef.current < MAP_UPDATE_THROTTLE_MS) return;
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
        if (now - lastDriverUpdateRef.current < MAP_UPDATE_THROTTLE_MS) return;
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
    if (!cameraRef.current) return;

    const coordinates: [number, number][] = [];
    if (pickup) coordinates.push([pickup.lng, pickup.lat]);
    if (dropoff) coordinates.push([dropoff.lng, dropoff.lat]);
    if (driverLocation) coordinates.push([driverLocation.lng, driverLocation.lat]);

    if (coordinates.length < 2) return;

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

  const straightLineFallback = useMemo(() => {
    if (driverLocation && pickup && (routeMode === 'toPickup' || routeMode === 'auto')) {
      const nearPickup =
        Math.abs(driverLocation.lat - pickup.lat) < 0.0013 &&
        Math.abs(driverLocation.lng - pickup.lng) < 0.0013;

      if (routeMode === 'toPickup' || (routeMode === 'auto' && !nearPickup)) {
        return [
          [driverLocation.lng, driverLocation.lat] as [number, number],
          [pickup.lng, pickup.lat] as [number, number],
        ];
      }
    }

    if (driverLocation && dropoff && (routeMode === 'toDropoff' || routeMode === 'auto')) {
      return [
        [driverLocation.lng, driverLocation.lat] as [number, number],
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
          Math.abs(driverLocation.lat - pickup.lat) < 0.0013 &&
          Math.abs(driverLocation.lng - pickup.lng) < 0.0013;

        if (!nearPickup) return { lat: pickup.lat, lng: pickup.lng };
      }

      if (dropoff) return { lat: dropoff.lat, lng: dropoff.lng };
      if (pickup) return { lat: pickup.lat, lng: pickup.lng };
      return null;
    })();

    const fromCoordinate = driverLocation
      ? { lat: driverLocation.lat, lng: driverLocation.lng }
      : pickup
        ? { lat: pickup.lat, lng: pickup.lng }
        : null;

    if (!fromCoordinate || !toCoordinate) {
      setRouteCoordinates(straightLineFallback);
      return;
    }

    const now = Date.now();
    const timeSinceLastFetch = now - lastRouteFetchAtRef.current;
    const lastFrom = lastRouteFromRef.current;
    const movedEnough =
      !lastFrom ||
      Math.abs(lastFrom.lat - fromCoordinate.lat) > 0.0013 ||
      Math.abs(lastFrom.lng - fromCoordinate.lng) > 0.0013;

    if (timeSinceLastFetch < ROUTE_REFRESH_MS && !movedEnough) {
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

    return () => {
      controller.abort();
    };
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

  const handleRecenter = () => {
    if (!cameraRef.current) return;

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

  const topOverlayOffset = Math.max(insets.top + 8, 16);
  const minBottomWithInset = (isNarrow ? 236 : 220) + insets.bottom;
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

        <LocationPuck visible puckBearing="heading" puckBearingEnabled />

        {routeLineGeoJSON && (
          <ShapeSource id="route-line" shape={routeLineGeoJSON}>
            <LineLayer
              id="route-line-backdrop"
              style={{
                lineColor: '#0F172A',
                lineOpacity: 0.2,
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
            <View
              style={[
                styles.driverMarker,
                {
                  transform: [{ rotate: `${Math.round(driverLocation.heading ?? 0)}deg` }],
                },
              ]}
            >
              <View style={styles.driverMarkerArrow} />
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

      <View style={[styles.topOverlay, { top: topOverlayOffset }]} pointerEvents="none">
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live road conditions</Text>
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
      ) : null}

      {showControls ? (
        <View style={[styles.controls, { bottom: Math.max(overlayBottomOffset + 4, 222 + insets.bottom) }]}>
          <Pressable style={styles.controlButton} onPress={handleRecenter}>
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
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#0F172A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  driverMarkerArrow: {
    position: 'absolute',
    top: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#0F172A',
  },
  driverMarkerCabin: {
    width: 11,
    height: 11,
    borderRadius: 999,
    backgroundColor: '#38BDF8',
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
