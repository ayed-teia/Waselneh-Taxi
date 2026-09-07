/* eslint-disable no-console */
/**
 * QA E2E: the driver search radius cap (R5).
 *
 * THE BUG THIS EXISTS FOR
 * createTripRequest ranked every eligible driver by Haversine distance and offered to
 * the nearest, with NO ceiling. Two radius constants existed and neither was ever
 * referenced by matching code:
 *
 *   PILOT_LIMITS.MAX_DRIVER_SEARCH_RADIUS_KM = 15   (shared, hardcoded)
 *   MAX_SEARCH_RADIUS_METERS = 5000                 (backend env, set in .env)
 *
 * They also disagreed with each other. So a driver 80 km away was a perfectly valid
 * match whenever nobody closer was online - the passenger waits an hour for a car
 * that should never have been offered the trip.
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
  if (!response.ok || body.error) throw new Error(body?.error?.message || `${fnName} failed`);
  return body.result;
}

/**
 * Offset a latitude by roughly N kilometres. 1 degree of latitude is ~111 km
 * everywhere, so this is accurate enough to place a driver decisively inside or
 * outside a 5 km cap without depending on longitude convergence.
 */
function latOffsetKm(lat, km) {
  return lat + km / 111;
}

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-radius-${Date.now()}`);
  const db = app.firestore();
  const suffix = Date.now();
  const cleanup = [];

  const officeId = `OFFICE_RAD_${suffix}`;
  const pickup = { lat: 32.2211, lng: 35.2544 };
  const dropoff = { lat: 31.9038, lng: 35.2034 };

  await db.collection('offices').doc(officeId).set({ officeId, name: 'QA Radius Office' });
  cleanup.push(db.collection('offices').doc(officeId));

  async function seedLine(lineId) {
    await db
      .collection('lines')
      .doc(lineId)
      .set({ lineId, officeId, name: 'QA Radius Line', minSeats: 1, maxSeats: 6 });
    cleanup.push(db.collection('lines').doc(lineId));
  }

  async function seedDriver(driverId, lineId, lat, lng) {
    const ref = db.collection('drivers').doc(driverId);
    await ref.set({
      driverId,
      driverType: 'licensed_line_owner',
      verificationStatus: 'approved',
      officeId,
      lineId,
      licenseId: `LIC_RAD_${suffix}`,
      vehicleType: 'taxi_standard',
      seatCapacity: 4,
      availableSeats: 4,
      fullTaxiReserved: false,
      isOnline: true,
      isAvailable: true,
      status: 'online',
      currentTripId: null,
      lastLocation: new admin.firestore.GeoPoint(lat, lng),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    cleanup.push(ref);
    cleanup.push(db.collection('driverLive').doc(driverId));
    return ref;
  }

  async function tryCreateTrip(passengerId, lineId) {
    const rideOptions = {
      bookingType: 'seat_only',
      requestedSeats: 1,
      requiredSeats: 1,
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
    if (created?.tripId) cleanup.push(db.collection('trips').doc(created.tripId));
    return created;
  }

  // ===========================================================================
  // 1. A driver FAR beyond the cap must NOT be offered the trip.
  //    50 km out, with the cap at 5 km.
  // ===========================================================================
  try {
    const lineId = `LINE_RAD_FAR_${suffix}`;
    const driverId = `qa-rad-far-${suffix}`;
    await seedLine(lineId);
    await seedDriver(driverId, lineId, latOffsetKm(pickup.lat, 50), pickup.lng);

    const created = await tryCreateTrip(`qa-rad-pax-far-${suffix}`, lineId);

    assert(
      !created?.tripId,
      `a driver 50km away must NOT be matched, but a trip was created (${created?.tripId})`
    );
    assert(
      created?.status === 'searching',
      `expected the no-driver-available path ('searching'), got '${created?.status}'`
    );
    pass('A driver beyond the radius cap is NOT offered the trip', `status=${created?.status}`);
  } catch (error) {
    fail(
      'A driver beyond the radius cap is NOT offered the trip',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 2. POSITIVE CONTROL: a driver comfortably INSIDE the cap is still matched.
  //    Without this, the cap could be "working" by rejecting everyone.
  // ===========================================================================
  try {
    const lineId = `LINE_RAD_NEAR_${suffix}`;
    const driverId = `qa-rad-near-${suffix}`;
    await seedLine(lineId);
    await seedDriver(driverId, lineId, latOffsetKm(pickup.lat, 1), pickup.lng);

    const created = await tryCreateTrip(`qa-rad-pax-near-${suffix}`, lineId);

    assert(created?.tripId, `a driver 1km away must still be matched, got ${JSON.stringify(created)}`);
    const trip = await db.collection('trips').doc(created.tripId).get();
    assert(
      trip.data()?.driverId === driverId,
      `expected the near driver to be assigned, got ${trip.data()?.driverId}`
    );
    pass('A driver within the radius cap is still matched (positive control)');
  } catch (error) {
    fail(
      'A driver within the radius cap is still matched (positive control)',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 3. With BOTH a near and a far driver, the near one is chosen and the far one
  //    is excluded outright - not merely ranked second.
  // ===========================================================================
  try {
    const lineId = `LINE_RAD_BOTH_${suffix}`;
    const nearId = `qa-rad-both-near-${suffix}`;
    const farId = `qa-rad-both-far-${suffix}`;
    await seedLine(lineId);
    await seedDriver(farId, lineId, latOffsetKm(pickup.lat, 40), pickup.lng);
    await seedDriver(nearId, lineId, latOffsetKm(pickup.lat, 2), pickup.lng);

    const created = await tryCreateTrip(`qa-rad-pax-both-${suffix}`, lineId);
    assert(created?.tripId, 'expected a match when a near driver exists');

    const trip = await db.collection('trips').doc(created.tripId).get();
    const data = trip.data() ?? {};
    assert(data.driverId === nearId, `expected the near driver, got ${data.driverId}`);

    // The far driver must not even be a fallback candidate: if the near driver
    // rejects, the trip should NOT be re-offered 40km away.
    const candidates = Array.isArray(data.candidateDriverIds) ? data.candidateDriverIds : [];
    assert(
      !candidates.includes(farId),
      `the far driver must be excluded from the candidate list entirely, got ${JSON.stringify(candidates)}`
    );
    pass('A far driver is excluded from the candidate list, not just out-ranked');
  } catch (error) {
    fail(
      'A far driver is excluded from the candidate list, not just out-ranked',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 4. "No driver within range" degrades to the existing no-driver path, and does
  //    NOT crash or leave a half-created trip.
  // ===========================================================================
  try {
    const lineId = `LINE_RAD_NONE_${suffix}`;
    const driverId = `qa-rad-none-${suffix}`;
    await seedLine(lineId);
    await seedDriver(driverId, lineId, latOffsetKm(pickup.lat, 90), pickup.lng);

    const created = await tryCreateTrip(`qa-rad-pax-none-${suffix}`, lineId);

    assert(created?.requestId, 'the tripRequest should still be created and left open');
    assert(created?.status === 'searching', `expected 'searching', got '${created?.status}'`);
    assert(!created?.tripId, 'no trip document should be created when nobody is in range');

    // The request stays OPEN so the existing sweeper can expire it normally.
    const reqSnap = await db.collection('tripRequests').doc(created.requestId).get();
    cleanup.push(db.collection('tripRequests').doc(created.requestId));
    assert(
      reqSnap.data()?.status === 'open',
      `the request should remain open for the sweeper, got ${reqSnap.data()?.status}`
    );
    pass('No driver in range degrades to the existing no-driver path (no crash)');
  } catch (error) {
    fail(
      'No driver in range degrades to the existing no-driver path (no crash)',
      error instanceof Error ? error.message : String(error)
    );
  }

  // --- cleanup ---------------------------------------------------------------
  for (const ref of cleanup.reverse()) await ref.delete().catch(() => undefined);
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[QA] Search radius E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Search radius E2E FAILED', error);
  process.exit(1);
});
