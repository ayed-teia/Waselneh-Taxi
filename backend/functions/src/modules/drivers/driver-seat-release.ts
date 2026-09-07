import { FieldValue } from 'firebase-admin/firestore';
import { BOOKING_TYPES, normalizeSeatCapacity, normalizeVehicleType } from '@taxi-line/shared';

import { asRecord, getBoolean, getNumber, getString } from '../../core/firestore/doc-data';

/**
 * ============================================================================
 * RELEASING A DRIVER FROM A TRIP (seat accounting)
 * ============================================================================
 *
 * FIVE code paths release a driver: passenger cancel, driver cancel, manager force
 * cancel, trip completion, and the driver-no-show sweeper. Each one must return the
 * seats the trip had reserved, and clear a full-taxi reservation if it held one.
 *
 * This logic used to be copy-pasted into three of those five, and simply MISSING
 * from the other two (managerForceCancelTrip and the expireStaleTrips no-show
 * branch), which wrote `{ isAvailable: true, currentTripId: null }` and nothing more.
 * The consequences were not subtle:
 *
 *   - availableSeats stayed decremented, and the drift ACCUMULATED - each incident
 *     shaved seats off a driver permanently until they showed 0 and stopped being
 *     matched at all;
 *   - fullTaxiReserved stayed true, filtering the driver out of matching entirely -
 *     silently unbookable until somebody edited Firestore by hand;
 *   - isAvailable was set true unconditionally, marking OFFLINE drivers available.
 *
 * Four copies of a rule is how the fifth one ends up wrong, so it lives here once.
 *
 * IMPORTANT: this returns a PATCH to merge onto the driver document; it does not
 * write. Callers are inside transactions with their own read-before-write ordering,
 * and handing back a patch keeps that their business.
 * ============================================================================
 */

export interface DriverReleasePatch {
  availableSeats: number;
  isAvailable: boolean;
  currentTripId: string | null;
  updatedAt: FirebaseFirestore.FieldValue;
  fullTaxiReserved?: boolean;
  fullTaxiReservedTripId?: string | null;
}

/**
 * Build the driver-document patch that releases `tripId`.
 *
 * @param driverData raw driver document body (already read by the caller)
 * @param tripData   raw trip document body, for bookingType / reservedSeats
 * @param tripId     the trip being released
 */
export function buildDriverReleasePatch(
  driverData: FirebaseFirestore.DocumentData | undefined,
  tripData: FirebaseFirestore.DocumentData | undefined,
  tripId: string
): DriverReleasePatch {
  const driver = asRecord(driverData);
  const trip = asRecord(tripData);

  const seatCapacity = normalizeSeatCapacity(
    driver.seatCapacity,
    normalizeVehicleType(driver.vehicleType)
  );

  // A missing availableSeats means "never decremented", i.e. full capacity.
  const availableSeatsRaw = getNumber(driver, 'availableSeats');
  const availableSeats = Math.max(
    0,
    Math.min(availableSeatsRaw === null ? seatCapacity : Math.round(availableSeatsRaw), seatCapacity)
  );

  const bookingType =
    getString(trip, 'bookingType', '') === BOOKING_TYPES.FULL_TAXI
      ? BOOKING_TYPES.FULL_TAXI
      : BOOKING_TYPES.SEAT_ONLY;

  const reservedSeats = Math.max(0, Math.round(getNumber(trip, 'reservedSeats', 0)));

  // Give the seats back, but never exceed capacity - a double release must not
  // inflate the seat count, which matters because the sweepers can re-observe the
  // same trip on a later run.
  const nextAvailableSeats = Math.max(
    0,
    Math.min(seatCapacity, availableSeats + reservedSeats)
  );

  const isOnline = getBoolean(driver, 'isOnline', false);
  const currentTripId = getString(driver, 'currentTripId');

  const patch: DriverReleasePatch = {
    availableSeats: nextAvailableSeats,
    // Availability is a CONSEQUENCE of being online with seats free, never an
    // assumption. The old code asserted `true` and marked offline drivers bookable.
    isAvailable: isOnline && nextAvailableSeats > 0,
    // Only clear the pointer if it still refers to THIS trip; the driver may
    // already have moved on to another.
    currentTripId: currentTripId === tripId ? null : currentTripId,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (bookingType === BOOKING_TYPES.FULL_TAXI) {
    const reservedTripId = getString(driver, 'fullTaxiReservedTripId');
    patch.fullTaxiReserved = false;
    patch.fullTaxiReservedTripId = reservedTripId === tripId ? null : reservedTripId;
  }

  return patch;
}
