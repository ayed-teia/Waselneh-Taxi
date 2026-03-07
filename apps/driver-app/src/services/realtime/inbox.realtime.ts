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
  bookingType?: 'seat_only' | 'full_taxi';
  requestedSeats?: number;
  requiredSeats?: number;
  destinationLabel?: string | null;
  destinationCity?: string | null;
  driverLineNumber?: string | null;
  driverRoutePath?: string | null;
  requestedVehicleType?: string | null;
  driverVehicleType?: string | null;
  driverSeatCapacity?: number;
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
    .onSnapshot(
      (snapshot) => {
        const items: InboxItem[] = snapshot.docs
          .map((docSnap) => {
          const data = docSnap.data();
          const requestId = String(data?.tripId ?? docSnap.id);
          const normalizedRequiredSeats =
            typeof data?.requiredSeats === 'number' && Number.isFinite(data.requiredSeats)
              ? Math.max(1, Math.round(data.requiredSeats))
              : null;
          const normalizedRequestedSeats =
            typeof data?.requestedSeats === 'number' && Number.isFinite(data.requestedSeats)
              ? Math.max(0, Math.round(data.requestedSeats))
              : null;
          const normalizedDriverSeatCapacity =
            typeof data?.driverSeatCapacity === 'number' && Number.isFinite(data.driverSeatCapacity)
              ? Math.max(1, Math.round(data.driverSeatCapacity))
              : null;
          const bookingType =
            data?.bookingType === 'full_taxi' || data?.bookingType === 'seat_only'
              ? data.bookingType
              : undefined;

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
            ...(bookingType ? { bookingType } : {}),
            ...(normalizedRequestedSeats !== null ? { requestedSeats: normalizedRequestedSeats } : {}),
            ...(normalizedRequiredSeats !== null ? { requiredSeats: normalizedRequiredSeats } : {}),
            ...(typeof data?.destinationLabel === 'string'
              ? { destinationLabel: data.destinationLabel }
              : {}),
            ...(typeof data?.destinationCity === 'string'
              ? { destinationCity: data.destinationCity }
              : {}),
            ...(typeof data?.driverLineNumber === 'string'
              ? { driverLineNumber: data.driverLineNumber }
              : {}),
            ...(typeof data?.driverRoutePath === 'string'
              ? { driverRoutePath: data.driverRoutePath }
              : {}),
            ...(typeof data?.requestedVehicleType === 'string'
              ? { requestedVehicleType: data.requestedVehicleType }
              : {}),
            ...(typeof data?.driverVehicleType === 'string'
              ? { driverVehicleType: data.driverVehicleType }
              : {}),
            ...(normalizedDriverSeatCapacity !== null
              ? { driverSeatCapacity: normalizedDriverSeatCapacity }
              : {}),
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
