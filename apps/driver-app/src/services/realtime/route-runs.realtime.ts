import { firebaseDB, Unsubscribe } from '../firebase';

export interface ManifestPassenger {
  bookingId: string;
  passengerId: string;
  passengerName: string;
  seats: number;
  status: string;
  pickupLabel: string | null;
  destinationLabel: string | null;
}

export function subscribeToRouteRun(
  runId: string,
  onData: (run: Record<string, unknown> | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('routeRuns')
    .doc(runId)
    .onSnapshot(
      (snapshot) => onData(snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null),
      onError
    );
}

export function subscribeToPassengerManifest(
  runId: string,
  onData: (passengers: ManifestPassenger[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('routeRuns')
    .doc(runId)
    .collection('bookings')
    .onSnapshot(
      (snapshot) =>
        onData(
          snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              bookingId: doc.id,
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
