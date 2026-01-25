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
 * Subscribe to a trip document (read-only)
 * All writes must go through Cloud Functions
 */
export function subscribeToTrip(
  tripId: string,
  onData: (trip: unknown) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  const tripRef = doc(db, 'trips', tripId);

  return onSnapshot(
    tripRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData({ id: snapshot.id, ...snapshot.data() });
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
