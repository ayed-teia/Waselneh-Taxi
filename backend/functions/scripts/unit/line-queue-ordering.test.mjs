/**
 * Unit tests for taxi-line queue candidate ordering.
 *
 * WHY THIS EXISTS
 *
 * `orderCandidatesByQueue` holds the invariant that makes the FIFO queue safe to put
 * behind a flag at all: queued drivers come first in position order, and everyone
 * else is KEPT, ranked behind them. If it ever dropped the non-queued drivers,
 * enabling the flag would silently make trips unmatchable on any line whose queue
 * happened to be empty.
 *
 * The emulator suite covers the happy paths through real Firestore. These cover the
 * edges that are awkward and slow to stage there: empty input, duplicate candidate
 * ids, a queued driver who is not a candidate, and ordering stability.
 *
 * ON THE FAKE FIRESTORE BELOW
 *
 * It deliberately does NOT emulate `where`/`orderBy` - it returns exactly the rows
 * the test supplies, in the order supplied. That is honest about what is being
 * proven: these tests exercise OUR ordering logic, not Firestore's query engine.
 * Returning rows deliberately unsorted is useful, because `orderCandidatesByQueue`
 * re-sorts by position itself, and that re-sort is the actual invariant.
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
const { orderCandidatesByQueue } = require(
  path.join(dirname, '..', '..', 'dist', 'modules', 'queue', 'line-queue')
);

/**
 * A Firestore stand-in exposing only the surface line-queue.ts actually uses:
 *   db.collection('lines').doc(lineId).collection('queue')
 *     .where(...).orderBy(...).get() -> { docs: [{ id, data() }] }
 */
function fakeDb(rowsByLine) {
  const chain = (rows) => ({
    where: () => chain(rows),
    orderBy: () => chain(rows),
    get: async () => ({
      docs: rows.map((row) => ({ id: row.driverId, data: () => row })),
    }),
  });

  return {
    collection: (name) => {
      assert.equal(name, 'lines', 'only the lines collection should be read');
      return {
        doc: (lineId) => ({
          collection: (sub) => {
            assert.equal(sub, 'queue', 'only the queue subcollection should be read');
            return chain(rowsByLine[lineId] ?? []);
          },
        }),
      };
    },
  };
}

/** A waiting queue row. */
const row = (driverId, position) => ({
  driverId,
  lineId: 'line1',
  status: 'waiting',
  position,
});

describe('orderCandidatesByQueue - the load-bearing invariant', () => {
  test('queued drivers are returned in position order, not the order supplied', async () => {
    const db = fakeDb({ line1: [row('c', 300), row('a', 100), row('b', 200)] });
    // Supplied as a distance ranking might: reversed.
    const ordered = await orderCandidatesByQueue(db, 'line1', ['c', 'b', 'a']);
    assert.deepEqual(ordered, ['a', 'b', 'c']);
  });

  test('a driver NOT in the queue is kept, ranked behind those who are', async () => {
    // The property that lets this ship behind a flag: enabling the queue changes
    // who is asked first, never whether anyone is asked.
    const db = fakeDb({ line1: [row('a', 100)] });
    const ordered = await orderCandidatesByQueue(db, 'line1', ['outsider', 'a']);
    assert.deepEqual(ordered, ['a', 'outsider']);
  });

  test('NO candidate is ever dropped', async () => {
    const db = fakeDb({ line1: [row('a', 100), row('b', 200)] });
    const candidates = ['x', 'b', 'y', 'a', 'z'];
    const ordered = await orderCandidatesByQueue(db, 'line1', candidates);
    assert.equal(ordered.length, candidates.length);
    assert.deepEqual([...ordered].sort(), [...candidates].sort());
  });

  test('an empty queue leaves the distance ranking untouched', async () => {
    const db = fakeDb({ line1: [] });
    const ordered = await orderCandidatesByQueue(db, 'line1', ['x', 'y', 'z']);
    assert.deepEqual(ordered, ['x', 'y', 'z']);
  });

  test('non-queued drivers keep their relative order', async () => {
    // They arrive distance-ranked; that ranking must survive among themselves.
    const db = fakeDb({ line1: [row('a', 100)] });
    const ordered = await orderCandidatesByQueue(db, 'line1', ['far', 'near', 'a', 'mid']);
    assert.deepEqual(ordered, ['a', 'far', 'near', 'mid']);
  });
});

describe('orderCandidatesByQueue - edges', () => {
  test('no candidates yields no candidates, without reading the queue', async () => {
    // Guarded early: a dispatch with nobody to ask should not cost a query.
    const db = {
      collection: () => assert.fail('the queue must not be read for an empty candidate list'),
    };
    assert.deepEqual(await orderCandidatesByQueue(db, 'line1', []), []);
  });

  test('a queued driver who is not a candidate does not appear in the result', async () => {
    // The queue is not the candidate list - eligibility and distance filtering
    // happen upstream, and this must not resurrect someone they excluded.
    const db = fakeDb({ line1: [row('a', 100), row('ghost', 50)] });
    const ordered = await orderCandidatesByQueue(db, 'line1', ['a', 'b']);
    assert.deepEqual(ordered, ['a', 'b']);
    assert.ok(!ordered.includes('ghost'));
  });

  test('a duplicated candidate id is not silently collapsed', async () => {
    // Upstream should not send duplicates; if it does, losing one would quietly
    // change the candidate count a caller may be relying on.
    const db = fakeDb({ line1: [row('a', 100)] });
    const ordered = await orderCandidatesByQueue(db, 'line1', ['a', 'a', 'b']);
    assert.equal(ordered.length, 3);
    assert.deepEqual(ordered, ['a', 'a', 'b']);
  });

  test('a row with a missing position sorts as zero rather than throwing', async () => {
    // getNumber falls back to 0, so such a row lands at the front. Pinned so the
    // behaviour is a decision rather than an accident.
    const db = fakeDb({ line1: [{ driverId: 'a', status: 'waiting' }, row('b', 200)] });
    const ordered = await orderCandidatesByQueue(db, 'line1', ['b', 'a']);
    assert.deepEqual(ordered, ['a', 'b']);
  });

  test('an unknown line behaves like an empty queue', async () => {
    const db = fakeDb({ line1: [row('a', 100)] });
    const ordered = await orderCandidatesByQueue(db, 'other-line', ['x', 'y']);
    assert.deepEqual(ordered, ['x', 'y']);
  });
});
