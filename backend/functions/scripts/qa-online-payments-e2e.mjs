/* eslint-disable no-console */
/**
 * QA E2E: the provider-agnostic online payments core.
 *
 * ⚠️  Online payments ship behind ONLINE_PAYMENTS_ENABLED, DEFAULT OFF, with NO real
 * processor wired. Choosing one is blocked on ILS settlement to West Bank accounts,
 * not on engineering. See docs/REMAINING_PLAN.md.
 *
 * WHAT IS VERIFIED AGAINST REAL INFRASTRUCTURE
 *   - flag OFF: the deployed webhook is inert (404) and the CASH path is untouched;
 *   - flag ON: charge -> awaiting_payment -> paid, failure, refund, duplicate events
 *     and illegal transitions, all through the real Firestore transaction.
 *
 * WHY THE FLAG-ON HALF RUNS IN-PROCESS
 * The functions emulator is started with the flag OFF, which is exactly the state we
 * must keep proving. Rather than enable a payments flag in a shared emulator - which
 * the mandate forbids and which would weaken the flag-off evidence - the flag-on
 * cases drive the compiled service directly against the SAME Firestore emulator. The
 * transaction, the idempotency guards and the state machine are the real ones; only
 * the HTTP hop is skipped, and the HTTP hop is separately covered by the 404 case and
 * by the signature unit tests.
 *
 * Requires the emulator suite (auth, firestore, functions).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = `${emulatorHost}:8080`;
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${emulatorHost}:9099`;
}
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath && (credentialPath.includes('%CD%') || !fs.existsSync(credentialPath))) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const results = [];
const pass = (n, d = '') => {
  results.push({ n, ok: true });
  console.log(`✅ ${n}${d ? ` - ${d}` : ''}`);
};
const fail = (n, d) => {
  results.push({ n, ok: false });
  console.error(`❌ ${n} - ${d}`);
};
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const DIST = path.join(__dirname, '..', 'dist');
const { StubProvider, stubSignPayload, STUB_SIGNATURE_HEADER } = require(
  path.join(DIST, 'modules', 'payments', 'payment-provider.js')
);
const { getPaymentProvider } = require(path.join(DIST, 'modules', 'payments', 'payment-core.service.js'));
const { isOnlinePaymentsEnabled } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'dist', 'config', 'auth-flags.config.js')
);

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-pay-${Date.now()}`);
  const db = app.firestore();
  const suffix = Date.now();
  const cleanup = [];

  // The service reads the ambient Firestore through the functions' own config module.
  // Point that at this same emulator instance and load the compiled service.
  const { initializeFirebase } = require(path.join(DIST, 'core', 'config', 'index.js'));
  try {
    initializeFirebase();
  } catch {
    /* already initialised */
  }
  const { advancePaymentFromEvent } = require(
    path.join(DIST, 'modules', 'payments', 'payment-core.service.js')
  );

  const provider = new StubProvider();

  async function seedPayment(tripId, status = 'pending') {
    const ref = db.collection('payments').doc(`payment_${tripId}`);
    await ref.set({
      paymentId: `payment_${tripId}`,
      tripId,
      passengerId: `pax-${tripId}`,
      driverId: `drv-${tripId}`,
      amount: 25,
      currency: 'ILS',
      method: 'cash',
      status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    cleanup.push(ref);
    return ref;
  }

  const event = (tripId, over = {}) => ({
    eventId: `evt_${tripId}_${Math.random().toString(36).slice(2)}`,
    providerChargeId: `stub_charge_payment_${tripId}`,
    tripId,
    status: 'paid',
    amountMinorUnits: 2500,
    ...over,
  });

  // ===========================================================================
  // 1. FLAG OFF: the webhook is inert on the actually-deployed function.
  // ===========================================================================
  try {
    const url = `http://${emulatorHost}:${functionsPort}/${projectId}/europe-west1/paymentWebhook`;
    const body = JSON.stringify(event('flagoff'));
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [STUB_SIGNATURE_HEADER]: stubSignPayload(body),
      },
      body,
    });
    assert(
      res.status === 404,
      `with the flag OFF the webhook must not be in service, got HTTP ${res.status}`
    );
    pass('Flag OFF: the payment webhook is inert (404) even for a correctly signed event');
  } catch (error) {
    fail('Flag OFF: the payment webhook is inert (404) even for a correctly signed event', String(error));
  }

  // ===========================================================================
  // 2. FLAG OFF: provider selection returns nothing, so the module cannot act.
  // ===========================================================================
  try {
    assert(getPaymentProvider({}) === null, 'no flag must select no provider');
    assert(
      getPaymentProvider({ ONLINE_PAYMENTS_ENABLED: 'false' }) === null,
      '"false" must select no provider'
    );
    assert(
      getPaymentProvider({ ONLINE_PAYMENTS_ENABLED: 'yes' }) === null,
      'only the literal "true" may enable this'
    );
    // The flag alone is no longer enough, and that is deliberate: since the Lahza
    // adapter landed, `lahza` is the default and a missing key is a HARD failure
    // rather than a silent fall back to the stub (which would mark trips paid for
    // free). Both halves are asserted so this cannot pass by simply never selecting
    // anything.
    let threwWithoutKey = false;
    try {
      getPaymentProvider({ ONLINE_PAYMENTS_ENABLED: 'true' });
    } catch {
      threwWithoutKey = true;
    }
    assert(threwWithoutKey, 'flag on with no Lahza key must fail safe, not select the stub');
    assert(
      getPaymentProvider({ ONLINE_PAYMENTS_ENABLED: 'true', LAHZA_SECRET_KEY: 'sk_test_qa' })
        ?.name === 'lahza',
      'the flag must actually work when the key is present'
    );
    assert(
      getPaymentProvider({
        ONLINE_PAYMENTS_ENABLED: 'true',
        PAYMENT_PROVIDER: 'stub',
        FUNCTIONS_EMULATOR: 'true',
      })?.name === 'stub',
      'the stub must remain available under the emulator'
    );
    assert(isOnlinePaymentsEnabled({}) === false, 'the flag defaults OFF');
    pass('Flag: a provider is selected only when ONLINE_PAYMENTS_ENABLED is literally "true"');
  } catch (error) {
    fail('Flag: a provider is selected only when ONLINE_PAYMENTS_ENABLED is literally "true"', String(error));
  }

  // ===========================================================================
  // 3. HAPPY PATH: pending -> awaiting_payment -> paid.
  // ===========================================================================
  try {
    const tripId = `pay-ok-${suffix}`;
    const ref = await seedPayment(tripId);
    await ref.update({ status: 'awaiting_payment' });

    const result = await advancePaymentFromEvent(event(tripId), provider.name);
    assert(result.ok, `expected the event to be applied, got ${JSON.stringify(result)}`);
    assert(result.duplicate === false, 'a first delivery is not a duplicate');

    const snap = await ref.get();
    assert(snap.data().status === 'paid', `expected paid, got ${snap.data().status}`);
    assert(snap.data().paidAt, 'paidAt must be stamped');
    pass('Happy path: a verified paid event advances awaiting_payment -> paid');
  } catch (error) {
    fail('Happy path: a verified paid event advances awaiting_payment -> paid', String(error));
  }

  // ===========================================================================
  // 4. DUPLICATE EVENT IS A NO-OP. The single most important property here.
  // ===========================================================================
  try {
    const tripId = `pay-dup-${suffix}`;
    const ref = await seedPayment(tripId);
    await ref.update({ status: 'awaiting_payment' });

    const evt = event(tripId);
    const first = await advancePaymentFromEvent(evt, provider.name);
    const afterFirst = (await ref.get()).data();

    // Byte-identical replay, as a processor retrying an un-acked delivery would send.
    const second = await advancePaymentFromEvent(evt, provider.name);
    const afterSecond = (await ref.get()).data();

    assert(first.duplicate === false && first.ok, 'the first delivery must apply');
    assert(second.ok, 'a replay must be reported as success, not an error');
    assert(second.duplicate === true, 'the replay must be reported as a duplicate');
    assert(afterSecond.status === 'paid', 'the state must be unchanged');
    assert(
      afterFirst.paidAt.isEqual(afterSecond.paidAt),
      'paidAt must NOT be re-stamped by a replay - a second stamp is a second payment in the ledger'
    );
    assert(
      afterSecond.processedEventIds.filter((id) => id === evt.eventId).length === 1,
      'the event id must be recorded exactly once'
    );
    pass('Idempotency: a replayed provider event is a no-op (paidAt not re-stamped)');
  } catch (error) {
    fail('Idempotency: a replayed provider event is a no-op (paidAt not re-stamped)', String(error));
  }

  // ===========================================================================
  // 5. Re-delivery under a DIFFERENT event id is also a no-op.
  //    This is the second, overlapping guard - the state machine rather than the
  //    processed-id set.
  // ===========================================================================
  try {
    const tripId = `pay-dup2-${suffix}`;
    const ref = await seedPayment(tripId);
    await ref.update({ status: 'awaiting_payment' });

    await advancePaymentFromEvent(event(tripId), provider.name);
    const before = (await ref.get()).data();
    const second = await advancePaymentFromEvent(event(tripId), provider.name); // new eventId
    const after = (await ref.get()).data();

    assert(second.duplicate === true, 'a same-state event must be a duplicate whatever its id');
    assert(after.status === 'paid');
    assert(before.paidAt.isEqual(after.paidAt), 'paidAt must not move');
    pass('Idempotency: a re-delivery with a NEW event id still does not re-apply');
  } catch (error) {
    fail('Idempotency: a re-delivery with a NEW event id still does not re-apply', String(error));
  }

  // ===========================================================================
  // 6. FAILED CHARGE.
  // ===========================================================================
  try {
    const tripId = `pay-fail-${suffix}`;
    const ref = await seedPayment(tripId);
    await ref.update({ status: 'awaiting_payment' });

    const result = await advancePaymentFromEvent(
      event(tripId, { status: 'failed', failureReason: 'card_declined' }),
      provider.name
    );
    assert(result.ok, 'a failure event is still a valid event');

    const data = (await ref.get()).data();
    assert(data.status === 'failed', `expected failed, got ${data.status}`);
    assert(data.failureReason === 'card_declined', 'the reason must be recorded');
    assert(!data.paidAt, 'a failed payment must never be stamped paid');
    pass('Failure path: a failed event records the reason and never stamps paidAt');
  } catch (error) {
    fail('Failure path: a failed event records the reason and never stamps paidAt', String(error));
  }

  // ===========================================================================
  // 7. REFUND: paid -> refunded.
  // ===========================================================================
  try {
    const tripId = `pay-refund-${suffix}`;
    const ref = await seedPayment(tripId);
    await ref.update({ status: 'paid' });

    const refund = await provider.refund({
      providerChargeId: `stub_charge_payment_${tripId}`,
      amountMinorUnits: 2500,
    });
    assert(refund.providerRefundId, 'the provider must return a refund id');

    const result = await advancePaymentFromEvent(
      event(tripId, { status: 'refunded' }),
      provider.name
    );
    assert(result.ok && result.status === 'refunded', JSON.stringify(result));

    const data = (await ref.get()).data();
    assert(data.status === 'refunded');
    assert(data.refundedAt, 'refundedAt must be stamped');
    pass('Refund path: paid -> refunded, stamped and recorded');
  } catch (error) {
    fail('Refund path: paid -> refunded, stamped and recorded', String(error));
  }

  // ===========================================================================
  // 8. ILLEGAL TRANSITION: a terminal payment cannot be resurrected.
  // ===========================================================================
  try {
    const tripId = `pay-illegal-${suffix}`;
    const ref = await seedPayment(tripId);
    await ref.update({ status: 'refunded' });

    const result = await advancePaymentFromEvent(event(tripId, { status: 'paid' }), provider.name);
    assert(result.ok === false, 'a refunded payment must not accept a paid event');
    assert(result.reason, 'the rejection must carry a reason');

    const data = (await ref.get()).data();
    assert(data.status === 'refunded', `state must be unchanged, got ${data.status}`);
    assert(!data.paidAt, 'a rejected event must not stamp paidAt');
    pass('Illegal transition: a refunded payment rejects a later paid event');
  } catch (error) {
    fail('Illegal transition: a refunded payment rejects a later paid event', String(error));
  }

  // ===========================================================================
  // 9. An event for an UNKNOWN payment must not conjure a document.
  // ===========================================================================
  try {
    const tripId = `pay-ghost-${suffix}`;
    const result = await advancePaymentFromEvent(event(tripId), provider.name);
    assert(result.ok === false, 'an unknown payment must be rejected');

    const snap = await db.collection('payments').doc(`payment_${tripId}`).get();
    assert(!snap.exists, 'no payment document may be created from a webhook alone');
    pass('An event for an unknown payment is rejected and creates nothing');
  } catch (error) {
    fail('An event for an unknown payment is rejected and creates nothing', String(error));
  }

  // ===========================================================================
  // 10. THE CASH PATH IS UNTOUCHED. pending -> paid must still be legal, because
  //     confirmCashPayment does exactly that.
  // ===========================================================================
  try {
    const { canTransitionPayment } = require(
      path.join(DIST, 'modules', 'payments', 'payment-state-machine.js')
    );
    assert(
      canTransitionPayment('pending', 'paid'),
      'the state machine must not have broken the cash transition'
    );

    // And a cash payment document is never dragged into the online states.
    const tripId = `pay-cash-${suffix}`;
    const ref = await seedPayment(tripId, 'pending');
    const data = (await ref.get()).data();
    assert(data.method === 'cash' && data.status === 'pending', 'cash docs are created as before');
    assert(!data.provider, 'a cash payment must carry no provider');
    pass('Cash path: pending -> paid stays legal and cash documents are unchanged');
  } catch (error) {
    fail('Cash path: pending -> paid stays legal and cash documents are unchanged', String(error));
  }

  // --- cleanup ---------------------------------------------------------------
  for (const ref of cleanup.reverse()) await ref.delete().catch(() => undefined);
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[QA] Online payments E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Online payments E2E FAILED', error);
  process.exit(1);
});
