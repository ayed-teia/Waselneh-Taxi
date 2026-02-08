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
  doc,
} from 'firebase/firestore';
import { getFirestoreAsync } from '../firebase';

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
  createdAt?: Date;
  matchedAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Subscribe to available trip requests (read-only)
 * Drivers can read trip requests per Firestore rules
 */
export function subscribeToTripRequests(
  onData: (requests: unknown[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;

  getFirestoreAsync()
    .then((db) => {
      const requestsRef = collection(db, 'tripRequests');

      // Query for pending requests, ordered by creation time
      const q = query(
        requestsRef,
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc'),
        limit(20)
      );

      unsubscribe = onSnapshot(
        q,
        (snapshot: QuerySnapshot<DocumentData>) => {
          const requests = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          onData(requests);
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
 * Subscribe to driver's active trip (read-only)
 */
export function subscribeToActiveTrip(
  driverId: string,
  onData: (trip: TripData | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;

  getFirestoreAsync()
    .then((db) => {
      const tripsRef = collection(db, 'trips');

      // Query for driver's active trip (includes accepted)
      const q = query(
        tripsRef,
        where('driverId', '==', driverId),
        where('status', 'in', ['accepted', 'driver_arrived', 'in_progress']),
        limit(1)
      );

      unsubscribe = onSnapshot(
        q,
        (snapshot: QuerySnapshot<DocumentData>) => {
          if (!snapshot.empty) {
            const docSnap = snapshot.docs[0]!;
            const data = docSnap.data();
            onData({
              id: docSnap.id,
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
              arrivedAt: data.arrivedAt?.toDate(),
              startedAt: data.startedAt?.toDate(),
              completedAt: data.completedAt?.toDate(),
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
 * Subscribe to a specific trip by ID (read-only)
 */
export function subscribeToTrip(
  tripId: string,
  onData: (trip: TripData | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;

  getFirestoreAsync()
    .then((db) => {
      const tripRef = doc(db, 'trips', tripId);

      unsubscribe = onSnapshot(
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
              arrivedAt: data.arrivedAt?.toDate(),
              startedAt: data.startedAt?.toDate(),
              completedAt: data.completedAt?.toDate(),
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
