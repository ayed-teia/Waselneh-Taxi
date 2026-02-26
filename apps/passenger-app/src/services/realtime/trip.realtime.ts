import { firebaseDB, Unsubscribe } from '../firebase';

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
  return firebaseDB
    .collection('tripRequests')
    .doc(requestId)
    .onSnapshot(
      (snapshot) => {
        if (snapshot.exists) {
          const data = snapshot.data();
          onData({
            id: snapshot.id,
            passengerId: data?.passengerId,
            pickup: data?.pickup,
            dropoff: data?.dropoff,
            estimatedDistanceKm: data?.estimatedDistanceKm,
            estimatedDurationMin: data?.estimatedDurationMin,
            estimatedPriceIls: data?.estimatedPriceIls,
            status: data?.status,
            matchedDriverId: data?.matchedDriverId,
            matchedTripId: data?.matchedTripId,
            matchedAt: data?.matchedAt?.toDate(),
            createdAt: data?.createdAt?.toDate(),
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
  console.log('🔔 [TripSubscription] Starting for tripId:', tripId);

  return firebaseDB
    .collection('trips')
    .doc(tripId)
    .onSnapshot(
      (snapshot) => {
        if (snapshot.exists) {
          const data = snapshot.data();
          console.log('📡 [TripSubscription] Update received:', { tripId, status: data?.status });
          onData({
            id: snapshot.id,
            passengerId: data?.passengerId,
            driverId: data?.driverId,
            pickup: data?.pickup,
            dropoff: data?.dropoff,
            estimatedDistanceKm: data?.estimatedDistanceKm,
            estimatedDurationMin: data?.estimatedDurationMin,
            estimatedPriceIls: data?.estimatedPriceIls,
            finalPriceIls: data?.finalPriceIls,
            status: data?.status,
            createdAt: data?.createdAt?.toDate(),
            matchedAt: data?.matchedAt?.toDate(),
            arrivedAt: data?.arrivedAt?.toDate(),
            startedAt: data?.startedAt?.toDate(),
            completedAt: data?.completedAt?.toDate(),
          });
        } else {
          console.log('⚠️ [TripSubscription] Trip not found:', tripId);
          onData(null);
        }
      },
      onError
    );
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
  console.log('🔔 [ActiveTrip] Starting subscription for user:', userId);

  const activeStatuses = ['pending', 'accepted', 'driver_arrived', 'in_progress'];

  return firebaseDB
    .collection('trips')
    .where('passengerId', '==', userId)
    .where('status', 'in', activeStatuses)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .onSnapshot(
      (snapshot) => {
        if (snapshot.empty) {
          console.log('ℹ️ [ActiveTrip] No active trip found for user:', userId);
          onData(null);
          return;
        }

        const docSnap = snapshot.docs[0]!;
        const data = docSnap.data();
        console.log('📡 [ActiveTrip] Found active trip:', { tripId: docSnap.id, status: data?.status });
        
        onData({
          id: docSnap.id,
          passengerId: data?.passengerId,
          driverId: data?.driverId,
          pickup: data?.pickup,
          dropoff: data?.dropoff,
          estimatedDistanceKm: data?.estimatedDistanceKm,
          estimatedDurationMin: data?.estimatedDurationMin,
          estimatedPriceIls: data?.estimatedPriceIls,
          finalPriceIls: data?.finalPriceIls,
          status: data?.status,
          createdAt: data?.createdAt?.toDate(),
          matchedAt: data?.matchedAt?.toDate(),
          arrivedAt: data?.arrivedAt?.toDate(),
          startedAt: data?.startedAt?.toDate(),
          completedAt: data?.completedAt?.toDate(),
        });
      },
      onError
    );
}

