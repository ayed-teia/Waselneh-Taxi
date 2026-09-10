import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { getBenefitRestorationPlan } = require(path.join(dirname, '..', '..', 'dist', 'modules', 'promotions'));

test('benefit restoration rejects duplicate restoration', () => {
  assert.equal(getBenefitRestorationPlan({ passengerId: 'p1', benefitsRestoredAt: {} }), null);
});

test('benefit restoration sanitizes refundable benefits', () => {
  assert.deepEqual(getBenefitRestorationPlan({ passengerId: ' p1 ', promoCode: 'WELCOME', loyaltyPointsRedeemed: 25.9 }), {
    passengerId: 'p1', promoCode: 'WELCOME', loyaltyPoints: 25,
  });
});

test('benefit restoration keeps a marker even when there is nothing monetary to restore', () => {
  assert.deepEqual(getBenefitRestorationPlan({ passengerId: 'p1' }), {
    passengerId: 'p1', promoCode: null, loyaltyPoints: 0,
  });
});
