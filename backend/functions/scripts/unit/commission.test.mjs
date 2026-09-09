import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const commission = require(path.join(
  __dirname,
  '..',
  '..',
  'dist',
  'modules',
  'billing',
  'commission.js'
));

const { calculateTripCommission, resolveCommissionBps } = commission;

describe('driver commission accounting', () => {
  test('defaults to a 10% commission', () => {
    assert.deepEqual(calculateTripCommission(100, undefined), {
      grossFareIls: 100,
      commissionBps: 1_000,
      commissionIls: 10,
      driverNetIls: 90,
    });
  });

  test('rounds all monetary values to agorot', () => {
    assert.deepEqual(calculateTripCommission(37.777, 1_250), {
      grossFareIls: 37.78,
      commissionBps: 1_250,
      commissionIls: 4.72,
      driverNetIls: 33.06,
    });
  });

  test('clamps invalid rates and never creates a negative fare', () => {
    assert.equal(resolveCommissionBps(-10), 0);
    assert.equal(resolveCommissionBps(20_000), 10_000);
    assert.equal(resolveCommissionBps(Number.NaN), 1_000);
    assert.deepEqual(calculateTripCommission(-50, 2_000), {
      grossFareIls: 0,
      commissionBps: 2_000,
      commissionIls: 0,
      driverNetIls: 0,
    });
  });
});
