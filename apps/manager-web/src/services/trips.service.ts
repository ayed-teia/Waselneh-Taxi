import { collection, onSnapshot, query, where, Unsubscribe, orderBy } from 'firebase/firestore';

import { getFirestoreDb } from './firebase';

/**
 * Trip data for manager dashboard
 */
export interface TripData {
  tripId: string;
  passengerId: string;
  driverId: string | null;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  status: string;
  estimatedPriceIls: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  // Payment fields
  paymentMethod: 'cash' | string;
  fareAmount: number;
  paymentStatus: 'pending' | 'paid' | string;
  paidAt: Date | null;
  // Timestamps
  createdAt: Date | null;
  acceptedAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Active trip statuses (trips in progress)
 */
const ACTIVE_TRIP_STATUSES = ['accepted', 'driver_arrived', 'in_progress'];

/**
 * Pending/unmatched trip statuses
 */
const PENDING_TRIP_STATUSES = ['pending', 'no_driver_available'];

/**
 * Subscribe to active trips (accepted, arrived, in_progress)
 * Manager can read all trips for monitoring
 */
export function subscribeToActiveTrips(
  onData: (trips: TripData[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  const tripsRef = collection(db, 'trips');
  
  const q = query(
    tripsRef,
    where('status', 'in', ACTIVE_TRIP_STATUSES),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const trips: TripData[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          tripId: docSnap.id,
          passengerId: data.passengerId,
          driverId: data.driverId ?? null,
          pickup: data.pickup,
          dropoff: data.dropoff,
          status: data.status,
          estimatedPriceIls: data.estimatedPriceIls ?? 0,
          estimatedDistanceKm: data.estimatedDistanceKm ?? 0,
          estimatedDurationMin: data.estimatedDurationMin ?? 0,
          // Payment fields
          paymentMethod: data.paymentMethod ?? 'cash',
          fareAmount: data.fareAmount ?? data.estimatedPriceIls ?? 0,
          paymentStatus: data.paymentStatus ?? 'pending',
          paidAt: data.paidAt?.toDate() ?? null,
          // Timestamps
          createdAt: data.createdAt?.toDate() ?? null,
          acceptedAt: data.acceptedAt?.toDate() ?? null,
          arrivedAt: data.arrivedAt?.toDate() ?? null,
          startedAt: data.startedAt?.toDate() ?? null,
          completedAt: data.completedAt?.toDate() ?? null,
        };
      });
      onData(trips);
    },
    onError
  );
}

/**
 * Subscribe to pending/unmatched trip requests
 * Shows trips waiting for driver or with no driver available
 */
export function subscribeToPendingTrips(
  onData: (trips: TripData[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  const tripsRef = collection(db, 'trips');
  
  const q = query(
    tripsRef,
    where('status', 'in', PENDING_TRIP_STATUSES),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const trips: TripData[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          tripId: docSnap.id,
          passengerId: data.passengerId,
          driverId: data.driverId ?? null,
          pickup: data.pickup,
          dropoff: data.dropoff,
          status: data.status,
          estimatedPriceIls: data.estimatedPriceIls ?? 0,
          estimatedDistanceKm: data.estimatedDistanceKm ?? 0,
          estimatedDurationMin: data.estimatedDurationMin ?? 0,
          // Payment fields
          paymentMethod: data.paymentMethod ?? 'cash',
          fareAmount: data.fareAmount ?? data.estimatedPriceIls ?? 0,
          paymentStatus: data.paymentStatus ?? 'pending',
          paidAt: data.paidAt?.toDate() ?? null,
          // Timestamps
          createdAt: data.createdAt?.toDate() ?? null,
          acceptedAt: data.acceptedAt?.toDate() ?? null,
          arrivedAt: data.arrivedAt?.toDate() ?? null,
          startedAt: data.startedAt?.toDate() ?? null,
          completedAt: data.completedAt?.toDate() ?? null,
        };
      });
      onData(trips);
    },
    onError
  );
}

/**
 * Subscribe to completed trips (for payment tracking)
 * Manager can filter unpaid trips
 */
export function subscribeToCompletedTrips(
  onData: (trips: TripData[]) => void,
  onError: (error: Error) => void,
  options?: { unpaidOnly?: boolean }
): Unsubscribe {
  const db = getFirestoreDb();
  const tripsRef = collection(db, 'trips');
  
  const q = query(
    tripsRef,
    where('status', '==', 'completed'),
    orderBy('completedAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      let trips: TripData[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          tripId: docSnap.id,
          passengerId: data.passengerId,
          driverId: data.driverId ?? null,
          pickup: data.pickup,
          dropoff: data.dropoff,
          status: data.status,
          estimatedPriceIls: data.estimatedPriceIls ?? 0,
          estimatedDistanceKm: data.estimatedDistanceKm ?? 0,
          estimatedDurationMin: data.estimatedDurationMin ?? 0,
          // Payment fields
          paymentMethod: data.paymentMethod ?? 'cash',
          fareAmount: data.fareAmount ?? data.estimatedPriceIls ?? 0,
          paymentStatus: data.paymentStatus ?? 'pending',
          paidAt: data.paidAt?.toDate() ?? null,
          // Timestamps
          createdAt: data.createdAt?.toDate() ?? null,
          acceptedAt: data.acceptedAt?.toDate() ?? null,
          arrivedAt: data.arrivedAt?.toDate() ?? null,
          startedAt: data.startedAt?.toDate() ?? null,
          completedAt: data.completedAt?.toDate() ?? null,
        };
      });
      
      // Filter unpaid only if requested
      if (options?.unpaidOnly) {
        trips = trips.filter(t => t.paymentStatus === 'pending');
      }
      
      onData(trips);
    },
    onError
  );
}

/**
 * Get status display info
 */
export function getTripStatusDisplay(status: string): { label: string; color: string; emoji: string } {
  switch (status) {
    case 'pending':
      return { label: 'Waiting for Driver', color: '#f59e0b', emoji: '⏳' };
    case 'accepted':
      return { label: 'Driver Assigned', color: '#3b82f6', emoji: '🚗' };
    case 'driver_arrived':
      return { label: 'Driver Arrived', color: '#8b5cf6', emoji: '📍' };
    case 'in_progress':
      return { label: 'In Progress', color: '#10b981', emoji: '🛣️' };
    case 'completed':
      return { label: 'Completed', color: '#6b7280', emoji: '✅' };
    case 'no_driver_available':
      return { label: 'No Driver', color: '#ef4444', emoji: '❌' };
    case 'cancelled_by_passenger':
      return { label: 'Cancelled', color: '#ef4444', emoji: '🚫' };
    case 'cancelled_by_driver':
      return { label: 'Driver Cancelled', color: '#ef4444', emoji: '🚫' };
    default:
      return { label: status, color: '#6b7280', emoji: '❓' };
  }
}

/**
 * Get payment status display info
 */
export function getPaymentStatusDisplay(paymentStatus: string): { label: string; color: string; emoji: string } {
  switch (paymentStatus) {
    case 'pending':
      return { label: 'Unpaid', color: '#f59e0b', emoji: '⏳' };
    case 'paid':
      return { label: 'Paid', color: '#10b981', emoji: '💵' };
    default:
      return { label: paymentStatus, color: '#6b7280', emoji: '❓' };
  }
}
