import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { evaluatePromo, normalizePromoCode } = require(path.join(dirname, '..', '..', 'dist', 'modules', 'promotions'));

test('promo codes are normalized to a safe canonical key', () => {
  assert.equal(normalizePromoCode(' welcome-10! '), 'WELCOME-10');
});

test('percentage promos respect their maximum discount', () => {
  assert.deepEqual(evaluatePromo({ active: true, discountType: 'percentage', discountValue: 25, maxDiscountIls: 10 }, 80, 100), { valid: true, discountIls: 10 });
});

test('promo policy enforces time, global, passenger and minimum-fare limits', () => {
  assert.equal(evaluatePromo({ active: true, discountType: 'fixed', discountValue: 5, startsAtMs: 101 }, 20, 100).reason, 'not_started');
  assert.equal(evaluatePromo({ active: true, discountType: 'fixed', discountValue: 5, expiresAtMs: 100 }, 20, 100).reason, 'expired');
  assert.equal(evaluatePromo({ active: true, discountType: 'fixed', discountValue: 5, minFareIls: 30 }, 20, 100).reason, 'minimum_fare');
  assert.equal(evaluatePromo({ active: true, discountType: 'fixed', discountValue: 5, usageLimit: 2, usageCount: 2 }, 20, 100).reason, 'usage_limit');
  assert.equal(evaluatePromo({ active: true, discountType: 'fixed', discountValue: 5, perPassengerLimit: 1, passengerUsageCount: 1 }, 20, 100).reason, 'passenger_limit');
});

test('fixed promos can never make a fare negative', () => {
  assert.equal(evaluatePromo({ active: true, discountType: 'fixed', discountValue: 50 }, 12, 100).discountIls, 12);
});
