/* eslint-disable no-console */
/**
 * QA E2E: confirmCashPayment (R6)
 *
 * Regression guard for R6: `confirmCashPayment` was implemented and called by the
 * driver app, but was never re-exported from `backend/functions/src/index.ts`, so it
 * was never deployed and no trip ever reached paymentStatus = "paid".
 *
 * This script drives a real trip through the emulator to COMPLETED and asserts the
 * payment state machine reaches "paid", plus the guard rails around it.
 *
 * Requires the emulator suite (auth, firestore, functions) to be running.
 */
import admin from 'firebase-admin';
import fs from 'node:fs';

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
  console.warn(`[QA] Ignoring invalid GOOGLE_APPLICATION_CREDENTIALS path: ${credentialPath}`);
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const testResults = [];

function pass(name, details = '') {
  testResults.push({ name, pass: true, details });
  console.log(`✅ ${name}${details ? ` - ${details}` : ''}`);
}

function fail(name, details) {
  testResults.push({ name, pass: false, details });
  console.error(`❌ ${name} - ${details}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function callCallable(functionName, data) {
  const url = `http://${emulatorHost}:${functionsPort}/${projectId}/europe-west1/${functionName}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const err = new Error(body?.error?.message || `Callable ${functionName} failed`);
    err.code = body?.error?.status || String(response.status);
    throw err;
  }
  return body.result;
}

/**
 * Assert a callable rejects, and that the message matches `expectedFragment`.
 * Used for the negative/guard cases.
 */
async function expectCallableRejected(functionName, data, expectedFragment, testName) {
  try {
    await callCallable(functionName, data);
    fail(testName, 'Expected the callable to be rejected but it succeeded');
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (message.includes(expectedFragment.toLowerCase())) {
      pass(testName);
    } else {
      fail(testName, `Unexpected error message: ${message}`);
    }
  }
}

async function main() {
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const suffix = Date.now();
  const driverId = `qa-cash-driver-${suffix}`;
  const otherDriverId = `qa-cash-other-driver-${suffix}`;
  const passengerId = `qa-cash-passenger-${suffix}`;

  const cleanupRefs = [];
  const pushCleanup = (ref) => cleanupRefs.push(ref);

  // ---------------------------------------------------------------------------
  // Test 0: the function is actually exported / reachable at all.
  // This is the direct regression guard for R6 - before the fix this 404s.
  // ---------------------------------------------------------------------------
  const probeUrl = `http://${emulatorHost}:${functionsPort}/${projectId}/europe-west1/confirmCashPayment`;
  try {
    const probe = await fetch(probeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    });
    if (probe.status === 404) {
      fail(
        'confirmCashPayment is exported and reachable',
        'Function returned HTTP 404 - it is not exported from backend/functions/src/index.ts'
      );
    } else {
      pass('confirmCashPayment is exported and reachable', `HTTP ${probe.status}`);
    }
  } catch (error) {
    fail(
      'confirmCashPayment is exported and reachable',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ---------------------------------------------------------------------------
  // Seed an eligible driver + a trip driven all the way to completion.
  // ---------------------------------------------------------------------------
  const driverRef = db.collection('drivers').doc(driverId);
  const otherDriverRef = db.collection('drivers').doc(otherDriverId);
  pushCleanup(driverRef);
  pushCleanup(otherDriverRef);

  const eligibleDriver = {
    status: 'online',
    isOnline: true,
    isAvailable: true,
    driverType: 'licensed_line_owner',
    verificationStatus: 'approved',
    lineId: 'line-qa-cash',
    licenseId: null,
    lastLocation: new admin.firestore.GeoPoint(32.2211, 35.2544),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await driverRef.set({ driverId, ...eligibleDriver });
  await otherDriverRef.set({ driverId: otherDriverId, ...eligibleDriver });

  const now = Date.now();
  const tripId = `qa-cash-trip-${suffix}`;
  const notCompletedTripId = `qa-cash-trip-inprogress-${suffix}`;

  pushCleanup(db.collection('trips').doc(tripId));
  pushCleanup(db.collection('trips').doc(notCompletedTripId));
  pushCleanup(db.collection('driverRequests').doc(driverId).collection('requests').doc(tripId));
  pushCleanup(db.collection('payments').doc(`payment_${tripId}`));

  const baseTrip = {
    passengerId,
    pickup: { lat: 32.2211, lng: 35.2544 },
    dropoff: { lat: 31.9038, lng: 35.2034 },
    estimatedDistanceKm: 10,
    estimatedDurationMin: 20,
    estimatedPriceIls: 25,
    fareAmount: 25,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('trips').doc(tripId).set({
    tripId,
    driverId,
    status: 'pending',
    ...baseTrip,
  });

  await db
    .collection('driverRequests')
    .doc(driverId)
    .collection('requests')
    .doc(tripId)
    .set({
      tripId,
      passengerId,
      pickup: baseTrip.pickup,
      dropoff: baseTrip.dropoff,
      estimatedPriceIls: 25,
      status: 'pending',
      expiresAt: admin.firestore.Timestamp.fromMillis(now + 60_000),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timeoutSeconds: 30,
    });

  // A trip left mid-ride, to prove payment cannot be collected before completion.
  await db.collection('trips').doc(notCompletedTripId).set({
    tripId: notCompletedTripId,
    driverId,
    status: 'in_progress',
    ...baseTrip,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ---------------------------------------------------------------------------
  // Test 1: payment cannot be collected while the trip is still in progress.
  // ---------------------------------------------------------------------------
  await expectCallableRejected(
    'confirmCashPayment',
    { tripId: notCompletedTripId, devUserId: driverId },
    'must be completed',
    'Rejects cash confirmation before the trip is completed'
  );

  // ---------------------------------------------------------------------------
  // Drive the happy-path trip to COMPLETED.
  // ---------------------------------------------------------------------------
  let reachedCompleted = false;
  try {
    await callCallable('acceptTripRequest', { tripId, devUserId: driverId });
    await callCallable('driverArrived', { tripId, devUserId: driverId });
    await callCallable('startTrip', { tripId, devUserId: driverId });
    const completeResult = await callCallable('completeTrip', { tripId, devUserId: driverId });
    assert(completeResult?.status === 'completed', 'Expected completeTrip to return status "completed"');
    reachedCompleted = true;
    pass('Trip reaches completed (accept -> arrived -> start -> complete)');
  } catch (error) {
    fail(
      'Trip reaches completed (accept -> arrived -> start -> complete)',
      error instanceof Error ? error.message : String(error)
    );
  }

  if (reachedCompleted) {
    // -------------------------------------------------------------------------
    // Test 2: a driver who does not own the trip cannot collect its payment.
    // -------------------------------------------------------------------------
    await expectCallableRejected(
      'confirmCashPayment',
      { tripId, devUserId: otherDriverId },
      'not the driver of this trip',
      'Rejects cash confirmation from a driver who does not own the trip'
    );

    // -------------------------------------------------------------------------
    // Test 3: the owning driver confirms cash, and the trip reaches PAID.
    // This is the assertion R6 is really about.
    // -------------------------------------------------------------------------
    try {
      const result = await callCallable('confirmCashPayment', { tripId, devUserId: driverId });
      assert(result?.success === true, 'Expected success: true');
      assert(
        result?.paymentStatus === 'paid',
        `Expected returned paymentStatus "paid", got "${result?.paymentStatus}"`
      );
      assert(result?.fareAmount === 25, `Expected fareAmount 25, got ${result?.fareAmount}`);

      // Verify the state machine actually persisted, not just the response body.
      const tripSnap = await db.collection('trips').doc(tripId).get();
      const trip = tripSnap.data();
      assert(
        trip?.paymentStatus === 'paid',
        `Expected persisted trip.paymentStatus "paid", got "${trip?.paymentStatus}"`
      );
      assert(trip?.paidAt, 'Expected trip.paidAt to be set');

      pass('Cash payment reaches paid and persists (paymentStatus + paidAt)');
    } catch (error) {
      fail(
        'Cash payment reaches paid and persists (paymentStatus + paidAt)',
        error instanceof Error ? error.message : String(error)
      );
    }

    // -------------------------------------------------------------------------
    // Test 4: double collection is rejected (idempotency guard).
    // -------------------------------------------------------------------------
    await expectCallableRejected(
      'confirmCashPayment',
      { tripId, devUserId: driverId },
      'already been collected',
      'Rejects double collection of the same cash payment'
    );
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  for (const ref of cleanupRefs.reverse()) {
    try {
      await ref.delete();
    } catch {
      // noop
    }
  }

  try {
    await admin.app().delete();
  } catch {
    // noop
  }

  const passed = testResults.filter((item) => item.pass).length;
  const failed = testResults.filter((item) => !item.pass).length;
  console.log(
    `\n[QA] Cash payment E2E summary -> total: ${testResults.length}, passed: ${passed}, failed: ${failed}`
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Cash payment E2E FAILED', error);
  process.exit(1);
});
