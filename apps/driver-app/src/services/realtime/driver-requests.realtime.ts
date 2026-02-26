import type { Unsubscribe } from '../firebase';
import { TripRequest, useTripRequestStore } from '../../store/trip-request.store';
import { useDriverStore } from '../../store';
import { subscribeToIncomingTrips, IncomingTripRequest } from './trips.realtime';

/**
 * ============================================================================
 * DRIVER REQUESTS REALTIME LISTENER
 * ============================================================================
 * 
 * Subscribes to trips collection where driverId == currentDriver AND status == 'pending'.
 * Shows incoming trip requests as a modal when driver is ONLINE.
 * 
 * QA VERIFICATION:
 * - LOG: "🎧 [DriverRequests] Listener STARTED for driver: {driverId}"
 * - LOG: "📥 [DriverRequests] New request received: {tripId}"
 * - LOG: "🔇 [DriverRequests] Listener STOPPED"
 * 
 * FIRESTORE PATH: trips/{tripId}
 * QUERY: driverId == currentDriver AND status == 'pending'
 * 
 * ============================================================================
 */

// Singleton listener state
let _unsubscribe: Unsubscribe | null = null;
let _currentDriverId: string | null = null;

/**
 * Start listening for driver trip requests
 * Call when driver goes ONLINE
 * 
 * Listens to trips collection where:
 * - driverId == currentDriver
 * - status == 'pending'
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

  _currentDriverId = driverId;

  // Get driver's current location for distance calculation
  const driverLocation = useDriverStore.getState().currentLocation;

  _unsubscribe = subscribeToIncomingTrips(
    driverId,
    driverLocation,
    (incomingRequest: IncomingTripRequest) => {
      // Convert to TripRequest format for the modal
      const request: TripRequest = {
        tripId: incomingRequest.tripId,
        passengerId: incomingRequest.passengerId,
        pickup: incomingRequest.pickup,
        dropoff: incomingRequest.dropoff,
        estimatedPriceIls: incomingRequest.estimatedPriceIls,
        pickupDistanceKm: incomingRequest.pickupDistanceKm,
        status: incomingRequest.status as 'pending' | 'accepted' | 'rejected' | 'expired',
        createdAt: incomingRequest.createdAt,
        expiresAt: null, // Not used in trips collection
      };

      console.log('📥 [DriverRequests] New request received:', request.tripId);

      // Show the request modal
      useTripRequestStore.getState().showRequest(request);
    },
    () => {
      console.log('📭 [DriverRequests] No pending requests');
    },
    (error) => {
      console.error('❌ [DriverRequests] Listener error:', error);
    }
  );

  console.log('✅ [DriverRequests] Listener STARTED for driver:', driverId);
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
