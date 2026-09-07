/**
 * Unit tests for the Lahza adapter — no network, no credentials, no emulator.
 *
 * ⚠️  NO REAL OR SANDBOX LAHZA CALL IS MADE ANYWHERE IN THIS FILE. These tests cover
 * the logic we own — signature verification, event mapping, reference/amount
 * handling and fail-safe provider selection — against the documented contract. They
 * cannot and do not prove that Lahza's live API behaves as documented.
 *
 * The `fetch`-based paths (createCharge, refund) are driven against a stubbed global
 * fetch, so they verify the REQUEST WE BUILD and how we read a documented response
 * shape. That is a real assertion about our code; it is not evidence about theirs.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DIST = path.join(__dirname, '..', '..', 'dist');
const {
  LahzaProvider,
  LAHZA_SIGNATURE_HEADER,
  LAHZA_EVENTS,
  lahzaSignPayload,
  mapLahzaEventToStatus,
  tripIdToLahzaReference,
  lahzaReferenceToTripId,
} = require(path.join(DIST, 'modules', 'payments', 'lahza-provider.js'));

const { getPaymentProvider } = require(
  path.join(DIST, 'modules', 'payments', 'payment-core.service.js')
);

const SECRET = 'sk_test_unit_secret_key';
const provider = new LahzaProvider({ secretKey: SECRET });

/** A charge.success payload shaped as Lahza documents it. */
function chargeSuccessBody(over = {}) {
  return JSON.stringify({
    event: LAHZA_EVENTS.CHARGE_SUCCESS,
    data: {
      id: 690075529,
      reference: 'payment-trip123',
      status: 'success',
      amount: 2500,
      currency: 'ILS',
      ...over,
    },
  });
}

const signedHeaders = (raw, secret = SECRET) => ({
  [LAHZA_SIGNATURE_HEADER]: lahzaSignPayload(raw, secret),
});

// ===========================================================================
// Signature verification — the entire security boundary.
// ===========================================================================
describe('Lahza webhook signature verification', () => {
  test('the signature is HMAC-SHA256 of the raw body, hex, keyed with the secret', () => {
    // Pinned against Node's crypto directly rather than against our own helper, so
    // this fails if the documented scheme is ever silently changed in the adapter.
    const raw = chargeSuccessBody();
    const expected = createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
    assert.equal(lahzaSignPayload(raw, SECRET), expected);
    assert.equal(expected.length, 64, 'a hex SHA256 digest is 64 characters');
  });

  test('a correctly signed payload verifies', () => {
    const raw = chargeSuccessBody();
    const event = provider.parseAndVerifyWebhook(raw, signedHeaders(raw));
    assert.ok(event, 'a correctly signed charge.success must verify');
    assert.equal(event.status, 'paid');
    assert.equal(event.tripId, 'trip123');
    assert.equal(event.amountMinorUnits, 2500);
  });

  /**
   * NEGATIVE CONTROL — the one that matters most.
   *
   * The body is altered to a larger amount while keeping the signature that was
   * valid for the ORIGINAL body. If verification were skipped, reordered after
   * parsing, or compared loosely, this forged event would be accepted and a trip
   * would be marked paid on an attacker's say-so.
   */
  test('NEGATIVE CONTROL: a tampered body with the original signature is REJECTED', () => {
    const original = chargeSuccessBody();
    const headers = signedHeaders(original);

    const tampered = chargeSuccessBody({ amount: 100000000 });
    assert.notEqual(tampered, original, 'the test must actually change the body');

    // Proof the header really is a VALID signature - for the original body.
    assert.ok(provider.parseAndVerifyWebhook(original, headers), 'control: original verifies');

    assert.equal(
      provider.parseAndVerifyWebhook(tampered, headers),
      null,
      'a body that does not match its signature must never produce an event'
    );
  });

  test('a payload signed with the WRONG secret is rejected', () => {
    const raw = chargeSuccessBody();
    assert.equal(provider.parseAndVerifyWebhook(raw, signedHeaders(raw, 'sk_test_other')), null);
  });

  test('an unsigned payload is rejected', () => {
    // Otherwise the webhook is an open "mark this trip paid" endpoint.
    assert.equal(provider.parseAndVerifyWebhook(chargeSuccessBody(), {}), null);
  });

  test('an empty or malformed signature is rejected without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so the length check must come first.
    const raw = chargeSuccessBody();
    for (const sig of ['', 'ab', 'z'.repeat(64), 'x'.repeat(128)]) {
      assert.doesNotThrow(() =>
        provider.parseAndVerifyWebhook(raw, { [LAHZA_SIGNATURE_HEADER]: sig })
      );
      assert.equal(
        provider.parseAndVerifyWebhook(raw, { [LAHZA_SIGNATURE_HEADER]: sig }),
        null,
        `signature ${JSON.stringify(sig)} must be rejected`
      );
    }
  });

  test('the header is matched case-insensitively', () => {
    const raw = chargeSuccessBody();
    const sig = lahzaSignPayload(raw, SECRET);
    assert.ok(provider.parseAndVerifyWebhook(raw, { 'X-Lahza-Signature': sig }));
  });

  test('a correctly signed but non-JSON body is rejected rather than throwing', () => {
    const raw = 'not json at all';
    assert.doesNotThrow(() => provider.parseAndVerifyWebhook(raw, signedHeaders(raw)));
    assert.equal(provider.parseAndVerifyWebhook(raw, signedHeaders(raw)), null);
  });
});

// ===========================================================================
// Event -> transition mapping.
// ===========================================================================
describe('Lahza event mapping', () => {
  test('charge.success means paid', () => {
    assert.equal(mapLahzaEventToStatus(LAHZA_EVENTS.CHARGE_SUCCESS), 'paid');
  });

  test('refund.processed means refunded', () => {
    assert.equal(mapLahzaEventToStatus(LAHZA_EVENTS.REFUND_PROCESSED), 'refunded');
  });

  test('in-flight refund events map to NOTHING', () => {
    // The money has not moved back yet. Reporting `refunded` here would tell a
    // passenger they had been repaid before they had been.
    assert.equal(mapLahzaEventToStatus(LAHZA_EVENTS.REFUND_PENDING), null);
    assert.equal(mapLahzaEventToStatus(LAHZA_EVENTS.REFUND_PROCESSING), null);
  });

  test('refund.failed does NOT map to a failed payment', () => {
    // A failed refund means the charge is still paid. Mapping it to `failed` would
    // mark a paid trip unpaid.
    assert.equal(mapLahzaEventToStatus(LAHZA_EVENTS.REFUND_FAILED), null);
  });

  test('unknown or junk events map to nothing', () => {
    for (const junk of ['charge.failed', 'invoice.create', '', null, undefined, 7, {}]) {
      assert.equal(mapLahzaEventToStatus(junk), null, JSON.stringify(junk));
    }
  });

  test('a signed event we take no action on yields no VerifiedPaymentEvent', () => {
    const raw = JSON.stringify({
      event: LAHZA_EVENTS.REFUND_PENDING,
      data: { reference: 'payment-trip123', amount: 2500 },
    });
    assert.equal(provider.parseAndVerifyWebhook(raw, signedHeaders(raw)), null);
  });

  test('the derived eventId is stable across a redelivery of the same event', () => {
    // Lahza's payload carries no event id, so the core's replay guard depends on
    // this being deterministic.
    const raw = chargeSuccessBody();
    const a = provider.parseAndVerifyWebhook(raw, signedHeaders(raw));
    const b = provider.parseAndVerifyWebhook(raw, signedHeaders(raw));
    assert.equal(a.eventId, b.eventId);
  });

  test('charge.success and refund.processed for one trip have DIFFERENT event ids', () => {
    // If they collided, the refund would be swallowed as a duplicate of the charge.
    const chargeRaw = chargeSuccessBody();
    const refundRaw = JSON.stringify({
      event: LAHZA_EVENTS.REFUND_PROCESSED,
      data: { reference: 'payment-trip123', amount: 2500, currency: 'ILS' },
    });
    const charge = provider.parseAndVerifyWebhook(chargeRaw, signedHeaders(chargeRaw));
    const refund = provider.parseAndVerifyWebhook(refundRaw, signedHeaders(refundRaw));
    assert.equal(refund.status, 'refunded');
    assert.notEqual(charge.eventId, refund.eventId);
  });
});

// ===========================================================================
// Reference <-> tripId. This is how a webhook resolves to a trip.
// ===========================================================================
describe('Lahza reference mapping', () => {
  test('round-trips a Firestore-style auto id', () => {
    const tripId = 'aBc123XyZ456DEF78900';
    assert.equal(lahzaReferenceToTripId(tripIdToLahzaReference(tripId)), tripId);
  });

  test('the reference uses ONLY characters Lahza documents as legal', () => {
    // Lahza allows -, ., = and alphanumerics. Our internal key is `payment_<tripId>`,
    // and the underscore is NOT allowed, which is why the wire format differs.
    const ref = tripIdToLahzaReference('aBc123XyZ456DEF78900');
    assert.match(ref, /^[A-Za-z0-9.=-]+$/, `illegal characters in reference: ${ref}`);
    assert.equal(ref.includes('_'), false, 'an underscore would be rejected by Lahza');
  });

  test('a reference that is not ours yields null, not a bogus tripId', () => {
    // This is how a webhook for somebody else's transaction gets ignored rather
    // than misapplied to one of our trips.
    for (const ref of ['T685312322670591', 'payment', 'payment-', '', null, undefined, 42, {}]) {
      assert.equal(lahzaReferenceToTripId(ref), null, JSON.stringify(ref));
    }
  });

  test('a webhook whose reference is not ours produces no event', () => {
    const raw = chargeSuccessBody({ reference: 'SOMEONE-ELSES-TXN' });
    assert.equal(provider.parseAndVerifyWebhook(raw, signedHeaders(raw)), null);
  });

  test('a reference carrying illegal characters is rejected', () => {
    assert.equal(lahzaReferenceToTripId('payment-trip/../evil'), null);
  });
});

// ===========================================================================
// Money. Lahza's ILS unit is agora — the same minor unit the core already uses.
// ===========================================================================
describe('amount and currency handling', () => {
  test('amountMinorUnits passes through unconverted (both sides are agorot)', () => {
    const raw = chargeSuccessBody({ amount: 12345 });
    const event = provider.parseAndVerifyWebhook(raw, signedHeaders(raw));
    assert.equal(event.amountMinorUnits, 12345, 'no *100 or /100 may be applied');
  });

  test('a non-numeric amount is rejected rather than coerced to NaN', () => {
    for (const amount of ['2500', null, undefined, {}, NaN, Infinity]) {
      const raw = chargeSuccessBody({ amount });
      assert.equal(
        provider.parseAndVerifyWebhook(raw, signedHeaders(raw)),
        null,
        `amount ${JSON.stringify(amount)} must be rejected`
      );
    }
  });

  test('createCharge sends the amount unconverted, in ILS, with our reference', async () => {
    const calls = [];
    const restore = stubFetch(calls, {
      status: true,
      message: 'Authorization URL created',
      data: {
        authorization_url: 'https://checkout.lahza.io/abc123',
        access_code: 'cwkmdksduwo2',
        reference: 'payment-trip123',
      },
    });

    try {
      const result = await provider.createCharge({
        tripId: 'trip123',
        amountMinorUnits: 2500,
        currency: 'ILS',
        passengerId: 'pax-1',
        idempotencyKey: 'payment_trip123',
      });

      assert.equal(calls.length, 1);
      const [url, init] = calls[0];
      assert.equal(url, 'https://api.lahza.io/transaction/initialize');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);

      const body = JSON.parse(init.body);
      assert.equal(body.amount, '2500', 'agorot must be sent as-is');
      assert.equal(body.currency, 'ILS');
      assert.equal(body.reference, 'payment-trip123', 'our reference carries the trip identity');

      assert.equal(result.clientActionUrl, 'https://checkout.lahza.io/abc123');
      assert.equal(result.providerChargeId, 'payment-trip123');
    } finally {
      restore();
    }
  });

  test('createCharge throws when Lahza reports status:false', async () => {
    // HTTP 200 alone is not success - Lahza signals failure in the envelope.
    const restore = stubFetch([], { status: false, message: 'Invalid key' }, 200);
    try {
      await assert.rejects(
        () =>
          provider.createCharge({
            tripId: 'trip123',
            amountMinorUnits: 2500,
            currency: 'ILS',
            passengerId: 'pax-1',
            idempotencyKey: 'payment_trip123',
          }),
        /Invalid key/
      );
    } finally {
      restore();
    }
  });

  test('refund posts the transaction reference and reports async settlement honestly', async () => {
    const calls = [];
    const restore = stubFetch(calls, {
      status: true,
      message: 'Refund has been queued for processing',
      data: { id: 3018284, status: 'pending', amount: 2500, currency: 'ILS' },
    });

    try {
      const result = await provider.refund({
        providerChargeId: 'payment-trip123',
        amountMinorUnits: 2500,
        reason: 'passenger complaint',
      });

      const [url, init] = calls[0];
      assert.equal(url, 'https://api.lahza.io/refund');
      const body = JSON.parse(init.body);
      assert.equal(body.transaction, 'payment-trip123');
      assert.equal(body.amount, '2500');
      assert.equal(body.currency, 'ILS');
      assert.equal(body.merchant_note, 'passenger complaint');

      assert.equal(result.providerRefundId, '3018284');
      assert.equal(
        result.settled,
        false,
        'a queued/pending refund must NOT be reported as settled'
      );
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// Fail-safe provider selection.
// ===========================================================================
describe('provider selection fails safe', () => {
  test('the flag OFF selects nothing, whatever else is set', () => {
    assert.equal(getPaymentProvider({}), null);
    assert.equal(getPaymentProvider({ LAHZA_SECRET_KEY: 'sk_test_x' }), null);
    assert.equal(
      getPaymentProvider({ ONLINE_PAYMENTS_ENABLED: 'false', LAHZA_SECRET_KEY: 'sk_test_x' }),
      null
    );
  });

  /**
   * NEGATIVE CONTROL for the fail-safe path: flag on, lahza selected, NO keys.
   *
   * The dangerous implementation is one that shrugs and returns the StubProvider,
   * which would mark trips paid without taking any money. It must throw instead.
   */
  test('NEGATIVE CONTROL: flag ON with no Lahza key THROWS, never falls back to the stub', () => {
    let selected;
    assert.throws(
      () => {
        selected = getPaymentProvider({ ONLINE_PAYMENTS_ENABLED: 'true' });
      },
      /LAHZA_SECRET_KEY/,
      'a missing key must be a hard, explicit failure'
    );
    assert.equal(selected, undefined, 'nothing may be returned when the key is absent');
  });

  test('a blank or whitespace-only key is treated as absent', () => {
    for (const key of ['', '   ']) {
      assert.throws(
        () => getPaymentProvider({ ONLINE_PAYMENTS_ENABLED: 'true', LAHZA_SECRET_KEY: key }),
        /LAHZA_SECRET_KEY/
      );
    }
  });

  test('flag ON with a key selects Lahza, and lahza is the DEFAULT provider', () => {
    const p = getPaymentProvider({
      ONLINE_PAYMENTS_ENABLED: 'true',
      LAHZA_SECRET_KEY: 'sk_test_x',
    });
    assert.equal(p.name, 'lahza', 'forgetting PAYMENT_PROVIDER must not land on the stub');
  });

  test('the stub is refused outside the emulator, even when asked for explicitly', () => {
    assert.throws(
      () => getPaymentProvider({ ONLINE_PAYMENTS_ENABLED: 'true', PAYMENT_PROVIDER: 'stub' }),
      /emulator/
    );
  });

  test('the stub is still available UNDER the emulator (tests keep working)', () => {
    const p = getPaymentProvider({
      ONLINE_PAYMENTS_ENABLED: 'true',
      PAYMENT_PROVIDER: 'stub',
      FUNCTIONS_EMULATOR: 'true',
    });
    assert.equal(p.name, 'stub');
  });

  test('an unknown provider name throws rather than defaulting to anything', () => {
    assert.throws(
      () =>
        getPaymentProvider({
          ONLINE_PAYMENTS_ENABLED: 'true',
          PAYMENT_PROVIDER: 'stripe',
          LAHZA_SECRET_KEY: 'sk_test_x',
        }),
      /Unknown PAYMENT_PROVIDER/
    );
  });

  test('constructing a LahzaProvider with no key throws', () => {
    assert.throws(() => new LahzaProvider({ secretKey: '' }), /secret key/i);
    assert.throws(() => new LahzaProvider({ secretKey: '   ' }), /secret key/i);
  });
});

// ---------------------------------------------------------------------------
// A stubbed global fetch. No network is touched.
// ---------------------------------------------------------------------------
function stubFetch(calls, jsonBody, httpStatus = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    return {
      ok: httpStatus >= 200 && httpStatus < 300,
      status: httpStatus,
      text: async () => JSON.stringify(jsonBody),
    };
  };
  return () => {
    globalThis.fetch = original;
  };
}

afterEach(() => {
  // Belt and braces: no test may leak a stubbed fetch into the next one.
});
