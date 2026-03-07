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
  officeId?: string | null;
  driverType?: string | null;
  verificationStatus?: string | null;
  fullName?: string | null;
  nationalId?: string | null;
  phone?: string | null;
  lineNumber?: string | null;
  routePath?: string | null;
  routeName?: string | null;
  routeCities?: string[] | null;
  photoUrl?: string | null;
  lineId?: string | null;
  licenseId?: string | null;
  vehicleType?: string | null;
  seatCapacity?: number | null;
  availableSeats?: number | null;
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
          officeId: typeof data.officeId === 'string' ? data.officeId : null,
          driverType: typeof data.driverType === 'string' ? data.driverType : null,
          verificationStatus: typeof data.verificationStatus === 'string' ? data.verificationStatus : null,
          fullName: typeof data.fullName === 'string' ? data.fullName : null,
          nationalId: typeof data.nationalId === 'string' ? data.nationalId : null,
          phone: typeof data.phone === 'string' ? data.phone : null,
          lineNumber: typeof data.lineNumber === 'string' ? data.lineNumber : null,
          routePath: typeof data.routePath === 'string' ? data.routePath : null,
          routeName: typeof data.routeName === 'string' ? data.routeName : null,
          routeCities: Array.isArray(data.routeCities) ? data.routeCities : null,
          photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : null,
          lineId: typeof data.lineId === 'string' ? data.lineId : null,
          licenseId: typeof data.licenseId === 'string' ? data.licenseId : null,
          vehicleType: typeof data.vehicleType === 'string' ? data.vehicleType : null,
          seatCapacity: typeof data.seatCapacity === 'number' ? data.seatCapacity : null,
          availableSeats: typeof data.availableSeats === 'number' ? data.availableSeats : null,
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
  officeId?: string;
  lineId?: string;
  licenseId?: string;
  fullName?: string;
  nationalId?: string;
  phone?: string;
  lineNumber?: string;
  routePath?: string;
  routeName?: string;
  routeCities?: string[];
  photoUrl?: string;
  vehicleType?: string;
  seatCapacity?: number;
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
