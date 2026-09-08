import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  releaseRouteRunSeats,
  reserveRouteRunSeats,
} = require('../../dist/modules/routes/route-run-capacity');

describe('route-run capacity', () => {
  it('reserves seats and automatically marks a run full', () => {
    const first = reserveRouteRunSeats(
      { seatCapacity: 4, availableSeats: 4, bookingCount: 0 },
      2
    );
    const second = reserveRouteRunSeats(first, 2);

    assert.deepEqual(first, {
      seatCapacity: 4,
      availableSeats: 2,
      bookedSeats: 2,
      bookingCount: 1,
      status: 'boarding',
    });
    assert.equal(second.availableSeats, 0);
    assert.equal(second.bookedSeats, 4);
    assert.equal(second.status, 'full');
  });

  it('rejects overbooking instead of producing negative capacity', () => {
    assert.throws(
      () => reserveRouteRunSeats({ seatCapacity: 4, availableSeats: 1 }, 2),
      /NOT_ENOUGH_SEATS/
    );
  });

  it('releases exactly the cancelled booking seats', () => {
    const released = releaseRouteRunSeats(
      { seatCapacity: 7, availableSeats: 1, bookingCount: 3 },
      2
    );

    assert.equal(released.availableSeats, 3);
    assert.equal(released.bookedSeats, 4);
    assert.equal(released.bookingCount, 2);
    assert.equal(released.status, 'boarding');
  });

  it('clamps malformed stored counters to safe values', () => {
    const released = releaseRouteRunSeats(
      { seatCapacity: 4, availableSeats: 99, bookingCount: -5 },
      3
    );

    assert.equal(released.availableSeats, 4);
    assert.equal(released.bookedSeats, 0);
    assert.equal(released.bookingCount, 0);
  });
});
