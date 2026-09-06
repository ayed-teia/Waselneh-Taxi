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
  // A second driver, for the dispatch re-offer scenarios.
  const secondDriverId = `qa-driver-2-${suffix}`;
  const passengerLifecycle = `qa-passenger-lifecycle-${suffix}`;
  const passengerReject = `qa-passenger-reject-${suffix}`;
  const passengerExpiry = `qa-passenger-expiry-${suffix}`;
  const passengerReconnect = `qa-passenger-reconnect-${suffix}`;
  const passengerSeat = `qa-passenger-seat-${suffix}`;
  const passengerFullTaxi = `qa-passenger-full-${suffix}`;
  const passengerFullTaxiProbe = `qa-passenger-full-probe-${suffix}`;
  const passengerReofferReject = `qa-passenger-reoffer-${suffix}`;
  const passengerExhaust = `qa-passenger-exhaust-${suffix}`;
  const passengerNoRepeat = `qa-passenger-norepeat-${suffix}`;
  const pickup = { lat: 32.2211, lng: 35.2544 };
  const dropoff = { lat: 31.9038, lng: 35.2034 };
  const lineId = `LINE_QA_${suffix}`;
  const officeId = `OFFICE_QA_${suffix}`;
  const driverRef = db.collection('drivers').doc(driverId);
  const secondDriverRef = db.collection('drivers').doc(secondDriverId);

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
    trackDoc(secondDriverRef);
    trackCollection(db.collection('driverRequests').doc(secondDriverId).collection('requests'));
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
      // Only ONE driver is seeded here, so after the rejection the candidate list is
      // genuinely exhausted and no_driver_available is the correct outcome. The
      // multi-driver re-offer behaviour is covered by the two scenarios below.
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

      // =========================================================================
    // Scenario 7: DISPATCH RELIABILITY - a rejection re-offers to the next driver.
    //
    // Before this change a single rejection killed the trip outright, even when
    // other eligible drivers were online. Two drivers are seeded here, the nearer
    // one rejects, and the trip must be handed to the second rather than dying.
    // =========================================================================
    try {
      // The primary driver sits exactly on the pickup, so it is always ranked first.
      await driverRef.set(
        {
          isOnline: true,
          isAvailable: true,
          status: 'online',
          currentTripId: null,
          lastLocation: new admin.firestore.GeoPoint(pickup.lat, pickup.lng),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // A second, slightly further driver: same line/office so it passes scope,
      // offset so the distance ranking is deterministic (driver 1 first).
      await secondDriverRef.set(
        {
          driverId: secondDriverId,
          driverType: 'licensed_line_owner',
          verificationStatus: 'approved',
          officeId,
          lineId,
          licenseId: `LIC_QA_2_${suffix}`,
          vehicleType: 'taxi_standard',
          seatCapacity: 4,
          isOnline: true,
          isAvailable: true,
          status: 'online',
          currentTripId: null,
          lastLocation: new admin.firestore.GeoPoint(pickup.lat + 0.01, pickup.lng + 0.01),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const { created } = await runStep('createTrip(reoffer-reject)', () =>
        createTrip(passengerReofferReject, pickup, dropoff, {
          requiredSeats: 1,
          officeId,
          lineId,
        })
      );
      assert(created.tripId, 'Expected tripId in re-offer reject scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));

      const beforeTrip = await db.collection('trips').doc(tripId).get();
      const firstDriverId = beforeTrip.data()?.driverId;
      assert(firstDriverId === driverId, `Expected the nearest driver to be offered first, got ${firstDriverId}`);
      const candidates = beforeTrip.data()?.candidateDriverIds;
      assert(
        Array.isArray(candidates) && candidates.length >= 2,
        `Expected a persisted candidate list of >= 2, got ${JSON.stringify(candidates)}`
      );

      await runStep('rejectTripRequest(reoffer)', () =>
        callCallable('rejectTripRequest', { tripId, devUserId: driverId })
      );

      const afterTrip = await db.collection('trips').doc(tripId).get();
      const afterData = afterTrip.data() ?? {};
      assert(
        afterData.status === 'pending',
        `Trip should stay pending after re-offer, got ${afterData.status}`
      );
      assert(
        afterData.driverId === secondDriverId,
        `Trip should be re-offered to the second driver, got ${afterData.driverId}`
      );

      // The second driver must actually have a pending offer to act on.
      const secondOffer = await db
        .collection('driverRequests')
        .doc(secondDriverId)
        .collection('requests')
        .doc(tripId)
        .get();
      assert(secondOffer.exists, 'Second driver should have received a request document');
      assert(
        secondOffer.data()?.status === 'pending',
        `Second driver offer should be pending, got ${secondOffer.data()?.status}`
      );

      // And the second driver can complete the accept flow normally.
      await runStep('acceptTripRequest(reoffer)', () =>
        callCallable('acceptTripRequest', { tripId, devUserId: secondDriverId })
      );
      const acceptedTrip = await db.collection('trips').doc(tripId).get();
      assert(
        acceptedTrip.data()?.status === 'accepted',
        `Second driver should be able to accept, got ${acceptedTrip.data()?.status}`
      );

      ok('Re-offer on reject scenario', tripId);
    } catch (error) {
      fail('Re-offer on reject scenario', error instanceof Error ? error.message : String(error));
    }

    // =========================================================================
    // Scenario 8: DISPATCH RELIABILITY - candidates exhausted ends cleanly.
    //
    // The re-offer must be BOUNDED. With two drivers who both reject, the trip
    // must end at no_driver_available rather than looping.
    // =========================================================================
    try {
      for (const [ref, id, lat, lng] of [
        [driverRef, driverId, pickup.lat, pickup.lng],
        [secondDriverRef, secondDriverId, pickup.lat + 0.01, pickup.lng + 0.01],
      ]) {
        await ref.set(
          {
            isOnline: true,
            isAvailable: true,
            status: 'online',
            currentTripId: null,
            availableSeats: 4,
            lastLocation: new admin.firestore.GeoPoint(lat, lng),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      const { created } = await runStep('createTrip(exhaust)', () =>
        createTrip(passengerExhaust, pickup, dropoff, {
          requiredSeats: 1,
          officeId,
          lineId,
        })
      );
      assert(created.tripId, 'Expected tripId in exhaustion scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));

      // First driver rejects -> re-offered to the second.
      await runStep('rejectTripRequest(exhaust-1)', () =>
        callCallable('rejectTripRequest', { tripId, devUserId: driverId })
      );
      const mid = await db.collection('trips').doc(tripId).get();
      assert(
        mid.data()?.driverId === secondDriverId,
        `Expected re-offer to the second driver, got ${mid.data()?.driverId}`
      );

      // Second driver rejects too -> no candidates left.
      await runStep('rejectTripRequest(exhaust-2)', () =>
        callCallable('rejectTripRequest', { tripId, devUserId: secondDriverId })
      );
      const final = await db.collection('trips').doc(tripId).get();
      assert(
        final.data()?.status === 'no_driver_available',
        `Trip should end at no_driver_available once candidates are exhausted, got ${final.data()?.status}`
      );

      ok('Re-offer exhaustion scenario', tripId);
    } catch (error) {
      fail('Re-offer exhaustion scenario', error instanceof Error ? error.message : String(error));
    }

    // =========================================================================
    // Scenario 9: DISPATCH RELIABILITY - the driver who already rejected must not
    // be offered the same trip again.
    //
    // Without this, a re-offer loop could hand the trip straight back to the
    // driver who just declined it, which is worse than the original dead-end:
    // it wastes the passenger's time AND annoys the driver.
    // =========================================================================
    try {
      for (const [ref, id, lat, lng] of [
        [driverRef, driverId, pickup.lat, pickup.lng],
        [secondDriverRef, secondDriverId, pickup.lat + 0.01, pickup.lng + 0.01],
      ]) {
        await ref.set(
          {
            driverId: id,
            isOnline: true,
            isAvailable: true,
            status: 'online',
            currentTripId: null,
            availableSeats: 4,
            lastLocation: new admin.firestore.GeoPoint(lat, lng),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      const { created } = await runStep('createTrip(no-repeat)', () =>
        createTrip(passengerNoRepeat, pickup, dropoff, {
          requiredSeats: 1,
          officeId,
          lineId,
        })
      );
      assert(created.tripId, 'Expected tripId in no-repeat scenario');
      const tripId = created.tripId;
      trackDoc(db.collection('trips').doc(tripId));

      // Driver 1 rejects -> should go to driver 2.
      await runStep('rejectTripRequest(no-repeat-1)', () =>
        callCallable('rejectTripRequest', { tripId, devUserId: driverId })
      );
      const afterFirst = await db.collection('trips').doc(tripId).get();
      assert(
        afterFirst.data()?.driverId === secondDriverId,
        `Expected re-offer to driver 2, got ${afterFirst.data()?.driverId}`
      );
      const tried = afterFirst.data()?.triedDriverIds;
      assert(
        Array.isArray(tried) && tried.includes(driverId),
        `Expected driver 1 recorded in triedDriverIds, got ${JSON.stringify(tried)}`
      );

      // Driver 2 rejects too. Driver 1 is idle and eligible again, but must NOT
      // be re-offered the trip they already declined.
      await runStep('rejectTripRequest(no-repeat-2)', () =>
        callCallable('rejectTripRequest', { tripId, devUserId: secondDriverId })
      );
      const afterSecond = await db.collection('trips').doc(tripId).get();
      const finalData = afterSecond.data() ?? {};
      assert(
        finalData.status === 'no_driver_available',
        `Trip should end at no_driver_available, got ${finalData.status}`
      );
      assert(
        finalData.driverId !== driverId || finalData.status === 'no_driver_available',
        'Trip must not be re-offered to the driver who already rejected it'
      );

      ok('Re-offer never returns to a driver who rejected', tripId);
    } catch (error) {
      fail(
        'Re-offer never returns to a driver who rejected',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      // The remaining scenarios assume a SINGLE matchable driver, so retire the
      // second one. Without this it silently absorbs trips that those scenarios
      // expect to go unmatched.
      await secondDriverRef.set(
        {
          isOnline: false,
          isAvailable: false,
          status: 'offline',
          currentTripId: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

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
