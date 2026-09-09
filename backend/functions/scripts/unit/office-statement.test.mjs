import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { calculateOfficeStatement } = require(path.join(dirname, '..', '..', 'dist', 'modules', 'billing', 'office-statement.js'));

test('office statement collects commissions and subscription invoices', () => {
  assert.deepEqual(calculateOfficeStatement([
    { grossFareIls: 100, commissionIls: 10 },
    { grossFareIls: 55.55, commissionIls: 5.56 },
  ], [40, 20]), {
    grossFareIls: 155.55, commissionDueIls: 15.56, subscriptionDueIls: 60, totalDueIls: 75.56,
  });
});

test('office statement clamps malformed negative amounts', () => {
  assert.deepEqual(calculateOfficeStatement([{ grossFareIls: -10, commissionIls: -2 }], [-5]), {
    grossFareIls: 0, commissionDueIls: 0, subscriptionDueIls: 0, totalDueIls: 0,
  });
});
