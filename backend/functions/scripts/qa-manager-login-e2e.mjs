/* eslint-disable no-console */
/**
 * QA E2E: manager production sign-in (email + password).
 *
 * THE POINT OF THIS SUITE
 * Signing in proves IDENTITY. It must grant nothing on its own. Authorization still
 * comes solely from managerRoles/{uid} via getManagerSession - the R1 fix - so a
 * perfectly valid password for an account that is not an active manager must get
 * nowhere.
 *
 * That is the negative control here, and it is the one that matters: if a valid
 * credential alone were enough, the whole R1 fix would have been undone by adding a
 * login form.
 *
 * Requires the emulator suite (auth, firestore, functions).
 */
import fs from 'node:fs';

import admin from 'firebase-admin';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);
const authPort = Number(process.env.FIREBASE_AUTH_EMULATOR_PORT || 9099);

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

const results = [];
const pass = (n, d = '') => {
  results.push({ n, ok: true });
  console.log(`✅ ${n}${d ? ` - ${d}` : ''}`);
};
const fail = (n, d) => {
  results.push({ n, ok: false });
  console.error(`❌ ${n} - ${d}`);
};

const IDENTITY = `http://${emulatorHost}:${authPort}/identitytoolkit.googleapis.com/v1`;

/** Sign in with email+password against the Auth emulator, returning the idToken. */
async function signInWithPassword(email, password) {
  const response = await fetch(`${IDENTITY}/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

/** Call a callable AS a signed-in user, by passing their real ID token. */
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
    err.code = body?.error?.status || String(response.status);
    throw err;
  }
  return body.result;
}

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-mgr-login-${Date.now()}`);
  const db = app.firestore();
  const auth = app.auth();
  const cleanup = [];
  const uids = [];

  const suffix = Date.now();
  const PASSWORD = 'Str0ng-QA-Passw0rd!';

  // --- an ACTIVE manager -----------------------------------------------------
  const managerEmail = `qa-manager-${suffix}@example.com`;
  const managerUser = await auth.createUser({ email: managerEmail, password: PASSWORD });
  uids.push(managerUser.uid);
  const managerRoleRef = db.collection('managerRoles').doc(managerUser.uid);
  cleanup.push(managerRoleRef);
  await managerRoleRef.set({
    uid: managerUser.uid,
    role: 'admin',
    permissions: [],
    officeIds: [],
    lineIds: [],
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // --- a valid account that is NOT a manager ---------------------------------
  const outsiderEmail = `qa-outsider-${suffix}@example.com`;
  const outsiderUser = await auth.createUser({ email: outsiderEmail, password: PASSWORD });
  uids.push(outsiderUser.uid);

  // --- a manager whose role has been DEACTIVATED -----------------------------
  const deactivatedEmail = `qa-deactivated-${suffix}@example.com`;
  const deactivatedUser = await auth.createUser({ email: deactivatedEmail, password: PASSWORD });
  uids.push(deactivatedUser.uid);
  const deactivatedRef = db.collection('managerRoles').doc(deactivatedUser.uid);
  cleanup.push(deactivatedRef);
  await deactivatedRef.set({
    uid: deactivatedUser.uid,
    role: 'admin',
    permissions: [],
    officeIds: [],
    lineIds: [],
    isActive: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ===========================================================================
  // 1. POSITIVE CONTROL: an active manager signs in and gets a session.
  // ===========================================================================
  try {
    const signIn = await signInWithPassword(managerEmail, PASSWORD);
    const session = await callAs(signIn.idToken, 'getManagerSession');
    if (session?.userId === managerUser.uid && session?.role === 'admin') {
      pass('Active manager signs in and receives a manager session', `role=${session.role}`);
    } else {
      fail('Active manager signs in and receives a manager session', JSON.stringify(session));
    }
  } catch (error) {
    fail(
      'Active manager signs in and receives a manager session',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 2. NEGATIVE CONTROL: a VALID credential with no managerRoles document is
  //    authenticated but NOT authorised. This is the check that keeps R1 fixed.
  // ===========================================================================
  try {
    const signIn = await signInWithPassword(outsiderEmail, PASSWORD);
    if (!signIn.idToken) throw new Error('expected a valid sign-in for the outsider');

    try {
      await callAs(signIn.idToken, 'getManagerSession');
      fail(
        'A valid password with NO managerRoles document is denied',
        'getManagerSession SUCCEEDED for a non-manager'
      );
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
      if (message.includes('manager role is required') || message.includes('permission')) {
        pass('A valid password with NO managerRoles document is denied');
      } else {
        fail('A valid password with NO managerRoles document is denied', message);
      }
    }
  } catch (error) {
    fail('A valid password with NO managerRoles document is denied', String(error));
  }

  // ===========================================================================
  // 3. A DEACTIVATED manager is denied, even with a valid password.
  // ===========================================================================
  try {
    const signIn = await signInWithPassword(deactivatedEmail, PASSWORD);
    try {
      await callAs(signIn.idToken, 'getManagerSession');
      fail('A deactivated manager is denied', 'getManagerSession SUCCEEDED');
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
      if (message.includes('deactivated') || message.includes('permission')) {
        pass('A deactivated manager is denied');
      } else {
        fail('A deactivated manager is denied', message);
      }
    }
  } catch (error) {
    fail('A deactivated manager is denied', String(error));
  }

  // ===========================================================================
  // 4. A wrong password does not authenticate at all.
  // ===========================================================================
  try {
    await signInWithPassword(managerEmail, 'definitely-not-the-password');
    fail('Wrong password is rejected', 'sign-in SUCCEEDED');
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toUpperCase();
    if (message.includes('INVALID') || message.includes('PASSWORD') || message.includes('CREDENTIAL')) {
      pass('Wrong password is rejected', message.slice(0, 30));
    } else {
      fail('Wrong password is rejected', message);
    }
  }

  // ===========================================================================
  // 5. Reactivating the role restores access - proving the check is live and
  //    reads managerRoles each time rather than caching a verdict.
  // ===========================================================================
  try {
    await deactivatedRef.set({ isActive: true }, { merge: true });
    const signIn = await signInWithPassword(deactivatedEmail, PASSWORD);
    const session = await callAs(signIn.idToken, 'getManagerSession');
    if (session?.userId === deactivatedUser.uid) {
      pass('Reactivating managerRoles restores access (authority is read live)');
    } else {
      fail('Reactivating managerRoles restores access (authority is read live)', JSON.stringify(session));
    }
  } catch (error) {
    fail(
      'Reactivating managerRoles restores access (authority is read live)',
      error instanceof Error ? error.message : String(error)
    );
  }

  // --- cleanup ---------------------------------------------------------------
  for (const ref of cleanup) {
    await ref.delete().catch(() => undefined);
  }
  for (const uid of uids) {
    await auth.deleteUser(uid).catch(() => undefined);
  }
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[QA] Manager login E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Manager login E2E FAILED', error);
  process.exit(1);
});
