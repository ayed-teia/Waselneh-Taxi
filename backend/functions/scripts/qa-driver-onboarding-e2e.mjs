/* eslint-disable no-console */
/**
 * QA E2E: driver onboarding - Storage rules and the document state machine.
 *
 * THE THREAT MODEL THESE RULES EXIST FOR
 * These are scans of identity documents. The failure that matters is not "a driver
 * sees the wrong file" - it is a bulk leak of national IDs. So the negative controls
 * here are the point: another driver must get nothing, and nobody may delete.
 *
 * Requires the emulator suite (auth, firestore, functions, storage).
 */
import fs from 'node:fs';

import admin from 'firebase-admin';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);
const authPort = Number(process.env.FIREBASE_AUTH_EMULATOR_PORT || 9099);
const storagePort = Number(process.env.FIREBASE_STORAGE_EMULATOR_PORT || 9199);

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = `${emulatorHost}:8080`;
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${emulatorHost}:${authPort}`;
}
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath && (credentialPath.includes('%CD%') || !fs.existsSync(credentialPath))) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const BUCKET = `${projectId}.firebasestorage.app`;
const STORAGE_BASE = `http://${emulatorHost}:${storagePort}`;
const IDENTITY = `http://${emulatorHost}:${authPort}/identitytoolkit.googleapis.com/v1`;

const results = [];
const pass = (n, d = '') => {
  results.push({ n, ok: true });
  console.log(`✅ ${n}${d ? ` - ${d}` : ''}`);
};
const fail = (n, d) => {
  results.push({ n, ok: false });
  console.error(`❌ ${n} - ${d}`);
};

/** Create an emulator user and return a usable ID token. */
async function signUp(email, password) {
  const response = await fetch(`${IDENTITY}/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return { idToken: body.idToken, uid: body.localId };
}

/** Upload to Storage AS a given user, so storage.rules is actually evaluated. */
async function uploadAs(idToken, objectPath, contentType, body) {
  const url = `${STORAGE_BASE}/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body,
  });
  return { ok: response.ok, status: response.status };
}

async function downloadAs(idToken, objectPath) {
  const url = `${STORAGE_BASE}/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media`;
  const response = await fetch(url, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  return { ok: response.ok, status: response.status };
}

async function deleteAs(idToken, objectPath) {
  const url = `${STORAGE_BASE}/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  return { ok: response.ok, status: response.status };
}

async function callAs(idToken, fnName, data = {}) {
  const url = `http://${emulatorHost}:${functionsPort}/${projectId}/europe-west1/${fnName}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const err = new Error(body?.error?.message || `${fnName} failed`);
    throw err;
  }
  return body.result;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-onboard-${Date.now()}`);
  const db = app.firestore();
  const auth = app.auth();
  const suffix = Date.now();
  const cleanupDocs = [];
  const uids = [];
  const PASSWORD = 'Str0ng-QA-Passw0rd!';

  // driver A (the subject), driver B (another driver), and a manager.
  const a = await signUp(`qa-drvA-${suffix}@example.com`, PASSWORD);
  const b = await signUp(`qa-drvB-${suffix}@example.com`, PASSWORD);
  const m = await signUp(`qa-mgr-${suffix}@example.com`, PASSWORD);
  uids.push(a.uid, b.uid, m.uid);

  const managerRoleRef = db.collection('managerRoles').doc(m.uid);
  cleanupDocs.push(managerRoleRef);
  await managerRoleRef.set({
    uid: m.uid,
    role: 'admin',
    permissions: [],
    officeIds: [],
    lineIds: [],
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const objectPath = `driver-documents/${a.uid}/driving_licence/licence-${suffix}.png`;

  // ===========================================================================
  // STORAGE RULES
  // ===========================================================================
  try {
    const r = await uploadAs(a.idToken, objectPath, 'image/png', PNG);
    r.ok
      ? pass('Storage: a driver CAN upload under their own prefix')
      : fail('Storage: a driver CAN upload under their own prefix', `HTTP ${r.status}`);
  } catch (error) {
    fail('Storage: a driver CAN upload under their own prefix', String(error));
  }

  // NEGATIVE CONTROL: the bulk-leak case.
  try {
    const r = await uploadAs(
      b.idToken,
      `driver-documents/${a.uid}/driving_licence/forged-${suffix}.png`,
      'image/png',
      PNG
    );
    !r.ok
      ? pass('Storage: another driver CANNOT upload into someone else prefix', `HTTP ${r.status}`)
      : fail('Storage: another driver CANNOT upload into someone else prefix', 'upload SUCCEEDED');
  } catch (error) {
    fail('Storage: another driver CANNOT upload into someone else prefix', String(error));
  }

  try {
    const r = await downloadAs(b.idToken, objectPath);
    !r.ok
      ? pass('Storage: another driver CANNOT read the documents', `HTTP ${r.status}`)
      : fail('Storage: another driver CANNOT read the documents', 'read SUCCEEDED');
  } catch (error) {
    fail('Storage: another driver CANNOT read the documents', String(error));
  }

  try {
    const r = await downloadAs(null, objectPath);
    !r.ok
      ? pass('Storage: an unauthenticated caller CANNOT read the documents', `HTTP ${r.status}`)
      : fail('Storage: an unauthenticated caller CANNOT read the documents', 'read SUCCEEDED');
  } catch (error) {
    fail('Storage: an unauthenticated caller CANNOT read the documents', String(error));
  }

  // POSITIVE CONTROLS - the rule must not simply deny everyone.
  try {
    const r = await downloadAs(a.idToken, objectPath);
    r.ok
      ? pass('Storage: the owning driver CAN read their own document')
      : fail('Storage: the owning driver CAN read their own document', `HTTP ${r.status}`);
  } catch (error) {
    fail('Storage: the owning driver CAN read their own document', String(error));
  }

  try {
    const r = await downloadAs(m.idToken, objectPath);
    r.ok
      ? pass('Storage: a manager CAN read a driver document (to verify it)')
      : fail('Storage: a manager CAN read a driver document (to verify it)', `HTTP ${r.status}`);
  } catch (error) {
    fail('Storage: a manager CAN read a driver document (to verify it)', String(error));
  }

  // Content-type and delete guards.
  try {
    const r = await uploadAs(
      a.idToken,
      `driver-documents/${a.uid}/driving_licence/evil-${suffix}.js`,
      'application/javascript',
      Buffer.from('alert(1)')
    );
    !r.ok
      ? pass('Storage: a disallowed content type is rejected', `HTTP ${r.status}`)
      : fail('Storage: a disallowed content type is rejected', 'upload SUCCEEDED');
  } catch (error) {
    fail('Storage: a disallowed content type is rejected', String(error));
  }

  try {
    const r = await deleteAs(a.idToken, objectPath);
    !r.ok
      ? pass('Storage: nobody may delete from a client (retention is auditable)', `HTTP ${r.status}`)
      : fail('Storage: nobody may delete from a client (retention is auditable)', 'delete SUCCEEDED');
  } catch (error) {
    fail('Storage: nobody may delete from a client (retention is auditable)', String(error));
  }

  // ===========================================================================
  // STATE MACHINE
  // ===========================================================================
  const itemsRef = db
    .collection('drivers')
    .doc(a.uid)
    .collection('private')
    .doc('documents')
    .collection('items');
  cleanupDocs.push(itemsRef.doc('driving_licence'));

  try {
    const r = await callAs(a.idToken, 'registerDriverDocument', {
      documentType: 'driving_licence',
      fileName: `licence-${suffix}.png`,
    });
    r.status === 'pending'
      ? pass('State: a driver upload lands as pending')
      : fail('State: a driver upload lands as pending', `status=${r.status}`);
  } catch (error) {
    fail('State: a driver upload lands as pending', String(error));
  }

  // NEGATIVE CONTROL: a driver must never approve their own licence.
  try {
    await callAs(a.idToken, 'reviewDriverDocument', {
      driverId: a.uid,
      documentType: 'driving_licence',
      decision: 'approved',
    });
    fail('State: a driver CANNOT approve their own document', 'review SUCCEEDED');
  } catch (error) {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    msg.includes('manager') || msg.includes('permission')
      ? pass('State: a driver CANNOT approve their own document')
      : fail('State: a driver CANNOT approve their own document', msg);
  }

  try {
    const r = await callAs(m.idToken, 'reviewDriverDocument', {
      driverId: a.uid,
      documentType: 'driving_licence',
      decision: 'rejected',
      note: 'Blurry photo',
    });
    r.status === 'rejected'
      ? pass('State: a manager can reject a document')
      : fail('State: a manager can reject a document', `status=${r.status}`);
  } catch (error) {
    fail('State: a manager can reject a document', String(error));
  }

  try {
    const r = await callAs(a.idToken, 'registerDriverDocument', {
      documentType: 'driving_licence',
      fileName: `licence-v2-${suffix}.png`,
    });
    r.status === 'pending'
      ? pass('State: rejected -> pending on re-upload')
      : fail('State: rejected -> pending on re-upload', `status=${r.status}`);
  } catch (error) {
    fail('State: rejected -> pending on re-upload', String(error));
  }

  try {
    const r = await callAs(m.idToken, 'reviewDriverDocument', {
      driverId: a.uid,
      documentType: 'driving_licence',
      decision: 'approved',
    });
    r.status === 'approved'
      ? pass('State: a manager can approve a document')
      : fail('State: a manager can approve a document', `status=${r.status}`);
  } catch (error) {
    fail('State: a manager can approve a document', String(error));
  }

  // NEGATIVE CONTROL: re-uploading over an APPROVED document would silently drop
  // its verification, so it must be refused.
  try {
    await callAs(a.idToken, 'registerDriverDocument', {
      documentType: 'driving_licence',
      fileName: `sneaky-${suffix}.png`,
    });
    fail('State: cannot re-upload over an APPROVED document', 'register SUCCEEDED');
  } catch (error) {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    msg.includes('rejected first') || msg.includes('cannot')
      ? pass('State: cannot re-upload over an APPROVED document')
      : fail('State: cannot re-upload over an APPROVED document', msg);
  }

  // A driver must not be able to write the status field directly either.
  try {
    const { initializeApp: initClient } = await import('firebase/app');
    const { getFirestore: cfs, connectFirestoreEmulator, doc, setDoc } = await import(
      'firebase/firestore'
    );
    const { getAuth: cAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import(
      'firebase/auth'
    );
    const capp = initClient(
      { apiKey: 'demo-key', projectId, appId: '1:1:web:d' },
      `qa-onb-client-${Date.now()}`
    );
    const cauth = cAuth(capp);
    connectAuthEmulator(cauth, `http://${emulatorHost}:${authPort}`, { disableWarnings: true });
    const cdb = cfs(capp);
    connectFirestoreEmulator(cdb, emulatorHost, 8080);
    await signInWithEmailAndPassword(cauth, `qa-drvA-${suffix}@example.com`, PASSWORD);

    try {
      await setDoc(
        doc(cdb, 'drivers', a.uid, 'private', 'documents', 'items', 'driving_licence'),
        { status: 'approved' },
        { merge: true }
      );
      fail('Rules: a driver CANNOT write their own document status', 'write SUCCEEDED');
    } catch (error) {
      const code = error?.code ?? '';
      code === 'permission-denied'
        ? pass('Rules: a driver CANNOT write their own document status')
        : fail('Rules: a driver CANNOT write their own document status', String(code));
    }
  } catch (error) {
    fail('Rules: a driver CANNOT write their own document status', String(error));
  }

  // --- cleanup ---------------------------------------------------------------
  for (const ref of cleanupDocs) await ref.delete().catch(() => undefined);
  for (const uid of uids) await auth.deleteUser(uid).catch(() => undefined);
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[QA] Driver onboarding E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Driver onboarding E2E FAILED', error);
  process.exit(1);
});
