import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { calculateSettlement } = require(path.join(dirname, '..', '..', 'dist', 'modules', 'billing', 'settlement.js'));

test('settlement totals and deducts recurring fee once', () => {
  assert.deepEqual(calculateSettlement([
    { grossFareIls: 100, commissionIls: 10, driverNetIls: 90 },
    { grossFareIls: 50, commissionIls: 5, driverNetIls: 45 },
  ], 20), { grossFareIls: 150, commissionIls: 15, driverNetIls: 135, recurringFeeIls: 20, payableIls: 115 });
});

test('settlement clamps malformed negative money and payable at zero', () => {
  assert.deepEqual(calculateSettlement([{ grossFareIls: -1, commissionIls: -1, driverNetIls: 5 }], 20), {
    grossFareIls: 0, commissionIls: 0, driverNetIls: 5, recurringFeeIls: 20, payableIls: 0,
  });
});
