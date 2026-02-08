import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  GeoPoint,
} from 'firebase/firestore';
import { getFirestoreAsync } from '../firebase';

/**
 * ============================================================================
 * DRIVER LIVE LOCATION FIRESTORE SERVICE
 * ============================================================================
 * 
 * Handles Firestore writes for driver location tracking.
 * 
 * FIRESTORE COLLECTION: driverLive/{driverId}
 * 
 * DOCUMENT SCHEMA:
 * {
 *   driverId: string,       // Driver's auth UID
 *   lat: number,            // Latitude
 *   lng: number,            // Longitude  
 *   heading: number | null, // Direction in degrees (0-360)
 *   speed: number | null,   // Speed in m/s
 *   updatedAt: Timestamp,   // Server timestamp
 *   status: "online"        // Always "online" while document exists
 * }
 * 
 * SECURITY RULES:
 * - Write: Only driver can write their own document (auth.uid === driverId)
 * - Read: Managers can read all, passengers can read (MVP)
 * 
 * QA VERIFICATION:
 * - Check Firestore Emulator UI at http://localhost:4000/firestore
 * - Document should appear when driver goes online
 * - Document should update every ~2 seconds
 * - Document should be DELETED when driver goes offline
 * 
 * ============================================================================
 */

/**
 * Location update data structure
 */
export interface LocationUpdate {
  lat: number;
  lng: number;
  heading?: number | undefined;
  speed?: number | undefined;
}

// Track if this is the first write (for logging)
let isFirstWrite = true;

/**
 * Update driver's live location in Firestore
 * Creates document if doesn't exist, updates if exists
 */
export async function updateDriverLocation(
  driverId: string,
  location: LocationUpdate
): Promise<void> {
  try {
    const db = await getFirestoreAsync();
    const locationRef = doc(db, 'driverLive', driverId);

    await setDoc(locationRef, {
      driverId,
      lat: location.lat,
      lng: location.lng,
      heading: location.heading ?? null,
      speed: location.speed ?? null,
      updatedAt: serverTimestamp(),
      status: 'online',
    });

    // Log first write explicitly
    if (isFirstWrite) {
      console.log('✅ [Firestore] driverLive/' + driverId + ' CREATED');
      isFirstWrite = false;
    }
  } catch (error) {
    console.error('❌ [Firestore] Write to driverLive failed:', error);
    throw error;
  }
}

/**
 * Remove driver's live location (when going offline)
 * Deletes the document from Firestore
 */
export async function removeDriverLocation(driverId: string): Promise<void> {
  try {
    const db = await getFirestoreAsync();
    const locationRef = doc(db, 'driverLive', driverId);

    await deleteDoc(locationRef);
    console.log('🗑️ [Firestore] driverLive/' + driverId + ' DELETED');
    
    // Reset first write flag for next online session
    isFirstWrite = true;
  } catch (error) {
    console.error('❌ [Firestore] Delete from driverLive failed:', error);
    // Don't throw - cleanup errors shouldn't crash the app
  }
}

/**
 * Set driver availability status
 * This write is allowed by Firestore rules for the driver's own document
 */
export async function setDriverAvailability(
  driverId: string,
  isOnline: boolean,
  currentLocation?: { lat: number; lng: number }
): Promise<void> {
  try {
    const db = await getFirestoreAsync();
    const availabilityRef = doc(db, 'driverAvailability', driverId);

    if (isOnline) {
      await setDoc(availabilityRef, {
        driverId,
        isOnline: true,
        lastLocation: currentLocation
          ? new GeoPoint(currentLocation.lat, currentLocation.lng)
          : null,
        onlineSince: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log('[DriverLocation] Driver is now ONLINE:', driverId);
    } else {
      await setDoc(availabilityRef, {
        driverId,
        isOnline: false,
        offlineSince: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log('[DriverLocation] Driver is now OFFLINE:', driverId);
    }
  } catch (error) {
    console.error('[DriverLocation] Error setting availability:', error);
    throw error;
  }
}
