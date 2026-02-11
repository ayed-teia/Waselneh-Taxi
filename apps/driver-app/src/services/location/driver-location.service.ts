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
 * Writes to BOTH collections:
 * - driverLive/{driverId} - for live map tracking
 * - drivers/{driverId} - for driver status/availability
 */
export async function updateDriverLocation(
  driverId: string,
  location: LocationUpdate
): Promise<void> {
  try {
    const db = await getFirestoreAsync();
    const now = serverTimestamp();

    // Update driverLive collection (for live map)
    const locationRef = doc(db, 'driverLive', driverId);
    await setDoc(locationRef, {
      driverId,
      lat: location.lat,
      lng: location.lng,
      heading: location.heading ?? null,
      speed: location.speed ?? null,
      updatedAt: now,
      status: 'online',
    });

    // Also update drivers collection (for drivers list page)
    const driverRef = doc(db, 'drivers', driverId);
    await setDoc(driverRef, {
      status: 'online',
      location: {
        lat: location.lat,
        lng: location.lng,
        updatedAt: now,
      },
      lastSeen: now,
    }, { merge: true });

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
 * Deletes from driverLive and updates drivers collection
 */
export async function removeDriverLocation(driverId: string): Promise<void> {
  try {
    const db = await getFirestoreAsync();

    // Delete from driverLive (for live map)
    const locationRef = doc(db, 'driverLive', driverId);
    await deleteDoc(locationRef);

    // Update drivers collection to offline status
    const driverRef = doc(db, 'drivers', driverId);
    await setDoc(driverRef, {
      status: 'offline',
      lastSeen: serverTimestamp(),
    }, { merge: true });

    console.log('🗑️ [Firestore] driverLive/' + driverId + ' DELETED, status set to offline');
    
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
 * 
 * Collection: drivers/{driverId}
 * 
 * Fields:
 * - isOnline: boolean - Driver has toggled to online
 * - isAvailable: boolean - Driver can receive new trips (online + not on a trip)
 * - lastLocation: GeoPoint - Last known location
 * - updatedAt: Timestamp
 */
export async function setDriverAvailability(
  driverId: string,
  isOnline: boolean,
  currentLocation?: { lat: number; lng: number }
): Promise<void> {
  try {
    const db = await getFirestoreAsync();
    const driverRef = doc(db, 'drivers', driverId);

    if (isOnline) {
      await setDoc(driverRef, {
        driverId,
        status: 'online',
        isOnline: true,
        isAvailable: true, // When going online, driver is available for trips
        availability: 'available', // Trip lifecycle controls this field
        lastLocation: currentLocation
          ? new GeoPoint(currentLocation.lat, currentLocation.lng)
          : null,
        lastSeen: serverTimestamp(),
        onlineSince: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      console.log('🟢 [Driver] Online + Available:', driverId);
    } else {
      await setDoc(driverRef, {
        driverId,
        status: 'offline',
        isOnline: false,
        isAvailable: false, // When going offline, driver is not available
        availability: 'available', // Reset to available when offline
        lastSeen: serverTimestamp(),
        offlineSince: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      console.log('⚫ [Driver] Offline:', driverId);
    }
  } catch (error) {
    console.error('[Driver] Error setting availability:', error);
    throw error;
  }
}
