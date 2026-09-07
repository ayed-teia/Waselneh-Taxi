/* eslint-disable no-console */
/**
 * QA E2E: the taxi-line FIFO queue.
 *
 * ⚠️  The queue ships behind TAXI_LINE_QUEUE_ENABLED, DEFAULT OFF, and needs driver
 *     sign-off on the fairness rules before it is ever switched on.
 *
 * This suite exercises the queue MODULE and its callables directly against the
 * emulator. The dispatch integration is verified by the flag-off case here plus the
 * existing qa-request-lifecycle suite, which must stay green precisely because the
 * flag is off by default.
 *
 * Requires the emulator suite (auth, firestore, functions).
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

function loadQueueModule() {
  const p = path.join(__dirname, '..', 'dist', 'modules', 'queue', 'line-queue.js');
  if (!fs.existsSync(p)) throw new Error(`build output missing: ${p}`);
  return require(p);
}

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-queue-${Date.now()}`);
  const db = app.firestore();
  const q = loadQueueModule();

  const suffix = Date.now();
  const lineId = `LINE_Q_${suffix}`;
  const d1 = `qa-q-drv1-${suffix}`;
  const d2 = `qa-q-drv2-${suffix}`;
  const d3 = `qa-q-drv3-${suffix}`;
  const cleanup = [];

  // ===========================================================================
  // 1. FIFO ORDER: first to join is first in line.
  // ===========================================================================
  try {
    await q.joinQueue(db, lineId, d1);
    await new Promise((r) => setTimeout(r, 5));
    await q.joinQueue(db, lineId, d2);
    await new Promise((r) => setTimeout(r, 5));
    await q.joinQueue(db, lineId, d3);
    for (const d of [d1, d2, d3]) {
      cleanup.push(db.collection('lines').doc(lineId).collection('queue').doc(d));
    }

    const queue = await q.getWaitingQueue(db, lineId);
    const order = queue.map((e) => e.driverId);
    if (order[0] === d1 && order[1] === d2 && order[2] === d3) {
      pass('FIFO: drivers are ordered by join time', order.join(' -> '));
    } else {
      fail('FIFO: drivers are ordered by join time', order.join(' -> '));
    }
  } catch (error) {
    fail('FIFO: drivers are ordered by join time', String(error));
  }

  // ===========================================================================
  // 2. Candidate ordering follows the queue, NOT distance.
  //    This is the whole behavioural change.
  // ===========================================================================
  try {
    // Deliberately pass them in reverse (as a distance ranking might).
    const ordered = await q.orderCandidatesByQueue(db, lineId, [d3, d2, d1]);
    if (ordered[0] === d1 && ordered[1] === d2 && ordered[2] === d3) {
      pass('Ordering: queue position overrides the incoming (distance) order');
    } else {
      fail('Ordering: queue position overrides the incoming (distance) order', ordered.join(' -> '));
    }
  } catch (error) {
    fail('Ordering: queue position overrides the incoming (distance) order', String(error));
  }

  // ===========================================================================
  // 3. A driver NOT in the queue still gets offered, behind those who are.
  //    Without this, enabling the queue could make trips unmatchable.
  // ===========================================================================
  try {
    const outsider = `qa-q-outsider-${suffix}`;
    const ordered = await q.orderCandidatesByQueue(db, lineId, [outsider, d2, d1]);
    const outsiderIndex = ordered.indexOf(outsider);
    if (ordered[0] === d1 && ordered[1] === d2 && outsiderIndex === 2) {
      pass('Ordering: a driver not in the queue is kept, ranked behind those who are');
    } else {
      fail(
        'Ordering: a driver not in the queue is kept, ranked behind those who are',
        ordered.join(' -> ')
      );
    }
  } catch (error) {
    fail('Ordering: a driver not in the queue is kept, ranked behind those who are', String(error));
  }

  // ===========================================================================
  // 4. FORFEIT on decline: the driver loses their place.
  // ===========================================================================
  try {
    await q.forfeitPlace(db, lineId, d1, 'declined_offer');
    const queue = await q.getWaitingQueue(db, lineId);
    const order = queue.map((e) => e.driverId);
    if (!order.includes(d1) && order[0] === d2) {
      pass('Forfeit: declining removes the driver and promotes the next', order.join(' -> '));
    } else {
      fail('Forfeit: declining removes the driver and promotes the next', order.join(' -> '));
    }
  } catch (error) {
    fail('Forfeit: declining removes the driver and promotes the next', String(error));
  }

  // ===========================================================================
  // 5. RE-JOIN goes to the BACK, not back to where they were.
  // ===========================================================================
  try {
    await new Promise((r) => setTimeout(r, 5));
    await q.joinQueue(db, lineId, d1);
    const queue = await q.getWaitingQueue(db, lineId);
    const order = queue.map((e) => e.driverId);
    if (order[order.length - 1] === d1) {
      pass('Re-join: a returning driver goes to the BACK of the queue', order.join(' -> '));
    } else {
      fail('Re-join: a returning driver goes to the BACK of the queue', order.join(' -> '));
    }
  } catch (error) {
    fail('Re-join: a returning driver goes to the BACK of the queue', String(error));
  }

  // ===========================================================================
  // 6. FORFEIT on going offline / leaving the service area.
  // ===========================================================================
  for (const reason of ['went_offline', 'left_service_area']) {
    try {
      const tmp = `qa-q-${reason}-${suffix}`;
      cleanup.push(db.collection('lines').doc(lineId).collection('queue').doc(tmp));
      await q.joinQueue(db, lineId, tmp);
      await q.forfeitPlace(db, lineId, tmp, reason);
      const queue = await q.getWaitingQueue(db, lineId);
      if (!queue.some((e) => e.driverId === tmp)) {
        pass(`Forfeit: '${reason}' removes the driver from the line`);
      } else {
        fail(`Forfeit: '${reason}' removes the driver from the line`, 'still queued');
      }
    } catch (error) {
      fail(`Forfeit: '${reason}' removes the driver from the line`, String(error));
    }
  }

  // ===========================================================================
  // 7. NEGATIVE CONTROL: a driver cannot write their own queue position.
  //    Position decides who earns the next fare, so this is the first thing
  //    anyone would try.
  // ===========================================================================
  try {
    const { initializeApp: initClient } = await import('firebase/app');
    const { getFirestore: cfs, connectFirestoreEmulator, doc, setDoc } = await import(
      'firebase/firestore'
    );
    const { getAuth: cAuth, connectAuthEmulator, signInAnonymously } = await import(
      'firebase/auth'
    );
    const capp = initClient(
      { apiKey: 'demo-key', projectId, appId: '1:1:web:d' },
      `qa-queue-client-${Date.now()}`
    );
    const cauth = cAuth(capp);
    connectAuthEmulator(cauth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    const cdb = cfs(capp);
    connectFirestoreEmulator(cdb, emulatorHost, 8080);
    const cred = await signInAnonymously(cauth);

    try {
      await setDoc(
        doc(cdb, 'lines', lineId, 'queue', cred.user.uid),
        { driverId: cred.user.uid, position: 0, status: 'waiting' },
        { merge: true }
      );
      fail('Rules: a driver CANNOT set their own queue position', 'write SUCCEEDED');
    } catch (error) {
      error?.code === 'permission-denied'
        ? pass('Rules: a driver CANNOT set their own queue position')
        : fail('Rules: a driver CANNOT set their own queue position', String(error?.code));
    }

    // Positive control: the queue must still be READABLE, or a driver cannot see
    // their own place in line.
    try {
      const { getDocs, collection } = await import('firebase/firestore');
      await getDocs(collection(cdb, 'lines', lineId, 'queue'));
      pass('Rules: the queue is readable, so a driver can see their place');
    } catch (error) {
      fail('Rules: the queue is readable, so a driver can see their place', String(error?.code));
    }
  } catch (error) {
    fail('Rules: a driver CANNOT set their own queue position', String(error));
  }

  // ===========================================================================
  // 8. FLAG OFF (the default) means dispatch ordering is untouched.
  // ===========================================================================
  try {
    const { isTaxiLineQueueEnabled } = require(
      path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'dist', 'config', 'auth-flags.config.js')
    );
    const off =
      isTaxiLineQueueEnabled({}) === false &&
      isTaxiLineQueueEnabled({ TAXI_LINE_QUEUE_ENABLED: 'false' }) === false &&
      isTaxiLineQueueEnabled({ TAXI_LINE_QUEUE_ENABLED: 'yes' }) === false;
    const on = isTaxiLineQueueEnabled({ TAXI_LINE_QUEUE_ENABLED: 'true' }) === true;
    if (off && on) {
      pass('Flag: the queue is OFF unless TAXI_LINE_QUEUE_ENABLED is literally "true"');
    } else {
      fail('Flag: the queue is OFF unless TAXI_LINE_QUEUE_ENABLED is literally "true"', `off=${off} on=${on}`);
    }
  } catch (error) {
    fail('Flag: the queue is OFF unless TAXI_LINE_QUEUE_ENABLED is literally "true"', String(error));
  }

  // --- cleanup ---------------------------------------------------------------
  for (const ref of cleanup) await ref.delete().catch(() => undefined);
  await db.collection('lines').doc(lineId).delete().catch(() => undefined);
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[QA] Line queue E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Line queue E2E FAILED', error);
  process.exit(1);
});
