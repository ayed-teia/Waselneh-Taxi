import { firebaseDB, type Unsubscribe } from '../firebase';
import { TripRequest, useTripRequestStore } from '../../store/trip-request.store';
import { useDriverStore } from '../../store';

/**
 * ============================================================================
 * DRIVER REQUESTS REALTIME LISTENER
 * ============================================================================
 *
 * Subscribes to driver-scoped requests:
 *   driverRequests/{driverId}/requests/{tripId}
 *
 * This matches backend callable contracts:
 * - acceptTripRequest
 * - rejectTripRequest
 *
 * ============================================================================
 */

let _unsubscribe: Unsubscribe | null = null;
let _currentDriverId: string | null = null;
let _lastShownTripId: string | null = null;
let _emptySnapshotTimer: ReturnType<typeof setTimeout> | null = null;
const EMPTY_SNAPSHOT_GRACE_MS = 5000;

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

function isExpired(expiresAt: Date | null | undefined, graceMs = 0): boolean {
  if (!expiresAt) {
    return false;
  }
  return expiresAt.getTime() + graceMs < Date.now();
}

function calculateDistanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const earthRadiusKm = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

/**
 * Start listening for driver trip requests.
 * Call when driver goes online.
 */
export async function startDriverRequestsListener(driverId: string): Promise<void> {
  if (_unsubscribe && _currentDriverId === driverId) {
    console.log('[DriverRequests] Listener already active for:', driverId);
    return;
  }

  if (_unsubscribe) {
    await stopDriverRequestsListener();
  }

  console.log('[DriverRequests] Starting listener for driver:', driverId);

  _currentDriverId = driverId;
  _lastShownTripId = null;

  _unsubscribe = firebaseDB
    .collection('driverRequests')
    .doc(driverId)
    .collection('requests')
    .where('status', '==', 'pending')
    .limit(20)
    .onSnapshot(
      (snapshot) => {
        const pendingDocs = snapshot.docs;

        if (pendingDocs.length === 0) {
          if (_emptySnapshotTimer) {
            clearTimeout(_emptySnapshotTimer);
          }

          _emptySnapshotTimer = setTimeout(() => {
            _lastShownTripId = null;
            const { isModalVisible, pendingRequest, hideRequest } = useTripRequestStore.getState();
            if (isModalVisible && pendingRequest) {
              if (isExpired(pendingRequest.expiresAt, 5000)) {
                hideRequest();
              } else {
                console.log('[DriverRequests] Empty snapshot ignored, keeping active request visible');
              }
            }
            console.log('[DriverRequests] No pending requests');
            _emptySnapshotTimer = null;
          }, EMPTY_SNAPSHOT_GRACE_MS);
          return;
        }

        if (_emptySnapshotTimer) {
          clearTimeout(_emptySnapshotTimer);
          _emptySnapshotTimer = null;
        }

        const sortedDocs = [...pendingDocs].sort((a, b) => {
          const aCreatedAt = toDateOrNull((a.data() as { createdAt?: unknown }).createdAt)?.getTime() ?? 0;
          const bCreatedAt = toDateOrNull((b.data() as { createdAt?: unknown }).createdAt)?.getTime() ?? 0;
          return bCreatedAt - aCreatedAt;
        });

        // Do not enforce expiration on-device (clock skew may hide valid requests).
        // Backend callable (accept/reject) is the source of truth for expiry.
        const activeDocs = sortedDocs;

        if (activeDocs.length === 0) {
          _lastShownTripId = null;
          const { isModalVisible, pendingRequest, hideRequest } = useTripRequestStore.getState();
          if (isModalVisible && pendingRequest) {
            hideRequest();
          }
          console.log('[DriverRequests] Pending requests exist but all are expired');
          return;
        }

        const docSnap = activeDocs[0]!;
        const data = docSnap.data() as {
          tripId?: string;
          passengerId?: string;
          pickup?: { lat?: number; lng?: number };
          dropoff?: { lat?: number; lng?: number };
          estimatedPriceIls?: number;
          requiredSeats?: number;
          requestedVehicleType?: string | null;
          driverVehicleType?: string | null;
          driverSeatCapacity?: number;
          createdAt?: unknown;
          expiresAt?: unknown;
        };

        const tripId = data.tripId || docSnap.id;
        const state = useTripRequestStore.getState();

        if (
          _lastShownTripId === tripId &&
          state.isModalVisible &&
          state.pendingRequest?.tripId === tripId
        ) {
          return;
        }

        const pickup = {
          lat: Number(data.pickup?.lat ?? 0),
          lng: Number(data.pickup?.lng ?? 0),
        };
        const dropoff = {
          lat: Number(data.dropoff?.lat ?? 0),
          lng: Number(data.dropoff?.lng ?? 0),
        };

        const driverLocation = useDriverStore.getState().currentLocation;
        const pickupDistanceKm = driverLocation
          ? Math.round(calculateDistanceKm(driverLocation, pickup) * 10) / 10
          : 0;
        const normalizedRequiredSeats =
          typeof data.requiredSeats === 'number' && Number.isFinite(data.requiredSeats)
            ? Math.max(1, Math.round(data.requiredSeats))
            : null;
        const normalizedDriverSeatCapacity =
          typeof data.driverSeatCapacity === 'number' && Number.isFinite(data.driverSeatCapacity)
            ? Math.max(1, Math.round(data.driverSeatCapacity))
            : null;

        const request: TripRequest = {
          tripId,
          passengerId: String(data.passengerId ?? ''),
          pickup,
          dropoff,
          estimatedPriceIls: Number(data.estimatedPriceIls ?? 0),
          ...(normalizedRequiredSeats !== null ? { requiredSeats: normalizedRequiredSeats } : {}),
          ...(typeof data.requestedVehicleType === 'string'
            ? { requestedVehicleType: data.requestedVehicleType }
            : {}),
          ...(typeof data.driverVehicleType === 'string'
            ? { driverVehicleType: data.driverVehicleType }
            : {}),
          ...(normalizedDriverSeatCapacity !== null
            ? { driverSeatCapacity: normalizedDriverSeatCapacity }
            : {}),
          pickupDistanceKm,
          status: 'pending',
          createdAt: toDateOrNull(data.createdAt),
          expiresAt: toDateOrNull(data.expiresAt),
        };

        _lastShownTripId = tripId;
        console.log('[DriverRequests] New request received:', request.tripId);
        state.showRequest(request);
      },
      (error) => {
        console.error('[DriverRequests] Listener error:', error);
      }
    );

  console.log('[DriverRequests] Listener STARTED for driver:', driverId);
}

/**
 * Stop listening for driver trip requests.
 * Call when driver goes offline.
 */
export async function stopDriverRequestsListener(): Promise<void> {
  if (!_unsubscribe) {
    console.log('[DriverRequests] No active listener to stop');
    return;
  }

  console.log('[DriverRequests] Stopping listener for driver:', _currentDriverId);

  _unsubscribe();
  _unsubscribe = null;
  _currentDriverId = null;
  _lastShownTripId = null;
  if (_emptySnapshotTimer) {
    clearTimeout(_emptySnapshotTimer);
    _emptySnapshotTimer = null;
  }

  useTripRequestStore.getState().clearAll();

  console.log('[DriverRequests] Listener STOPPED');
}

/**
 * Check if listener is active.
 */
export function isDriverRequestsListenerActive(): boolean {
  return _unsubscribe !== null;
}
