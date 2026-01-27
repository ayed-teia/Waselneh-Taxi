import { collection, onSnapshot, query, Unsubscribe, doc, getDoc } from 'firebase/firestore';
import { getFirestoreDb } from './firebase';

/**
 * Driver profile info (from drivers collection)
 */
export interface DriverProfile {
  name?: string;
  phone?: string;
  lineId?: string;
  vehiclePlate?: string;
}

/**
 * Driver live location data with profile info
 */
export interface DriverLiveLocation {
  driverId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  updatedAt: Date | null;
  // Profile data (fetched from drivers collection)
  name?: string;
  lineId?: string;
  isOnline: boolean;
}

/**
 * Cache for driver profiles to avoid repeated fetches
 */
const profileCache = new Map<string, DriverProfile>();

/**
 * Fetch driver profile from drivers collection
 */
async function fetchDriverProfile(driverId: string): Promise<DriverProfile | null> {
  // Check cache first
  if (profileCache.has(driverId)) {
    return profileCache.get(driverId)!;
  }

  try {
    const db = getFirestoreDb();
    const driverDoc = await getDoc(doc(db, 'drivers', driverId));
    
    if (driverDoc.exists()) {
      const data = driverDoc.data();
      const profile: DriverProfile = {
        name: data.name ?? data.displayName ?? undefined,
        phone: data.phone ?? undefined,
        lineId: data.lineId ?? undefined,
        vehiclePlate: data.vehiclePlate ?? undefined,
      };
      profileCache.set(driverId, profile);
      return profile;
    }
  } catch (error) {
    console.warn('Failed to fetch driver profile:', driverId, error);
  }
  
  return null;
}

/**
 * Subscribe to all driver live locations
 * Manager can read all driver locations for monitoring
 */
export function subscribeToAllDriverLocations(
  onData: (drivers: DriverLiveLocation[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  const driversRef = collection(db, 'driverLive');
  const q = query(driversRef);

  return onSnapshot(
    q,
    async (snapshot) => {
      const driversPromises = snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data();
        const profile = await fetchDriverProfile(docSnap.id);
        
        return {
          driverId: docSnap.id,
          lat: data.lat,
          lng: data.lng,
          heading: data.heading ?? null,
          speed: data.speed ?? null,
          updatedAt: data.updatedAt?.toDate() ?? null,
          name: profile?.name,
          lineId: profile?.lineId,
          isOnline: true, // If in driverLive, they're online
        };
      });
      
      const drivers = await Promise.all(driversPromises);
      onData(drivers);
    },
    onError
  );
}

/**
 * Get unique line IDs from driver list
 */
export function getUniqueLineIds(drivers: DriverLiveLocation[]): string[] {
  const lineIds = new Set<string>();
  drivers.forEach(driver => {
    if (driver.lineId) {
      lineIds.add(driver.lineId);
    }
  });
  return Array.from(lineIds).sort();
}
