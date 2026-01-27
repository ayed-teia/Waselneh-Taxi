import {
  collection,
  query,
  onSnapshot,
  Unsubscribe,
  orderBy,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';
import { getFirebaseFirestore } from '../firebase';

/**
 * Inbox item from driver's inbox subcollection
 */
export interface InboxItem {
  id: string;
  requestId: string;
  passengerId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPriceIls: number;
  createdAt: Date | null;
}

/**
 * Subscribe to driver's inbox (read-only)
 * Receives trip requests dispatched to this driver
 */
export function subscribeToInbox(
  driverId: string,
  onData: (items: InboxItem[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirebaseFirestore();
  const inboxRef = collection(db, 'drivers', driverId, 'inbox');

  // Query inbox ordered by creation time (newest first)
  const q = query(
    inboxRef,
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot: QuerySnapshot<DocumentData>) => {
      const items: InboxItem[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          requestId: data.requestId,
          passengerId: data.passengerId,
          pickup: data.pickup,
          dropoff: data.dropoff,
          estimatedDistanceKm: data.estimatedDistanceKm,
          estimatedDurationMin: data.estimatedDurationMin,
          estimatedPriceIls: data.estimatedPriceIls,
          createdAt: data.createdAt?.toDate() ?? null,
        };
      });
      onData(items);
    },
    onError
  );
}
