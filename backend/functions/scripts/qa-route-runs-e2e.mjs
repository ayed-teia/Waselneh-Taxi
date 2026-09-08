/* eslint-disable no-console */
import admin from 'firebase-admin';
import fs from 'node:fs';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);

process.env.FIRESTORE_EMULATOR_HOST ||= host + ':8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= host + ':9099';
if (
  process.env.GOOGLE_APPLICATION_CREDENTIALS &&
  (process.env.GOOGLE_APPLICATION_CREDENTIALS.includes('%CD%') ||
    !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS))
) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

async function callCallable(name, devUserId, data) {
  const response = await fetch(
    'http://' + host + ':' + functionsPort + '/' + projectId + '/europe-west1/' + name,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { ...data, devUserId } }),
    }
  );
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body?.error?.message || name + ' failed');
  }
  return body.result;
}

async function expectFailure(name, devUserId, data, expected) {
  try {
    await callCallable(name, devUserId, data);
    throw new Error(name + ' unexpectedly succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('unexpectedly succeeded')) throw error;
    if (!message.toLowerCase().includes(expected.toLowerCase())) {
      throw new Error('Expected "' + expected + '", received "' + message + '"');
    }
  }
}

async function main() {
  const app = admin.initializeApp({ projectId }, 'qa-route-runs-' + Date.now());
  const db = app.firestore();
  const suffix = Date.now();
  const driverId = 'qa-route-driver-' + suffix;
  const passengerA = 'qa-route-passenger-a-' + suffix;
  const passengerB = 'qa-route-passenger-b-' + suffix;
  const passengerC = 'qa-route-passenger-c-' + suffix;
  const lineId = 'LINE_QA_ROUTE_' + suffix;
  const refs = [
    db.collection('drivers').doc(driverId),
    db.collection('lines').doc(lineId),
    db.collection('users').doc(passengerA),
    db.collection('users').doc(passengerB),
    db.collection('users').doc(passengerC),
  ];

  await refs[0].set({
    driverId,
    driverType: 'licensed_line_owner',
    verificationStatus: 'approved',
    lineId,
    licenseId: 'LICENSE_' + suffix,
    vehicleId: 'VEHICLE_' + suffix,
    vehicleType: 'taxi_standard',
    seatCapacity: 4,
  });
  await refs[1].set({
    lineId,
    name: 'QA Jenin - Ramallah',
    code: 'QA_JR_' + suffix,
    status: 'active',
    originCityId: 'CITY_JENIN',
    destinationCityId: 'CITY_RAMALLAH',
    originLabel: 'Jenin station',
    destinationLabel: 'Ramallah station',
  });
  await refs[2].set({ fullName: 'Passenger A' });
  await refs[3].set({ fullName: 'Passenger B' });
  await refs[4].set({ fullName: 'Passenger C' });

  let runId = '';
  try {
    const opened = await callCallable('openRouteRun', driverId, {
      lineId,
      departureTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    runId = opened.runId;
    const runRef = db.collection('routeRuns').doc(runId);
    refs.push(runRef);

    const first = await callCallable('bookRouteRun', passengerA, { runId, seats: 2 });
    if (first.availableSeats !== 2) throw new Error('First booking did not reserve two seats');

    const duplicate = await callCallable('bookRouteRun', passengerA, { runId, seats: 2 });
    if (duplicate.availableSeats !== 2) throw new Error('Duplicate booking was not idempotent');
    await expectFailure(
      'bookRouteRun',
      passengerA,
      { runId, seats: 1 },
      'different seat count'
    );

    const second = await callCallable('bookRouteRun', passengerB, { runId, seats: 2 });
    if (second.availableSeats !== 0 || second.status !== 'full') {
      throw new Error('Run did not automatically become full');
    }

    await expectFailure('bookRouteRun', passengerC, { runId, seats: 1 }, 'not accepting');

    const manifest = await runRef.collection('bookings').get();
    if (manifest.size !== 2) throw new Error('Manifest must contain two passenger bookings');
    if (manifest.docs.find((doc) => doc.id === passengerA)?.data().passengerName !== 'Passenger A') {
      throw new Error('Passenger manifest identity was not snapshotted');
    }

    const cancelled = await callCallable('cancelRouteBooking', passengerA, { runId });
    if (cancelled.availableSeats !== 2) throw new Error('Cancellation did not restore seats');

    await callCallable('bookRouteRun', passengerC, { runId, seats: 1 });
    const afterRebook = (await runRef.get()).data() ?? {};
    if (afterRebook.availableSeats !== 1 || afterRebook.bookedSeats !== 3) {
      throw new Error('Capacity counters drifted after cancellation and rebooking');
    }

    await callCallable('advanceRouteRun', driverId, { runId, targetStatus: 'departed' });
    await expectFailure('cancelRouteBooking', passengerB, { runId }, 'after departure');
    await callCallable('advanceRouteRun', driverId, { runId, targetStatus: 'completed' });

    const driver = (await refs[0].get()).data() ?? {};
    if (driver.activeRouteRunId !== undefined) {
      throw new Error('Completed route run did not clear the driver active run pointer');
    }

    console.log('✅ RouteRun booking, capacity, manifest, and lifecycle checks passed');
  } finally {
    if (runId) {
      const bookings = await db.collection('routeRuns').doc(runId).collection('bookings').get();
      await Promise.all(bookings.docs.map((doc) => doc.ref.delete()));
    }
    for (const ref of refs.reverse()) await ref.delete().catch(() => undefined);
    await app.delete().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('❌ RouteRun E2E failed:', error);
  process.exit(1);
});
