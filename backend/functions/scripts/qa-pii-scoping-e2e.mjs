/* eslint-disable no-console */
/**
 * QA E2E: PII read scoping for drivers/{driverId} and driverLive/{driverId}.
 *
 * THE ISSUE
 * Both collections ended their read rule with `|| isAuthenticated()`, so ANY signed-in
 * account could read - and enumerate - every driver document (nationalId, phone) and
 * stream every driver's live GPS position.
 *
 * THE FIX
 * Reads are scoped to: the driver themselves, a manager, and the passenger of record on
 * the driver's CURRENT trip (linked via drivers/{driverId}.currentTripId -> the trip's
 * passengerId).
 *
 * PII IS NOW SPLIT OUT (the previously-documented limit is fixed)
 * Firestore read rules are per-DOCUMENT, not per-field, so while nationalId / phone /
 * fullName lived on drivers/{id}, the passenger of record received them along with the
 * driver card they legitimately read. Those fields now live in the private
 * subcollection drivers/{id}/private/pii, readable only by the driver and managers.
 * This suite asserts BOTH the document-level access scoping AND that the passenger of
 * record no longer receives the PII fields.
 *
 * Requires the emulator suite (auth, firestore, functions) to be running.
 */
import fs from 'node:fs';

import admin from 'firebase-admin';
import { initializeApp as initClientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
  getFirestore as getClientFirestore,
  connectFirestoreEmulator,
  doc as clientDoc,
  collection as clientCollection,
  getDoc,
  getDocs,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';

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

const testResults = [];

function pass(name, details = '') {
  testResults.push({ name, pass: true, details });
  console.log(`✅ ${name}${details ? ` - ${details}` : ''}`);
}

function fail(name, details) {
  testResults.push({ name, pass: false, details });
  console.error(`❌ ${name} - ${details}`);
}

function isPermissionDenied(error) {
  // The Firebase SDK sets code === 'permission-denied'; the message itself carries only
  // the rules evaluation trace (e.g. "false for 'get' @ L224") and does NOT reliably
  // contain the word "permission", so check the code first.
  if (error && typeof error === 'object' && error.code === 'permission-denied') return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('permission-denied') ||
    message.includes('permission') ||
    message.includes('insufficient');
}

/** Assert a read is DENIED. */
async function expectDenied(label, readFn) {
  try {
    await readFn();
    fail(label, 'The read SUCCEEDED but should have been denied');
  } catch (error) {
    if (isPermissionDenied(error)) {
      pass(label);
    } else {
      fail(label, `Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Assert a read is ALLOWED. */
async function expectAllowed(label, readFn) {
  try {
    await readFn();
    pass(label);
  } catch (error) {
    fail(label, `Denied, but should have been allowed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Sign in a fresh anonymous client, returning its own Firestore handle. */
function newClient(name) {
  const app = initClientApp(
    {
      apiKey: 'demo-key',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      appId: '1:111111111111:web:demo',
    },
    `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const auth = getAuth(app);
  const db = getClientFirestore(app);
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, emulatorHost, 8080);
  return { app, auth, db };
}

async function main() {
  admin.initializeApp({ projectId });
  const adminDb = admin.firestore();

  const suffix = Date.now();
  const cleanupRefs = [];
  const pushCleanup = (ref) => cleanupRefs.push(ref);
  const clientApps = [];

  // --- three separate signed-in identities -----------------------------------
  const driverClient = newClient('driver');
  const passengerClient = newClient('passenger');
  const strangerClient = newClient('stranger');
  const managerClient = newClient('manager');
  clientApps.push(driverClient, passengerClient, strangerClient, managerClient);

  const driverUid = (await signInAnonymously(driverClient.auth)).user.uid;
  const passengerUid = (await signInAnonymously(passengerClient.auth)).user.uid;
  await signInAnonymously(strangerClient.auth); // a random authenticated user
  const managerUid = (await signInAnonymously(managerClient.auth)).user.uid;

  const tripId = `qa-pii-trip-${suffix}`;

  const driverRef = adminDb.collection('drivers').doc(driverUid);
  const driverLiveRef = adminDb.collection('driverLive').doc(driverUid);
  const driverPiiRef = adminDb
    .collection('drivers')
    .doc(driverUid)
    .collection('private')
    .doc('pii');
  const tripRef = adminDb.collection('trips').doc(tripId);
  const managerRoleRef = adminDb.collection('managerRoles').doc(managerUid);
  pushCleanup(driverRef);
  pushCleanup(driverLiveRef);
  pushCleanup(driverPiiRef);
  pushCleanup(tripRef);
  pushCleanup(managerRoleRef);

  // Parent driver document: display + operational fields only, no PII.
  await driverRef.set({
    driverId: driverUid,
    displayName: 'QA PII Driver',
    status: 'online',
    isOnline: true,
    isAvailable: true,
    driverType: 'licensed_line_owner',
    verificationStatus: 'approved',
    lineId: 'line-qa-pii',
    licenseId: null,
    currentTripId: tripId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // PII goes to the private subcollection.
  await driverPiiRef.set({
    driverId: driverUid,
    fullName: 'QA PII Driver Legal Name',
    nationalId: 'QA-NATIONAL-ID-123',
    phone: '+970000000000',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await driverLiveRef.set({
    driverId: driverUid,
    lat: 32.2211,
    lng: 35.2544,
    heading: 90,
    speed: 12,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // The trip that links this passenger to this driver.
  await tripRef.set({
    tripId,
    passengerId: passengerUid,
    driverId: driverUid,
    status: 'in_progress',
    pickup: { lat: 32.2211, lng: 35.2544 },
    dropoff: { lat: 31.9038, lng: 35.2034 },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // An active manager (via managerRoles, the post-R1 source of truth).
  await managerRoleRef.set({
    uid: managerUid,
    role: 'admin',
    permissions: [],
    officeIds: [],
    lineIds: [],
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ===========================================================================
  // THE VULNERABILITY: a random authenticated user must not reach either doc.
  // ===========================================================================
  await expectDenied('PII: stranger CANNOT read drivers/{driverId} (nationalId, phone)', () =>
    getDoc(clientDoc(strangerClient.db, 'drivers', driverUid))
  );

  await expectDenied('PII: stranger CANNOT read driverLive/{driverId} (live GPS)', () =>
    getDoc(clientDoc(strangerClient.db, 'driverLive', driverUid))
  );

  // Enumeration is the worse form of the same bug - harvesting every driver at once.
  await expectDenied('PII: stranger CANNOT enumerate the drivers collection', () =>
    getDocs(clientCollection(strangerClient.db, 'drivers'))
  );

  await expectDenied('PII: stranger CANNOT enumerate the driverLive collection', () =>
    getDocs(clientCollection(strangerClient.db, 'driverLive'))
  );

  // ===========================================================================
  // REAL READ PATHS THAT MUST KEEP WORKING.
  // Without these, the rule would be "secure" only by breaking the product.
  // ===========================================================================

  // Passenger on the driver's current trip - the live trip UI.
  // (passenger-app/app/trip.tsx and PassengerMapView.tsx)
  await expectAllowed('PII: passenger on the active trip CAN read the assigned driver profile', () =>
    getDoc(clientDoc(passengerClient.db, 'drivers', driverUid))
  );

  await expectAllowed('PII: passenger on the active trip CAN read the assigned driver location', () =>
    getDoc(clientDoc(passengerClient.db, 'driverLive', driverUid))
  );

  // Driver reading their own documents.
  // (driver-app home screen eligibility subscription)
  await expectAllowed('PII: driver CAN read their own profile', () =>
    getDoc(clientDoc(driverClient.db, 'drivers', driverUid))
  );

  // Manager: single doc AND collection enumeration.
  // (manager-web DriversListPage + LiveMapPage both enumerate)
  await expectAllowed('PII: manager CAN read a driver profile', () =>
    getDoc(clientDoc(managerClient.db, 'drivers', driverUid))
  );

  await expectAllowed('PII: manager CAN enumerate the drivers collection', () =>
    getDocs(clientCollection(managerClient.db, 'drivers'))
  );

  await expectAllowed('PII: manager CAN enumerate the driverLive collection (live map)', () =>
    getDocs(clientCollection(managerClient.db, 'driverLive'))
  );

  // ===========================================================================
  // SCOPING IS PER-DRIVER: being a passenger on one trip must not grant access
  // to an UNRELATED driver.
  // ===========================================================================
  const otherDriverUid = `qa-pii-other-driver-${suffix}`;
  const otherDriverRef = adminDb.collection('drivers').doc(otherDriverUid);
  const otherDriverLiveRef = adminDb.collection('driverLive').doc(otherDriverUid);
  pushCleanup(otherDriverRef);
  pushCleanup(otherDriverLiveRef);

  await otherDriverRef.set({
    driverId: otherDriverUid,
    displayName: 'QA Unrelated Driver',
    currentTripId: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await adminDb
    .collection('drivers')
    .doc(otherDriverUid)
    .collection('private')
    .doc('pii')
    .set({
      driverId: otherDriverUid,
      fullName: 'QA Unrelated Legal Name',
      nationalId: 'QA-OTHER-NATIONAL-ID',
      phone: '+970111111111',
    });
  await otherDriverLiveRef.set({
    driverId: otherDriverUid,
    lat: 31.9,
    lng: 35.2,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await expectDenied('PII: passenger CANNOT read an UNRELATED driver profile', () =>
    getDoc(clientDoc(passengerClient.db, 'drivers', otherDriverUid))
  );

  await expectDenied('PII: passenger CANNOT read an UNRELATED driver location', () =>
    getDoc(clientDoc(passengerClient.db, 'driverLive', otherDriverUid))
  );

  // ===========================================================================
  // Access ends with the assignment: once the driver is no longer on this
  // passenger's trip, the passenger loses access.
  // ===========================================================================
  await driverRef.set({ currentTripId: null }, { merge: true });

  await expectDenied(
    'PII: passenger loses driver access once currentTripId is cleared',
    () => getDoc(clientDoc(passengerClient.db, 'drivers', driverUid))
  );

  // Restore, so the next assertion is meaningful.
  await driverRef.set({ currentTripId: tripId }, { merge: true });

  // ===========================================================================
  // THE POINT OF THE MIGRATION: the passenger of record must NOT receive PII.
  // ===========================================================================

  // 1. The driver document they can read must carry no PII fields at all.
  try {
    const snap = await getDoc(clientDoc(passengerClient.db, 'drivers', driverUid));
    const data = snap.data() ?? {};
    const leaked = ['nationalId', 'phone', 'fullName'].filter((f) => data[f] !== undefined);
    if (leaked.length === 0) {
      pass('PII: passenger driver document carries NO nationalId / phone / fullName');
    } else {
      fail(
        'PII: passenger driver document carries NO nationalId / phone / fullName',
        `still exposed: [${leaked.join(', ')}]`
      );
    }
  } catch (error) {
    fail(
      'PII: passenger driver document carries NO nationalId / phone / fullName',
      `the passenger could not read the driver doc at all: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // 2. The passenger must still get the display fields the trip UI renders,
  //    otherwise the migration has simply broken the driver card.
  try {
    const snap = await getDoc(clientDoc(passengerClient.db, 'drivers', driverUid));
    const data = snap.data() ?? {};
    if (typeof data.displayName === 'string' && data.displayName.length > 0) {
      pass('PII: passenger still receives display fields (displayName)', data.displayName);
    } else {
      fail('PII: passenger still receives display fields (displayName)', 'displayName missing');
    }
  } catch (error) {
    fail(
      'PII: passenger still receives display fields (displayName)',
      error instanceof Error ? error.message : String(error)
    );
  }

  // 3. The passenger must be denied the private PII subcollection outright.
  await expectDenied('PII: passenger CANNOT read drivers/{id}/private/pii', () =>
    getDoc(clientDoc(passengerClient.db, 'drivers', driverUid, 'private', 'pii'))
  );

  // 4. A stranger, likewise.
  await expectDenied('PII: stranger CANNOT read drivers/{id}/private/pii', () =>
    getDoc(clientDoc(strangerClient.db, 'drivers', driverUid, 'private', 'pii'))
  );

  // 5. POSITIVE CONTROLS - the people who need the PII must still get it.
  await expectAllowed('PII: driver CAN read their own private PII', () =>
    getDoc(clientDoc(driverClient.db, 'drivers', driverUid, 'private', 'pii'))
  );

  await expectAllowed('PII: manager CAN read a driver private PII doc', () =>
    getDoc(clientDoc(managerClient.db, 'drivers', driverUid, 'private', 'pii'))
  );

  // 6. And the manager must actually receive the values, not an empty doc.
  try {
    const snap = await getDoc(clientDoc(managerClient.db, 'drivers', driverUid, 'private', 'pii'));
    const data = snap.data() ?? {};
    if (data.nationalId === 'QA-NATIONAL-ID-123' && data.phone === '+970000000000') {
      pass('PII: manager receives the actual nationalId and phone values');
    } else {
      fail(
        'PII: manager receives the actual nationalId and phone values',
        `got nationalId=${String(data.nationalId)} phone=${String(data.phone)}`
      );
    }
  } catch (error) {
    fail(
      'PII: manager receives the actual nationalId and phone values',
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
  for (const c of clientApps) {
    try {
      await c.auth.signOut();
    } catch {
      // noop
    }
    try {
      await deleteClientApp(c.app);
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
    `[QA] PII scoping E2E summary -> total: ${testResults.length}, passed: ${passed}, failed: ${failed}`
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] PII scoping E2E FAILED', error);
  process.exit(1);
});
