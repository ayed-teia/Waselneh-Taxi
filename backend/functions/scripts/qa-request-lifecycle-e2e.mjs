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

async function runStep(name, action) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} failed: ${message}`);
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
  const passengerLifecycle = `qa-passenger-lifecycle-${suffix}`;
  const passengerReject = `qa-passenger-reject-${suffix}`;
  const passengerExpiry = `qa-passenger-expiry-${suffix}`;
  const passengerReconnect = `qa-passenger-reconnect-${suffix}`;
  const passengerSeat = `qa-passenger-seat-${suffix}`;
  const passengerFullTaxi = `qa-passenger-full-${suffix}`;
  const passengerFullTaxiProbe = `qa-passenger-full-probe-${suffix}`;
  const pickup = { lat: 32.2211, lng: 35.2544 };
  const dropoff = { lat: 31.9038, lng: 35.2034 };
  const lineId = `LINE_QA_${suffix}`;
  const officeId = `OFFICE_QA_${suffix}`;
  const driverRef = db.collection('drivers').doc(driverId);

  const cleanupDocRefs = [];
  const cleanupCollectionRefs = [];
  const trackDoc = (ref) => cleanupDocRefs.push(ref);
  const trackCollection = (ref) => cleanupCollectionRefs.push(ref);
  const getDriverSeatState = async () => {
    const snap = await driverRef.get();
    const data = snap.data() || {};
    return {
      availableSeats:
        typeof data.availableSeats === 'number' ? Math.round(data.availableSeats) : null,
      seatCapacity: typeof data.seatCapacity === 'number' ? Math.round(data.seatCapacity) : null,
      fullTaxiReserved: data.fullTaxiReserved === true,
      fullTaxiReservedTripId:
        typeof data.fullTaxiReservedTripId === 'string' ? data.fullTaxiReservedTripId : null,
      isAvailable: data.isAvailable === true,
      isOnline: data.isOnline === true,
    };
  };

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
      const { created } = await runStep('createTrip(lifecycle)', () =>
        createTrip(passengerLifecycle, pickup, dropoff, {
          requiredSeats: 2,
          vehicleType: 'taxi_standard',
          officeId,
          lineId,
        })
      );
      assert(created.status === 'matched', 'Expected matched trip in lifecycle scenario');
      assert(created.tripId, 'Expected tripId in lifecycle scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));
      trackDoc(db.collection('payments').doc(`payment_${tripId}`));

      await runStep('acceptTripRequest(lifecycle)', () =>
        callCallable('acceptTripRequest', { tripId, devUserId: driverId })
      );
      await runStep('driverArrived(lifecycle)', () =>
        callCallable('driverArrived', { tripId, devUserId: driverId })
      );
      await runStep('startTrip(lifecycle)', () =>
        callCallable('startTrip', { tripId, devUserId: driverId })
      );
      await runStep('completeTrip(lifecycle)', () =>
        callCallable('completeTrip', { tripId, devUserId: driverId })
      );

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

      const { created } = await runStep('createTrip(reject)', () =>
        createTrip(passengerReject, pickup, dropoff, {
          requiredSeats: 1,
          officeId,
          lineId,
        })
      );
      assert(created.tripId, 'Expected tripId in reject scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));

      await runStep('rejectTripRequest(reject)', () =>
        callCallable('rejectTripRequest', { tripId, devUserId: driverId })
      );
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

      const { created } = await createTrip(passengerExpiry, pickup, dropoff, {
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

      const firstAttempt = await createTrip(passengerReconnect, pickup, dropoff, {
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

      const secondAttempt = await createTrip(passengerReconnect, pickup, dropoff, {
        requiredSeats: 1,
        officeId,
        lineId,
      });
      assert(secondAttempt.created.status === 'matched', 'Expected matched after reconnect');
      assert(secondAttempt.created.tripId, 'Expected tripId after reconnect');
      trackDoc(db.collection('trips').doc(secondAttempt.created.tripId));

      // Cleanup reconnect scenario trip so later scenarios start from a clean
      // passenger state and do not hit active-trip guard.
      await callCallable('passengerCancelTrip', {
        tripId: secondAttempt.created.tripId,
        devUserId: passengerReconnect,
      });

      ok('Reconnect scenario', secondAttempt.created.tripId);
    } catch (error) {
      fail('Reconnect scenario', error instanceof Error ? error.message : String(error));
    }

    // Scenario 5: Seat-only reservation decrements one seat and restores on cancel.
    try {
      await driverRef.set(
        {
          isOnline: true,
          isAvailable: true,
          status: 'online',
          fullTaxiReserved: false,
          fullTaxiReservedTripId: null,
          availableSeats: 4,
          seatCapacity: 4,
          currentTripId: null,
          lastLocation: new admin.firestore.GeoPoint(pickup.lat, pickup.lng),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const { created } = await createTrip(passengerSeat, pickup, dropoff, {
        bookingType: 'seat_only',
        requiredSeats: 1,
        officeId,
        lineId,
      });
      assert(created.status === 'matched', 'Expected matched in seat-only scenario');
      assert(created.tripId, 'Expected tripId in seat-only scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));

      await callCallable('acceptTripRequest', { tripId, devUserId: driverId });

      const acceptedTrip = await db.collection('trips').doc(tripId).get();
      const acceptedTripData = acceptedTrip.data() || {};
      const seatOnlyBookingType = String(acceptedTripData.bookingType ?? 'undefined');
      assert(acceptedTripData.status === 'accepted', 'Seat-only trip should be accepted');
      assert(
        seatOnlyBookingType === 'seat_only',
        `Seat-only bookingType mismatch (got: ${seatOnlyBookingType})`
      );
      assert(
        Number(acceptedTripData.reservedSeats) === 1,
        `Seat-only reservedSeats should equal 1, got ${acceptedTripData.reservedSeats}`
      );

      const driverAfterAccept = await getDriverSeatState();
      assert(driverAfterAccept.availableSeats === 3, 'Seat-only should decrement available seats to 3');
      assert(driverAfterAccept.isAvailable === true, 'Driver should remain available after seat-only accept');
      assert(driverAfterAccept.fullTaxiReserved === false, 'Seat-only should not set fullTaxiReserved');

      await callCallable('passengerCancelTrip', { tripId, devUserId: passengerSeat });
      const cancelledTrip = await db.collection('trips').doc(tripId).get();
      assert(
        cancelledTrip.data()?.status === 'cancelled_by_passenger',
        'Seat-only cancelled trip should become cancelled_by_passenger'
      );

      const driverAfterCancel = await getDriverSeatState();
      assert(driverAfterCancel.availableSeats === 4, 'Seat-only cancel should restore seats to 4');
      assert(driverAfterCancel.isAvailable === true, 'Driver should be available after seat-only cancel');
      ok('Seat-only reserve/restore scenario', tripId);
    } catch (error) {
      fail('Seat-only reserve/restore scenario', error instanceof Error ? error.message : String(error));
    }

    // Scenario 6: Full-taxi reservation blocks driver and restores on cancel.
    try {
      await driverRef.set(
        {
          isOnline: true,
          isAvailable: true,
          status: 'online',
          fullTaxiReserved: false,
          fullTaxiReservedTripId: null,
          availableSeats: 4,
          seatCapacity: 4,
          currentTripId: null,
          lastLocation: new admin.firestore.GeoPoint(pickup.lat, pickup.lng),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const { created } = await createTrip(passengerFullTaxi, pickup, dropoff, {
        bookingType: 'full_taxi',
        requiredSeats: 1,
        officeId,
        lineId,
      });
      assert(created.status === 'matched', 'Expected matched in full-taxi scenario');
      assert(created.tripId, 'Expected tripId in full-taxi scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));

      await callCallable('acceptTripRequest', { tripId, devUserId: driverId });

      const acceptedTrip = await db.collection('trips').doc(tripId).get();
      const acceptedTripData = acceptedTrip.data() || {};
      const fullTaxiBookingType = String(acceptedTripData.bookingType ?? 'undefined');
      assert(acceptedTripData.status === 'accepted', 'Full-taxi trip should be accepted');
      assert(
        fullTaxiBookingType === 'full_taxi',
        `Full-taxi bookingType mismatch (got: ${fullTaxiBookingType})`
      );
      assert(
        Number(acceptedTripData.reservedSeats) === 4,
        `Full-taxi reservedSeats should equal full capacity (4), got ${acceptedTripData.reservedSeats}`
      );

      const driverAfterAccept = await getDriverSeatState();
      assert(driverAfterAccept.availableSeats === 0, 'Full-taxi should drop available seats to 0');
      assert(driverAfterAccept.isAvailable === false, 'Driver should be unavailable after full-taxi accept');
      assert(driverAfterAccept.fullTaxiReserved === true, 'Driver should be fullTaxiReserved after full-taxi accept');
      assert(
        driverAfterAccept.fullTaxiReservedTripId === tripId,
        'fullTaxiReservedTripId should match accepted trip'
      );

      const unmatchedAttempt = await createTrip(passengerFullTaxiProbe, pickup, dropoff, {
        bookingType: 'seat_only',
        requiredSeats: 1,
        officeId,
        lineId,
      });
      assert(
        unmatchedAttempt.created.status === 'searching',
        'Driver should be hidden from matching while full-taxi reservation is active'
      );
      trackDoc(db.collection('tripRequests').doc(unmatchedAttempt.created.requestId));

      await callCallable('passengerCancelTrip', { tripId, devUserId: passengerFullTaxi });
      const cancelledTrip = await db.collection('trips').doc(tripId).get();
      assert(
        cancelledTrip.data()?.status === 'cancelled_by_passenger',
        'Full-taxi cancelled trip should become cancelled_by_passenger'
      );

      const driverAfterCancel = await getDriverSeatState();
      assert(driverAfterCancel.availableSeats === 4, 'Full-taxi cancel should restore seats to 4');
      assert(driverAfterCancel.fullTaxiReserved === false, 'Full-taxi cancel should clear fullTaxiReserved');
      assert(driverAfterCancel.isAvailable === true, 'Driver should be available after full-taxi cancel');
      ok('Full-taxi reserve/block/restore scenario', tripId);
    } catch (error) {
      fail(
        'Full-taxi reserve/block/restore scenario',
        error instanceof Error ? error.message : String(error)
      );
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
