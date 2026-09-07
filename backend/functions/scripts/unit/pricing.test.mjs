/**
 * Unit tests for pure pricing logic — no emulator, no I/O, milliseconds to run.
 *
 * These cover the arithmetic that decides what a passenger is charged. It is exactly
 * the kind of code that is easy to change "harmlessly" and hard to notice breaking,
 * because a wrong fare still looks like a number.
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

const SHARED = path.join(__dirname, '..', '..', '..', '..', 'packages', 'shared', 'dist');
const pricing = require(path.join(SHARED, 'pricing', 'pricing.utils.js'));
const vehicle = require(path.join(SHARED, 'config', 'vehicle.config.js'));

const { PRICING_CONFIG, roundDistanceKm, calculatePrice, calculateRidePrice } = pricing;

describe('roundDistanceKm', () => {
  /**
   * NOTE: this returns binary floating-point artefacts - roundDistanceKm(5.01) is
   * 5.1000000000000005, not 5.1, because it computes ceil(x / 0.1) * 0.1. That is
   * cosmetically ugly but HARMLESS here: the only consumer is calculatePrice, which
   * multiplies by the rate and then Math.ceil()s to whole shekels, so the 5e-16 tail
   * cannot move a fare. Asserted with a tolerance rather than "fixed", because
   * changing the rounding would change fares, which is a pricing decision and not a
   * correctness pass. Flagged in CORRECTNESS_PASS_REPORT.md.
   */
  const CLOSE = 1e-9;

  test('rounds UP to the nearest 0.1 km', () => {
    assert.ok(Math.abs(roundDistanceKm(1.23) - 1.3) < CLOSE);
    assert.ok(Math.abs(roundDistanceKm(5.01) - 5.1) < CLOSE);
  });

  test('leaves an exact tenth unchanged', () => {
    assert.ok(Math.abs(roundDistanceKm(2.0) - 2.0) < CLOSE);
    assert.ok(Math.abs(roundDistanceKm(3.4) - 3.4) < CLOSE);
  });

  test('the float tail never changes a fare (the property that matters)', () => {
    // Whatever the artefact, the fare must equal the fare of the clean value.
    for (const km of [5.01, 3.4, 12.37, 44.44]) {
      const clean = Math.ceil(Math.round(km * 10)) / 10;
      assert.equal(
        calculatePrice(km),
        calculatePrice(clean),
        `float tail changed the fare at ${km}km`
      );
    }
  });

  test('handles zero without producing a negative or NaN', () => {
    const r = roundDistanceKm(0);
    assert.ok(Number.isFinite(r), 'must be finite');
    assert.ok(r >= 0, 'must not be negative');
  });
});

describe('calculatePrice — base fare and the minimum-fare floor', () => {
  test('a long trip is charged by distance', () => {
    // 100km * 0.5 ILS/km = 50, comfortably above the floor.
    assert.equal(calculatePrice(100), 50);
  });

  test('a very short trip is floored at MINIMUM_PRICE_ILS', () => {
    // 1km * 0.5 = 0.5, which must be lifted to the 5 ILS minimum.
    assert.equal(calculatePrice(1), PRICING_CONFIG.MINIMUM_PRICE_ILS);
    assert.equal(calculatePrice(0), PRICING_CONFIG.MINIMUM_PRICE_ILS);
  });

  test('the floor applies at the boundary, not just below it', () => {
    // 10km * 0.5 = exactly 5 = the floor.
    assert.equal(calculatePrice(10), PRICING_CONFIG.MINIMUM_PRICE_ILS);
    // Just past it, distance takes over.
    assert.ok(calculatePrice(12) > PRICING_CONFIG.MINIMUM_PRICE_ILS);
  });

  test('always returns a whole number of shekels', () => {
    for (const km of [0.3, 7.7, 13.31, 44.44]) {
      const p = calculatePrice(km);
      assert.equal(p, Math.ceil(p), `${km}km produced a non-integer fare ${p}`);
    }
  });

  test('is monotonic: a longer trip never costs less', () => {
    let previous = -Infinity;
    for (const km of [0, 1, 5, 10, 25, 50, 100, 250]) {
      const p = calculatePrice(km);
      assert.ok(p >= previous, `fare dropped from ${previous} to ${p} at ${km}km`);
      previous = p;
    }
  });
});

describe('calculateRidePrice — seat surcharge and vehicle multiplier', () => {
  test('a standard 4-seat request adds no surcharge', () => {
    const base = calculatePrice(100);
    assert.equal(calculateRidePrice(100, { requiredSeats: 4, vehicleType: null }), base);
  });

  test('seats beyond 4 add an incremental surcharge', () => {
    const four = calculateRidePrice(100, { requiredSeats: 4, vehicleType: null });
    const six = calculateRidePrice(100, { requiredSeats: 6, vehicleType: null });
    assert.ok(six > four, `6 seats (${six}) should cost more than 4 (${four})`);
  });

  test('the vehicle multiplier is applied', () => {
    const types = Object.keys(vehicle.VEHICLE_PRICE_MULTIPLIER ?? {});
    if (types.length === 0) {
      // Nothing to assert if the table is empty; do not invent a passing test.
      return;
    }
    const prices = types.map((t) => calculateRidePrice(100, { requiredSeats: 4, vehicleType: t }));
    assert.ok(
      prices.every((p) => Number.isFinite(p) && p > 0),
      `every vehicle type must yield a positive fare, got ${JSON.stringify(prices)}`
    );
  });

  test('the minimum-fare floor still applies after multipliers', () => {
    for (const type of [null, ...Object.keys(vehicle.VEHICLE_PRICE_MULTIPLIER ?? {})]) {
      const p = calculateRidePrice(0.1, { requiredSeats: 1, vehicleType: type });
      assert.ok(
        p >= PRICING_CONFIG.MINIMUM_PRICE_ILS,
        `vehicleType=${type} produced ${p}, below the ${PRICING_CONFIG.MINIMUM_PRICE_ILS} floor`
      );
    }
  });

  test('never returns a fractional or negative fare', () => {
    for (const seats of [1, 2, 4, 6, 8]) {
      const p = calculateRidePrice(23.7, { requiredSeats: seats, vehicleType: null });
      assert.equal(p, Math.ceil(p), `seats=${seats} produced a fractional fare ${p}`);
      assert.ok(p > 0, `seats=${seats} produced a non-positive fare ${p}`);
    }
  });
});

describe('seat normalization', () => {
  test('normalizeSeatCapacity clamps into a sane range', () => {
    const c = vehicle.normalizeSeatCapacity;
    assert.ok(c(0, null) >= 1, 'zero seats must not survive');
    assert.ok(c(-5, null) >= 1, 'negative seats must not survive');
    assert.ok(c(9999, null) <= vehicle.VEHICLE_MAX_CAPACITY, 'must clamp to the max capacity');
  });

  test('normalizeSeatCapacity copes with junk input', () => {
    const c = vehicle.normalizeSeatCapacity;
    for (const junk of [undefined, null, NaN, 'four', {}, []]) {
      const r = c(junk, null);
      assert.ok(
        Number.isInteger(r) && r >= 1,
        `junk input ${JSON.stringify(junk)} produced ${r}`
      );
    }
  });

  test('normalizeVehicleType rejects unknown values rather than passing them through', () => {
    assert.equal(vehicle.normalizeVehicleType('definitely-not-a-vehicle'), null);
    assert.equal(vehicle.normalizeVehicleType(undefined), null);
    assert.equal(vehicle.normalizeVehicleType(42), null);
  });

  test('clampRequestedSeats keeps values within 1..MAX', () => {
    const f = pricing.clampRequestedSeats;
    assert.equal(f(0), 1);
    assert.equal(f(-3), 1);
    assert.equal(f(2), 2);
    assert.ok(f(1000) <= vehicle.VEHICLE_MAX_CAPACITY);
  });
});
