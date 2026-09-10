#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Seeds the LOCAL EMULATOR with a minimal, idempotent demo dataset so the three
 * apps have something real to show.
 *
 * EMULATOR ONLY. It refuses to run unless FIRESTORE_EMULATOR_HOST is set, so it
 * cannot be pointed at production by accident.
 *
 * Idempotent: every write is a fixed document id with { merge: true }, so running
 * it twice changes nothing and never duplicates.
 *
 * The manager role is NOT seeded here - manager-web's dev login calls
 * devIssueManagerToken, which creates `managerRoles/dev-manager-<role>` itself.
 *
 * Usage: node scripts/seed-local-demo.mjs
 */
import admin from 'firebase-admin';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = `${host}:8080`;
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${host}:9099`;
}
// A real service-account credential must never be used against the emulator.
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set.');
  process.exit(1);
}

// The ids the apps use by default (see EXPO_PUBLIC_DEV_DRIVER_ID / _PASSENGER_ID).
const DRIVER_ID = process.env.DEV_DRIVER_ID || 'dev-driver-001';
const PASSENGER_ID = process.env.DEV_PASSENGER_ID || 'dev-passenger-001';
const OFFICE_ID = 'OFFICE_DEMO';

/**
 * IMPORTANT: this MUST match the line id that `devIssueDriverToken` derives, because
 * the driver app calls that callable on every dev login and it overwrites the
 * driver's `lineId` with `LINE_<first 8 chars of uid, uppercased>`.
 *
 * Seeding a prettier id (e.g. LINE_NABLUS_RAMALLAH) looks fine until the driver app
 * starts: the callable then rewrites lineId to LINE_DEV-DRIV, which points at a line
 * document that does not exist, and dispatch silently stops matching that driver -
 * every booking comes back "searching" with no explanation.
 *
 * So the seed creates the line the app will actually ask for.
 */
const LINE_ID = `LINE_${DRIVER_ID.slice(0, 8).toUpperCase()}`;

// Nablus — the driver sits near the demo pickup point so dispatch can match them
// inside the 5 km search radius.
const NABLUS = { lat: 32.2211, lng: 35.2544 };

async function main() {
  const app = admin.initializeApp({ projectId }, `seed-${Date.now()}`);
  const db = app.firestore();
  const auth = app.auth();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // --- Auth users, so the dev sign-in has something to attach to ---------------
  for (const [uid, displayName] of [
    [DRIVER_ID, 'Demo Driver'],
    [PASSENGER_ID, 'Demo Passenger'],
  ]) {
    try {
      await auth.createUser({ uid, displayName });
      console.log(`  + auth user ${uid}`);
    } catch (error) {
      if (error?.code === 'auth/uid-already-exists') {
        console.log(`  = auth user ${uid} (exists)`);
      } else {
        throw error;
      }
    }
  }

  // --- Office + line ----------------------------------------------------------
  await db.collection('offices').doc(OFFICE_ID).set(
    { officeId: OFFICE_ID, name: 'Nablus Central Office', isActive: true, updatedAt: now },
    { merge: true }
  );
  console.log(`  = office ${OFFICE_ID}`);

  await db.collection('lines').doc(LINE_ID).set(
    {
      lineId: LINE_ID,
      officeId: OFFICE_ID,
      name: 'Nablus → Ramallah',
      minSeats: 1,
      maxSeats: 6,
      isActive: true,
      updatedAt: now,
    },
    { merge: true }
  );
  console.log(`  = line ${LINE_ID}  (matches what devIssueDriverToken derives)`);

  // The old pretty-named line, kept so an already-seeded database still resolves.
  await db.collection('lines').doc('LINE_NABLUS_RAMALLAH').set(
    {
      lineId: 'LINE_NABLUS_RAMALLAH',
      officeId: OFFICE_ID,
      name: 'Nablus → Ramallah (alias)',
      minSeats: 1,
      maxSeats: 6,
      isActive: true,
      updatedAt: now,
    },
    { merge: true }
  );

  // --- Driver: eligible, online, in the line ----------------------------------
  await db.collection('drivers').doc(DRIVER_ID).set(
    {
      driverId: DRIVER_ID,
      name: 'Demo Driver',
      phone: '+970590000001',
      driverType: 'licensed_line_owner',
      verificationStatus: 'approved',
      officeId: OFFICE_ID,
      lineId: LINE_ID,
      licenseId: 'LIC_DEMO_001',
      vehicleType: 'taxi_standard',
      vehiclePlate: '1234567',
      seatCapacity: 4,
      availableSeats: 4,
      fullTaxiReserved: false,
      isOnline: true,
      isAvailable: true,
      status: 'online',
      currentTripId: null,
      rating: 4.8,
      lastLocation: new admin.firestore.GeoPoint(NABLUS.lat, NABLUS.lng),
      updatedAt: now,
    },
    { merge: true }
  );
  console.log(`  = driver ${DRIVER_ID} (online, approved, in ${LINE_ID})`);

  // Live position, which is what the map subscribes to.
  await db.collection('driverLive').doc(DRIVER_ID).set(
    {
      driverId: DRIVER_ID,
      location: new admin.firestore.GeoPoint(NABLUS.lat, NABLUS.lng),
      heading: 0,
      isOnline: true,
      updatedAt: now,
    },
    { merge: true }
  );
  console.log(`  = driverLive ${DRIVER_ID}`);

  // --- Passenger --------------------------------------------------------------
  await db.collection('users').doc(PASSENGER_ID).set(
    {
      uid: PASSENGER_ID,
      role: 'passenger',
      name: 'Demo Passenger',
      phone: '+970590000002',
      isActive: true,
      updatedAt: now,
    },
    { merge: true }
  );
  console.log(`  = passenger ${PASSENGER_ID}`);

  // The driver also needs a users/ record for screens that read it.
  await db.collection('users').doc(DRIVER_ID).set(
    {
      uid: DRIVER_ID,
      role: 'driver',
      name: 'Demo Driver',
      phone: '+970590000001',
      isActive: true,
      updatedAt: now,
    },
    { merge: true }
  );

  await app.delete().catch(() => undefined);
  console.log('\nSeed complete (idempotent - safe to re-run).');
}

main().catch((error) => {
  console.error('Seed FAILED:', error);
  process.exit(1);
});
