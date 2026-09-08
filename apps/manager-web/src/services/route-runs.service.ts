import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { getFirestoreDb } from './firebase';

export type Unsubscribe = () => void;

export interface RouteRunRow {
  id: string;
  lineId: string;
  driverId: string;
  status: string;
  departureTime: Date | null;
  seatCapacity: number;
  bookedSeats: number;
  availableSeats: number;
  bookingCount: number;
}

export interface ManifestRow {
  id: string;
  passengerId: string;
  passengerName: string;
  seats: number;
  status: string;
  pickupLabel: string | null;
  destinationLabel: string | null;
}

export function subscribeRouteRuns(
  onData: (runs: RouteRunRow[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  const ref = query(collection(db, 'routeRuns'), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(
    ref,
    (snapshot) =>
      onData(
        snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            lineId: String(data.lineId ?? ''),
            driverId: String(data.driverId ?? ''),
            status: String(data.status ?? ''),
            departureTime: data.departureTime?.toDate?.() ?? null,
            seatCapacity: Number(data.seatCapacity ?? 0),
            bookedSeats: Number(data.bookedSeats ?? 0),
            availableSeats: Number(data.availableSeats ?? 0),
            bookingCount: Number(data.bookingCount ?? 0),
          };
        })
      ),
    onError
  );
}

export function subscribeRouteRunManifest(
  runId: string,
  onData: (rows: ManifestRow[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const db = getFirestoreDb();
  return onSnapshot(
    collection(db, 'routeRuns', runId, 'bookings'),
    (snapshot) =>
      onData(
        snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            passengerId: String(data.passengerId ?? ''),
            passengerName: String(data.passengerName ?? 'Passenger'),
            seats: Number(data.seats ?? 0),
            status: String(data.status ?? ''),
            pickupLabel: typeof data.pickupLabel === 'string' ? data.pickupLabel : null,
            destinationLabel:
              typeof data.destinationLabel === 'string' ? data.destinationLabel : null,
          };
        })
      ),
    onError
  );
}
