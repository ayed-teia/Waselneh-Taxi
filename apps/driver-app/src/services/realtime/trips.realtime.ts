import { firebaseDB, Unsubscribe } from '../firebase';

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
  acceptedAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Incoming trip request from trips collection
 */
export interface IncomingTripRequest {
  tripId: string;
  passengerId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedPriceIls: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  pickupDistanceKm: number;
  status: string;
  createdAt: Date | null;
}

/**
 * Subscribe to available trip requests (read-only)
 * Drivers can read trip requests per Firestore rules
 */
export function subscribeToTripRequests(
  onData: (requests: unknown[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('tripRequests')
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .limit(20)
    .onSnapshot(
      (snapshot) => {
        const requests = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        onData(requests);
      },
      onError
    );
}

/**
 * Haversine formula to calculate distance between two points (km)
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

/**
 * Subscribe to incoming trip requests for the driver
 * 
 * Listens to trips where:
 * - driverId == current driver
 * - status == 'pending'
 * 
 * Shows incoming trip modal when a new request arrives.
 * 
 * @param driverId - The driver's user ID
 * @param driverLocation - Driver's current location for distance calculation
 * @param onRequest - Callback when a new trip request arrives
 * @param onNoRequest - Callback when no pending requests
 * @param onError - Error callback
 * @returns Unsubscribe function
 */
export function subscribeToIncomingTrips(
  driverId: string,
  driverLocation: { lat: number; lng: number } | null,
  onRequest: (request: IncomingTripRequest) => void,
  onNoRequest: () => void,
  onError: (error: Error) => void
): Unsubscribe {
  console.log('🎧 [IncomingTrips] Starting listener for driver:', driverId);

  const unsubscribe = firebaseDB
    .collection('trips')
    .where('driverId', '==', driverId)
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .onSnapshot(
      (snapshot) => {
        if (snapshot.empty) {
          console.log('📭 [IncomingTrips] No pending requests');
          onNoRequest();
          return;
        }

        const docSnap = snapshot.docs[0]!;
        const data = docSnap.data();

        // Calculate distance from driver to pickup
        let pickupDistanceKm = 0;
        if (driverLocation && data?.pickup) {
          pickupDistanceKm = calculateDistance(
            driverLocation.lat,
            driverLocation.lng,
            data.pickup.lat,
            data.pickup.lng
          );
        }

        const request: IncomingTripRequest = {
          tripId: docSnap.id,
          passengerId: data?.passengerId,
          pickup: data?.pickup,
          dropoff: data?.dropoff,
          estimatedPriceIls: data?.estimatedPriceIls,
          estimatedDistanceKm: data?.estimatedDistanceKm,
          estimatedDurationMin: data?.estimatedDurationMin,
          pickupDistanceKm: Math.round(pickupDistanceKm * 10) / 10,
          status: data?.status,
          createdAt: data?.createdAt?.toDate() ?? null,
        };

        console.log('📥 [IncomingTrips] New request received:', request.tripId);
        console.log('   📍 Pickup distance:', pickupDistanceKm.toFixed(2), 'km');
        console.log('   💵 Estimated price: ₪' + request.estimatedPriceIls);

        onRequest(request);
      },
      (error) => {
        console.error('❌ [IncomingTrips] Listener error:', error);
        onError(error);
      }
    );

  console.log('✅ [IncomingTrips] Listener STARTED for driver:', driverId);

  return () => {
    console.log('🔇 [IncomingTrips] Listener STOPPED for driver:', driverId);
    unsubscribe();
  };
}

/**
 * Subscribe to ALL pending trips (unassigned)
 * 
 * Listens to trips where:
 * - status == 'pending'
 * - assignedDriverId == null
 * 
 * This allows drivers to see ALL available trip requests.
 * 
 * @param driverLocation - Driver's current location for distance calculation
 * @param onTrips - Callback when trips change (receives array of trips)
 * @param onError - Error callback
 * @returns Unsubscribe function
 */
export function subscribeToAvailableTrips(
  driverLocation: { lat: number; lng: number } | null,
  onTrips: (trips: IncomingTripRequest[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  console.log('🎧 [AvailableTrips] Starting listener for ALL pending trips');

  const unsubscribe = firebaseDB
    .collection('trips')
    .where('status', '==', 'pending')
    .where('assignedDriverId', '==', null)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .onSnapshot(
      (snapshot) => {
        if (snapshot.empty) {
          console.log('📭 [AvailableTrips] No pending trips available');
          onTrips([]);
          return;
        }

        const trips: IncomingTripRequest[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();

          // Calculate distance from driver to pickup
          let pickupDistanceKm = 0;
          if (driverLocation && data?.pickup) {
            pickupDistanceKm = calculateDistance(
              driverLocation.lat,
              driverLocation.lng,
              data.pickup.lat,
              data.pickup.lng
            );
          }

          console.log('🚨 NEW TRIP REQUEST:', docSnap.id);

          return {
            tripId: docSnap.id,
            passengerId: data?.passengerId,
            pickup: data?.pickup || { lat: 0, lng: 0 },
            dropoff: data?.destination || data?.dropoff || { lat: 0, lng: 0 },
            estimatedPriceIls: data?.estimatedPriceIls || 0,
            estimatedDistanceKm: data?.estimatedDistanceKm || 0,
            estimatedDurationMin: data?.estimatedDurationMin || 0,
            pickupDistanceKm: Math.round(pickupDistanceKm * 10) / 10,
            status: data?.status,
            createdAt: data?.createdAt?.toDate() ?? null,
          };
        });

        console.log(`📥 [AvailableTrips] Found ${trips.length} pending trip(s)`);
        onTrips(trips);
      },
      (error) => {
        console.error('❌ [AvailableTrips] Listener error:', error);
        onError(error);
      }
    );

  console.log('✅ [AvailableTrips] Listener STARTED');

  return () => {
    console.log('🔇 [AvailableTrips] Listener STOPPED');
    unsubscribe();
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
  return firebaseDB
    .collection('trips')
    .where('driverId', '==', driverId)
    .where('status', 'in', ['accepted', 'driver_arrived', 'in_progress'])
    .limit(1)
    .onSnapshot(
      (snapshot) => {
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0]!;
          const data = docSnap.data();
          onData({
            id: docSnap.id,
            passengerId: data?.passengerId,
            driverId: data?.driverId,
            pickup: data?.pickup,
            dropoff: data?.dropoff,
            estimatedDistanceKm: data?.estimatedDistanceKm,
            estimatedDurationMin: data?.estimatedDurationMin,
            estimatedPriceIls: data?.estimatedPriceIls,
            status: data?.status,
            createdAt: data?.createdAt?.toDate(),
            matchedAt: data?.matchedAt?.toDate(),
            arrivedAt: data?.arrivedAt?.toDate(),
            startedAt: data?.startedAt?.toDate(),
            completedAt: data?.completedAt?.toDate(),
          });
        } else {
          onData(null);
        }
      },
      onError
    );
}

/**
 * Subscribe to a specific trip by ID (read-only)
 */
export function subscribeToTrip(
  tripId: string,
  onData: (trip: TripData | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('trips')
    .doc(tripId)
    .onSnapshot(
      (snapshot) => {
        if (snapshot.exists) {
          const data = snapshot.data();
          onData({
            id: snapshot.id,
            passengerId: data?.passengerId,
            driverId: data?.driverId,
            pickup: data?.pickup,
            dropoff: data?.dropoff,
            estimatedDistanceKm: data?.estimatedDistanceKm,
            estimatedDurationMin: data?.estimatedDurationMin,
            estimatedPriceIls: data?.estimatedPriceIls,
            status: data?.status,
            createdAt: data?.createdAt?.toDate(),
            matchedAt: data?.matchedAt?.toDate(),
            arrivedAt: data?.arrivedAt?.toDate(),
            startedAt: data?.startedAt?.toDate(),
            completedAt: data?.completedAt?.toDate(),
          });
        } else {
          onData(null);
        }
      },
      onError
    );
}
