/* eslint-disable no-console */
import admin from 'firebase-admin';
import fs from 'node:fs';
import { deleteApp as deleteClientApp, initializeApp as initClientApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
  getFirestore as getClientFirestore,
  connectFirestoreEmulator,
  doc as clientDoc,
  updateDoc,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = `${emulatorHost}:8080`;
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${emulatorHost}:9099`;
}

if (process.env.FIRESTORE_EMULATOR_HOST && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Ignore host-level service account env when running local emulator QA.
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath && (credentialPath.includes('%CD%') || !fs.existsSync(credentialPath))) {
  console.warn(`[QA] Ignoring invalid GOOGLE_APPLICATION_CREDENTIALS path: ${credentialPath}`);
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
  if (!condition) {
    throw new Error(message);
  }
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

async function expectCallableForbidden(functionName, data, testName) {
  try {
    await callCallable(functionName, data);
    fail(testName, 'Expected forbidden error but function succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('approved licensed line owners')) {
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
  const ineligibleDriverId = `qa-ineligible-${suffix}`;
  const eligibleDriverId = `qa-eligible-${suffix}`;
  const passengerId = `qa-passenger-${suffix}`;

  const cleanupRefs = [];
  const pushCleanup = (ref) => cleanupRefs.push(ref);

  // ---------------------------------------------------------------------------
  // Test 1: Firestore rules - go online blocked for ineligible driver
  // ---------------------------------------------------------------------------
  const clientApp = initClientApp({
    apiKey: 'demo-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: '1:111111111111:web:demo',
  });
  const clientAuth = getAuth(clientApp);
  const clientDb = getClientFirestore(clientApp);
  connectAuthEmulator(clientAuth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(clientDb, emulatorHost, 8080);

  const anonCred = await signInAnonymously(clientAuth);
  const rulesTestDriverId = anonCred.user.uid;
  const rulesDriverRef = db.collection('drivers').doc(rulesTestDriverId);
  pushCleanup(rulesDriverRef);

  await rulesDriverRef.set({
    driverId: rulesTestDriverId,
    status: 'offline',
    isOnline: false,
    isAvailable: false,
    driverType: 'contractor',
    verificationStatus: 'pending',
    lineId: null,
    licenseId: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    await updateDoc(clientDoc(clientDb, 'drivers', rulesTestDriverId), {
      isOnline: true,
      status: 'online',
      updatedAt: new Date(),
    });
    fail('Rules block go online (ineligible)', 'Write unexpectedly succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('permission') || message.includes('missing or insufficient')) {
      pass('Rules block go online (ineligible)');
    } else {
      fail('Rules block go online (ineligible)', `Unexpected error: ${message}`);
    }
  }

  await rulesDriverRef.set(
    {
      driverType: 'licensed_line_owner',
      verificationStatus: 'approved',
      lineId: 'line-rules-01',
      licenseId: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await updateDoc(clientDoc(clientDb, 'drivers', rulesTestDriverId), {
      isOnline: true,
      status: 'online',
      updatedAt: new Date(),
    });
    pass('Rules allow go online (eligible)');
  } catch (error) {
    fail('Rules allow go online (eligible)', error instanceof Error ? error.message : String(error));
  }

  // ---------------------------------------------------------------------------
  // Seed drivers/trips for callable tests
  // ---------------------------------------------------------------------------
  const ineligibleDriverRef = db.collection('drivers').doc(ineligibleDriverId);
  const eligibleDriverRef = db.collection('drivers').doc(eligibleDriverId);
  pushCleanup(ineligibleDriverRef);
  pushCleanup(eligibleDriverRef);

  await ineligibleDriverRef.set({
    driverId: ineligibleDriverId,
    status: 'offline',
    isOnline: false,
    isAvailable: false,
    driverType: 'contractor',
    verificationStatus: 'pending',
    lineId: null,
    licenseId: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await eligibleDriverRef.set({
    driverId: eligibleDriverId,
    status: 'online',
    isOnline: true,
    isAvailable: true,
    driverType: 'licensed_line_owner',
    verificationStatus: 'approved',
    lineId: 'line-qa-01',
    licenseId: null,
    lastLocation: new admin.firestore.GeoPoint(32.2211, 35.2544),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const now = Date.now();
  const tripAcceptBlockedId = `qa-trip-accept-blocked-${suffix}`;
  const tripStartBlockedId = `qa-trip-start-blocked-${suffix}`;
  const tripCompleteBlockedId = `qa-trip-complete-blocked-${suffix}`;
  const tripHappyPathId = `qa-trip-happy-${suffix}`;

  for (const id of [
    tripAcceptBlockedId,
    tripStartBlockedId,
    tripCompleteBlockedId,
    tripHappyPathId,
  ]) {
    pushCleanup(db.collection('trips').doc(id));
  }
  pushCleanup(db.collection('driverRequests').doc(ineligibleDriverId).collection('requests').doc(tripAcceptBlockedId));
  pushCleanup(db.collection('driverRequests').doc(eligibleDriverId).collection('requests').doc(tripHappyPathId));
  pushCleanup(db.collection('payments').doc(`payment_${tripHappyPathId}`));

  await db.collection('trips').doc(tripAcceptBlockedId).set({
    tripId: tripAcceptBlockedId,
    passengerId,
    driverId: ineligibleDriverId,
    status: 'pending',
    pickup: { lat: 32.2211, lng: 35.2544 },
    dropoff: { lat: 31.9038, lng: 35.2034 },
    estimatedDistanceKm: 10,
    estimatedDurationMin: 20,
    estimatedPriceIls: 25,
    fareAmount: 25,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db
    .collection('driverRequests')
    .doc(ineligibleDriverId)
    .collection('requests')
    .doc(tripAcceptBlockedId)
    .set({
      tripId: tripAcceptBlockedId,
      passengerId,
      pickup: { lat: 32.2211, lng: 35.2544 },
      dropoff: { lat: 31.9038, lng: 35.2034 },
      estimatedPriceIls: 25,
      status: 'pending',
      expiresAt: admin.firestore.Timestamp.fromMillis(now + 60_000),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timeoutSeconds: 30,
    });

  await db.collection('trips').doc(tripStartBlockedId).set({
    tripId: tripStartBlockedId,
    passengerId,
    driverId: ineligibleDriverId,
    status: 'driver_arrived',
    pickup: { lat: 32.2211, lng: 35.2544 },
    dropoff: { lat: 31.9038, lng: 35.2034 },
    estimatedDistanceKm: 10,
    estimatedDurationMin: 20,
    estimatedPriceIls: 25,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('trips').doc(tripCompleteBlockedId).set({
    tripId: tripCompleteBlockedId,
    passengerId,
    driverId: ineligibleDriverId,
    status: 'in_progress',
    pickup: { lat: 32.2211, lng: 35.2544 },
    dropoff: { lat: 31.9038, lng: 35.2034 },
    estimatedDistanceKm: 10,
    estimatedDurationMin: 20,
    estimatedPriceIls: 25,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('trips').doc(tripHappyPathId).set({
    tripId: tripHappyPathId,
    passengerId,
    driverId: eligibleDriverId,
    status: 'pending',
    pickup: { lat: 32.2211, lng: 35.2544 },
    dropoff: { lat: 31.9038, lng: 35.2034 },
    estimatedDistanceKm: 10,
    estimatedDurationMin: 20,
    estimatedPriceIls: 25,
    fareAmount: 25,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db
    .collection('driverRequests')
    .doc(eligibleDriverId)
    .collection('requests')
    .doc(tripHappyPathId)
    .set({
      tripId: tripHappyPathId,
      passengerId,
      pickup: { lat: 32.2211, lng: 35.2544 },
      dropoff: { lat: 31.9038, lng: 35.2034 },
      estimatedPriceIls: 25,
      status: 'pending',
      expiresAt: admin.firestore.Timestamp.fromMillis(now + 60_000),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timeoutSeconds: 30,
    });

  // ---------------------------------------------------------------------------
  // Test 2-4: Ineligible driver blocked by callable guards
  // ---------------------------------------------------------------------------
  await expectCallableForbidden(
    'acceptTripRequest',
    { tripId: tripAcceptBlockedId, devUserId: ineligibleDriverId },
    'Guard blocks acceptTripRequest (ineligible driver)'
  );
  await expectCallableForbidden(
    'startTrip',
    { tripId: tripStartBlockedId, devUserId: ineligibleDriverId },
    'Guard blocks startTrip (ineligible driver)'
  );
  await expectCallableForbidden(
    'completeTrip',
    { tripId: tripCompleteBlockedId, devUserId: ineligibleDriverId },
    'Guard blocks completeTrip (ineligible driver)'
  );

  // ---------------------------------------------------------------------------
  // Test 5: Eligible driver full happy path
  // ---------------------------------------------------------------------------
  try {
    await callCallable('acceptTripRequest', { tripId: tripHappyPathId, devUserId: eligibleDriverId });
    await callCallable('driverArrived', { tripId: tripHappyPathId, devUserId: eligibleDriverId });
    await callCallable('startTrip', { tripId: tripHappyPathId, devUserId: eligibleDriverId });
    const completeResult = await callCallable('completeTrip', {
      tripId: tripHappyPathId,
      devUserId: eligibleDriverId,
    });
    assert(completeResult?.status === 'completed', 'Expected completed status from completeTrip');
    pass('Eligible driver full flow (accept -> arrived -> start -> complete)');
  } catch (error) {
    fail(
      'Eligible driver full flow (accept -> arrived -> start -> complete)',
      error instanceof Error ? error.message : String(error)
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
    await clientAuth.signOut();
  } catch {
    // noop
  }

  try {
    await deleteClientApp(clientApp);
  } catch {
    // noop
  }

  try {
    await admin.app().delete();
  } catch {
    // noop
  }

  const passed = testResults.filter((item) => item.pass).length;
  const failed = testResults.filter((item) => !item.pass).length;
  console.log(`\n[QA] Driver eligibility E2E summary -> total: ${testResults.length}, passed: ${passed}, failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('[QA] Driver eligibility E2E FAILED', error);
  process.exit(1);
});
