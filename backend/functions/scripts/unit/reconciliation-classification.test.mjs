/**
 * Unit tests for the internal trip-vs-ledger classification.
 *
 * This logic moved from `apps/manager-web/src/services/reconciliation.ts` to the
 * backend. The emulator suite previously loaded that TypeScript by stripping the
 * types with a hand-rolled regex into a `data:` URL, because the QA harness has no
 * TypeScript runtime - fragile, and the wrong home for financial classification.
 *
 * Every edge case the old suite pinned is preserved here, plus the ones it did not
 * cover. If these pass, the port is faithful.
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
const { classifyTrip, findOrphanedPayments, indexPaymentsByTrip, summarize } = require(
  path.join(dirname, '..', '..', 'dist', 'modules', 'reconciliation')
);

const payment = (tripId) => ({ paymentId: `pay_${tripId}`, tripId });

describe('classifyTrip - the three states a manager acts on', () => {
  test('COLLECTED: trip paid and a payment record exists', () => {
    assert.equal(classifyTrip({ tripId: 't1', paymentStatus: 'paid' }, payment('t1')), 'collected');
  });

  test('UNCOLLECTED: trip completed but payment still pending', () => {
    assert.equal(classifyTrip({ tripId: 't2', paymentStatus: 'pending' }, null), 'uncollected');
  });

  test('UNRECORDED: trip says paid but there is NO payment document', () => {
    // The trip and the ledger disagree - the case actually worth chasing.
    assert.equal(classifyTrip({ tripId: 't3', paymentStatus: 'paid' }, null), 'unrecorded');
  });
});

describe('classifyTrip - the trip is the source of truth', () => {
  test('a stray payment row does NOT upgrade a pending trip', () => {
    assert.equal(classifyTrip({ tripId: 't4', paymentStatus: 'pending' }, payment('t4')), 'uncollected');
  });

  test('an unknown paymentStatus is never treated as paid', () => {
    assert.equal(
      classifyTrip({ tripId: 't5', paymentStatus: 'weird_value' }, payment('t5')),
      'uncollected'
    );
  });

  test('a failed payment is not collected', () => {
    assert.equal(classifyTrip({ tripId: 't6', paymentStatus: 'failed' }, payment('t6')), 'uncollected');
  });

  test('an undefined payment behaves exactly like null', () => {
    assert.equal(classifyTrip({ tripId: 't7', paymentStatus: 'paid' }, undefined), 'unrecorded');
  });

  test('a missing paymentStatus is never treated as paid', () => {
    assert.equal(classifyTrip({ tripId: 't8', paymentStatus: '' }, payment('t8')), 'uncollected');
  });

  test('case matters - "PAID" is not "paid"', () => {
    // Deliberate: statuses are written by the server from an enum. A case-folded
    // match would let a hand-edited document read as settled.
    assert.equal(classifyTrip({ tripId: 't9', paymentStatus: 'PAID' }, payment('t9')), 'uncollected');
  });
});

describe('indexPaymentsByTrip', () => {
  test('matches payments to trips by tripId', () => {
    const index = indexPaymentsByTrip([payment('x'), payment('y')]);
    assert.equal(index.get('x').paymentId, 'pay_x');
    assert.equal(index.get('nope'), undefined);
  });

  test('a payment with an empty tripId is ignored, not matched to everything', () => {
    const index = indexPaymentsByTrip([{ paymentId: 'p0', tripId: '' }, payment('x')]);
    assert.equal(index.size, 1);
    assert.ok(index.has('x'));
  });

  test('an empty input yields an empty index rather than throwing', () => {
    assert.equal(indexPaymentsByTrip([]).size, 0);
  });

  test('the last payment wins when two share a tripId', () => {
    const index = indexPaymentsByTrip([
      { paymentId: 'first', tripId: 'dup' },
      { paymentId: 'second', tripId: 'dup' },
    ]);
    assert.equal(index.size, 1);
    assert.equal(index.get('dup').paymentId, 'second');
  });
});

describe('findOrphanedPayments', () => {
  test('flags a payment whose trip is absent', () => {
    const trips = [
      { tripId: 'a', paymentStatus: 'paid' },
      { tripId: 'b', paymentStatus: 'pending' },
    ];
    const orphans = findOrphanedPayments([payment('a'), payment('zzz-missing')], trips);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].tripId, 'zzz-missing');
  });

  test('does NOT flag a matched payment', () => {
    const orphans = findOrphanedPayments([payment('a')], [{ tripId: 'a', paymentStatus: 'paid' }]);
    assert.equal(orphans.length, 0);
  });

  test('a payment with no tripId is not reported as an orphan', () => {
    // It has nothing to be orphaned FROM; indexing already ignores it.
    const orphans = findOrphanedPayments([{ paymentId: 'p0', tripId: '' }], []);
    assert.equal(orphans.length, 0);
  });

  test('every payment is an orphan when no trips are supplied', () => {
    assert.equal(findOrphanedPayments([payment('a'), payment('b')], []).length, 2);
  });
});

describe('summarize', () => {
  test('counts each state', () => {
    assert.deepEqual(summarize(['collected', 'collected', 'uncollected', 'unrecorded']), {
      collectedCount: 2,
      uncollectedCount: 1,
      unrecordedCount: 1,
    });
  });

  test('an empty run reports zeros rather than throwing', () => {
    assert.deepEqual(summarize([]), {
      collectedCount: 0,
      uncollectedCount: 0,
      unrecordedCount: 0,
    });
  });
});
