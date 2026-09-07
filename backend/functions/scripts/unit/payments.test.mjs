/**
 * Unit tests for the payment state machine and the stub provider — no emulator, no I/O.
 *
 * These cover the decisions that money correctness rests on: which transitions are
 * legal, that a duplicate event is distinguishable from an illegal one, and that the
 * adapter refuses anything it has not verified.
 *
 * Run: node --test backend/functions/scripts/unit/
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DIST = path.join(__dirname, '..', '..', 'dist');
const sm = require(path.join(DIST, 'modules', 'payments', 'payment-state-machine.js'));
const {
  StubProvider,
  stubSignPayload,
  STUB_SIGNATURE_HEADER,
} = require(path.join(DIST, 'modules', 'payments', 'payment-provider.js'));

const {
  canTransitionPayment,
  decidePaymentTransition,
  isPaymentState,
  isTerminalPaymentState,
  paymentIdempotencyKey,
} = sm;

describe('payment state machine — legal transitions', () => {
  test('pending -> awaiting_payment (an online charge was created)', () => {
    assert.equal(canTransitionPayment('pending', 'awaiting_payment'), true);
  });

  test('pending -> paid stays legal (the CASH path must not break)', () => {
    // confirmCashPayment does exactly this and predates the online module.
    assert.equal(canTransitionPayment('pending', 'paid'), true);
  });

  test('awaiting_payment -> paid | failed | cancelled', () => {
    for (const to of ['paid', 'failed', 'cancelled']) {
      assert.equal(canTransitionPayment('awaiting_payment', to), true, `awaiting_payment -> ${to}`);
    }
  });

  test('paid -> refunded is the only exit from paid', () => {
    assert.equal(canTransitionPayment('paid', 'refunded'), true);
    for (const to of ['pending', 'awaiting_payment', 'failed', 'cancelled']) {
      assert.equal(canTransitionPayment('paid', to), false, `paid -> ${to} must be illegal`);
    }
  });
});

describe('payment state machine — illegal transitions are rejected', () => {
  test('nothing escapes a terminal state', () => {
    for (const from of ['failed', 'cancelled', 'refunded']) {
      assert.equal(isTerminalPaymentState(from), true, `${from} should be terminal`);
      for (const to of ['pending', 'awaiting_payment', 'paid', 'failed', 'cancelled', 'refunded']) {
        if (to === from) continue;
        assert.equal(canTransitionPayment(from, to), false, `${from} -> ${to} must be illegal`);
      }
    }
  });

  test('money state can never be rewound to pending', () => {
    for (const from of ['awaiting_payment', 'paid', 'failed', 'cancelled', 'refunded']) {
      assert.equal(canTransitionPayment(from, 'pending'), false, `${from} -> pending`);
    }
  });

  test('awaiting_payment -> refunded is illegal (nothing was captured to refund)', () => {
    assert.equal(canTransitionPayment('awaiting_payment', 'refunded'), false);
  });

  test('a rejected transition carries a reason', () => {
    const d = decidePaymentTransition('failed', 'paid');
    assert.equal(d.apply, false);
    assert.equal(d.alreadyApplied, false);
    assert.match(d.reason, /terminal/, 'a terminal rejection should say so');
  });
});

describe('decidePaymentTransition — three outcomes, not two', () => {
  test('a NEW legal transition is applied', () => {
    assert.deepEqual(decidePaymentTransition('awaiting_payment', 'paid'), {
      apply: true,
      alreadyApplied: false,
    });
  });

  test('a REPEAT of the current state is a no-op success, not an error', () => {
    // This is the duplicate-webhook case. Conflating it with "illegal" would make a
    // processor retry forever; conflating it with "apply" would double-apply.
    const d = decidePaymentTransition('paid', 'paid');
    assert.equal(d.apply, false, 'must not write');
    assert.equal(d.alreadyApplied, true, 'must report success');
    assert.equal(d.reason, undefined, 'a duplicate is not an error');
  });

  test('an ILLEGAL transition is neither applied nor treated as already applied', () => {
    const d = decidePaymentTransition('refunded', 'paid');
    assert.equal(d.apply, false);
    assert.equal(d.alreadyApplied, false);
    assert.ok(d.reason);
  });

  /**
   * NEGATIVE CONTROL for idempotency.
   *
   * Models the naive implementation this code exists to avoid: one that asks only
   * "is the target reachable or equal?" and writes whenever the answer is yes. Under
   * a duplicate `paid` event that version applies twice — which in the real service
   * means a second paidAt, a second ledger entry, a second payout.
   */
  test('NEGATIVE CONTROL: an unguarded check double-applies the same event', () => {
    const naiveWouldWrite = (from, to) => from === to || canTransitionPayment(from, to);

    let naiveWrites = 0;
    let guardedWrites = 0;
    let state = 'awaiting_payment';

    // The same `paid` event delivered twice, as a retrying processor would.
    for (const _ of [1, 2]) {
      if (naiveWouldWrite(state, 'paid')) naiveWrites += 1;
      if (decidePaymentTransition(state, 'paid').apply) guardedWrites += 1;
      state = 'paid';
    }

    assert.equal(naiveWrites, 2, 'the unguarded version must be shown to double-apply');
    assert.equal(guardedWrites, 1, 'the real decision function applies exactly once');
  });
});

describe('payment state validation', () => {
  test('recognises every real state', () => {
    for (const s of ['pending', 'awaiting_payment', 'paid', 'failed', 'cancelled', 'refunded']) {
      assert.equal(isPaymentState(s), true, s);
    }
  });

  test('rejects junk, so a corrupt field cannot authorise a transition', () => {
    for (const junk of ['PAID', 'paid ', '', null, undefined, 7, {}, ['paid']]) {
      assert.equal(isPaymentState(junk), false, JSON.stringify(junk));
    }
  });
});

describe('idempotency key', () => {
  test('is derived from the trip, so it is stable across retries', () => {
    assert.equal(paymentIdempotencyKey('trip-1'), paymentIdempotencyKey('trip-1'));
  });

  test('matches the payment document id, so the two cannot disagree', () => {
    assert.equal(paymentIdempotencyKey('trip-1'), 'payment_trip-1');
  });

  test('different trips never share a key', () => {
    assert.notEqual(paymentIdempotencyKey('trip-1'), paymentIdempotencyKey('trip-2'));
  });
});

describe('StubProvider — charges', () => {
  const provider = new StubProvider();

  test('the same idempotency key yields the SAME charge id', async () => {
    const input = {
      tripId: 't1',
      amountMinorUnits: 2500,
      currency: 'ILS',
      passengerId: 'p1',
      idempotencyKey: 'payment_t1',
    };
    const a = await provider.createCharge(input);
    const b = await provider.createCharge(input);
    assert.equal(a.providerChargeId, b.providerChargeId, 'a retry must not create a second charge');
  });

  test('refund returns an id and reports whether it settled', async () => {
    const r = await provider.refund({ providerChargeId: 'stub_charge_x', amountMinorUnits: 100 });
    assert.ok(r.providerRefundId);
    assert.equal(typeof r.settled, 'boolean');
  });
});

describe('StubProvider — webhook verification', () => {
  const provider = new StubProvider();

  const body = (over = {}) =>
    JSON.stringify({
      eventId: 'evt_1',
      tripId: 't1',
      providerChargeId: 'stub_charge_payment_t1',
      status: 'paid',
      amountMinorUnits: 2500,
      ...over,
    });

  const signed = (raw) => ({ [STUB_SIGNATURE_HEADER]: stubSignPayload(raw) });

  test('a correctly signed payload verifies', () => {
    const raw = body();
    const event = provider.parseAndVerifyWebhook(raw, signed(raw));
    assert.ok(event, 'a valid payload must verify');
    assert.equal(event.status, 'paid');
    assert.equal(event.tripId, 't1');
  });

  test('an UNSIGNED payload is rejected', () => {
    // Otherwise the webhook is an open "mark this trip paid" endpoint.
    assert.equal(provider.parseAndVerifyWebhook(body(), {}), null);
  });

  test('a TAMPERED body is rejected even with a signature for the original', () => {
    const original = body();
    const headers = signed(original);
    const tampered = body({ amountMinorUnits: 999999 });
    assert.equal(provider.parseAndVerifyWebhook(tampered, headers), null);
  });

  test('a wrong signature is rejected', () => {
    const raw = body();
    assert.equal(
      provider.parseAndVerifyWebhook(raw, { [STUB_SIGNATURE_HEADER]: 'a'.repeat(64) }),
      null
    );
  });

  test('a signature of the wrong LENGTH is rejected without throwing', () => {
    // timingSafeEqual throws on a length mismatch; the length check must come first.
    const raw = body();
    assert.doesNotThrow(() => provider.parseAndVerifyWebhook(raw, { [STUB_SIGNATURE_HEADER]: 'ab' }));
    assert.equal(provider.parseAndVerifyWebhook(raw, { [STUB_SIGNATURE_HEADER]: 'ab' }), null);
  });

  test('malformed JSON is rejected rather than throwing', () => {
    const raw = 'not json';
    assert.equal(provider.parseAndVerifyWebhook(raw, signed(raw)), null);
  });

  test('a signed payload with a status we do not accept is rejected', () => {
    // A provider must never be able to push us straight to `pending` or a made-up state.
    for (const status of ['pending', 'awaiting_payment', 'cancelled', 'hacked']) {
      const raw = body({ status });
      assert.equal(provider.parseAndVerifyWebhook(raw, signed(raw)), null, status);
    }
  });

  test('a signed payload missing required fields is rejected', () => {
    for (const field of ['eventId', 'tripId', 'providerChargeId']) {
      const parsed = JSON.parse(body());
      delete parsed[field];
      const raw = JSON.stringify(parsed);
      assert.equal(provider.parseAndVerifyWebhook(raw, signed(raw)), null, `missing ${field}`);
    }
  });

  test('failureReason is OMITTED rather than set to undefined when absent', () => {
    // exactOptionalPropertyTypes: an explicitly-undefined key is not the same as absent.
    const raw = body();
    const event = provider.parseAndVerifyWebhook(raw, signed(raw));
    assert.equal('failureReason' in event, false);
  });

  test('failureReason is carried through on a failed event', () => {
    const raw = body({ status: 'failed', failureReason: 'card_declined' });
    const event = provider.parseAndVerifyWebhook(raw, signed(raw));
    assert.equal(event.failureReason, 'card_declined');
  });
});
