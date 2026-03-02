import { firebaseDB, Unsubscribe } from '../firebase';
import { TripStatus } from '@taxi-line/shared';

export interface PassengerTripHistoryItem {
  id: string;
  driverId: string;
  status: TripStatus;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  estimatedPriceIls: number;
  finalPriceIls: number | null;
  createdAt: Date | null;
  completedAt: Date | null;
}

export function subscribeToPassengerTripHistory(
  passengerId: string,
  onData: (trips: PassengerTripHistoryItem[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('trips')
    .where('passengerId', '==', passengerId)
    .orderBy('createdAt', 'desc')
    .limit(80)
    .onSnapshot(
      (snapshot) => {
        const trips = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            driverId: data?.driverId ?? '',
            status: (data?.status as TripStatus) ?? 'pending',
            pickup: data?.pickup ?? { lat: 0, lng: 0 },
            dropoff: data?.dropoff ?? { lat: 0, lng: 0 },
            estimatedPriceIls: Number(data?.estimatedPriceIls ?? 0),
            finalPriceIls: typeof data?.finalPriceIls === 'number' ? Number(data.finalPriceIls) : null,
            createdAt: data?.createdAt?.toDate?.() ?? null,
            completedAt: data?.completedAt?.toDate?.() ?? null,
          };
        });
        onData(trips);
      },
      onError
    );
}
