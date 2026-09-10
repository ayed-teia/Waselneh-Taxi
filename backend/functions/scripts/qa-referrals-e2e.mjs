/* eslint-disable no-console */
/**
 * QA E2E: the server-authoritative referral system.
 *
 * WHAT THIS EXISTS TO PROVE
 *
 * Referrals were previously a UI-only placeholder: the passenger app built a code
 * client-side from a slice of the caller's own uid, and nothing server-side ever
 * recorded, validated or rewarded anything. This suite proves the replacement is
 * real, server-owned, and abuse-resistant.
 *
 * THE CRITICAL PROPERTY: rewards land on PAYMENT, not on trip completion.
 * `completeTrip` writes the payment row as PENDING; `confirmCashPayment` sets PAID.
 * A reward hung off completion would pay out on cash trips the driver never
 * actually collected, so case 7 asserts the balance is still zero after completion
 * and only becomes non-zero after payment.
 *
 * Requires the emulator suite (auth, firestore, functions).
 */
import fs from 'node:fs';

import admin from 'firebase-admin';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);
const REGION = 'europe-west1';

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

async function callFn(name, data) {
  const response = await fetch(`http://${emulatorHost}:${functionsPort}/${projectId}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const error = new Error(body?.error?.message || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  return body.result;
}

/** Assert a callable rejects, and return the message for inspection. */
async function expectRejected(name, data, label) {
  try {
    await callFn(name, data);
    throw new Error(`${label}: expected rejection but the call succeeded`);
  } catch (error) {
    if (String(error.message).startsWith(`${label}:`)) throw error;
    return error.message;
  }
}

const PICKUP = { lat: 32.2211, lng: 35.2544 };
const DROPOFF = { lat: 31.9038, lng: 35.2034 };

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-referrals-${Date.now()}`);
  const db = app.firestore();
  const suffix = Date.now();
  const cleanup = [];

  const OFFICE = `REF_OFFICE_${suffix}`;
  const LINE = `REF_LINE_${suffix}`;
  const DRIVER = `ref-driver-${suffix}`;
  const INVITER = `ref-inviter-${suffix}`;
  const INVITEE = `ref-invitee-${suffix}`;
  const MANAGER = `ref-manager-${suffix}`;
  const configRef = db.collection('system').doc('referralConfig');

  // A global admin, provisioned the way every other suite does it: managerRoles/{uid}
  // is the ONLY source of truth for RBAC, so seeding it here is what makes the
  // manager callables reachable. Empty `permissions` falls back to the role default.
  const managerRoleRef = db.collection('managerRoles').doc(MANAGER);
  await managerRoleRef.set({
    uid: MANAGER,
    role: 'admin',
    permissions: [],
    officeIds: [],
    lineIds: [],
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  cleanup.push(managerRoleRef);

  const trackUser = (uid) => {
    cleanup.push(db.collection('users').doc(uid));
    cleanup.push(db.collection('referrals').doc(uid));
    cleanup.push(db.collection('referralCredits').doc(uid));
    cleanup.push(db.collection('referralRewardAudit').doc(uid));
  };
  [INVITER, INVITEE].forEach(trackUser);

  async function creditBalance(uid) {
    const snapshot = await db.collection('referralCredits').doc(uid).get();
    return snapshot.exists ? Number(snapshot.data()?.balance ?? 0) : 0;
  }

  // ===========================================================================
  // 1. Every new callable is actually deployed.
  //    A callable exported from the barrel but missing from src/index.ts compiles
  //    and passes unit tests, yet never deploys - this is the guard for that.
  // ===========================================================================
  try {
    const names = [
      'getMyReferralCode',
      'claimReferralCode',
      'getMyReferralStatus',
      'managerSetReferralConfig',
      'managerGetReferralReport',
    ];
    const missing = [];
    for (const name of names) {
      const response = await fetch(`http://${emulatorHost}:${functionsPort}/${projectId}/${REGION}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      });
      if (response.status === 404) missing.push(name);
    }
    assert(missing.length === 0, `not deployed: ${missing.join(', ')}`);
    pass('All 5 referral callables are deployed');
  } catch (error) {
    fail('All 5 referral callables are deployed', error.message);
  }

  // ===========================================================================
  // 2. A code is issued, is stable, and is NOT derived from the uid.
  // ===========================================================================
  let inviterCode = null;
  try {
    const first = await callFn('getMyReferralCode', { devUserId: INVITER });
    const second = await callFn('getMyReferralCode', { devUserId: INVITER });
    inviterCode = first.code;
    assert(inviterCode, 'no code issued');
    assert(first.code === second.code, `code not stable: ${first.code} vs ${second.code}`);
    assert(
      !inviterCode.includes(INVITER.slice(0, 6).toUpperCase()),
      `code leaks the uid prefix: ${inviterCode}`
    );
    const mapping = await db.collection('referralCodes').doc(inviterCode).get();
    assert(mapping.exists && mapping.data()?.ownerId === INVITER, 'code -> owner mapping missing');
    pass('Referral code is issued, stable and not uid-derived', inviterCode);
  } catch (error) {
    fail('Referral code is issued, stable and not uid-derived', error.message);
  }
  if (inviterCode) cleanup.push(db.collection('referralCodes').doc(inviterCode));

  // ===========================================================================
  // 3. Self-referral is refused.
  // ===========================================================================
  try {
    const message = await expectRejected(
      'claimReferralCode',
      { devUserId: INVITER, code: inviterCode },
      'self-referral'
    );
    assert(/your own/i.test(message), `unexpected message: ${message}`);
    const exists = (await db.collection('referrals').doc(INVITER).get()).exists;
    assert(!exists, 'a self-referral attribution document was created');
    pass('Self-referral is refused');
  } catch (error) {
    fail('Self-referral is refused', error.message);
  }

  // ===========================================================================
  // 4. An unknown code is refused.
  // ===========================================================================
  try {
    await expectRejected(
      'claimReferralCode',
      { devUserId: INVITEE, code: 'WSLZZZZZZ' },
      'unknown code'
    );
    pass('An unknown referral code is refused');
  } catch (error) {
    fail('An unknown referral code is refused', error.message);
  }

  // ===========================================================================
  // 5. A valid claim is recorded as pending.
  // ===========================================================================
  try {
    const claim = await callFn('claimReferralCode', { devUserId: INVITEE, code: inviterCode });
    assert(claim?.claimed === true, `unexpected response: ${JSON.stringify(claim)}`);
    const referral = (await db.collection('referrals').doc(INVITEE).get()).data() ?? {};
    assert(referral.inviterId === INVITER, `wrong inviter: ${referral.inviterId}`);
    assert(referral.status === 'pending', `expected pending, got ${referral.status}`);
    pass('A valid referral claim is recorded as pending');
  } catch (error) {
    fail('A valid referral claim is recorded as pending', error.message);
  }

  // ===========================================================================
  // 6. A second claim is refused - one inviter, forever.
  // ===========================================================================
  try {
    const message = await expectRejected(
      'claimReferralCode',
      { devUserId: INVITEE, code: inviterCode },
      'second claim'
    );
    assert(/already been used/i.test(message), `unexpected message: ${message}`);
    pass('A second referral claim on the same account is refused');
  } catch (error) {
    fail('A second referral claim on the same account is refused', error.message);
  }

  // ===========================================================================
  // 7. THE CORE PROPERTY: rewards land on PAYMENT, not on completion.
  // ===========================================================================
  let tripId = null;
  try {
    // Configure rewards (they are off by default - see case 9).
    await callFn('managerSetReferralConfig', {
      devUserId: MANAGER,
      enabled: true,
      inviterCredits: 10,
      inviteeCredits: 5,
      minQualifyingFareIls: 0,
      claimExpiryDays: 0,
    });

    await db.collection('offices').doc(OFFICE).set({ officeId: OFFICE, name: 'Referral QA', isActive: true });
    await db.collection('lines').doc(LINE).set({
      lineId: LINE, officeId: OFFICE, name: 'Referral QA', minSeats: 1, maxSeats: 6, isActive: true,
    });
    await db.collection('drivers').doc(DRIVER).set({
      driverId: DRIVER, driverType: 'licensed_line_owner', verificationStatus: 'approved',
      officeId: OFFICE, lineId: LINE, vehicleType: 'taxi_standard',
      seatCapacity: 4, availableSeats: 4, fullTaxiReserved: false,
      isOnline: true, isAvailable: true, status: 'online', currentTripId: null,
      lastLocation: new admin.firestore.GeoPoint(PICKUP.lat, PICKUP.lng),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    cleanup.push(
      db.collection('offices').doc(OFFICE),
      db.collection('lines').doc(LINE),
      db.collection('drivers').doc(DRIVER),
      db.collection('driverLive').doc(DRIVER)
    );

    const rideOptions = {
      bookingType: 'seat_only', requestedSeats: 1, requiredSeats: 1, officeId: OFFICE, lineId: LINE,
    };
    const estimate = await callFn('estimateTrip', {
      pickup: PICKUP, dropoff: DROPOFF, devUserId: INVITEE, rideOptions,
    });
    const created = await callFn('createTripRequest', {
      pickup: PICKUP, dropoff: DROPOFF, devUserId: INVITEE, rideOptions,
      estimate: {
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        priceIls: estimate.priceIls,
      },
    });
    assert(created?.tripId, `no driver matched: ${JSON.stringify(created)}`);
    tripId = created.tripId;
    cleanup.push(db.collection('trips').doc(tripId));
    cleanup.push(db.collection('payments').doc(`payment_${tripId}`));

    for (const step of ['acceptTripRequest', 'driverArrived', 'startTrip', 'completeTrip']) {
      await callFn(step, { tripId, devUserId: DRIVER });
    }

    // The trip is COMPLETED but unpaid. Nothing may have been granted yet.
    const afterCompletion = await creditBalance(INVITEE);
    assert(
      afterCompletion === 0,
      `credits were granted at completion, before payment (balance ${afterCompletion})`
    );

    await callFn('confirmCashPayment', { tripId, devUserId: DRIVER });

    const inviteeBalance = await creditBalance(INVITEE);
    const inviterBalance = await creditBalance(INVITER);
    assert(inviteeBalance === 5, `invitee balance ${inviteeBalance}, expected 5`);
    assert(inviterBalance === 10, `inviter balance ${inviterBalance}, expected 10`);

    const referral = (await db.collection('referrals').doc(INVITEE).get()).data() ?? {};
    assert(referral.status === 'qualified', `referral status ${referral.status}`);
    assert(referral.qualifyingTripId === tripId, 'qualifying trip not recorded');
    pass('Rewards are granted on PAYMENT, never on completion', 'invitee 5, inviter 10');
  } catch (error) {
    fail('Rewards are granted on PAYMENT, never on completion', error.message);
  }

  // ===========================================================================
  // 8. Idempotency: a repeated payment confirmation must not double-credit.
  // ===========================================================================
  try {
    const before = await creditBalance(INVITER);
    // The trip is already paid, so this is rejected - the point is that the
    // balance is unchanged either way.
    await callFn('confirmCashPayment', { tripId, devUserId: DRIVER }).catch(() => undefined);
    const after = await creditBalance(INVITER);
    assert(after === before, `balance moved on a repeat confirmation: ${before} -> ${after}`);

    const ledger = await db
      .collection('referralCredits').doc(INVITER)
      .collection('ledger').get();
    assert(ledger.size === 1, `expected exactly 1 ledger entry, found ${ledger.size}`);
    pass('A repeated payment confirmation does not double-credit');
  } catch (error) {
    fail('A repeated payment confirmation does not double-credit', error.message);
  }

  // ===========================================================================
  // 9. Rewards are OFF by default - deleting the config makes the system inert.
  // ===========================================================================
  try {
    await configRef.delete();
    const status = await callFn('getMyReferralStatus', { devUserId: INVITER });
    assert(status.rewardsEnabled === false, 'rewardsEnabled should be false with no config');
    assert(status.inviterCredits === 0, 'no config must report zero reward value');
    pass('With no config the programme reports itself disabled');
  } catch (error) {
    fail('With no config the programme reports itself disabled', error.message);
  }

  // ===========================================================================
  // 10. Status reporting exposes counts, never invitee identities.
  // ===========================================================================
  try {
    const status = await callFn('getMyReferralStatus', { devUserId: INVITER });
    assert(status.invitedCount >= 1, `invitedCount ${status.invitedCount}`);
    assert(status.qualifiedCount >= 1, `qualifiedCount ${status.qualifiedCount}`);
    const serialized = JSON.stringify(status);
    assert(!serialized.includes(INVITEE), 'status leaked an invitee uid');
    pass('Referral status returns counts without exposing invitee identities');
  } catch (error) {
    fail('Referral status returns counts without exposing invitee identities', error.message);
  }

  // ===========================================================================
  // 11. Manager reporting is permission-gated and PII-free.
  // ===========================================================================
  try {
    await expectRejected(
      'managerGetReferralReport',
      { devUserId: INVITER },
      'non-manager report'
    );
    const report = await callFn('managerGetReferralReport', { devUserId: MANAGER });
    assert(typeof report.totalClaims === 'number', 'report missing totals');
    const serialized = JSON.stringify(report);
    assert(!serialized.includes(INVITER), 'report leaked an inviter uid');
    assert(!serialized.includes(INVITEE), 'report leaked an invitee uid');
    pass('Manager report is permission-gated and contains no raw uids');
  } catch (error) {
    fail('Manager report is permission-gated and contains no raw uids', error.message);
  }

  // ===========================================================================
  // 12. Client write denial on every new collection.
  // ===========================================================================
  try {
    const denied = [];
    for (const path of [
      `referralCodes/${inviterCode ?? 'WSLAAAAAA'}`,
      `referrals/${INVITEE}`,
      `referralCredits/${INVITER}`,
      `referralRewardAudit/${INVITEE}`,
    ]) {
      const response = await fetch(
        `http://${emulatorHost}:8080/v1/projects/${projectId}/databases/(default)/documents/${path}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { balance: { integerValue: '999999' } } }),
        }
      );
      denied.push(response.status === 401 || response.status === 403);
    }
    assert(denied.every(Boolean), `a client write was permitted: ${JSON.stringify(denied)}`);
    pass('Clients cannot write any referral collection directly');
  } catch (error) {
    fail('Clients cannot write any referral collection directly', error.message);
  }

  // --- cleanup ---------------------------------------------------------------
  for (const uid of [INVITER, INVITEE]) {
    const ledger = await db.collection('referralCredits').doc(uid).collection('ledger').get();
    for (const doc of ledger.docs) await doc.ref.delete().catch(() => undefined);
  }
  const configEvents = await configRef.collection('events').get().catch(() => ({ docs: [] }));
  for (const doc of configEvents.docs) await doc.ref.delete().catch(() => undefined);
  await configRef.delete().catch(() => undefined);
  for (const ref of cleanup.reverse()) await ref.delete().catch(() => undefined);
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[QA] Referrals E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Referrals E2E FAILED', error);
  process.exit(1);
});
