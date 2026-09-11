/* eslint-disable no-console */
/**
 * QA E2E: benefit restoration across every cancellation actor.
 *
 * WHAT THIS EXISTS TO PROVE
 *
 * Benefits are consumed at REQUEST time (promo usage counters + redeemed loyalty
 * points). Before this work they were returned only when an UNMATCHED request was
 * abandoned - `cancelTripRequest` and the search-expiry sweeper.
 *
 * The four actors that cancel a MATCHED trip restored nothing:
 *   passengerCancelTrip, driverCancelTrip, managerForceCancelTrip,
 *   and the driver-no-show branch of expireStaleTrips.
 *
 * So a passenger who redeemed a promo and points, got matched, then cancelled
 * before the trip started silently lost both. This suite proves each actor now
 * gives them back, and - just as important - that nothing is EVER returned twice.
 *
 * Requires the emulator suite (auth, firestore, functions).
 */
import fs from 'node:fs';

import admin from 'firebase-admin';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);
const REGION = 'europe-west1';

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

async function callFn(name, data) {
  const response = await fetch(
    `http://${emulatorHost}:${functionsPort}/${projectId}/${REGION}/${name}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(body?.error?.message || `HTTP ${response.status}`);
  }
  return body.result;
}

const PICKUP = { lat: 32.2211, lng: 35.2544 };
const DROPOFF = { lat: 31.9038, lng: 35.2034 };

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-cancel-${Date.now()}`);
  const db = app.firestore();
  const suffix = Date.now();
  const cleanup = [];

  const OFFICE = `CAN_OFFICE_${suffix}`;
  const LINE = `CAN_LINE_${suffix}`;
  const PROMO = `CANCELQA${suffix}`.slice(0, 24).toUpperCase();
  const MANAGER = `can-manager-${suffix}`;

  // --- fixtures --------------------------------------------------------------
  await db.collection('offices').doc(OFFICE).set({ officeId: OFFICE, name: 'Cancel QA', isActive: true });
  await db.collection('lines').doc(LINE).set({
    lineId: LINE, officeId: OFFICE, name: 'Cancel QA', minSeats: 1, maxSeats: 6, isActive: true,
  });
  const managerRoleRef = db.collection('managerRoles').doc(MANAGER);
  await managerRoleRef.set({
    uid: MANAGER, role: 'admin', permissions: [], officeIds: [], lineIds: [],
    isActive: true, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  cleanup.push(
    db.collection('offices').doc(OFFICE),
    db.collection('lines').doc(LINE),
    managerRoleRef
  );

  const promoRef = db.collection('promoCodes').doc(PROMO);
  cleanup.push(promoRef);

  /** Reset the promo to a known, unused state before each scenario. */
  async function resetPromo() {
    await promoRef.set({
      code: PROMO, nameAr: 'اختبار', nameEn: 'Cancel QA',
      discountType: 'fixed', discountValue: 5, minFareIls: 0,
      usageLimit: 100, perPassengerLimit: 10, usageCount: 0, active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async function seedDriver(driverId) {
    const ref = db.collection('drivers').doc(driverId);
    await ref.set({
      driverId, driverType: 'licensed_line_owner', verificationStatus: 'approved',
      officeId: OFFICE, lineId: LINE, vehicleType: 'taxi_standard',
      seatCapacity: 4, availableSeats: 4, fullTaxiReserved: false,
      isOnline: true, isAvailable: true, status: 'online', currentTripId: null,
      lastLocation: new admin.firestore.GeoPoint(PICKUP.lat, PICKUP.lng),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    cleanup.push(ref, db.collection('driverLive').doc(driverId));
    return ref;
  }

  /** Give the passenger points, then book a matched trip spending promo + points. */
  async function bookMatchedTrip(passengerId, driverId, startingPoints = 100) {
    const passengerRef = db.collection('users').doc(passengerId);
    await passengerRef.set(
      { uid: passengerId, loyaltyPoints: startingPoints, loyaltyUpdatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    cleanup.push(passengerRef);
    cleanup.push(db.collection('promoRedemptions').doc(`${PROMO}_${passengerId}`));

    const rideOptions = {
      bookingType: 'seat_only', requestedSeats: 1, requiredSeats: 1, officeId: OFFICE, lineId: LINE,
    };
    const estimate = await callFn('estimateTrip', {
      pickup: PICKUP, dropoff: DROPOFF, devUserId: passengerId, rideOptions,
    });
    const created = await callFn('createTripRequest', {
      pickup: PICKUP, dropoff: DROPOFF, devUserId: passengerId, rideOptions,
      promoCode: PROMO,
      loyaltyPointsToRedeem: 50,
      estimate: {
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        priceIls: estimate.priceIls,
      },
    });
    assert(created?.tripId, `no driver matched: ${JSON.stringify(created)}`);
    cleanup.push(db.collection('trips').doc(created.tripId));
    if (created.requestId) cleanup.push(db.collection('tripRequests').doc(created.requestId));
    return created;
  }

  const pointsOf = async (uid) =>
    Number((await db.collection('users').doc(uid).get()).data()?.loyaltyPoints ?? 0);
  const promoUsage = async () => Number((await promoRef.get()).data()?.usageCount ?? 0);
  const tripOf = async (tripId) => (await db.collection('trips').doc(tripId).get()).data() ?? {};

  // ===========================================================================
  // 1-3. Each interactive actor restores promo usage AND loyalty points.
  // ===========================================================================
  const actors = [
    { label: 'passengerCancelTrip', fn: 'passengerCancelTrip', caller: 'passenger', reason: 'passenger_cancelled' },
    { label: 'driverCancelTrip', fn: 'driverCancelTrip', caller: 'driver', reason: 'driver_cancelled' },
    { label: 'managerForceCancelTrip', fn: 'managerForceCancelTrip', caller: 'manager', reason: 'manager_cancelled' },
  ];

  for (const actor of actors) {
    try {
      await resetPromo();
      const passengerId = `can-pax-${actor.caller}-${suffix}`;
      const driverId = `can-drv-${actor.caller}-${suffix}`;
      await seedDriver(driverId);

      const created = await bookMatchedTrip(passengerId, driverId);
      const spentPoints = await pointsOf(passengerId);
      const spentUsage = await promoUsage();
      assert(spentPoints < 100, `points were not redeemed (still ${spentPoints})`);
      assert(spentUsage === 1, `promo usage not consumed (${spentUsage})`);

      const devUserId =
        actor.caller === 'passenger' ? passengerId : actor.caller === 'driver' ? driverId : MANAGER;
      await callFn(actor.fn, { tripId: created.tripId, devUserId, reason: 'qa' });

      const restoredPoints = await pointsOf(passengerId);
      const restoredUsage = await promoUsage();
      const trip = await tripOf(created.tripId);

      assert(restoredPoints === 100, `points not restored: ${restoredPoints} (expected 100)`);
      assert(restoredUsage === 0, `promo usage not released: ${restoredUsage} (expected 0)`);
      assert(trip.benefitsRestoredAt, 'benefitsRestoredAt sentinel not written on the trip');
      assert(
        trip.benefitsRestoreReason === actor.reason,
        `reason recorded as ${trip.benefitsRestoreReason}, expected ${actor.reason}`
      );
      pass(`${actor.label} restores promo usage and loyalty points`);
    } catch (error) {
      fail(`${actor.label} restores promo usage and loyalty points`, error.message);
    }
  }

  // ===========================================================================
  // 4. A SECOND cancellation attempt never refunds twice.
  // ===========================================================================
  try {
    await resetPromo();
    const passengerId = `can-pax-double-${suffix}`;
    const driverId = `can-drv-double-${suffix}`;
    await seedDriver(driverId);
    const created = await bookMatchedTrip(passengerId, driverId);

    await callFn('passengerCancelTrip', { tripId: created.tripId, devUserId: passengerId });
    const afterFirst = await pointsOf(passengerId);
    const usageAfterFirst = await promoUsage();

    // The trip is already cancelled so this is rejected - the point is that the
    // balances do not move even if an actor retries.
    await callFn('passengerCancelTrip', { tripId: created.tripId, devUserId: passengerId }).catch(
      () => undefined
    );
    await callFn('managerForceCancelTrip', {
      tripId: created.tripId, devUserId: MANAGER, reason: 'qa-double',
    }).catch(() => undefined);

    const afterSecond = await pointsOf(passengerId);
    const usageAfterSecond = await promoUsage();
    assert(afterSecond === afterFirst, `points moved on retry: ${afterFirst} -> ${afterSecond}`);
    assert(
      usageAfterSecond === usageAfterFirst,
      `promo usage moved on retry: ${usageAfterFirst} -> ${usageAfterSecond}`
    );
    assert(usageAfterSecond === 0, `promo usage should be 0, got ${usageAfterSecond}`);

    const ledger = await db
      .collection('users').doc(passengerId)
      .collection('loyaltyLedger')
      .where('type', '==', 'trip_discount_restored')
      .get();
    assert(ledger.size === 1, `expected exactly 1 restoration ledger entry, found ${ledger.size}`);
    pass('A repeated cancellation never refunds twice', '1 ledger entry');
  } catch (error) {
    fail('A repeated cancellation never refunds twice', error.message);
  }

  // ===========================================================================
  // 5. A trip carries the link back to its originating request.
  // ===========================================================================
  try {
    await resetPromo();
    const passengerId = `can-pax-link-${suffix}`;
    const driverId = `can-drv-link-${suffix}`;
    await seedDriver(driverId);
    const created = await bookMatchedTrip(passengerId, driverId);
    const trip = await tripOf(created.tripId);
    assert(
      trip.requestId === created.requestId,
      `trip.requestId is ${trip.requestId}, expected ${created.requestId}`
    );
    await callFn('passengerCancelTrip', { tripId: created.tripId, devUserId: passengerId });
    pass('A matched trip links back to its originating tripRequest');
  } catch (error) {
    fail('A matched trip links back to its originating tripRequest', error.message);
  }

  // ===========================================================================
  // 6. A trip with NO benefits still records the sentinel, so a later actor can
  //    tell "already handled" from "never handled".
  // ===========================================================================
  try {
    const passengerId = `can-pax-nobenefit-${suffix}`;
    const driverId = `can-drv-nobenefit-${suffix}`;
    await seedDriver(driverId);
    const passengerRef = db.collection('users').doc(passengerId);
    await passengerRef.set({ uid: passengerId, loyaltyPoints: 0 }, { merge: true });
    cleanup.push(passengerRef);

    const rideOptions = {
      bookingType: 'seat_only', requestedSeats: 1, requiredSeats: 1, officeId: OFFICE, lineId: LINE,
    };
    const estimate = await callFn('estimateTrip', {
      pickup: PICKUP, dropoff: DROPOFF, devUserId: passengerId, rideOptions,
    });
    const created = await callFn('createTripRequest', {
      pickup: PICKUP, dropoff: DROPOFF, devUserId: passengerId, rideOptions,
      estimate: {
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        priceIls: estimate.priceIls,
      },
    });
    assert(created?.tripId, 'no driver matched for the no-benefit case');
    cleanup.push(db.collection('trips').doc(created.tripId));
    if (created.requestId) cleanup.push(db.collection('tripRequests').doc(created.requestId));

    await callFn('passengerCancelTrip', { tripId: created.tripId, devUserId: passengerId });
    const trip = await tripOf(created.tripId);
    assert(trip.benefitsRestoredAt, 'sentinel missing on a trip with no benefits');
    assert(
      Number((await passengerRef.get()).data()?.loyaltyPoints ?? 0) === 0,
      'points were invented for a passenger who redeemed none'
    );
    pass('A trip with no benefits still records the restoration sentinel');
  } catch (error) {
    fail('A trip with no benefits still records the restoration sentinel', error.message);
  }

  // --- cleanup ---------------------------------------------------------------
  for (const uid of [
    `can-pax-passenger-${suffix}`, `can-pax-driver-${suffix}`, `can-pax-manager-${suffix}`,
    `can-pax-double-${suffix}`, `can-pax-link-${suffix}`, `can-pax-nobenefit-${suffix}`,
  ]) {
    const ledger = await db.collection('users').doc(uid).collection('loyaltyLedger').get();
    for (const doc of ledger.docs) await doc.ref.delete().catch(() => undefined);
  }
  const audits = await db.collection('promoRedemptionAudit').get();
  for (const doc of audits.docs) {
    if (doc.data()?.promoCode === PROMO) await doc.ref.delete().catch(() => undefined);
  }
  for (const ref of cleanup.reverse()) await ref.delete().catch(() => undefined);
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[QA] Cancellation benefits E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Cancellation benefits E2E FAILED', error);
  process.exit(1);
});
