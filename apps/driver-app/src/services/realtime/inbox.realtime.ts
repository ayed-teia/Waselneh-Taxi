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
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  expiresAt: Date | null;
  createdAt: Date | null;
}

function toDateOrNull(value: unknown): Date | null {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

/**
 * Subscribe to pending driver requests.
 * Source of truth: driverRequests/{driverId}/requests/{tripId}
 */
export function subscribeToInbox(
  driverId: string,
  onData: (items: InboxItem[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('driverRequests')
    .doc(driverId)
    .collection('requests')
    .where('status', '==', 'pending')
    .limit(50)
    .onSnapshot(
      (snapshot) => {
        const items: InboxItem[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const requestId = String(data?.tripId ?? docSnap.id);

          return {
            id: docSnap.id,
            requestId,
            passengerId: String(data?.passengerId ?? ''),
            pickup: {
              lat: Number(data?.pickup?.lat ?? 0),
              lng: Number(data?.pickup?.lng ?? 0),
            },
            dropoff: {
              lat: Number(data?.dropoff?.lat ?? 0),
              lng: Number(data?.dropoff?.lng ?? 0),
            },
            estimatedDistanceKm: Number(data?.estimatedDistanceKm ?? NaN),
            estimatedDurationMin: Number(data?.estimatedDurationMin ?? NaN),
            estimatedPriceIls: Number(data?.estimatedPriceIls ?? 0),
            status: 'pending',
            expiresAt: toDateOrNull(data?.expiresAt),
            createdAt: toDateOrNull(data?.createdAt),
          };
        });

        items.sort((a, b) => {
          const aTime = a.createdAt?.getTime() ?? 0;
          const bTime = b.createdAt?.getTime() ?? 0;
          return bTime - aTime;
        });

        onData(items);
      },
      onError
    );
}
