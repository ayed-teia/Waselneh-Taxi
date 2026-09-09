import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const { decideRefundRequest } = require(path.join(dirname, '..', '..', 'dist', 'modules', 'payments', 'refund-request.js'));

test('refund requests require a paid payment', () => {
  assert.equal(decideRefundRequest('pending').allowed, false);
  assert.equal(decideRefundRequest('awaiting_payment').allowed, false);
  assert.equal(decideRefundRequest('refunded').allowed, false);
  assert.equal(decideRefundRequest('paid').allowed, true);
});

test('refund reservation is idempotent and failed requests can retry', () => {
  assert.equal(decideRefundRequest('paid', 'processing').alreadyRequested, true);
  assert.equal(decideRefundRequest('paid', 'submitted').alreadyRequested, true);
  assert.equal(decideRefundRequest('paid', 'failed').allowed, true);
});
