/* eslint-disable no-console */
/**
 * QA E2E: the scheduled (cron) functions.
 *
 * THE GAP THIS CLOSES
 * expireDriverRequests, expireStaleTrips and aggregateOpsMetrics had NO test coverage
 * at all. The pubsub emulator was not configured, so the functions emulator skipped
 * them entirely - meaning the dispatch re-offer path inside expireDriverRequests, added
 * with the re-offer work, had never actually executed under a scheduled run. Its
 * behaviour was inferred from the reject-path twin that shares the same module.
 *
 * HOW THESE ARE INVOKED, AND WHY
 * The pubsub emulator IS now configured (firebase.json), and the three functions
 * register as pubsub functions rather than being skipped. But publishing to their
 * `firebase-schedule-<name>` topics does NOT dispatch them: firebase-tools 15.29.0
 * fails with "Unsupported trigger signature: http" for v2 onSchedule functions.
 *
 * So these tests call `.run()` on the compiled function - the documented handle that
 * firebase-functions exposes on an onSchedule export for exactly this purpose. That
 * runs the REAL shipped handler against the REAL emulator Firestore; what it does not
 * exercise is Cloud Scheduler's own delivery, which is Google's to get right and cannot
 * be tested locally regardless.
 *
 * Requires the emulator suite (auth, firestore, functions) to be running.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = `${emulatorHost}:8080`;
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${emulatorHost}:9099`;
}
process.env.GCLOUD_PROJECT = projectId;

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Load a compiled scheduled function and invoke its handler. */
function loadScheduled(relPath, exportName) {
  const full = path.join(__dirname, '..', 'dist', relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`build output missing: ${full} (run pnpm build:functions)`);
  }
  const mod = require(full);
  const fn = mod[exportName];
  if (typeof fn?.run !== 'function') {
    throw new Error(`${exportName} has no .run() handle`);
  }
  return () => fn.run({ scheduleTime: new Date().toISOString() });
}

async function main() {
  // The scheduled modules call initializeApp() on the DEFAULT app when they load,
  // so this harness must use its own NAMED app or the second init throws.
  const app = admin.initializeApp({ projectId }, `qa-scheduled-${Date.now()}`);
  const db = app.firestore();

  const suffix = Date.now();
  const cleanup = [];
  const track = (ref) => cleanup.push(ref);

  const runExpireDriverRequests = loadScheduled(
    'modules/trips/expireDriverRequests.scheduled.js',
    'expireDriverRequests'
  );
  const runExpireStaleTrips = loadScheduled(
    'modules/trips/expireStaleTrips.scheduled.js',
    'expireStaleTrips'
  );
  const runAggregateOpsMetrics = loadScheduled(
    'modules/monitoring/aggregateOpsMetrics.scheduled.js',
    'aggregateOpsMetrics'
  );

  const past = admin.firestore.Timestamp.fromMillis(Date.now() - 120_000);

  // ===========================================================================
  // 1. expireDriverRequests: an unanswered offer with NO other candidate must
  //    expire the offer and fail the trip.
  // ===========================================================================
  try {
    const driverId = `qa-sched-drv-${suffix}`;
    const tripId = `qa-sched-trip-noalt-${suffix}`;
    const tripRef = db.collection('trips').doc(tripId);
    const reqRef = db
      .collection('driverRequests')
      .doc(driverId)
      .collection('requests')
      .doc(tripId);
    const drvRef = db.collection('drivers').doc(driverId);
    track(tripRef);
    track(reqRef);
    track(drvRef);

    await drvRef.set({
      driverId,
      isOnline: true,
      isAvailable: false,
      currentTripId: tripId,
      seatCapacity: 4,
      availableSeats: 4,
      vehicleType: 'taxi_standard',
      driverType: 'licensed_line_owner',
      verificationStatus: 'approved',
      lineId: `LINE_QA_${suffix}`,
    });
    await tripRef.set({
      tripId,
      passengerId: `qa-sched-pax-${suffix}`,
      driverId,
      status: 'pending',
      // No candidateDriverIds => nothing to re-offer to.
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await reqRef.set({
      tripId,
      status: 'pending',
      expiresAt: past,
      createdAt: past,
    });

    await runExpireDriverRequests();

    const reqAfter = await reqRef.get();
    const tripAfter = await tripRef.get();
    assert(
      reqAfter.data()?.status === 'expired',
      `offer should be expired, got ${reqAfter.data()?.status}`
    );
    assert(
      tripAfter.data()?.status === 'no_driver_available',
      `trip should be no_driver_available, got ${tripAfter.data()?.status}`
    );
    pass('expireDriverRequests: expires a stale offer and fails the trip (no candidates)');
  } catch (error) {
    fail(
      'expireDriverRequests: expires a stale offer and fails the trip (no candidates)',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 2. expireDriverRequests + RE-OFFER. This is the path that had never run
  //    under a scheduled invocation: a timed-out offer with another eligible
  //    candidate must move to that candidate rather than failing the trip.
  // ===========================================================================
  try {
    const driverA = `qa-sched-drvA-${suffix}`;
    const driverB = `qa-sched-drvB-${suffix}`;
    const tripId = `qa-sched-trip-reoffer-${suffix}`;
    const lineId = `LINE_QA_${suffix}`;

    const refA = db.collection('drivers').doc(driverA);
    const refB = db.collection('drivers').doc(driverB);
    const tripRef = db.collection('trips').doc(tripId);
    const reqA = db.collection('driverRequests').doc(driverA).collection('requests').doc(tripId);
    const reqB = db.collection('driverRequests').doc(driverB).collection('requests').doc(tripId);
    [refA, refB, tripRef, reqA, reqB].forEach(track);

    const eligible = {
      isOnline: true,
      seatCapacity: 4,
      availableSeats: 4,
      vehicleType: 'taxi_standard',
      driverType: 'licensed_line_owner',
      verificationStatus: 'approved',
      lineId,
      lastLocation: new admin.firestore.GeoPoint(32.2211, 35.2544),
    };

    // A holds the offer; B is free and eligible.
    await refA.set({ driverId: driverA, ...eligible, isAvailable: false, currentTripId: tripId });
    await refB.set({ driverId: driverB, ...eligible, isAvailable: true, currentTripId: null });

    await tripRef.set({
      tripId,
      passengerId: `qa-sched-pax2-${suffix}`,
      driverId: driverA,
      status: 'pending',
      pickup: { lat: 32.2211, lng: 35.2544 },
      dropoff: { lat: 31.9038, lng: 35.2034 },
      estimatedPriceIls: 25,
      // The persisted ranking createTripRequest writes.
      candidateDriverIds: [driverA, driverB],
      dispatchAttempt: 1,
      triedDriverIds: [driverA],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await reqA.set({ tripId, status: 'pending', expiresAt: past, createdAt: past });

    await runExpireDriverRequests();

    const tripAfter = await tripRef.get();
    const tripData = tripAfter.data() ?? {};
    assert(
      tripData.status === 'pending',
      `trip should stay pending after re-offer, got ${tripData.status}`
    );
    assert(
      tripData.driverId === driverB,
      `trip should be re-offered to driver B, got ${tripData.driverId}`
    );

    const offerB = await reqB.get();
    assert(offerB.exists, 'driver B should have received an offer document');
    assert(
      offerB.data()?.status === 'pending',
      `driver B offer should be pending, got ${offerB.data()?.status}`
    );

    const aAfter = await reqA.get();
    assert(
      aAfter.data()?.status === 'expired',
      `driver A offer should be expired, got ${aAfter.data()?.status}`
    );

    pass('expireDriverRequests: RE-OFFERS a timed-out trip to the next candidate');
  } catch (error) {
    fail(
      'expireDriverRequests: RE-OFFERS a timed-out trip to the next candidate',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 3. expireStaleTrips: an OPEN tripRequest older than the search timeout must
  //    be expired with the no_driver_found reason.
  // ===========================================================================
  try {
    const requestId = `qa-sched-req-${suffix}`;
    const reqRef = db.collection('tripRequests').doc(requestId);
    track(reqRef);

    // TRIP_SEARCH_TIMEOUT_SECONDS is 120s; back-date well beyond it.
    await reqRef.set({
      requestId,
      passengerId: `qa-sched-pax3-${suffix}`,
      status: 'open',
      createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 600_000),
    });

    await runExpireStaleTrips();

    const after = await reqRef.get();
    const data = after.data() ?? {};
    assert(data.status === 'expired', `request should be expired, got ${data.status}`);
    assert(
      data.expirationReason === 'no_driver_found',
      `expected expirationReason no_driver_found, got ${data.expirationReason}`
    );
    pass('expireStaleTrips: expires an OPEN request past the search timeout');
  } catch (error) {
    fail(
      'expireStaleTrips: expires an OPEN request past the search timeout',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 4. expireStaleTrips: a driver who accepted but never arrived must be
  //    cancelled by the system and the driver freed.
  // ===========================================================================
  try {
    const driverId = `qa-sched-noshow-drv-${suffix}`;
    const tripId = `qa-sched-noshow-${suffix}`;
    const tripRef = db.collection('trips').doc(tripId);
    const drvRef = db.collection('drivers').doc(driverId);
    track(tripRef);
    track(drvRef);

    await drvRef.set({
      driverId,
      isOnline: true,
      isAvailable: false,
      currentTripId: tripId,
      seatCapacity: 4,
      availableSeats: 4,
    });
    // DRIVER_ARRIVAL_TIMEOUT_SECONDS is 300s; back-date beyond it.
    await tripRef.set({
      tripId,
      passengerId: `qa-sched-pax4-${suffix}`,
      driverId,
      status: 'accepted',
      acceptedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 900_000),
      createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 900_000),
    });

    await runExpireStaleTrips();

    const tripAfter = await tripRef.get();
    const drvAfter = await drvRef.get();
    assert(
      tripAfter.data()?.status === 'cancelled_by_system',
      `trip should be cancelled_by_system, got ${tripAfter.data()?.status}`
    );
    assert(
      tripAfter.data()?.cancellationReason === 'driver_no_show',
      `expected driver_no_show, got ${tripAfter.data()?.cancellationReason}`
    );
    assert(
      drvAfter.data()?.currentTripId === null,
      'driver should be released from the trip'
    );
    pass('expireStaleTrips: cancels a driver no-show and frees the driver');
  } catch (error) {
    fail(
      'expireStaleTrips: cancels a driver no-show and frees the driver',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 5. aggregateOpsMetrics: must write a metrics document reflecting live state.
  // ===========================================================================
  try {
    // Seed known live state, so the counters are checked against something real
    // rather than merely asserting that a document exists.
    const metricDriverOnline = `qa-metric-online-${suffix}`;
    const metricTripPending = `qa-metric-pending-${suffix}`;
    const onlineRef = db.collection('drivers').doc(metricDriverOnline);
    const pendingRef = db.collection('trips').doc(metricTripPending);
    track(onlineRef);
    track(pendingRef);

    await onlineRef.set({
      driverId: metricDriverOnline,
      isOnline: true,
      isAvailable: true,
      seatCapacity: 4,
      availableSeats: 4,
    });
    await pendingRef.set({
      tripId: metricTripPending,
      passengerId: `qa-metric-pax-${suffix}`,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await runAggregateOpsMetrics();

    // The function writes to a fixed document: opsMetrics/current.
    const snap = await db.collection('opsMetrics').doc('current').get();
    assert(snap.exists, 'aggregateOpsMetrics should write opsMetrics/current');
    const data = snap.data() ?? {};

    for (const key of ['generatedAt', 'windows', 'errors', 'drivers', 'trips']) {
      assert(data[key] !== undefined, `opsMetrics/current is missing "${key}"`);
    }

    assert(
      typeof data.drivers?.onlineCount === 'number' && data.drivers.onlineCount >= 1,
      `expected drivers.onlineCount >= 1 (we seeded one), got ${data.drivers?.onlineCount}`
    );
    assert(
      typeof data.trips?.pendingCount === 'number' && data.trips.pendingCount >= 1,
      `expected trips.pendingCount >= 1 (we seeded one), got ${data.trips?.pendingCount}`
    );
    assert(
      typeof data.trips?.activeCount === 'number',
      `expected a numeric trips.activeCount, got ${data.trips?.activeCount}`
    );

    pass(
      'aggregateOpsMetrics: writes opsMetrics/current with counters reflecting live state',
      `onlineCount=${data.drivers.onlineCount} pendingCount=${data.trips.pendingCount}`
    );
  } catch (error) {
    fail(
      'aggregateOpsMetrics: writes opsMetrics/current with counters reflecting live state',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 6. Idempotency: re-running the sweepers must not corrupt settled state.
  //    A cron that fires every minute WILL re-observe the same documents.
  // ===========================================================================
  try {
    await runExpireDriverRequests();
    await runExpireStaleTrips();
    pass('sweepers are safe to re-run over already-settled documents');
  } catch (error) {
    fail(
      'sweepers are safe to re-run over already-settled documents',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  for (const ref of cleanup.reverse()) {
    try {
      await ref.delete();
    } catch {
      // noop
    }
  }
  try {
    await app.delete();
  } catch {
    // noop
  }

  const passed = testResults.filter((t) => t.pass).length;
  const failed = testResults.filter((t) => !t.pass).length;
  console.log(
    `\n[QA] Scheduled functions E2E summary -> total: ${testResults.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Scheduled functions E2E FAILED', error);
  process.exit(1);
});
