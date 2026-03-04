/* eslint-disable no-console */
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

if (process.env.FIRESTORE_EMULATOR_HOST && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Ignore host-level service account path when running emulator QA flows.
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath && (credentialPath.includes('%CD%') || !fs.existsSync(credentialPath))) {
  console.warn(`[QA] Ignoring invalid GOOGLE_APPLICATION_CREDENTIALS path: ${credentialPath}`);
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const results = [];

function ok(name, details = '') {
  results.push({ name, pass: true, details });
  console.log(`✅ ${name}${details ? ` - ${details}` : ''}`);
}

function fail(name, details) {
  results.push({ name, pass: false, details });
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

async function createTrip(passengerId, pickup, dropoff, rideOptions = undefined) {
  const estimate = await callCallable('estimateTrip', {
    pickup,
    dropoff,
    rideOptions,
    devUserId: passengerId,
  });
  const created = await callCallable('createTripRequest', {
    pickup,
    dropoff,
    estimate: {
      distanceKm: estimate.distanceKm,
      durationMin: estimate.durationMin,
      priceIls: estimate.priceIls,
    },
    rideOptions,
    devUserId: passengerId,
  });
  return { estimate, created };
}

async function main() {
  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const suffix = Date.now();

  const driverId = `qa-driver-${suffix}`;
  const passengerId = `qa-passenger-${suffix}`;
  const pickup = { lat: 32.2211, lng: 35.2544 };
  const dropoff = { lat: 31.9038, lng: 35.2034 };
  const lineId = `LINE_QA_${suffix}`;
  const officeId = `OFFICE_QA_${suffix}`;

  const cleanupDocRefs = [];
  const cleanupCollectionRefs = [];
  const trackDoc = (ref) => cleanupDocRefs.push(ref);
  const trackCollection = (ref) => cleanupCollectionRefs.push(ref);

  try {
    // Seed operation scope + eligible driver.
    await db.collection('offices').doc(officeId).set({
      officeId,
      name: 'QA Office',
      code: 'QA',
      city: 'Nablus',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    trackDoc(db.collection('offices').doc(officeId));

    await db.collection('lines').doc(lineId).set({
      lineId,
      officeId,
      name: 'QA Line',
      code: 'QAL',
      status: 'active',
      minSeats: 1,
      maxSeats: 6,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    trackDoc(db.collection('lines').doc(lineId));

    const driverRef = db.collection('drivers').doc(driverId);
    await driverRef.set({
      driverId,
      driverType: 'licensed_line_owner',
      verificationStatus: 'approved',
      officeId,
      lineId,
      licenseId: `LIC_QA_${suffix}`,
      vehicleType: 'taxi_standard',
      seatCapacity: 4,
      isOnline: true,
      isAvailable: true,
      status: 'online',
      lastLocation: new admin.firestore.GeoPoint(pickup.lat, pickup.lng),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    trackDoc(driverRef);
    trackDoc(db.collection('driverLive').doc(driverId));
    trackCollection(db.collection('driverRequests').doc(driverId).collection('requests'));
    trackCollection(db.collection('tripRequests'));

    // Scenario 1: Full lifecycle.
    try {
      const { created } = await createTrip(passengerId, pickup, dropoff, {
        requiredSeats: 2,
        vehicleType: 'taxi_standard',
        officeId,
        lineId,
      });
      assert(created.status === 'matched', 'Expected matched trip in lifecycle scenario');
      assert(created.tripId, 'Expected tripId in lifecycle scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));
      trackDoc(db.collection('payments').doc(`payment_${tripId}`));

      await callCallable('acceptTripRequest', { tripId, devUserId: driverId });
      await callCallable('driverArrived', { tripId, devUserId: driverId });
      await callCallable('startTrip', { tripId, devUserId: driverId });
      await callCallable('completeTrip', { tripId, devUserId: driverId });

      const tripDoc = await db.collection('trips').doc(tripId).get();
      assert(tripDoc.data()?.status === 'completed', 'Trip should be completed');
      ok('Lifecycle scenario', tripId);
    } catch (error) {
      fail('Lifecycle scenario', error instanceof Error ? error.message : String(error));
    }

    // Scenario 2: Reject flow.
    try {
      await driverRef.set(
        {
          isOnline: true,
          isAvailable: true,
          status: 'online',
          lastLocation: new admin.firestore.GeoPoint(pickup.lat, pickup.lng),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const { created } = await createTrip(passengerId, pickup, dropoff, {
        requiredSeats: 1,
        officeId,
        lineId,
      });
      assert(created.tripId, 'Expected tripId in reject scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));

      await callCallable('rejectTripRequest', { tripId, devUserId: driverId });
      const tripDoc = await db.collection('trips').doc(tripId).get();
      assert(tripDoc.data()?.status === 'no_driver_available', 'Trip should move to no_driver_available');
      ok('Reject scenario', tripId);
    } catch (error) {
      fail('Reject scenario', error instanceof Error ? error.message : String(error));
    }

    // Scenario 3: Expiry guard.
    try {
      await driverRef.set(
        {
          isOnline: true,
          isAvailable: true,
          status: 'online',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const { created } = await createTrip(passengerId, pickup, dropoff, {
        requiredSeats: 1,
        officeId,
        lineId,
      });
      assert(created.tripId, 'Expected tripId in expiry scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));

      const reqRef = db
        .collection('driverRequests')
        .doc(driverId)
        .collection('requests')
        .doc(tripId);
      await reqRef.set(
        {
          expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5_000),
        },
        { merge: true }
      );

      let blocked = false;
      try {
        await callCallable('acceptTripRequest', { tripId, devUserId: driverId });
      } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        blocked = message.includes('expired');
      }
      assert(blocked, 'Accept should be blocked for expired request');
      await db.collection('trips').doc(tripId).set(
        { status: 'no_driver_available', cancelledAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      ok('Expiry guard scenario', tripId);
    } catch (error) {
      fail('Expiry guard scenario', error instanceof Error ? error.message : String(error));
    }

    // Scenario 4: Reconnect flow.
    try {
      await driverRef.set(
        {
          isOnline: false,
          isAvailable: false,
          status: 'offline',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const firstAttempt = await createTrip(passengerId, pickup, dropoff, {
        requiredSeats: 1,
        officeId,
        lineId,
      });
      assert(firstAttempt.created.status === 'searching', 'Expected searching when driver offline');

      await driverRef.set(
        {
          isOnline: true,
          isAvailable: true,
          status: 'online',
          lastLocation: new admin.firestore.GeoPoint(pickup.lat, pickup.lng),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const secondAttempt = await createTrip(passengerId, pickup, dropoff, {
        requiredSeats: 1,
        officeId,
        lineId,
      });
      assert(secondAttempt.created.status === 'matched', 'Expected matched after reconnect');
      assert(secondAttempt.created.tripId, 'Expected tripId after reconnect');
      trackDoc(db.collection('trips').doc(secondAttempt.created.tripId));
      ok('Reconnect scenario', secondAttempt.created.tripId);
    } catch (error) {
      fail('Reconnect scenario', error instanceof Error ? error.message : String(error));
    }
  } finally {
    for (const ref of cleanupDocRefs.reverse()) {
      try {
        await ref.delete();
      } catch {
        // ignore cleanup errors
      }
    }

    for (const colRef of cleanupCollectionRefs) {
      try {
        const snapshot = await colRef.limit(200).get();
        for (const docSnap of snapshot.docs) {
          await docSnap.ref.delete();
        }
      } catch {
        // ignore cleanup errors
      }
    }

    try {
      await admin.app().delete();
    } catch {
      // ignore
    }
  }

  const passed = results.filter((entry) => entry.pass).length;
  const failed = results.filter((entry) => !entry.pass).length;
  console.log(
    `\n[QA] Request lifecycle E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[QA] Request lifecycle E2E FAILED', error);
  process.exit(1);
});
