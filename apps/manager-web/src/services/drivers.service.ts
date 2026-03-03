import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirestoreDb } from './firebase';
import { getFunctionsInstance } from './firebase';

/**
 * ============================================================================
 * DRIVERS REALTIME SERVICE
 * ============================================================================
 * 
 * Subscribes to realtime updates from the drivers collection.
 * 
 * FIRESTORE COLLECTION: drivers/{driverId}
 * 
 * ============================================================================
 */

/**
 * Driver document structure
 */
export interface DriverDocument {
  id: string;
  status: 'online' | 'offline';
  isOnline?: boolean;
  isAvailable?: boolean;
  driverType?: string | null;
  verificationStatus?: string | null;
  lineId?: string | null;
  licenseId?: string | null;
  eligibilityBlocked?: boolean;
  eligibilityBlockReasons?: string[];
  location?: {
    lat: number;
    lng: number;
    updatedAt: Timestamp | null;
  };
  lastSeen: Timestamp | null;
}

/**
 * Subscribe to realtime driver updates
 * 
 * @param callback - Function called whenever drivers data changes
 * @returns Unsubscribe function
 */
export function subscribeToDrivers(
  callback: (drivers: DriverDocument[]) => void
): () => void {
  const db = getFirestoreDb();
  const driversRef = collection(db, 'drivers');

  console.log('🎧 [Drivers] Starting realtime subscription...');

  const unsubscribe = onSnapshot(
    driversRef,
    (snapshot) => {
      const drivers: DriverDocument[] = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        drivers.push({
          id: doc.id,
          status: data.status || 'offline',
          isOnline: data.isOnline ?? (data.status === 'online'),
          isAvailable: data.isAvailable ?? false,
          driverType: typeof data.driverType === 'string' ? data.driverType : null,
          verificationStatus: typeof data.verificationStatus === 'string' ? data.verificationStatus : null,
          lineId: typeof data.lineId === 'string' ? data.lineId : null,
          licenseId: typeof data.licenseId === 'string' ? data.licenseId : null,
          eligibilityBlocked: data.eligibilityBlocked === true,
          eligibilityBlockReasons: Array.isArray(data.eligibilityBlockReasons) ? data.eligibilityBlockReasons : [],
          location: data.location ? {
            lat: data.location.lat,
            lng: data.location.lng,
            updatedAt: data.location.updatedAt || null,
          } : undefined,
          lastSeen: data.lastSeen || null,
        });
      });

      console.log(`🔄 Drivers snapshot updated: ${drivers.length} driver(s)`);
      callback(drivers);
    },
    (error) => {
      console.error('❌ [Drivers] Snapshot error:', error);
    }
  );

  return unsubscribe;
}

export interface UpsertDriverEligibilityInput {
  driverId: string;
  driverType?: string;
  verificationStatus: 'approved' | 'pending' | 'rejected';
  lineId?: string;
  licenseId?: string;
  note?: string;
  forceOfflineIfIneligible?: boolean;
}

export interface UpsertDriverEligibilityResponse {
  success: boolean;
  driverId: string;
  isEligible: boolean;
  reasons: string[];
}

export async function upsertDriverEligibility(
  payload: UpsertDriverEligibilityInput
): Promise<UpsertDriverEligibilityResponse> {
  const functions = getFunctionsInstance();
  const callable = httpsCallable<UpsertDriverEligibilityInput, UpsertDriverEligibilityResponse>(
    functions,
    'managerSetDriverEligibility'
  );
  const result = await callable(payload);
  return result.data;
}
