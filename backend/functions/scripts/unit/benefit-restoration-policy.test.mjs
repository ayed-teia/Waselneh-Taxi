/**
 * Unit tests for the generalised benefit-restoration policy.
 *
 * The pure decision is `getBenefitRestorationPlan`: given a document that
 * consumed a promo and/or loyalty points, what is owed back? Four different
 * actors can cancel the same matched trip, so the guards here are what stop a
 * benefit being returned twice.
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
const { getBenefitRestorationPlan } = require(
  path.join(dirname, '..', '..', 'dist', 'modules', 'promotions')
);

describe('getBenefitRestorationPlan - double-refund guard', () => {
  test('an already-restored document yields nothing', () => {
    // This is THE guard against a second refund. Four actors can cancel the same
    // trip, and the sweeper can re-observe it on a later run.
    assert.equal(
      getBenefitRestorationPlan({
        passengerId: 'p1',
        promoCode: 'WELCOME',
        loyaltyPointsRedeemed: 50,
        benefitsRestoredAt: {},
      }),
      null
    );
  });

  test('the guard fires even when the sentinel is the only field set', () => {
    assert.equal(getBenefitRestorationPlan({ passengerId: 'p1', benefitsRestoredAt: {} }), null);
  });

  test('a document with no passenger yields nothing', () => {
    // Without a passenger there is nobody to credit; writing a sentinel would
    // silently mark a real benefit as handled.
    assert.equal(getBenefitRestorationPlan({ promoCode: 'WELCOME' }), null);
    assert.equal(getBenefitRestorationPlan({ passengerId: '   ' }), null);
  });
});

describe('getBenefitRestorationPlan - what is owed back', () => {
  test('returns the promo and the redeemed points', () => {
    assert.deepEqual(
      getBenefitRestorationPlan({
        passengerId: 'p1',
        promoCode: 'WELCOME',
        loyaltyPointsRedeemed: 40,
      }),
      { passengerId: 'p1', promoCode: 'WELCOME', loyaltyPoints: 40 }
    );
  });

  test('a marker plan is still returned when nothing monetary is owed', () => {
    // Deliberate: the caller writes benefitsRestoredAt regardless, which is what
    // lets a LATER actor tell "already handled" from "never handled".
    assert.deepEqual(getBenefitRestorationPlan({ passengerId: 'p1' }), {
      passengerId: 'p1',
      promoCode: null,
      loyaltyPoints: 0,
    });
  });

  test('fractional points are floored, never rounded up', () => {
    const plan = getBenefitRestorationPlan({ passengerId: 'p1', loyaltyPointsRedeemed: 25.9 });
    assert.equal(plan.loyaltyPoints, 25, 'must never return more than was redeemed');
  });

  test('a negative or junk point value can never mint points', () => {
    for (const redeemed of [-50, Number.NaN, 'lots', null, undefined, {}]) {
      const plan = getBenefitRestorationPlan({ passengerId: 'p1', loyaltyPointsRedeemed: redeemed });
      assert.ok(plan, `expected a marker plan for ${JSON.stringify(redeemed)}`);
      assert.equal(plan.loyaltyPoints, 0, `junk ${JSON.stringify(redeemed)} produced points`);
    }
  });

  test('a blank promo code normalises to null rather than an empty document id', () => {
    // An empty string would resolve to promoCodes/"" - a real document path.
    for (const code of ['', '   ']) {
      assert.equal(getBenefitRestorationPlan({ passengerId: 'p1', promoCode: code }).promoCode, null);
    }
  });

  test('a non-string promo code is ignored', () => {
    assert.equal(getBenefitRestorationPlan({ passengerId: 'p1', promoCode: 42 }).promoCode, null);
  });

  test('passenger id is trimmed', () => {
    assert.equal(getBenefitRestorationPlan({ passengerId: '  p1  ' }).passengerId, 'p1');
  });
});

describe('restoration works from either document shape', () => {
  test('a tripRequest body is understood', () => {
    // Benefits are consumed at request time.
    const plan = getBenefitRestorationPlan({
      requestId: 'req-1',
      passengerId: 'p1',
      promoCode: 'SAVE10',
      loyaltyPointsRedeemed: 30,
    });
    assert.deepEqual(plan, { passengerId: 'p1', promoCode: 'SAVE10', loyaltyPoints: 30 });
  });

  test('a matched trip body is understood identically', () => {
    // After dispatch the trip document carries its own copy, which is what the
    // four matched-trip cancellation actors have in hand.
    const plan = getBenefitRestorationPlan({
      tripId: 'trip-1',
      requestId: 'req-1',
      passengerId: 'p1',
      promoCode: 'SAVE10',
      promoDiscountIls: 4,
      loyaltyPointsRedeemed: 30,
      loyaltyDiscountIls: 3,
      status: 'accepted',
    });
    assert.deepEqual(plan, { passengerId: 'p1', promoCode: 'SAVE10', loyaltyPoints: 30 });
  });
});
