/* eslint-disable no-console */
/**
 * QA E2E: security regressions R1 and R2.
 *
 * R1 - PRIVILEGE ESCALATION
 *   firestore.rules used to trust users/{uid}.role inside isManager(), while
 *   match /users/{uid} allowed the owner to write their whole document. Any signed-in
 *   user could therefore set role: "admin" on themselves, become a manager, and then
 *   write managerRoles/* to make it permanent. The backend mirrored the same flaw:
 *   getManagerProfile() fell back to users/{uid} for role/permissions/scope.
 *
 * R2 - DEV AUTH BYPASS
 *   core/auth/devAuth.isEmulatorMode() also returned true when ENVIRONMENT === 'dev'.
 *   ENVIRONMENT defaults to 'dev' (core/env/env.ts), so a deployed function would
 *   accept an unauthenticated caller's `devUserId` and act as that user.
 *
 * Requires the emulator suite (auth, firestore, functions) to be running.
 *
 * NOTE ON WHAT THIS CAN AND CANNOT PROVE:
 * The emulator necessarily runs WITH the emulator env vars set, so the devUserId
 * fallback is legitimately active here. This script therefore verifies R2 by unit-
 * testing the gate's own logic against the compiled module under controlled env vars,
 * rather than by pretending the emulator is production. The R1 checks are true
 * end-to-end rules/RBAC checks against the live emulator.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import admin from 'firebase-admin';
import { initializeApp as initClientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
  getFirestore as getClientFirestore,
  connectFirestoreEmulator,
  doc as clientDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const testResults = [];

function pass(name, details = '') {
  testResults.push({ name, pass: true, details });
  console.log(`✅ ${name}${details ? ` - ${details}` : ''}`);
}

function fail(name, details) {
  testResults.push({ name, pass: false, details });
  console.error(`❌ ${name} - ${details}`);
}

function isPermissionDenied(error) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('permission') || message.includes('insufficient');
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

async function main() {
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const suffix = Date.now();
  const cleanupRefs = [];
  const pushCleanup = (ref) => cleanupRefs.push(ref);

  const clientApp = initClientApp({
    apiKey: 'demo-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: '1:111111111111:web:demo',
  });
  const clientAuth = getAuth(clientApp);
  const clientDb = getClientFirestore(clientApp);
  connectAuthEmulator(clientAuth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(clientDb, emulatorHost, 8080);

  const cred = await signInAnonymously(clientAuth);
  const attackerUid = cred.user.uid;

  const attackerUserRef = db.collection('users').doc(attackerUid);
  const attackerRoleRef = db.collection('managerRoles').doc(attackerUid);
  pushCleanup(attackerUserRef);
  pushCleanup(attackerRoleRef);

  // Seed an ordinary, non-privileged user document (as the auth trigger would).
  await attackerUserRef.set({
    uid: attackerUid,
    role: 'passenger',
    displayName: 'QA Attacker',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ===========================================================================
  // R1.1 - a user cannot escalate their own role via users/{uid}
  // ===========================================================================
  try {
    await updateDoc(clientDoc(clientDb, 'users', attackerUid), { role: 'admin' });
    fail('R1: self-assigning users/{uid}.role = admin is blocked', 'The write SUCCEEDED');
  } catch (error) {
    if (isPermissionDenied(error)) {
      pass('R1: self-assigning users/{uid}.role = admin is blocked');
    } else {
      fail('R1: self-assigning users/{uid}.role = admin is blocked', String(error));
    }
  }

  // ===========================================================================
  // R1.2 - the other privilege fields are equally protected
  // ===========================================================================
  for (const [field, value] of [
    ['permissions', ['manage_operations']],
    ['managerRole', 'admin'],
    ['officeIds', ['office-1']],
    ['lineIds', ['line-1']],
    ['status', 'active'],
  ]) {
    try {
      await updateDoc(clientDoc(clientDb, 'users', attackerUid), { [field]: value });
      fail(`R1: self-assigning users/{uid}.${field} is blocked`, 'The write SUCCEEDED');
    } catch (error) {
      if (isPermissionDenied(error)) {
        pass(`R1: self-assigning users/{uid}.${field} is blocked`);
      } else {
        fail(`R1: self-assigning users/{uid}.${field} is blocked`, String(error));
      }
    }
  }

  // ===========================================================================
  // R1.3 - a non-privileged owner CAN still edit their own profile fields.
  // Guards against over-tightening the rule into a broken app.
  // ===========================================================================
  try {
    await updateDoc(clientDoc(clientDb, 'users', attackerUid), {
      displayName: 'Renamed By Owner',
    });
    pass('R1: owner can still update non-privilege profile fields');
  } catch (error) {
    fail('R1: owner can still update non-privilege profile fields', String(error));
  }

  // ===========================================================================
  // R1.4 - a user cannot mint their own managerRoles/{uid} document
  // ===========================================================================
  try {
    await setDoc(clientDoc(clientDb, 'managerRoles', attackerUid), {
      uid: attackerUid,
      role: 'admin',
      isActive: true,
      permissions: [],
    });
    fail('R1: self-minting managerRoles/{uid} is blocked', 'The write SUCCEEDED');
  } catch (error) {
    if (isPermissionDenied(error)) {
      pass('R1: self-minting managerRoles/{uid} is blocked');
    } else {
      fail('R1: self-minting managerRoles/{uid} is blocked', String(error));
    }
  }

  // ===========================================================================
  // R1.5 - backend RBAC ignores users/{uid}.
  // Force users/{uid}.role = 'admin' with the Admin SDK (bypassing rules, i.e.
  // simulating a doc that was escalated before the rules were fixed, or by any
  // other path) and confirm the backend still refuses to treat them as a manager.
  // ===========================================================================
  await attackerUserRef.set(
    { role: 'admin', permissions: ['manage_operations'], status: 'active' },
    { merge: true }
  );

  try {
    await callCallable('getManagerSession', { devUserId: attackerUid });
    fail(
      'R1: backend RBAC ignores users/{uid}.role (no managerRoles doc)',
      'getManagerSession SUCCEEDED for a user with only users/{uid}.role = admin'
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (message.includes('manager role is required') || message.includes('permission')) {
      pass('R1: backend RBAC ignores users/{uid}.role (no managerRoles doc)');
    } else {
      fail('R1: backend RBAC ignores users/{uid}.role (no managerRoles doc)', message);
    }
  }

  // ===========================================================================
  // R1.6 - a DEACTIVATED managerRoles document does not grant access.
  // ===========================================================================
  await attackerRoleRef.set({
    uid: attackerUid,
    role: 'admin',
    permissions: ['manage_operations'],
    officeIds: [],
    lineIds: [],
    isActive: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    await callCallable('getManagerSession', { devUserId: attackerUid });
    fail(
      'R1: deactivated managerRoles document is refused',
      'getManagerSession SUCCEEDED for isActive: false'
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (message.includes('deactivated') || message.includes('permission')) {
      pass('R1: deactivated managerRoles document is refused');
    } else {
      fail('R1: deactivated managerRoles document is refused', message);
    }
  }

  // ===========================================================================
  // R1.7 - positive control: an ACTIVE managerRoles document DOES grant access.
  // Without this, every check above could pass simply because manager auth is broken.
  // ===========================================================================
  await attackerRoleRef.set({ isActive: true }, { merge: true });

  try {
    const session = await callCallable('getManagerSession', { devUserId: attackerUid });
    assert.ok(session, 'expected a manager session payload');
    pass('R1: active managerRoles document still grants manager access (positive control)');
  } catch (error) {
    fail(
      'R1: active managerRoles document still grants manager access (positive control)',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // R2 - the dev auth bypass depends ONLY on the auto-set emulator variables.
  //
  // Loaded from the COMPILED output so this tests what actually ships.
  // ===========================================================================
  const devAuthPath = path.join(__dirname, '../dist/core/auth/devAuth.js');
  if (!fs.existsSync(devAuthPath)) {
    fail('R2: dev auth gate ignores ENVIRONMENT', `build output not found at ${devAuthPath}`);
  } else {
    const { isEmulatorMode } = await import(pathToFileURL(devAuthPath).href);

    const saved = {
      FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
      ENVIRONMENT: process.env.ENVIRONMENT,
    };
    const setEnv = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };

    try {
      // Case A: no emulator vars, ENVIRONMENT unset. ENVIRONMENT defaults to 'dev'
      // in core/env/env.ts, so this is the shape of a real deployment that never
      // overrode it - the bypass must be OFF.
      setEnv('FUNCTIONS_EMULATOR', undefined);
      setEnv('FIRESTORE_EMULATOR_HOST', undefined);
      setEnv('ENVIRONMENT', undefined);
      if (isEmulatorMode() === false) {
        pass('R2: bypass is OFF in a deployment with no emulator vars');
      } else {
        fail('R2: bypass is OFF in a deployment with no emulator vars', 'isEmulatorMode() === true');
      }

      // Case B: the regression itself - ENVIRONMENT === 'dev' must NOT enable it.
      setEnv('ENVIRONMENT', 'dev');
      if (isEmulatorMode() === false) {
        pass('R2: ENVIRONMENT=dev alone does NOT enable the devUserId bypass');
      } else {
        fail(
          'R2: ENVIRONMENT=dev alone does NOT enable the devUserId bypass',
          'isEmulatorMode() === true - the R2 regression is back'
        );
      }

      // Case C: prod-ish value, still off.
      setEnv('ENVIRONMENT', 'prod');
      if (isEmulatorMode() === false) {
        pass('R2: bypass is OFF when ENVIRONMENT=prod');
      } else {
        fail('R2: bypass is OFF when ENVIRONMENT=prod', 'isEmulatorMode() === true');
      }

      // Case D: positive control - the real emulator signals must still enable it,
      // otherwise the local QA scripts would silently stop working.
      setEnv('ENVIRONMENT', undefined);
      setEnv('FUNCTIONS_EMULATOR', 'true');
      if (isEmulatorMode() === true) {
        pass('R2: FUNCTIONS_EMULATOR=true still enables the bypass (positive control)');
      } else {
        fail('R2: FUNCTIONS_EMULATOR=true still enables the bypass (positive control)', 'false');
      }

      setEnv('FUNCTIONS_EMULATOR', undefined);
      setEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
      if (isEmulatorMode() === true) {
        pass('R2: FIRESTORE_EMULATOR_HOST still enables the bypass (positive control)');
      } else {
        fail('R2: FIRESTORE_EMULATOR_HOST still enables the bypass (positive control)', 'false');
      }
    } finally {
      setEnv('FUNCTIONS_EMULATOR', saved.FUNCTIONS_EMULATOR);
      setEnv('FIRESTORE_EMULATOR_HOST', saved.FIRESTORE_EMULATOR_HOST);
      setEnv('ENVIRONMENT', saved.ENVIRONMENT);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  for (const ref of cleanupRefs.reverse()) {
    try {
      await ref.delete();
    } catch {
      // noop
    }
  }
  try {
    await clientAuth.signOut();
  } catch {
    // noop
  }
  try {
    await deleteClientApp(clientApp);
  } catch {
    // noop
  }
  try {
    await admin.app().delete();
  } catch {
    // noop
  }

  const passed = testResults.filter((item) => item.pass).length;
  const failed = testResults.filter((item) => !item.pass).length;
  console.log(
    `\n[QA] Security regression E2E summary -> total: ${testResults.length}, passed: ${passed}, failed: ${failed}`
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Security regression E2E FAILED', error);
  process.exit(1);
});
