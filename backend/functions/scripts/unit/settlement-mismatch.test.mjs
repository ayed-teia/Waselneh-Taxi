/**
 * Unit tests for the provider settlement mismatch taxonomy.
 *
 * This is the half of reconciliation that did not exist: comparing OUR ledger
 * against the PROVIDER's settlement report. The internal classification can never
 * detect that the processor thinks something different from us.
 *
 * No real Lahza settlement file can be obtained without live credentials, so every
 * category is proven against fixtures. That is honest evidence about OUR logic -
 * it is not evidence about Lahza's actual report format.
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
const { classifyPaymentAgainstSettlement, reconcileSettlement, severityFor } = require(
  path.join(dirname, '..', '..', 'dist', 'modules', 'reconciliation')
);

/** An internal payment in agorot. */
function internal(over = {}) {
  return {
    paymentId: 'payment_trip1',
    tripId: 'trip1',
    status: 'paid',
    amountMinorUnits: 2500,
    currency: 'ILS',
    providerChargeId: 'payment-trip1',
    ...over,
  };
}

/** A provider settlement row in agorot. */
function provider(over = {}) {
  return {
    reference: 'payment-trip1',
    status: 'paid',
    amountMinorUnits: 2500,
    currency: 'ILS',
    tripId: 'trip1',
    ...over,
  };
}

describe('classifyPaymentAgainstSettlement - agreement', () => {
  test('identical records are matched', () => {
    const finding = classifyPaymentAgainstSettlement(internal(), provider());
    assert.equal(finding.category, 'matched');
    assert.equal(finding.severity, 'none');
  });

  test('unpaid internally and absent from the report is consistent, not a mismatch', () => {
    const finding = classifyPaymentAgainstSettlement(internal({ status: 'pending' }), null);
    assert.equal(finding.category, 'matched');
  });
});

describe('classifyPaymentAgainstSettlement - the money-losing cases', () => {
  test('internal paid but absent from the settlement report is HIGH risk', () => {
    const finding = classifyPaymentAgainstSettlement(internal({ status: 'paid' }), null);
    assert.equal(finding.category, 'internal_paid_provider_missing');
    assert.equal(finding.severity, 'high');
  });

  test('provider paid while we still say pending is HIGH risk', () => {
    // Usually a webhook we failed to process - the passenger was charged.
    const finding = classifyPaymentAgainstSettlement(internal({ status: 'pending' }), provider());
    assert.equal(finding.category, 'provider_paid_internal_pending');
    assert.equal(finding.severity, 'high');
  });

  test('an amount difference is HIGH risk', () => {
    const finding = classifyPaymentAgainstSettlement(internal(), provider({ amountMinorUnits: 2400 }));
    assert.equal(finding.category, 'amount_mismatch');
    assert.equal(finding.severity, 'high');
    assert.equal(finding.internalAmountMinorUnits, 2500);
    assert.equal(finding.providerAmountMinorUnits, 2400);
  });

  test('one agora of difference is still a mismatch', () => {
    // Money compares exactly; there is no tolerance band.
    const finding = classifyPaymentAgainstSettlement(internal(), provider({ amountMinorUnits: 2501 }));
    assert.equal(finding.category, 'amount_mismatch');
  });
});

describe('classifyPaymentAgainstSettlement - refunds and currency', () => {
  test('provider refunded while we say paid is a refund mismatch', () => {
    const finding = classifyPaymentAgainstSettlement(internal(), provider({ status: 'refunded' }));
    assert.equal(finding.category, 'refund_mismatch');
  });

  test('we say refunded while the provider says paid is also a refund mismatch', () => {
    const finding = classifyPaymentAgainstSettlement(internal({ status: 'refunded' }), provider());
    assert.equal(finding.category, 'refund_mismatch');
  });

  test('both refunded is agreement', () => {
    const finding = classifyPaymentAgainstSettlement(
      internal({ status: 'refunded' }),
      provider({ status: 'refunded' })
    );
    assert.equal(finding.category, 'matched');
  });

  test('a currency difference is caught before any amount comparison', () => {
    // Comparing 2500 ILS against 2500 USD as equal would be worse than useless.
    const finding = classifyPaymentAgainstSettlement(
      internal({ currency: 'ILS' }),
      provider({ currency: 'USD', amountMinorUnits: 9999 })
    );
    assert.equal(finding.category, 'currency_mismatch');
  });

  test('currency comparison ignores case and padding', () => {
    const finding = classifyPaymentAgainstSettlement(internal({ currency: ' ils ' }), provider());
    assert.equal(finding.category, 'matched');
  });
});

describe('severityFor', () => {
  test('matched carries no severity', () => {
    assert.equal(severityFor('matched'), 'none');
  });

  test('every money-losing category is high', () => {
    for (const category of [
      'internal_paid_provider_missing',
      'provider_paid_internal_pending',
      'amount_mismatch',
      'duplicate_provider_reference',
      'orphan_provider_payment',
    ]) {
      assert.equal(severityFor(category), 'high', `${category} should be high risk`);
    }
  });
});

describe('reconcileSettlement - whole-batch behaviour', () => {
  test('every internal payment yields exactly one finding', () => {
    const report = reconcileSettlement(
      [internal({ paymentId: 'p1', providerChargeId: 'r1' }), internal({ paymentId: 'p2', providerChargeId: 'r2' })],
      [provider({ reference: 'r1' }), provider({ reference: 'r2' })]
    );
    assert.equal(report.comparedCount, 2);
    assert.equal(report.findings.length, 2);
    assert.equal(report.totals.matched, 2);
  });

  test('a settlement row nothing internal claims is an orphan', () => {
    const report = reconcileSettlement(
      [internal({ providerChargeId: 'r1' })],
      [provider({ reference: 'r1' }), provider({ reference: 'stranger' })]
    );
    assert.equal(report.totals.orphan_provider_payment, 1);
    const orphan = report.findings.find((f) => f.category === 'orphan_provider_payment');
    assert.equal(orphan.providerReference, 'stranger');
    assert.equal(orphan.paymentId, null);
  });

  test('a duplicated provider reference is flagged, never silently collapsed', () => {
    // The same reference twice can mean a double capture.
    const report = reconcileSettlement(
      [internal({ providerChargeId: 'dup' })],
      [provider({ reference: 'dup' }), provider({ reference: 'dup' })]
    );
    assert.equal(report.totals.duplicate_provider_reference, 1);
    assert.equal(report.highRiskCount, 1);
  });

  test('an internal payment with no provider reference is not matched by accident', () => {
    const report = reconcileSettlement(
      [internal({ providerChargeId: null, status: 'paid' })],
      [provider({ reference: 'unrelated' })]
    );
    assert.equal(report.totals.internal_paid_provider_missing, 1);
    assert.equal(report.totals.orphan_provider_payment, 1);
  });

  test('an empty run reports zeros rather than throwing', () => {
    const report = reconcileSettlement([], []);
    assert.equal(report.comparedCount, 0);
    assert.equal(report.findings.length, 0);
    assert.equal(report.highRiskCount, 0);
  });

  test('highRiskCount counts only high-severity findings', () => {
    const report = reconcileSettlement(
      [
        internal({ paymentId: 'ok', providerChargeId: 'r1' }),
        internal({ paymentId: 'bad', providerChargeId: 'r2', status: 'pending' }),
      ],
      [provider({ reference: 'r1' }), provider({ reference: 'r2' })]
    );
    assert.equal(report.highRiskCount, 1);
    assert.equal(report.totals.matched, 1);
  });

  test('a blank provider reference row is skipped rather than indexed', () => {
    const report = reconcileSettlement([internal({ providerChargeId: 'r1' })], [
      provider({ reference: '' }),
      provider({ reference: 'r1' }),
    ]);
    assert.equal(report.totals.matched, 1);
    assert.equal(report.totals.orphan_provider_payment, 0);
  });
});
