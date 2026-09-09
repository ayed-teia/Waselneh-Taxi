import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { isPayableInvoiceStatus, shouldReactivateSubscription } = require(path.join(dirname, '..', '..', 'dist', 'modules', 'billing', 'invoice-payment.js'));

test('only pending and overdue invoice states can be paid', () => {
  assert.equal(isPayableInvoiceStatus('pending'), true);
  assert.equal(isPayableInvoiceStatus('past_due'), true);
  assert.equal(isPayableInvoiceStatus('suspended'), true);
  assert.equal(isPayableInvoiceStatus('paid'), false);
  assert.equal(isPayableInvoiceStatus('void'), false);
});

test('reactivates a blocked subscription after its final blocking invoice is paid', () => {
  assert.equal(shouldReactivateSubscription('suspended', ['paid', 'pending']), true);
  assert.equal(shouldReactivateSubscription('past_due', []), true);
});

test('does not reactivate with another overdue debt or from a terminal status', () => {
  assert.equal(shouldReactivateSubscription('suspended', ['past_due']), false);
  assert.equal(shouldReactivateSubscription('past_due', ['suspended']), false);
  assert.equal(shouldReactivateSubscription('cancelled', []), false);
});
