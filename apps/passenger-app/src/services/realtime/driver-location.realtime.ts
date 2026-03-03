import { firebaseDB, Unsubscribe } from '../firebase';

/**
 * Driver live location data from Firestore
 */
export interface DriverLocation {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  updatedAt: Date | null;
}

export interface DriverProfile {
  id: string;
  name: string;
  photoUrl: string | null;
  rating: number | null;
  completedTrips: number | null;
  vehicleModel: string | null;
  plateNumber: string | null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function snapshotExists(snapshot: { exists: boolean | (() => boolean) }): boolean {
  return typeof snapshot.exists === 'function' ? snapshot.exists() : snapshot.exists;
}

/**
 * Subscribe to a driver's live location (read-only)
 * Used by passengers to track their driver during active trips
 * 
 * @param driverId - The driver's user ID
 * @param onData - Callback with location data (null if no location)
 * @param onError - Error callback
 * @returns Unsubscribe function
 */
export function subscribeToDriverLocation(
  driverId: string,
  onData: (location: DriverLocation | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  console.log('📍 [DriverLocation] Starting subscription for driver:', driverId);

  return firebaseDB
    .collection('driverLive')
    .doc(driverId)
    .onSnapshot(
      (snapshot) => {
        if (snapshotExists(snapshot)) {
          const data = snapshot.data();
          const lat =
            toNumber(data?.lat) ??
            toNumber(data?.location?.lat) ??
            toNumber(data?.lastLocation?.latitude) ??
            toNumber(data?.lastLocation?._latitude);
          const lng =
            toNumber(data?.lng) ??
            toNumber(data?.location?.lng) ??
            toNumber(data?.lastLocation?.longitude) ??
            toNumber(data?.lastLocation?._longitude);

          if (lat === null || lng === null) {
            onData(null);
            return;
          }

          onData({
            lat,
            lng,
            heading: data?.heading ?? null,
            speed: data?.speed ?? null,
            updatedAt: data?.updatedAt?.toDate() ?? null,
          });
        } else {
          onData(null);
        }
      },
      onError
    );
}

/**
 * Subscribe to driver profile fields shown in passenger trip card.
 * This is resilient to schema differences across environments.
 */
export function subscribeToDriverProfile(
  driverId: string,
  onData: (profile: DriverProfile | null) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('drivers')
    .doc(driverId)
    .onSnapshot(
      (snapshot) => {
        if (!snapshotExists(snapshot)) {
          onData(null);
          return;
        }

        const data = snapshot.data() || {};

        const name =
          toStringOrNull(data.name) ||
          toStringOrNull(data.displayName) ||
          toStringOrNull(data.fullName) ||
          'Driver';

        const photoUrl =
          toStringOrNull(data.photoUrl) ||
          toStringOrNull(data.avatarUrl) ||
          toStringOrNull(data.profileImageUrl) ||
          toStringOrNull(data.profilePictureUrl);

        const rating =
          toNumber(data.ratingAvg) ??
          toNumber(data.averageRating) ??
          toNumber(data.rating);

        const completedTrips =
          toNumber(data.completedTrips) ??
          toNumber(data.tripsCount) ??
          toNumber(data.totalTrips);

        const vehicleModel =
          toStringOrNull(data.vehicleModel) ||
          toStringOrNull(data?.vehicle?.model);

        const plateNumber =
          toStringOrNull(data.plateNumber) ||
          toStringOrNull(data?.vehicle?.plate);

        onData({
          id: snapshot.id,
          name,
          photoUrl,
          rating,
          completedTrips,
          vehicleModel,
          plateNumber,
        });
      },
      onError
    );
}
