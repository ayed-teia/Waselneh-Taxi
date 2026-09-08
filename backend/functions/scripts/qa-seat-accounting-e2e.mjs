/* eslint-disable no-console */
/**
 * QA E2E: seat accounting across EVERY path that releases a driver (R8).
 *
 * THE BUG THIS EXISTS FOR
 * Five code paths release a driver from a trip. Three of them (passengerCancelTrip,
 * driverCancelTrip, completeTrip) restore the seats the trip had reserved. Two did
 * not: managerForceCancelTrip and the driver-no-show branch of expireStaleTrips both
 * wrote `{ isAvailable: true, currentTripId: null }` and nothing else.
 *
 * WHY THAT MATTERS MORE THAN IT LOOKS
 *   - availableSeats stays decremented, so a 4-seat taxi force-cancelled off a
 *     2-seat booking advertises 2 seats forever. The drift ACCUMULATES: every
 *     force-cancel shaves seats off permanently until the driver shows 0 and stops
 *     being matched at all.
 *   - fullTaxiReserved stays true after a full-taxi force-cancel, which filters the
 *     driver out of matching entirely - silently unbookable until somebody edits
 *     Firestore by hand.
 *   - isAvailable was set to true unconditionally, ignoring whether the driver is
 *     even online.
 *
 * Each scenario below asserts the driver is returned to their PRE-TRIP seat state,
 * which is the property that actually matters operationally.
 *
 * Requires the emulator suite (auth, firestore, functions).
 */
import fs from 'node:fs';

import admin from 'firebase-admin';

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

async function callCallable(fnName, data) {
  const url = `http://${emulatorHost}:${functionsPort}/${projectId}/europe-west1/${fnName}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body?.error?.message || `${fnName} failed`);
  }
  return body.result;
}

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-seats-${Date.now()}`);
  const db = app.firestore();
  const suffix = Date.now();
  const cleanup = [];

  const officeId = `OFFICE_SEAT_${suffix}`;
  const SEAT_CAPACITY = 4;
  const pickup = { lat: 32.2211, lng: 35.2544 };
  const dropoff = { lat: 31.9038, lng: 35.2034 };

  await db.collection('offices').doc(officeId).set({ officeId, name: 'QA Seat Office' });
  cleanup.push(db.collection('offices').doc(officeId));

  /**
   * Each scenario gets its OWN line. Otherwise createTripRequest can match a driver
   * seeded by an earlier scenario and the trip lands on the wrong driver, which looks
   * like a product bug but is only test cross-talk.
   */
  async function seedLine(lineId) {
    await db.collection('lines').doc(lineId).set({
      lineId,
      officeId,
      name: 'QA Seat Line',
      minSeats: 1,
      maxSeats: 6,
    });
    cleanup.push(db.collection('lines').doc(lineId));
  }

  /** Seed an eligible, fully-available driver. */
  async function seedDriver(driverId, lineId) {
    await seedLine(lineId);
    const ref = db.collection('drivers').doc(driverId);
    await ref.set({
      driverId,
      driverType: 'licensed_line_owner',
      verificationStatus: 'approved',
      officeId,
      lineId,
      licenseId: `LIC_SEAT_${suffix}`,
      vehicleType: 'taxi_standard',
      seatCapacity: SEAT_CAPACITY,
      availableSeats: SEAT_CAPACITY,
      fullTaxiReserved: false,
      fullTaxiReservedTripId: null,
      isOnline: true,
      isAvailable: true,
      status: 'online',
      currentTripId: null,
      lastLocation: new admin.firestore.GeoPoint(pickup.lat, pickup.lng),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    cleanup.push(ref);
    cleanup.push(db.collection('driverLive').doc(driverId));
    return ref;
  }

  async function seatState(driverId) {
    const snap = await db.collection('drivers').doc(driverId).get();
    const d = snap.data() ?? {};
    return {
      availableSeats: typeof d.availableSeats === 'number' ? Math.round(d.availableSeats) : null,
      fullTaxiReserved: d.fullTaxiReserved === true,
      fullTaxiReservedTripId:
        typeof d.fullTaxiReservedTripId === 'string' ? d.fullTaxiReservedTripId : null,
      isAvailable: d.isAvailable === true,
      currentTripId: typeof d.currentTripId === 'string' ? d.currentTripId : null,
    };
  }

  /** Create a trip and have the driver accept it, so seats are actually reserved. */
  async function createAndAccept(passengerId, driverId, rideOptions) {
    const estimate = await callCallable('estimateTrip', {
      pickup,
      dropoff,
      devUserId: passengerId,
      rideOptions,
    });
    assert(estimate, 'estimateTrip returned nothing');

    const created = await callCallable('createTripRequest', {
      pickup,
      dropoff,
      estimate: {
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        priceIls: estimate.priceIls,
      },
      devUserId: passengerId,
      rideOptions,
    });
    assert(created?.tripId, `createTripRequest did not match a driver: ${JSON.stringify(created)}`);
    cleanup.push(db.collection('trips').doc(created.tripId));
    cleanup.push(
      db.collection('driverRequests').doc(driverId).collection('requests').doc(created.tripId)
    );

    await callCallable('acceptTripRequest', { tripId: created.tripId, devUserId: driverId });
    return created.tripId;
  }

  /** A manager who can call managerForceCancelTrip. */
  const managerId = `qa-seat-mgr-${suffix}`;
  const managerRoleRef = db.collection('managerRoles').doc(managerId);
  cleanup.push(managerRoleRef);
  await managerRoleRef.set({
    uid: managerId,
    role: 'admin',
    permissions: [],
    officeIds: [],
    lineIds: [],
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ===========================================================================
  // 0. Dispatch must reject an undersized taxi BEFORE creating an offer.
  //    A previous normalization bug forced requiredSeats to 1 for every
  //    seat-only request, so a passenger asking for 5 seats could be matched to a
  //    4-seat taxi and would only be rejected later when the driver accepted.
  // ===========================================================================
  try {
    const driverId = `qa-seat-capacity-${suffix}`;
    const lineId = `LINE_CAPACITY_${suffix}`;
    await seedDriver(driverId, lineId);

    const passengerId = `qa-seat-pax-capacity-${suffix}`;
    const rideOptions = {
      bookingType: 'seat_only',
      requiredSeats: SEAT_CAPACITY + 1,
      officeId,
      lineId,
    };
    const estimate = await callCallable('estimateTrip', {
      pickup,
      dropoff,
      devUserId: passengerId,
      rideOptions,
    });

    const created = await callCallable('createTripRequest', {
      pickup,
      dropoff,
      estimate: {
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        priceIls: estimate.priceIls,
      },
      devUserId: passengerId,
      rideOptions,
    });
    if (created?.requestId) cleanup.push(db.collection('tripRequests').doc(created.requestId));

    assert(
      created?.status === 'searching' && !created?.tripId,
      `${SEAT_CAPACITY + 1}-seat request must stay searching instead of being offered to a ${SEAT_CAPACITY}-seat taxi`
    );

    const requests = await db.collection('driverRequests').doc(driverId).collection('requests').get();
    assert(requests.empty, 'undersized driver must not receive a request document');
    pass('Dispatch rejects an undersized taxi before creating an offer');
  } catch (error) {
    fail(
      'Dispatch rejects an undersized taxi before creating an offer',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 1. FORCE-CANCEL a SEAT_ONLY trip: seats must come back.
  // ===========================================================================
  try {
    const driverId = `qa-seat-fc-seat-${suffix}`;
    const lineId = `LINE_FC_SEAT_${suffix}`;
    await seedDriver(driverId, lineId);
    const before = await seatState(driverId);

    const tripId = await createAndAccept(`qa-seat-pax-fc1-${suffix}`, driverId, {
      bookingType: 'seat_only',
      requestedSeats: 2,
      requiredSeats: 2,
      officeId,
      lineId,
    });

    const during = await seatState(driverId);
    assert(
      during.availableSeats === before.availableSeats - 2,
      `expected seats to drop by 2, got ${during.availableSeats} from ${before.availableSeats}`
    );

    await callCallable('managerForceCancelTrip', {
      tripId,
      reason: 'QA seat accounting',
      devUserId: managerId,
    });

    const after = await seatState(driverId);
    assert(
      after.availableSeats === before.availableSeats,
      `availableSeats must return to ${before.availableSeats}, got ${after.availableSeats}`
    );
    assert(after.currentTripId === null, 'currentTripId must be cleared');
    pass(
      'Force-cancel (seat_only) restores availableSeats',
      `${during.availableSeats} -> ${after.availableSeats}`
    );
  } catch (error) {
    fail(
      'Force-cancel (seat_only) restores availableSeats',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 2. FORCE-CANCEL a FULL_TAXI trip: the reservation must be released.
  //    If fullTaxiReserved stays true the driver is silently unbookable.
  // ===========================================================================
  try {
    const driverId = `qa-seat-fc-full-${suffix}`;
    const lineId = `LINE_FC_FULL_${suffix}`;
    await seedDriver(driverId, lineId);
    const before = await seatState(driverId);

    const tripId = await createAndAccept(`qa-seat-pax-fc2-${suffix}`, driverId, {
      bookingType: 'full_taxi',
      requestedSeats: 1,
      requiredSeats: 1,
      officeId,
      lineId,
    });

    const during = await seatState(driverId);
    assert(during.fullTaxiReserved === true, 'full-taxi accept should set fullTaxiReserved');

    await callCallable('managerForceCancelTrip', {
      tripId,
      reason: 'QA seat accounting',
      devUserId: managerId,
    });

    const after = await seatState(driverId);
    assert(
      after.fullTaxiReserved === false,
      'fullTaxiReserved must be cleared, or the driver is silently unbookable'
    );
    assert(
      after.fullTaxiReservedTripId === null,
      `fullTaxiReservedTripId must be cleared, got ${after.fullTaxiReservedTripId}`
    );
    assert(
      after.availableSeats === before.availableSeats,
      `availableSeats must return to ${before.availableSeats}, got ${after.availableSeats}`
    );
    pass('Force-cancel (full_taxi) releases the full-taxi reservation');
  } catch (error) {
    fail(
      'Force-cancel (full_taxi) releases the full-taxi reservation',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 3. DRIVER NO-SHOW (expireStaleTrips) on a SEAT_ONLY trip.
  //    Invoked via .run() - firebase-tools cannot dispatch v2 onSchedule via
  //    pubsub locally, so this calls the real compiled handler directly.
  // ===========================================================================
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);

  function loadExpireStaleTrips() {
    const p = path.join(__dirname, '..', 'dist', 'modules', 'trips', 'expireStaleTrips.scheduled.js');
    if (!fs.existsSync(p)) throw new Error(`build output missing: ${p}`);
    const mod = require(p);
    return () => mod.expireStaleTrips.run({ scheduleTime: new Date().toISOString() });
  }

  try {
    const runSweeper = loadExpireStaleTrips();
    const driverId = `qa-seat-ns-seat-${suffix}`;
    const lineId = `LINE_NS_SEAT_${suffix}`;
    await seedDriver(driverId, lineId);
    const before = await seatState(driverId);

    const tripId = await createAndAccept(`qa-seat-pax-ns1-${suffix}`, driverId, {
      bookingType: 'seat_only',
      requestedSeats: 2,
      requiredSeats: 2,
      officeId,
      lineId,
    });

    const during = await seatState(driverId);
    assert(
      during.availableSeats === before.availableSeats - 2,
      `expected seats to drop by 2, got ${during.availableSeats}`
    );

    // Back-date acceptedAt beyond DRIVER_ARRIVAL_TIMEOUT_SECONDS (300s).
    await db
      .collection('trips')
      .doc(tripId)
      .set(
        { acceptedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 900_000) },
        { merge: true }
      );

    await runSweeper();

    const tripAfter = await db.collection('trips').doc(tripId).get();
    assert(
      tripAfter.data()?.status === 'cancelled_by_system',
      `trip should be cancelled_by_system, got ${tripAfter.data()?.status}`
    );

    const after = await seatState(driverId);
    assert(
      after.availableSeats === before.availableSeats,
      `availableSeats must return to ${before.availableSeats}, got ${after.availableSeats}`
    );
    assert(after.currentTripId === null, 'currentTripId must be cleared');
    pass(
      'No-show sweeper (seat_only) restores availableSeats',
      `${during.availableSeats} -> ${after.availableSeats}`
    );
  } catch (error) {
    fail(
      'No-show sweeper (seat_only) restores availableSeats',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 4. DRIVER NO-SHOW on a FULL_TAXI trip.
  // ===========================================================================
  try {
    const runSweeper = loadExpireStaleTrips();
    const driverId = `qa-seat-ns-full-${suffix}`;
    const lineId = `LINE_NS_FULL_${suffix}`;
    await seedDriver(driverId, lineId);
    const before = await seatState(driverId);

    const tripId = await createAndAccept(`qa-seat-pax-ns2-${suffix}`, driverId, {
      bookingType: 'full_taxi',
      requestedSeats: 1,
      requiredSeats: 1,
      officeId,
      lineId,
    });

    const during = await seatState(driverId);
    assert(during.fullTaxiReserved === true, 'full-taxi accept should set fullTaxiReserved');

    await db
      .collection('trips')
      .doc(tripId)
      .set(
        { acceptedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 900_000) },
        { merge: true }
      );

    await runSweeper();

    const after = await seatState(driverId);
    assert(
      after.fullTaxiReserved === false,
      'fullTaxiReserved must be cleared after a no-show, or the driver is silently unbookable'
    );
    assert(
      after.availableSeats === before.availableSeats,
      `availableSeats must return to ${before.availableSeats}, got ${after.availableSeats}`
    );
    pass('No-show sweeper (full_taxi) releases the full-taxi reservation');
  } catch (error) {
    fail(
      'No-show sweeper (full_taxi) releases the full-taxi reservation',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 5. An OFFLINE driver must not be marked available by a release.
  //    The old code set isAvailable: true unconditionally.
  // ===========================================================================
  try {
    const driverId = `qa-seat-offline-${suffix}`;
    const lineId = `LINE_OFFLINE_${suffix}`;
    await seedDriver(driverId, lineId);

    const tripId = await createAndAccept(`qa-seat-pax-off-${suffix}`, driverId, {
      bookingType: 'seat_only',
      requestedSeats: 1,
      requiredSeats: 1,
      officeId,
      lineId,
    });

    // The driver goes offline while holding the trip.
    await db
      .collection('drivers')
      .doc(driverId)
      .set({ isOnline: false, status: 'offline' }, { merge: true });

    await callCallable('managerForceCancelTrip', {
      tripId,
      reason: 'QA offline check',
      devUserId: managerId,
    });

    const after = await seatState(driverId);
    assert(
      after.isAvailable === false,
      'an OFFLINE driver must not be marked available by a force-cancel'
    );
    pass('Force-cancel does not mark an OFFLINE driver as available');
  } catch (error) {
    fail(
      'Force-cancel does not mark an OFFLINE driver as available',
      error instanceof Error ? error.message : String(error)
    );
  }

  // --- cleanup ---------------------------------------------------------------
  for (const ref of cleanup.reverse()) {
    await ref.delete().catch(() => undefined);
  }
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[QA] Seat accounting E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Seat accounting E2E FAILED', error);
  process.exit(1);
});
