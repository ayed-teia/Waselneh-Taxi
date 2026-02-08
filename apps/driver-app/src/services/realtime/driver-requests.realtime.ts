import {
  collection,
  query,
  where,
  onSnapshot,
  Unsubscribe,
  orderBy,
  limit,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';
import { getFirestoreAsync } from '../firebase';
import { TripRequest, useTripRequestStore } from '../../store/trip-request.store';
import { useDriverStore } from '../../store';

/**
 * ============================================================================
 * DRIVER REQUESTS REALTIME LISTENER
 * ============================================================================
 * 
 * Subscribes to driverRequests/{driverId}/requests collection.
 * Shows incoming trip requests as a modal when driver is ONLINE.
 * 
 * QA VERIFICATION:
 * - LOG: "🎧 [DriverRequests] Listener STARTED for driver: {driverId}"
 * - LOG: "📥 [DriverRequests] New request received: {tripId}"
 * - LOG: "🔇 [DriverRequests] Listener STOPPED"
 * 
 * FIRESTORE PATH: driverRequests/{driverId}/requests/{tripId}
 * 
 * DOCUMENT SCHEMA (from Cloud Function):
 * {
 *   tripId: string,
 *   passengerId: string,
 *   pickup: { lat, lng },
 *   dropoff: { lat, lng },
 *   estimatedPriceIls: number,
 *   status: 'pending' | 'accepted' | 'rejected' | 'expired',
 *   createdAt: Timestamp,
 *   expiresAt: Timestamp
 * }
 * 
 * ============================================================================
 */

// Singleton listener state
let _unsubscribe: Unsubscribe | null = null;
let _currentDriverId: string | null = null;

/**
 * Haversine formula to calculate distance between two points
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Start listening for driver trip requests
 * Call when driver goes ONLINE
 */
export async function startDriverRequestsListener(driverId: string): Promise<void> {
  // Guard: Already listening for this driver
  if (_unsubscribe && _currentDriverId === driverId) {
    console.log('🎧 [DriverRequests] Listener already active for:', driverId);
    return;
  }

  // Stop any existing listener first
  if (_unsubscribe) {
    await stopDriverRequestsListener();
  }

  console.log('🎧 [DriverRequests] Starting listener for driver:', driverId);

  try {
    const db = await getFirestoreAsync();
    const requestsRef = collection(db, 'driverRequests', driverId, 'requests');

    // Query for pending requests only, ordered by creation time
    const q = query(
      requestsRef,
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(1) // Only show the most recent pending request
    );

    _currentDriverId = driverId;

    _unsubscribe = onSnapshot(
      q,
      (snapshot: QuerySnapshot<DocumentData>) => {
        // Get driver's current location for distance calculation
        const driverLocation = useDriverStore.getState().currentLocation;

        if (snapshot.empty) {
          console.log('📭 [DriverRequests] No pending requests');
          return;
        }

        // Process the newest pending request
        const docSnap = snapshot.docs[0]!;
        const data = docSnap.data();

        // Calculate distance from driver to pickup
        let pickupDistanceKm = 0;
        if (driverLocation) {
          pickupDistanceKm = calculateDistance(
            driverLocation.lat,
            driverLocation.lng,
            data.pickup.lat,
            data.pickup.lng
          );
        }

        const request: TripRequest = {
          tripId: data.tripId,
          passengerId: data.passengerId,
          pickup: data.pickup,
          dropoff: data.dropoff,
          estimatedPriceIls: data.estimatedPriceIls,
          pickupDistanceKm: Math.round(pickupDistanceKm * 10) / 10, // Round to 1 decimal
          status: data.status,
          createdAt: data.createdAt?.toDate() ?? null,
          expiresAt: data.expiresAt?.toDate() ?? null,
        };

        console.log('📥 [DriverRequests] New request received:', request.tripId);
        console.log('   📍 Pickup distance:', pickupDistanceKm.toFixed(2), 'km');
        console.log('   💵 Estimated price: ₪' + request.estimatedPriceIls);

        // Show the request modal
        useTripRequestStore.getState().showRequest(request);
      },
      (error) => {
        console.error('❌ [DriverRequests] Listener error:', error);
      }
    );

    console.log('✅ [DriverRequests] Listener STARTED for driver:', driverId);
  } catch (error) {
    console.error('❌ [DriverRequests] Failed to start listener:', error);
    _currentDriverId = null;
  }
}

/**
 * Stop listening for driver trip requests
 * Call when driver goes OFFLINE
 */
export async function stopDriverRequestsListener(): Promise<void> {
  if (!_unsubscribe) {
    console.log('🔇 [DriverRequests] No active listener to stop');
    return;
  }

  console.log('🔇 [DriverRequests] Stopping listener for driver:', _currentDriverId);

  _unsubscribe();
  _unsubscribe = null;
  _currentDriverId = null;

  // Clear any pending request modal
  useTripRequestStore.getState().clearAll();

  console.log('✅ [DriverRequests] Listener STOPPED');
}

/**
 * Check if listener is active
 */
export function isDriverRequestsListenerActive(): boolean {
  return _unsubscribe !== null;
}
