import { firebaseDB, Unsubscribe } from '../firebase';

export interface PassengerLine {
  id: string;
  name: string;
  code: string;
  originLabel: string | null;
  destinationLabel: string | null;
  fixedPriceIls: number | null;
}

export interface PassengerRouteRun {
  id: string;
  lineId: string;
  driverId: string;
  status: string;
  departureTime: Date | null;
  seatCapacity: number;
  availableSeats: number;
  originLabel: string | null;
  destinationLabel: string | null;
}

export function subscribeToPassengerLines(
  onData: (lines: PassengerLine[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB.collection('lines').onSnapshot(
    (snapshot) =>
      onData(
        snapshot.docs
          .map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              name: String(data.name ?? data.code ?? doc.id),
              code: String(data.code ?? doc.id),
              originLabel: typeof data.originLabel === 'string' ? data.originLabel : null,
              destinationLabel:
                typeof data.destinationLabel === 'string' ? data.destinationLabel : null,
              fixedPriceIls:
                typeof data.fixedPriceIls === 'number' ? data.fixedPriceIls : null,
              active: data.status === 'active',
              routed: typeof data.originCityId === 'string',
            };
          })
          .filter((line) => line.active && line.routed)
      ),
    onError
  );
}

export function subscribeToRouteRuns(
  lineId: string,
  onData: (runs: PassengerRouteRun[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('routeRuns')
    .where('lineId', '==', lineId)
    .onSnapshot(
      (snapshot) => {
        const runs = snapshot.docs
          .map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              lineId: String(data.lineId ?? ''),
              driverId: String(data.driverId ?? ''),
              status: String(data.status ?? ''),
              departureTime: data.departureTime?.toDate?.() ?? null,
              seatCapacity: Number(data.seatCapacity ?? 0),
              availableSeats: Number(data.availableSeats ?? 0),
              originLabel: typeof data.originLabel === 'string' ? data.originLabel : null,
              destinationLabel:
                typeof data.destinationLabel === 'string' ? data.destinationLabel : null,
            };
          })
          .filter((run) => run.status === 'boarding' || run.status === 'full')
          .sort(
            (left, right) =>
              (left.departureTime?.getTime() ?? 0) - (right.departureTime?.getTime() ?? 0)
          );
        onData(runs);
      },
      onError
    );
}

export function subscribeToMyRouteBooking(
  runId: string,
  passengerId: string,
  onData: (booking: Record<string, unknown> | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('routeRuns')
    .doc(runId)
    .collection('bookings')
    .doc(passengerId)
    .onSnapshot(
      (snapshot) => onData(snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null),
      onError
    );
}
