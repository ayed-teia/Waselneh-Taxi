import { firebaseDB, serverTimestamp } from '../firebase';

/**
 * ============================================================================
 * DEV MOCK LOCATION SERVICE
 * ============================================================================
 * 
 * DEV-only service that simulates driver location updates without GPS.
 * Uses mock coordinates with slight random offsets.
 * 
 * FIRESTORE COLLECTION: drivers/{driverId}
 * 
 * DOCUMENT SCHEMA:
 * {
 *   status: "online" | "offline",
 *   location: {
 *     lat: number,
 *     lng: number,
 *     updatedAt: Timestamp
 *   },
 *   lastSeen: Timestamp
 * }
 * 
 * NO GPS PERMISSIONS REQUIRED - uses mock data only.
 * 
 * ============================================================================
 */

// Base location (Nablus city center)
const BASE_LOCATION = {
  lat: 32.2211,
  lng: 35.2544,
};

// Mock location state
let mockLocationInterval: ReturnType<typeof setInterval> | null = null;
let currentDriverId: string | null = null;

/**
 * Generate a small random offset for mock movement
 * Creates movement of approximately 50-100 meters
 */
function getRandomOffset(): number {
  // Random offset between -0.001 and 0.001 degrees (~100m)
  return (Math.random() - 0.5) * 0.002;
}

/**
 * Update driver location in Firestore
 */
async function updateMockLocation(driverId: string): Promise<void> {
  try {
    const lat = BASE_LOCATION.lat + getRandomOffset();
    const lng = BASE_LOCATION.lng + getRandomOffset();

    await firebaseDB.collection('drivers').doc(driverId).set({
      status: 'online',
      location: {
        lat,
        lng,
        updatedAt: serverTimestamp(),
      },
      lastSeen: serverTimestamp(),
    }, { merge: true });

    console.log(`📍 Driver location updated: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  } catch (error) {
    console.error('❌ [MockLocation] Update failed:', error);
  }
}

/**
 * Start mock location updates (DEV mode only)
 * Updates every 3 seconds with random offset
 * 
 * @param driverId - The driver's ID
 */
export async function startMockLocationUpdates(driverId: string): Promise<void> {
  // Guard: Don't start if already running
  if (mockLocationInterval && currentDriverId === driverId) {
    console.log('⚠️ [MockLocation] Already running for this driver');
    return;
  }

  // Stop existing updates if different driver
  if (mockLocationInterval) {
    stopMockLocationUpdates();
  }

  currentDriverId = driverId;

  console.log('🚀 [MockLocation] Starting DEV mock location updates for:', driverId);
  console.log('   Update interval: 3000ms');
  console.log('   Base location: Nablus city center');

  // Send first update immediately
  await updateMockLocation(driverId);

  // Then update every 3 seconds
  mockLocationInterval = setInterval(() => {
    if (currentDriverId) {
      updateMockLocation(currentDriverId);
    }
  }, 3000);
}

/**
 * Stop mock location updates
 */
export async function stopMockLocationUpdates(): Promise<void> {
  if (!mockLocationInterval) {
    console.log('⚠️ [MockLocation] No mock updates running');
    return;
  }

  console.log('🛑 [MockLocation] Stopping mock location updates');

  clearInterval(mockLocationInterval);
  mockLocationInterval = null;

  // Update status to offline
  if (currentDriverId) {
    try {
      await firebaseDB.collection('drivers').doc(currentDriverId).set({
        status: 'offline',
        lastSeen: serverTimestamp(),
      }, { merge: true });

      console.log('   ✓ Driver status set to offline');
    } catch (error) {
      console.error('❌ [MockLocation] Failed to set offline:', error);
    }
  }

  currentDriverId = null;
}

/**
 * Check if mock location is currently active
 */
export function isMockLocationActive(): boolean {
  return mockLocationInterval !== null;
}
