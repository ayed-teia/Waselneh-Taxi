import { getFirestore, doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { initializeFirebase } from '../firebase';

/**
 * Get Firestore instance
 */
function getFirestoreDb() {
  const app = initializeFirebase();
  return getFirestore(app);
}

/**
 * Trip request data from Firestore
 */
export interface TripRequestData {
  id: string;
  passengerId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPriceIls: number;
  status: string;
  matchedDriverId?: string;
  matchedTripId?: string;
  matchedAt?: Date;
  createdAt: Date;
}

/**
 * Trip data from Firestore
 */
export interface TripData {
  id: string;
  passengerId: string;
  driverId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPriceIls: number;
  status: string;
  createdAt: Date;
  matchedAt?: Date;
}

/**
 * Subscribe to a trip request document (read-only)
 * Used to track when request is matched to a driver
 */
export function subscribeToTripRequest(
  requestId: string,
  onData: (request: TripRequestData | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  const requestRef = doc(db, 'tripRequests', requestId);

  return onSnapshot(
    requestRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        onData({
          id: snapshot.id,
          passengerId: data.passengerId,
          pickup: data.pickup,
          dropoff: data.dropoff,
          estimatedDistanceKm: data.estimatedDistanceKm,
          estimatedDurationMin: data.estimatedDurationMin,
          estimatedPriceIls: data.estimatedPriceIls,
          status: data.status,
          matchedDriverId: data.matchedDriverId,
          matchedTripId: data.matchedTripId,
          matchedAt: data.matchedAt?.toDate(),
          createdAt: data.createdAt?.toDate(),
        });
      } else {
        onData(null);
      }
    },
    onError
  );
}

/**
 * Subscribe to a trip document (read-only)
 * All writes must go through Cloud Functions
 */
export function subscribeToTrip(
  tripId: string,
  onData: (trip: TripData | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  const tripRef = doc(db, 'trips', tripId);

  return onSnapshot(
    tripRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        onData({
          id: snapshot.id,
          passengerId: data.passengerId,
          driverId: data.driverId,
          pickup: data.pickup,
          dropoff: data.dropoff,
          estimatedDistanceKm: data.estimatedDistanceKm,
          estimatedDurationMin: data.estimatedDurationMin,
          estimatedPriceIls: data.estimatedPriceIls,
          status: data.status,
          createdAt: data.createdAt?.toDate(),
          matchedAt: data.matchedAt?.toDate(),
        });
      } else {
        onData(null);
      }
    },
    onError
  );
}

/**
 * Subscribe to user's active trip (read-only)
 * Placeholder - will be implemented with proper query
 */
export function subscribeToActiveTrip(
  userId: string,
  _onData: (trip: unknown) => void,
  _onError: (error: Error) => void
): Unsubscribe {
  // Placeholder - in production this would query for active trips
  // where passengerId == userId and status in ['pending', 'accepted', 'in_progress']
  console.log('Subscribing to active trip for user:', userId);
  
  // Return a no-op unsubscribe for now
  return () => {
    console.log('Unsubscribed from active trip');
  };
}

