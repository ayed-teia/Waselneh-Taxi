import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { getFirestoreAsync } from '../firebase';

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
  finalPriceIls?: number;
  status: string;
  createdAt: Date;
  matchedAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
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
  let unsubscribe: Unsubscribe | null = null;

  getFirestoreAsync()
    .then((db) => {
      const requestRef = doc(db, 'tripRequests', requestId);

      unsubscribe = onSnapshot(
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
    })
    .catch(onError);

  return () => {
    if (unsubscribe) {
      unsubscribe();
    }
  };
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
  let unsubscribe: Unsubscribe | null = null;

  console.log('🔔 [TripSubscription] Starting for tripId:', tripId);

  getFirestoreAsync()
    .then((db) => {
      const tripRef = doc(db, 'trips', tripId);

      unsubscribe = onSnapshot(
        tripRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            console.log('📡 [TripSubscription] Update received:', { tripId, status: data.status });
            onData({
              id: snapshot.id,
              passengerId: data.passengerId,
              driverId: data.driverId,
              pickup: data.pickup,
              dropoff: data.dropoff,
              estimatedDistanceKm: data.estimatedDistanceKm,
              estimatedDurationMin: data.estimatedDurationMin,
              estimatedPriceIls: data.estimatedPriceIls,
              finalPriceIls: data.finalPriceIls,
              status: data.status,
              createdAt: data.createdAt?.toDate(),
              matchedAt: data.matchedAt?.toDate(),
              arrivedAt: data.arrivedAt?.toDate(),
              startedAt: data.startedAt?.toDate(),
              completedAt: data.completedAt?.toDate(),
            });
          } else {
            console.log('⚠️ [TripSubscription] Trip not found:', tripId);
            onData(null);
          }
        },
        onError
      );
    })
    .catch(onError);

  return () => {
    console.log('🔇 [TripSubscription] Unsubscribing from tripId:', tripId);
    if (unsubscribe) {
      unsubscribe();
    }
  };
}

/**
 * Subscribe to user's active trip (read-only)
 * Finds any ongoing trip for the passenger and subscribes to updates.
 * 
 * Active statuses: pending, accepted, driver_arrived, in_progress
 */
export function subscribeToActiveTrip(
  userId: string,
  onData: (trip: TripData | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;

  console.log('🔔 [ActiveTrip] Starting subscription for user:', userId);

  getFirestoreAsync()
    .then(async (db) => {
      const { collection, query, where, onSnapshot: firestoreOnSnapshot, orderBy, limit } = await import('firebase/firestore');
      
      const tripsRef = collection(db, 'trips');
      
      // Query for active trips where this user is the passenger
      // Active = not completed or cancelled
      const activeStatuses = ['pending', 'accepted', 'driver_arrived', 'in_progress'];
      const q = query(
        tripsRef,
        where('passengerId', '==', userId),
        where('status', 'in', activeStatuses),
        orderBy('createdAt', 'desc'),
        limit(1)
      );

      unsubscribe = firestoreOnSnapshot(
        q,
        (snapshot) => {
          if (snapshot.empty) {
            console.log('ℹ️ [ActiveTrip] No active trip found for user:', userId);
            onData(null);
            return;
          }

          const docSnap = snapshot.docs[0];
          const data = docSnap.data();
          console.log('📡 [ActiveTrip] Found active trip:', { tripId: docSnap.id, status: data.status });
          
          onData({
            id: docSnap.id,
            passengerId: data.passengerId,
            driverId: data.driverId,
            pickup: data.pickup,
            dropoff: data.dropoff,
            estimatedDistanceKm: data.estimatedDistanceKm,
            estimatedDurationMin: data.estimatedDurationMin,
            estimatedPriceIls: data.estimatedPriceIls,
            finalPriceIls: data.finalPriceIls,
            status: data.status,
            createdAt: data.createdAt?.toDate(),
            matchedAt: data.matchedAt?.toDate(),
            arrivedAt: data.arrivedAt?.toDate(),
            startedAt: data.startedAt?.toDate(),
            completedAt: data.completedAt?.toDate(),
          });
        },
        onError
      );
    })
    .catch(onError);

  return () => {
    console.log('🔇 [ActiveTrip] Unsubscribing for user:', userId);
    if (unsubscribe) {
      unsubscribe();
    }
  };
}

