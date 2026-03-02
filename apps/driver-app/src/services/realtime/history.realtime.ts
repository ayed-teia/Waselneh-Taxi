import { firebaseDB, Unsubscribe } from '../firebase';
import { TripStatus } from '../../types/shared';

export interface DriverTripHistoryItem {
  id: string;
  passengerId: string;
  status: TripStatus;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedPriceIls: number;
  finalPriceIls: number | null;
  createdAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export function subscribeToDriverTripHistory(
  driverId: string,
  onData: (trips: DriverTripHistoryItem[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('trips')
    .where('driverId', '==', driverId)
    .orderBy('createdAt', 'desc')
    .limit(120)
    .onSnapshot(
      (snapshot) => {
        const trips = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            passengerId: data?.passengerId ?? '',
            status: (data?.status as TripStatus) ?? 'pending',
            pickup: data?.pickup ?? { lat: 0, lng: 0 },
            dropoff: data?.dropoff ?? { lat: 0, lng: 0 },
            estimatedPriceIls: Number(data?.estimatedPriceIls ?? 0),
            finalPriceIls: typeof data?.finalPriceIls === 'number' ? Number(data.finalPriceIls) : null,
            createdAt: data?.createdAt?.toDate?.() ?? null,
            startedAt: data?.startedAt?.toDate?.() ?? null,
            completedAt: data?.completedAt?.toDate?.() ?? null,
          };
        });
        onData(trips);
      },
      onError
    );
}
