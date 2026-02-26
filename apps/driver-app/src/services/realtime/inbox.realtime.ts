import { firebaseDB, Unsubscribe } from '../firebase';

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
  return firebaseDB
    .collection('drivers')
    .doc(driverId)
    .collection('inbox')
    .orderBy('createdAt', 'desc')
    .onSnapshot(
      (snapshot) => {
        const items: InboxItem[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            requestId: data?.requestId,
            passengerId: data?.passengerId,
            pickup: data?.pickup,
            dropoff: data?.dropoff,
            estimatedDistanceKm: data?.estimatedDistanceKm,
            estimatedDurationMin: data?.estimatedDurationMin,
            estimatedPriceIls: data?.estimatedPriceIls,
            createdAt: data?.createdAt?.toDate() ?? null,
          };
        });
        onData(items);
      },
      onError
    );
}
