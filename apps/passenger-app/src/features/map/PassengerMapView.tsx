import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PassengerMapViewProps } from './PassengerMapViewImpl';

/**
 * ============================================================================
 * MAP LOAD BOUNDARY
 * ============================================================================
 *
 * WHY THE REAL MAP IS NOT IMPORTED AT THE TOP OF THIS FILE
 *
 * `PassengerMapViewImpl` imports `@rnmapbox/maps`, and on the Android emulator that
 * import fails while the module is being EVALUATED:
 *
 *   Exception in HostObject::get for prop 'RNMBXLocationModule'
 *     java.lang.ExceptionInInitializerError
 *       at com.mapbox.common.location.LocationServiceFactory.getOrCreate
 *       at com.rnmapbox.rnmbx.location.LocationManager.<init>
 *
 * expo-router treats a route whose module threw as a route with NO DEFAULT EXPORT.
 * Because home.tsx, searching.tsx and trip.tsx all reach this component, all three
 * routes silently disappeared and the app landed on "Unmatched Route" - the home
 * screen included, so the app looked completely broken.
 *
 * A synchronous require inside try/catch is used rather than React.lazy: the module
 * does not merely load slowly, it THROWS, and a rejected dynamic import surfaces as
 * "Received a promise that resolves to: undefined" instead of something catchable.
 * require() lets the throw be caught right here and turned into a placeholder.
 *
 * A dead map is a degraded screen. A dead route is a dead app.
 *
 * The driver app reaches its map through a separate `map.tsx` route, which is the
 * only reason it survived the same hazard.
 * ============================================================================
 */

type MapComponent = (props: PassengerMapViewProps) => React.ReactElement | null;

let resolved: MapComponent | null = null;
let loadFailed = false;

function loadMapComponent(): MapComponent | null {
  if (resolved) return resolved;
  if (loadFailed) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./PassengerMapViewImpl') as {
      PassengerMapView?: MapComponent;
    };
    if (typeof mod?.PassengerMapView !== 'function') {
      throw new Error('PassengerMapViewImpl did not export a component');
    }
    resolved = mod.PassengerMapView;
    return resolved;
  } catch (error) {
    loadFailed = true;
    console.error(
      '[Map] Map view unavailable on this device; the rest of the app is unaffected.',
      error
    );
    return null;
  }
}

export function PassengerMapView(props: PassengerMapViewProps) {
  const Impl = loadMapComponent();

  if (!Impl) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>الخريطة غير متاحة على هذا الجهاز</Text>
        <Text style={styles.fallbackHint}>Map unavailable on this device</Text>
      </View>
    );
  }

  return <Impl {...props} />;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1f6',
  },
  fallbackText: { fontSize: 15, fontWeight: '600', color: '#334155' },
  fallbackHint: { marginTop: 4, fontSize: 12, color: '#64748b' },
});
