/**
 * Unit tests for pure dispatch logic — no emulator, no I/O.
 *
 * Covers the seat-release patch builder (R8) and the queue ordering maths, both of
 * which decide real operational outcomes: whether a driver keeps their seats, and who
 * gets offered the next fare.
 *
 * Run: node --test backend/functions/scripts/unit/
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DIST = path.join(__dirname, '..', '..', 'dist');
const { buildDriverReleasePatch } = require(
  path.join(DIST, 'modules', 'drivers', 'driver-seat-release.js')
);

/** A 4-seat driver holding `tripId` with `reserved` seats taken. */
function driverHolding(tripId, reserved, extra = {}) {
  return {
    seatCapacity: 4,
    vehicleType: 'taxi_standard',
    availableSeats: 4 - reserved,
    isOnline: true,
    currentTripId: tripId,
    ...extra,
  };
}

describe('buildDriverReleasePatch — seat restoration (R8)', () => {
  test('gives back exactly the seats the trip reserved', () => {
    const patch = buildDriverReleasePatch(
      driverHolding('trip-1', 2),
      { bookingType: 'seat_only', reservedSeats: 2 },
      'trip-1'
    );
    assert.equal(patch.availableSeats, 4, 'a 2-seat booking on a 4-seat car must restore to 4');
  });

  test('never exceeds seat capacity, even if released twice', () => {
    // The sweeper runs every minute and can re-observe the same trip.
    const alreadyRestored = driverHolding('trip-1', 0);
    const patch = buildDriverReleasePatch(
      alreadyRestored,
      { bookingType: 'seat_only', reservedSeats: 2 },
      'trip-1'
    );
    assert.equal(patch.availableSeats, 4, 'a double release must not inflate seats above capacity');
  });

  test('clears a full-taxi reservation held by this trip', () => {
    const patch = buildDriverReleasePatch(
      driverHolding('trip-1', 4, { fullTaxiReserved: true, fullTaxiReservedTripId: 'trip-1' }),
      { bookingType: 'full_taxi', reservedSeats: 4 },
      'trip-1'
    );
    assert.equal(patch.fullTaxiReserved, false, 'must release the reservation');
    assert.equal(patch.fullTaxiReservedTripId, null, 'must clear the reservation pointer');
  });

  test('does NOT steal a full-taxi reservation belonging to a different trip', () => {
    const patch = buildDriverReleasePatch(
      driverHolding('trip-1', 4, { fullTaxiReserved: true, fullTaxiReservedTripId: 'other-trip' }),
      { bookingType: 'full_taxi', reservedSeats: 4 },
      'trip-1'
    );
    assert.equal(
      patch.fullTaxiReservedTripId,
      'other-trip',
      'a reservation for another trip must be left alone'
    );
  });

  test('leaves fullTaxi fields untouched for a seat_only release', () => {
    const patch = buildDriverReleasePatch(
      driverHolding('trip-1', 1),
      { bookingType: 'seat_only', reservedSeats: 1 },
      'trip-1'
    );
    assert.equal(
      'fullTaxiReserved' in patch,
      false,
      'a seat-only release must not write full-taxi fields at all'
    );
  });
});

describe('buildDriverReleasePatch — availability is derived, never assumed', () => {
  test('an OFFLINE driver is never marked available', () => {
    const patch = buildDriverReleasePatch(
      driverHolding('trip-1', 2, { isOnline: false }),
      { bookingType: 'seat_only', reservedSeats: 2 },
      'trip-1'
    );
    assert.equal(patch.isAvailable, false, 'offline drivers must not become bookable');
  });

  test('an online driver with seats free becomes available', () => {
    const patch = buildDriverReleasePatch(
      driverHolding('trip-1', 2),
      { bookingType: 'seat_only', reservedSeats: 2 },
      'trip-1'
    );
    assert.equal(patch.isAvailable, true);
  });

  test('an online driver with zero seats free is NOT available', () => {
    const patch = buildDriverReleasePatch(
      { seatCapacity: 4, vehicleType: 'taxi_standard', availableSeats: 0, isOnline: true },
      { bookingType: 'seat_only', reservedSeats: 0 },
      'trip-1'
    );
    assert.equal(patch.isAvailable, false, 'no free seats means not available');
  });
});

describe('buildDriverReleasePatch — currentTripId handling', () => {
  test('clears the pointer when it refers to this trip', () => {
    const patch = buildDriverReleasePatch(
      driverHolding('trip-1', 1),
      { bookingType: 'seat_only', reservedSeats: 1 },
      'trip-1'
    );
    assert.equal(patch.currentTripId, null);
  });

  test('preserves a pointer to a DIFFERENT trip', () => {
    // The driver may already have moved on; clearing blindly would orphan that trip.
    const patch = buildDriverReleasePatch(
      driverHolding('trip-2', 1),
      { bookingType: 'seat_only', reservedSeats: 1 },
      'trip-1'
    );
    assert.equal(patch.currentTripId, 'trip-2');
  });
});

describe('buildDriverReleasePatch — malformed input', () => {
  test('a missing availableSeats is treated as full capacity, not zero', () => {
    const patch = buildDriverReleasePatch(
      { seatCapacity: 4, vehicleType: 'taxi_standard', isOnline: true },
      { bookingType: 'seat_only', reservedSeats: 0 },
      'trip-1'
    );
    assert.equal(patch.availableSeats, 4, 'absent seats must mean "never decremented"');
  });

  test('undefined driver and trip data do not throw', () => {
    const patch = buildDriverReleasePatch(undefined, undefined, 'trip-1');
    assert.ok(Number.isInteger(patch.availableSeats), 'must still yield an integer seat count');
    assert.ok(patch.availableSeats >= 0, 'must not be negative');
    assert.equal(patch.isAvailable, false, 'unknown driver must not be assumed available');
  });

  test('junk seat values never produce NaN or a negative', () => {
    for (const junk of [NaN, -3, 'two', null, {}]) {
      const patch = buildDriverReleasePatch(
        { seatCapacity: 4, vehicleType: 'taxi_standard', availableSeats: junk, isOnline: true },
        { bookingType: 'seat_only', reservedSeats: junk },
        'trip-1'
      );
      assert.ok(
        Number.isInteger(patch.availableSeats) && patch.availableSeats >= 0,
        `junk ${JSON.stringify(junk)} produced ${patch.availableSeats}`
      );
      assert.ok(patch.availableSeats <= 4, 'must never exceed capacity');
    }
  });
});

/**
 * Queue ordering. orderCandidatesByQueue needs Firestore, so the pure ordering
 * property it relies on is tested here directly: queued drivers first in position
 * order, everyone else preserved behind them.
 */
describe('queue ordering maths', () => {
  function orderByPosition(candidates, positionByDriver) {
    const inQueue = candidates
      .filter((id) => positionByDriver.has(id))
      .sort((a, b) => positionByDriver.get(a) - positionByDriver.get(b));
    const notInQueue = candidates.filter((id) => !positionByDriver.has(id));
    return [...inQueue, ...notInQueue];
  }

  test('queued drivers are ordered by position, not by input order', () => {
    const positions = new Map([
      ['a', 100],
      ['b', 200],
      ['c', 300],
    ]);
    assert.deepEqual(orderByPosition(['c', 'b', 'a'], positions), ['a', 'b', 'c']);
  });

  test('a driver not in the queue is KEPT, ranked behind those who are', () => {
    // This is the property that stops the queue making trips unmatchable.
    const positions = new Map([['a', 100]]);
    assert.deepEqual(orderByPosition(['x', 'a'], positions), ['a', 'x']);
  });

  test('with an empty queue the original order is preserved exactly', () => {
    const order = ['x', 'y', 'z'];
    assert.deepEqual(orderByPosition(order, new Map()), order);
  });

  test('no candidate is ever dropped', () => {
    const positions = new Map([['b', 50]]);
    const input = ['a', 'b', 'c'];
    const out = orderByPosition(input, positions);
    assert.equal(out.length, input.length, 'ordering must not lose a candidate');
    assert.deepEqual([...out].sort(), [...input].sort());
  });
});
