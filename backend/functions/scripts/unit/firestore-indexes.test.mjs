/**
 * Every composite-index-requiring query must have a matching index definition.
 *
 * WHY THIS CANNOT BE CAUGHT BY THE EMULATOR SUITES
 *
 * The Firestore emulator creates composite indexes ON DEMAND. A query needing an
 * index that does not exist in firestore.indexes.json runs perfectly in CI and then
 * throws FAILED_PRECONDITION ("The query requires an index") the first time a real
 * user hits it in production. All 19 emulator suites are green and tell us nothing
 * about this whatsoever.
 *
 * So the check has to be static: the QUERIES list below is maintained by hand from
 * the real call sites, and this test asserts each one is covered.
 *
 * WHAT NEEDS A COMPOSITE INDEX
 *   - two or more equality filters plus an orderBy on another field
 *   - an equality filter plus an orderBy on a different field
 *   - an `in` filter plus an orderBy on a different field
 * A single-field inequality with no orderBy (or ordering by the SAME field) is
 * served by the automatic single-field index and needs nothing here - which is why
 * the `payments` createdAt range scans are deliberately absent from this list.
 *
 * THE PREFIX RULE
 * Equality fields must PRECEDE the sort field in the index. trips(driverId, status)
 * does NOT serve a query that also orders by completedAt.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(dirname, '..', '..', '..', '..');
const INDEXES_PATH = path.join(REPO_ROOT, 'firestore.indexes.json');

/**
 * Real queries that require a composite index.
 * `equality` fields may appear in any order; `orderBy` must follow them.
 */
const QUERIES = [
  {
    where: 'backend getDriverEarningsSummary.callable.ts',
    collection: 'trips',
    equality: ['driverId', 'status'],
    orderBy: { field: 'completedAt', order: 'DESCENDING' },
  },
  {
    where: 'backend modules/queue/line-queue.ts getWaitingQueue',
    collection: 'queue',
    equality: ['status'],
    orderBy: { field: 'position', order: 'ASCENDING' },
  },
  {
    where: 'manager-web trips.service subscribeToActiveTrips / PendingTrips',
    collection: 'trips',
    equality: ['status'],
    orderBy: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    where: 'manager-web trips.service completed trips',
    collection: 'trips',
    equality: ['status'],
    orderBy: { field: 'completedAt', order: 'DESCENDING' },
  },
  {
    where: 'manager-web roadblocks.service activeOnly',
    collection: 'roadblocks',
    equality: ['status'],
    orderBy: { field: 'updatedAt', order: 'DESCENDING' },
  },
  {
    where: 'passenger trip.realtime active trip',
    collection: 'trips',
    equality: ['passengerId', 'status'],
    orderBy: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    where: 'driver trips.realtime incoming for driver',
    collection: 'trips',
    equality: ['driverId', 'status'],
    orderBy: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    where: 'driver trips.realtime available (unassigned) trips',
    collection: 'trips',
    equality: ['status', 'assignedDriverId'],
    orderBy: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    where: 'driver trips.realtime pending tripRequests',
    collection: 'tripRequests',
    equality: ['status'],
    orderBy: { field: 'createdAt', order: 'DESCENDING' },
  },
];

function loadIndexes() {
  const parsed = JSON.parse(fs.readFileSync(INDEXES_PATH, 'utf8'));
  assert.ok(Array.isArray(parsed.indexes), 'firestore.indexes.json has no indexes array');
  return parsed.indexes;
}

/**
 * True when `index` serves `query`: every equality field appears before the sort
 * field, and the sort field matches in name and direction.
 */
function indexServes(index, query) {
  if (index.collectionGroup !== query.collection) return false;

  const fields = index.fields ?? [];
  const sortPosition = fields.findIndex(
    (f) => f.fieldPath === query.orderBy.field && f.order === query.orderBy.order
  );
  if (sortPosition < 0) return false;

  const beforeSort = fields.slice(0, sortPosition).map((f) => f.fieldPath);
  return query.equality.every((field) => beforeSort.includes(field));
}

describe('firestore.indexes.json covers every composite query', () => {
  for (const query of QUERIES) {
    test(`${query.collection}: ${query.equality.join(' + ')} -> ${query.orderBy.field} (${query.where})`, () => {
      const indexes = loadIndexes();
      const covered = indexes.some((index) => indexServes(index, query));
      assert.ok(
        covered,
        `No index serves this query. Production would throw FAILED_PRECONDITION. ` +
          `Add: { collectionGroup: "${query.collection}", fields: [` +
          `${query.equality.map((f) => `${f} ASC`).join(', ')}, ` +
          `${query.orderBy.field} ${query.orderBy.order}] }`
      );
    });
  }
});

describe('the index file itself is well formed', () => {
  test('every index has a collectionGroup, a queryScope and fields', () => {
    for (const index of loadIndexes()) {
      assert.ok(index.collectionGroup, 'missing collectionGroup');
      assert.ok(
        index.queryScope === 'COLLECTION' || index.queryScope === 'COLLECTION_GROUP',
        `bad queryScope on ${index.collectionGroup}: ${index.queryScope}`
      );
      assert.ok(Array.isArray(index.fields) && index.fields.length >= 2, 'needs 2+ fields');
    }
  });

  test('there are no exact duplicate indexes', () => {
    // A duplicate is billable storage for nothing, and a sign of a careless merge.
    const seen = new Set();
    for (const index of loadIndexes()) {
      const key = `${index.collectionGroup}|${index.queryScope}|${index.fields
        .map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig}`)
        .join(',')}`;
      assert.ok(!seen.has(key), `duplicate index: ${key}`);
      seen.add(key);
    }
  });
});
