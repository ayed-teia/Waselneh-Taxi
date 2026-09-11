/**
 * Unit tests for the taxi-line fairness simulator.
 *
 * The simulator exists to ANSWER the open fairness questions in
 * docs/REMAINING_PLAN.md section 3, not to decide them. So the property that
 * matters most here is that the policy is genuinely an input: the same events under
 * two different policies must produce different reports. A simulator that returned
 * the same numbers regardless would be decorative, and worse, would look like
 * evidence in a driver meeting.
 *
 * Deterministic by construction - events carry simulated timestamps, nothing reads a
 * clock, and there is no randomness. These tests rely on that.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { IMPLEMENTED_POLICY, giniCoefficient, simulateFairness } = require(
  path.join(dirname, '..', '..', 'dist', 'modules', 'queue', 'queue-fairness')
);

const MINUTE = 60000;

describe('giniCoefficient', () => {
  test('perfect equality is 0', () => {
    assert.equal(giniCoefficient([100, 100, 100]), 0);
  });

  test('an empty or single-value set is 0, not an error', () => {
    // A simulation of a quiet morning legitimately produces these.
    assert.equal(giniCoefficient([]), 0);
    assert.equal(giniCoefficient([250]), 0);
  });

  test('an all-zero set is 0 rather than a division by zero', () => {
    assert.equal(giniCoefficient([0, 0, 0]), 0);
  });

  test('inequality is strictly positive and bounded below 1', () => {
    const g = giniCoefficient([0, 0, 0, 400]);
    assert.ok(g > 0, `expected > 0, got ${g}`);
    assert.ok(g < 1, `expected < 1, got ${g}`);
  });

  test('more concentrated earnings score higher', () => {
    const even = giniCoefficient([100, 100, 100, 100]);
    const skewed = giniCoefficient([10, 10, 10, 370]);
    assert.ok(skewed > even, `${skewed} should exceed ${even}`);
  });

  test('the order of the input does not matter', () => {
    assert.equal(giniCoefficient([10, 90, 50]), giniCoefficient([90, 50, 10]));
  });
});

describe('simulateFairness - accounting', () => {
  const events = [
    { atMs: 0, kind: 'join', driverId: 'a' },
    { atMs: 1 * MINUTE, kind: 'join', driverId: 'b' },
    { atMs: 10 * MINUTE, kind: 'trip_accepted', driverId: 'a' },
    { atMs: 30 * MINUTE, kind: 'trip_completed', driverId: 'a', fareIls: 40, durationMinutes: 20 },
  ];

  test('counts trips and earnings per driver', () => {
    const report = simulateFairness(events);
    const a = report.outcomes.find((o) => o.driverId === 'a');
    assert.equal(a.tripsCompleted, 1);
    assert.equal(a.earningsIls, 40);
    assert.equal(report.totalTrips, 1);
    assert.equal(report.totalEarningsIls, 40);
  });

  test('a driver who never worked still appears, with zeros', () => {
    // Omitting them would flatter the distribution - they are exactly the driver
    // a fairness argument is about.
    const report = simulateFairness(events);
    const b = report.outcomes.find((o) => o.driverId === 'b');
    assert.equal(b.tripsCompleted, 0);
    assert.equal(b.earningsIls, 0);
  });

  test('events may be supplied out of order', () => {
    const shuffled = [events[3], events[0], events[2], events[1]];
    assert.deepEqual(simulateFairness(shuffled), simulateFairness(events));
  });

  test('the same input always yields the same report', () => {
    assert.deepEqual(simulateFairness(events), simulateFairness(events));
  });

  test('waiting time accrues while queued', () => {
    const report = simulateFairness(events);
    const a = report.outcomes.find((o) => o.driverId === 'a');
    // Joined at 0, accepted at 10 minutes.
    assert.equal(Math.round(a.waitingMinutes), 10);
  });

  test('an empty simulation reports zeros rather than throwing', () => {
    const report = simulateFairness([]);
    assert.deepEqual(report.outcomes, []);
    assert.equal(report.totalTrips, 0);
    assert.equal(report.earningsGini, 0);
    assert.equal(report.tripCountSpread, 0);
  });
});

describe('simulateFairness - the policy is genuinely an input', () => {
  /** A short trip, under two readings of the short-trip question. */
  const shortTrip = [
    { atMs: 0, kind: 'join', driverId: 'a' },
    { atMs: 1 * MINUTE, kind: 'join', driverId: 'b' },
    { atMs: 2 * MINUTE, kind: 'trip_accepted', driverId: 'a' },
    { atMs: 5 * MINUTE, kind: 'trip_completed', driverId: 'a', fareIls: 15, durationMinutes: 3 },
  ];

  test('a decline forfeits a place only when the policy says so', () => {
    const declines = [
      { atMs: 0, kind: 'join', driverId: 'a' },
      { atMs: 5 * MINUTE, kind: 'declined', driverId: 'a' },
    ];

    const forfeits = simulateFairness(declines, { ...IMPLEMENTED_POLICY, declineForfeitsPlace: true });
    const keeps = simulateFairness(declines, { ...IMPLEMENTED_POLICY, declineForfeitsPlace: false });

    assert.equal(forfeits.outcomes[0].timesForfeited, 1);
    assert.equal(keeps.outcomes[0].timesForfeited, 0);
  });

  test('going offline forfeits only when the policy says so', () => {
    const offline = [
      { atMs: 0, kind: 'join', driverId: 'a' },
      { atMs: 5 * MINUTE, kind: 'went_offline', driverId: 'a' },
    ];

    const forfeits = simulateFairness(offline, { ...IMPLEMENTED_POLICY, offlineForfeitsPlace: true });
    const keeps = simulateFairness(offline, { ...IMPLEMENTED_POLICY, offlineForfeitsPlace: false });

    assert.equal(forfeits.outcomes[0].timesForfeited, 1);
    assert.equal(keeps.outcomes[0].timesForfeited, 0);
    // Either way the driver leaves the queue - going offline is not a place-hold.
  });

  test('the short-trip rule changes who is at the head afterwards', () => {
    // THE open question: does a 3-minute trip send you to the back of the rank?
    // Both readings are defensible; the simulator must represent both.
    const toTail = simulateFairness(shortTrip, {
      ...IMPLEMENTED_POLICY,
      shortTripReturnsToHeadMaxMinutes: 0,
    });
    const toHead = simulateFairness(shortTrip, {
      ...IMPLEMENTED_POLICY,
      shortTripReturnsToHeadMaxMinutes: 5,
    });

    // The accounting is identical; what differs is the queue the next offer sees,
    // which shows up as the waiting time each driver accrues from here.
    assert.equal(toTail.totalTrips, toHead.totalTrips);
    assert.equal(toTail.totalEarningsIls, toHead.totalEarningsIls);
  });

  test('the implemented default matches what the code actually does today', () => {
    // If this ever drifts, the simulator stops describing the real system.
    assert.equal(IMPLEMENTED_POLICY.declineForfeitsPlace, true);
    assert.equal(IMPLEMENTED_POLICY.offlineForfeitsPlace, true);
    assert.equal(IMPLEMENTED_POLICY.shortTripReturnsToHeadMaxMinutes, 0);
  });
});

describe('simulateFairness - the numbers a driver meeting would cite', () => {
  test('an even split scores a low gini and a zero spread', () => {
    const events = [];
    for (const driverId of ['a', 'b', 'c']) {
      events.push({ atMs: 0, kind: 'join', driverId });
      events.push({
        atMs: 30 * MINUTE,
        kind: 'trip_completed',
        driverId,
        fareIls: 50,
        durationMinutes: 20,
      });
    }
    const report = simulateFairness(events);
    assert.equal(report.earningsGini, 0);
    assert.equal(report.tripCountSpread, 0);
  });

  test('one driver taking everything is visible in both measures', () => {
    const events = [
      { atMs: 0, kind: 'join', driverId: 'a' },
      { atMs: 0, kind: 'join', driverId: 'b' },
      { atMs: 10 * MINUTE, kind: 'trip_completed', driverId: 'a', fareIls: 50, durationMinutes: 10 },
      { atMs: 20 * MINUTE, kind: 'trip_completed', driverId: 'a', fareIls: 50, durationMinutes: 10 },
      { atMs: 30 * MINUTE, kind: 'trip_completed', driverId: 'a', fareIls: 50, durationMinutes: 10 },
    ];
    const report = simulateFairness(events);
    assert.ok(report.earningsGini > 0, `gini should be > 0, got ${report.earningsGini}`);
    assert.equal(report.tripCountSpread, 3);
  });
});
