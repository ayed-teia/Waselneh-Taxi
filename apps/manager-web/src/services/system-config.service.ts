/**
 * System Configuration Service
 * 
 * Step 32: Pilot Hardening & Kill Switches
 * Step 33: Go-Live Mode - Feature Flags
 * 
 * Manages system-wide configuration including feature flags.
 */

import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { getFirestoreDb, getFunctionsInstance } from './firebase';

/**
 * Feature flag names
 */
export type FeatureFlag = 'tripsEnabled' | 'roadblocksEnabled' | 'paymentsEnabled';

/**
 * System configuration document
 */
export interface SystemConfig {
  tripsEnabled: boolean;
  roadblocksEnabled: boolean;
  paymentsEnabled: boolean;
  updatedAt?: Date;
  updatedBy?: string;
}

/**
 * Subscribe to system configuration changes
 */
export function subscribeToSystemConfig(
  onData: (config: SystemConfig) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  const configRef = doc(db, 'system', 'config');
  
  return onSnapshot(
    configRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        onData({
          tripsEnabled: data.tripsEnabled ?? true,
          roadblocksEnabled: data.roadblocksEnabled ?? true,
          paymentsEnabled: data.paymentsEnabled ?? false,
          updatedAt: data.updatedAt?.toDate(),
          updatedBy: data.updatedBy,
        });
      } else {
        // Default config
        onData({ 
          tripsEnabled: true,
          roadblocksEnabled: true,
          paymentsEnabled: false,
        });
      }
    },
    (error) => {
      console.error('Error subscribing to system config:', error);
      onError?.(error);
    }
  );
}

/**
 * Toggle trips enabled/disabled (kill switch)
 */
export async function toggleTripsEnabled(enabled: boolean): Promise<void> {
  const functions = getFunctionsInstance();
  const toggleTrips = httpsCallable<{ enabled: boolean }, { tripsEnabled: boolean }>(
    functions,
    'managerToggleTrips'
  );
  
  await toggleTrips({ enabled });
}

/**
 * Toggle any feature flag
 */
export async function toggleFeatureFlag(flag: FeatureFlag, enabled: boolean): Promise<void> {
  const functions = getFunctionsInstance();
  const toggleFlag = httpsCallable<{ flag: FeatureFlag; enabled: boolean }, { flag: string; enabled: boolean }>(
    functions,
    'managerToggleFeatureFlag'
  );
  
  await toggleFlag({ flag, enabled });
}

/**
 * Force cancel a trip (manager override)
 */
export async function forceCancelTrip(tripId: string, reason?: string): Promise<void> {
  const functions = getFunctionsInstance();
  const forceCancel = httpsCallable<{ tripId: string; reason?: string }, { cancelled: boolean }>(
    functions,
    'managerForceCancelTrip'
  );
  
  await forceCancel({ tripId, reason });
}
