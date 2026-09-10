#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * FRONT-TO-BACK INTEGRATION CHECK (emulator only).
 *
 * The QA suites already prove the backend works. This checks something different:
 * that the functions THE APPS ACTUALLY CALL exist, are reachable over the same HTTP
 * surface the apps use, and accept the same payload shape the app code sends -
 * including the `devUserId` dev-auth bypass the mobile apps inject.
 *
 * It drives one complete passenger journey through the real callables:
 *   estimateTrip -> createTripRequest -> accept -> arrive -> start -> complete -> pay
 *
 * A failure here means a screen in the app would break, even though the backend's
 * own tests pass.
 */
import fs from 'node:fs';
import admin from 'firebase-admin';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const fnPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);
const REGION = 'europe-west1';

process.env.FIRESTORE_EMULATOR_HOST ||= `${host}:8080`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= `${host}:9099`;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

const results = [];
const pass = (n, d = '') => { results.push({ n, ok: true }); console.log(`✅ ${n}${d ? ` — ${d}` : ''}`); };
const fail = (n, d) => { results.push({ n, ok: false }); console.error(`❌ ${n} — ${d}`); };
function assert(c, m) { if (!c) throw new Error(m); }

/** Exactly how the mobile apps call a callable: POST {data}, dev uid inside data. */
async function callFn(name, data) {
  const res = await fetch(`http://${host}:${fnPort}/${projectId}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = body?.error?.status;
    throw err;
  }
  return body.result;
}

const PICKUP = { lat: 32.2211, lng: 35.2544 };
const DROPOFF = { lat: 31.9038, lng: 35.2034 };

async function main() {
  const app = admin.initializeApp({ projectId }, `integ-${Date.now()}`);
  const db = app.firestore();
  const sfx = Date.now();
  const cleanup = [];

  const OFFICE = `OFFICE_INTEG_${sfx}`;
  const LINE = `LINE_INTEG_${sfx}`;
  const DRIVER = `integ-driver-${sfx}`;
  const PAX = `integ-pax-${sfx}`;

  // ---- reachability of every function the frontends call ---------------------
  // A 404 here means the app's screen calls something that does not exist.
  const FRONTEND_CALLS = [
    'estimateTrip', 'createTripRequest', 'cancelTripRequest', 'acceptTripRequest',
    'rejectTripRequest', 'driverArrived', 'startTrip', 'completeTrip',
    'confirmCashPayment', 'submitRating', 'submitPassengerRating',
    'passengerCancelTrip', 'driverCancelTrip', 'createSupportTicket',
    'getDriverEarningsSummary', 'devIssueDriverToken', 'devIssueManagerToken',
    'getManagerSession', 'managerUpsertOffice', 'managerUpsertLine',
    'managerUpsertLicense', 'managerUpsertVehicle', 'managerLinkDriverToOperations',
    'managerUpsertPricingProfile', 'managerUpsertPricingZone', 'managerUpsertStaffRole',
    'managerSetDriverEligibility', 'managerForceCancelTrip', 'managerToggleTrips',
    'managerAcknowledgeAlert', 'managerToggleFeatureFlag',
    'reportClientError', 'joinLineQueue', 'leaveLineQueue', 'getLineQueue',
    'registerDriverDocument', 'reviewDriverDocument', 'requestOtpPermission',
    'reportOtpResult', 'startOnlinePayment', 'ping',
  ];

  try {
    const missing = [];
    for (const fn of FRONTEND_CALLS) {
      const res = await fetch(`http://${host}:${fnPort}/${projectId}/${REGION}/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      });
      // 404 = not deployed. Anything else (400/401/403/500) means it EXISTS and ran.
      if (res.status === 404) missing.push(fn);
    }
    assert(missing.length === 0, `these callables do not exist: ${missing.join(', ')}`);
    pass(`All ${FRONTEND_CALLS.length} frontend-called functions are deployed`);
  } catch (e) {
    fail('All frontend-called functions are deployed', e.message);
  }

  // ---- seed the minimum an app needs ----------------------------------------
  await db.collection('offices').doc(OFFICE).set({ officeId: OFFICE, name: 'Integ Office', isActive: true });
  await db.collection('lines').doc(LINE).set({ lineId: LINE, officeId: OFFICE, name: 'Integ Line', minSeats: 1, maxSeats: 6, isActive: true });
  await db.collection('drivers').doc(DRIVER).set({
    driverId: DRIVER, driverType: 'licensed_line_owner', verificationStatus: 'approved',
    officeId: OFFICE, lineId: LINE, licenseId: `LIC_${sfx}`, vehicleType: 'taxi_standard',
    seatCapacity: 4, availableSeats: 4, fullTaxiReserved: false, isOnline: true,
    isAvailable: true, status: 'online', currentTripId: null,
    lastLocation: new admin.firestore.GeoPoint(PICKUP.lat, PICKUP.lng),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  cleanup.push(db.collection('offices').doc(OFFICE), db.collection('lines').doc(LINE),
    db.collection('drivers').doc(DRIVER), db.collection('driverLive').doc(DRIVER));

  const rideOptions = { bookingType: 'seat_only', requestedSeats: 1, requiredSeats: 1, officeId: OFFICE, lineId: LINE };
  let tripId = null;

  // ---- 1. estimateTrip (passenger home screen) ------------------------------
  let estimate;
  try {
    estimate = await callFn('estimateTrip', { pickup: PICKUP, dropoff: DROPOFF, devUserId: PAX, rideOptions });
    assert(typeof estimate?.priceIls === 'number' && estimate.priceIls > 0, `bad price: ${JSON.stringify(estimate)}`);
    assert(typeof estimate?.distanceKm === 'number', 'missing distanceKm');
    pass('estimateTrip returns a usable fare', `₪${estimate.priceIls}, ${estimate.distanceKm}km`);
  } catch (e) {
    fail('estimateTrip returns a usable fare', e.message);
  }

  // ---- 2. createTripRequest + dispatch (the core booking flow) ---------------
  try {
    const created = await callFn('createTripRequest', {
      pickup: PICKUP, dropoff: DROPOFF, devUserId: PAX, rideOptions,
      estimate: { distanceKm: estimate.distanceKm, durationMin: estimate.durationMin, priceIls: estimate.priceIls },
    });
    assert(created?.tripId, `no driver matched: ${JSON.stringify(created)}`);
    tripId = created.tripId;
    cleanup.push(db.collection('trips').doc(tripId));
    pass('createTripRequest matches the online driver', `trip ${tripId}`);
  } catch (e) {
    fail('createTripRequest matches the online driver', e.message);
  }

  // ---- 3. the driver-app lifecycle ------------------------------------------
  if (tripId) {
    for (const [label, fn] of [
      ['acceptTripRequest', 'acceptTripRequest'],
      ['driverArrived', 'driverArrived'],
      ['startTrip', 'startTrip'],
    ]) {
      try {
        await callFn(fn, { tripId, devUserId: DRIVER });
        pass(`driver app: ${label}`);
      } catch (e) {
        fail(`driver app: ${label}`, e.message);
      }
    }

    try {
      await callFn('completeTrip', { tripId, devUserId: DRIVER });
      const t = (await db.collection('trips').doc(tripId).get()).data() ?? {};
      assert(t.status === 'completed', `trip status is ${t.status}`);
      const payRef = db.collection('payments').doc(`payment_${tripId}`);
      cleanup.push(payRef);
      const p = (await payRef.get()).data();
      assert(p, 'completeTrip did not create the payment ledger entry');
      pass('completeTrip closes the trip and writes the payment record', `status=${p.status}`);
    } catch (e) {
      fail('completeTrip closes the trip and writes the payment record', e.message);
    }

    // ---- 4. cash payment (the only live payment path) -----------------------
    try {
      const r = await callFn('confirmCashPayment', { tripId, devUserId: DRIVER });
      assert(r?.paymentStatus === 'paid', `expected paid, got ${r?.paymentStatus}`);
      pass('confirmCashPayment marks the fare collected', `₪${r.fareAmount}`);
    } catch (e) {
      fail('confirmCashPayment marks the fare collected', e.message);
    }

    // ---- 5. ratings (both apps' end-of-trip screens) ------------------------
    try {
      await callFn('submitRating', { tripId, rating: 5, devUserId: PAX });
      pass('passenger app: submitRating');
    } catch (e) {
      fail('passenger app: submitRating', e.message);
    }
    try {
      await callFn('submitPassengerRating', { tripId, rating: 5, devUserId: DRIVER });
      pass('driver app: submitPassengerRating');
    } catch (e) {
      fail('driver app: submitPassengerRating', e.message);
    }
  }

  // ---- 6. manager-web session path ------------------------------------------
  try {
    const tok = await callFn('devIssueManagerToken', { role: 'admin', uid: 'dev-manager-admin' });
    assert(tok?.token, 'no custom token issued');
    const signIn = await fetch(
      `http://${host}:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok.token, returnSecureToken: true }) }
    ).then((r) => r.json());
    assert(signIn?.idToken, `sign-in failed: ${JSON.stringify(signIn).slice(0, 160)}`);

    const res = await fetch(`http://${host}:${fnPort}/${projectId}/${REGION}/getManagerSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` },
      body: JSON.stringify({ data: {} }),
    });
    const body = await res.json();
    assert(body?.result?.role === 'admin', `bad session: ${JSON.stringify(body).slice(0, 200)}`);
    assert(Array.isArray(body.result.permissions) && body.result.permissions.length > 0, 'no permissions');
    pass('manager-web: dev login -> real session with permissions', `${body.result.permissions.length} perms`);
  } catch (e) {
    fail('manager-web: dev login -> real session with permissions', e.message);
  }

  // ---- 8. client error reporting (used by all apps' error boundaries) -------
  try {
    await callFn('reportClientError', {
      app: 'passenger-app', severity: 'error', devUserId: PAX,
      message: 'integration-check synthetic error',
      context: { source: 'integration-check' },
    });
    pass('reportClientError accepts client crash reports');
  } catch (e) {
    fail('reportClientError accepts client crash reports', e.message);
  }

  // ---- 9. online payments must stay INERT (flag off) ------------------------
  try {
    let inert = false;
    try {
      await callFn('startOnlinePayment', { tripId: tripId ?? 'x', devUserId: PAX });
    } catch (e) {
      inert = /not enabled/i.test(e.message);
    }
    assert(inert, 'startOnlinePayment should be disabled while ONLINE_PAYMENTS_ENABLED is off');
    const wh = await fetch(`http://${host}:${fnPort}/${projectId}/${REGION}/paymentWebhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert(wh.status === 404, `webhook should 404 while the flag is off, got ${wh.status}`);
    pass('online payments remain inert (flag OFF) and cash is the only path');
  } catch (e) {
    fail('online payments remain inert (flag OFF) and cash is the only path', e.message);
  }

  // ---- 10. security: an unauthenticated client cannot write money -----------
  try {
    let denied = false;
    try {
      await fetch(`http://${host}:8080/v1/projects/${projectId}/databases/(default)/documents/payments/x`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { status: { stringValue: 'paid' } } }),
      }).then(async (r) => { if (r.status === 403 || r.status === 401) denied = true; });
    } catch { denied = true; }
    assert(denied, 'a client was able to write to payments/ directly');
    pass('security: clients cannot write payments/ directly');
  } catch (e) {
    fail('security: clients cannot write payments/ directly', e.message);
  }

  for (const ref of cleanup.reverse()) await ref.delete().catch(() => undefined);
  await app.delete().catch(() => undefined);

  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n[INTEGRATION] total: ${results.length}, passed: ${ok}, failed: ${bad}`);
  process.exit(bad > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[INTEGRATION] FAILED', e); process.exit(1); });
