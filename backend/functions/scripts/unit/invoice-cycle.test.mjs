import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const cycle = require(
  path.join(dirname, '..', '..', 'dist', 'modules', 'billing', 'invoice-cycle.js')
);

test('billing period key is stable in UTC', () =>
  assert.equal(cycle.billingPeriodKey(new Date('2026-09-30T23:00:00Z')), '2026-09'));
test('monthly, quarterly and annual schedules respect their interval', () => {
  const start = new Date('2026-01-05T00:00:00Z');
  assert.equal(cycle.shouldCreateInvoice(start, new Date('2026-02-05T00:00:00Z'), 'monthly'), true);
  assert.equal(
    cycle.shouldCreateInvoice(start, new Date('2026-02-05T00:00:00Z'), 'quarterly'),
    false
  );
  assert.equal(
    cycle.shouldCreateInvoice(start, new Date('2026-04-05T00:00:00Z'), 'quarterly'),
    true
  );
  assert.equal(cycle.shouldCreateInvoice(start, new Date('2027-01-05T00:00:00Z'), 'annual'), true);
});
test('does not invoice before the subscription billing day', () => {
  assert.equal(
    cycle.shouldCreateInvoice(
      new Date('2026-01-20T00:00:00Z'),
      new Date('2026-02-19T00:00:00Z'),
      'monthly'
    ),
    false
  );
});

test('invoice reminders are emitted only three and one days before due date', () => {
  const due = new Date('2026-10-10T12:00:00Z');
  assert.equal(cycle.reminderDaysBeforeDue(due, new Date('2026-10-07T12:00:00Z')), 3);
  assert.equal(cycle.reminderDaysBeforeDue(due, new Date('2026-10-09T12:00:00Z')), 1);
  assert.equal(cycle.reminderDaysBeforeDue(due, new Date('2026-10-08T12:00:00Z')), null);
});
