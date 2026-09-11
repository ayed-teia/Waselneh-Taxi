/* eslint-disable no-console */
/**
 * QA E2E: phone/OTP sign-in and its server-side rate limiting.
 *
 * WHAT IS ACTUALLY VERIFIED HERE
 * The Auth emulator supports fictional phone numbers with fixed codes, so the whole
 * sign-in round trip - request a code, verify it, receive a real Firebase user - is
 * exercised end to end, along with the wrong-code path. The rate limiting is
 * exercised against the real callables and real Firestore counters.
 *
 * WHAT IS NOT, AND CANNOT BE, VERIFIED HERE
 *   - real SMS delivery to a real handset (no carrier in the emulator)
 *   - on-device reCAPTCHA / App Check / Play Integrity / APNs silent push
 *   - the Firebase console configuration those depend on
 * Those need a device and the console; see docs/AUTH_ROLLOUT.md. Nothing in this
 * file claims to cover them.
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

const testResults = [];
const pass = (name, details = '') => {
  testResults.push({ name, pass: true });
  console.log(`✅ ${name}${details ? ` - ${details}` : ''}`);
};
const fail = (name, details) => {
  testResults.push({ name, pass: false });
  console.error(`❌ ${name} - ${details}`);
};
const check = (name, actual, expected) =>
  actual === expected ? pass(name) : fail(name, `expected "${expected}", got "${actual}"`);

async function callCallable(fnName, data, idToken) {
  const url = `http://${emulatorHost}:${functionsPort}/${projectId}/europe-west1/${fnName}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Only when a test is exercising the AUTHENTICATED path. Most OTP calls
      // happen before the caller has any credential at all.
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
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

/**
 * Register a fictional phone number + code with the Auth emulator, so the whole
 * sign-in round trip can run without an SMS.
 */
async function setEmulatorTestPhoneNumbers(mapping) {
  const url = `http://${emulatorHost}:${authPort}/emulator/v1/projects/${projectId}/config`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signIn: { allowDuplicateEmails: false }, testPhoneNumbers: mapping }),
  });
  if (!response.ok) {
    throw new Error(`failed to set test phone numbers: HTTP ${response.status}`);
  }
}

/**
 * The phone sign-in round trip is driven through the Auth emulator's REST API rather
 * than the firebase/auth Web SDK.
 *
 * WHY: PhoneAuthProvider needs a browser DOM for its reCAPTCHA verifier and throws
 * auth/operation-not-supported-in-this-environment under Node. The REST endpoints are
 * what the SDK calls underneath, so this exercises the same emulator code path - it
 * just skips the verifier the emulator does not evaluate anyway. On a real device the
 * verifier is real, which is exactly the part that needs device QA.
 */
const IDENTITY_BASE = `http://${emulatorHost}:${authPort}/identitytoolkit.googleapis.com/v1`;
const EMULATOR_BASE = `http://${emulatorHost}:${authPort}/emulator/v1/projects/${projectId}`;

async function sendVerificationCode(phoneNumber) {
  const response = await fetch(`${IDENTITY_BASE}/accounts:sendVerificationCode?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body.sessionInfo;
}

/** The emulator exposes the code it "sent", so no SMS is needed. */
async function readEmulatorCode(sessionInfo) {
  const response = await fetch(`${EMULATOR_BASE}/verificationCodes`);
  const body = await response.json();
  const entry = (body.verificationCodes || []).filter((c) => c.sessionInfo === sessionInfo).at(-1);
  if (!entry) throw new Error('no verification code recorded for this session');
  return entry.code;
}

async function signInWithPhoneCode(sessionInfo, code) {
  const response = await fetch(`${IDENTITY_BASE}/accounts:signInWithPhoneNumber?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionInfo, code }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

async function main() {
  const adminApp = admin.initializeApp({ projectId }, `qa-otp-${Date.now()}`);
  const db = adminApp.firestore();
  const cleanup = [];

  // Fictional numbers the emulator accepts with fixed codes.
  //
  // OTHER_TEST_PHONE exists so the suite can sign in as a DIFFERENT real user and
  // prove it still cannot clear this number's lockout. Both are registered in ONE
  // call because the helper PATCHes the whole testPhoneNumbers map - a second call
  // would silently replace the first.
  const TEST_PHONE = '+970599000111';
  const OTHER_TEST_PHONE = '+970599000222';
  const TEST_CODE = '123456';
  await setEmulatorTestPhoneNumbers({
    [TEST_PHONE]: TEST_CODE,
    [OTHER_TEST_PHONE]: TEST_CODE,
  });

  // ===========================================================================
  // 1. E.164 normalisation and the country allow-list (pure logic, via callable).
  // ===========================================================================
  try {
    const r = await callCallable('requestOtpPermission', {
      phoneNumber: '+441234567890',
      deviceId: `dev-${Date.now()}`,
    });
    check('Rejects a country outside the allow-list (+44)', r.reason, 'country_not_allowed');
  } catch (error) {
    fail('Rejects a country outside the allow-list (+44)', String(error));
  }

  try {
    const r = await callCallable('requestOtpPermission', {
      phoneNumber: '0599123456',
      deviceId: `dev-${Date.now()}`,
    });
    // Ambiguous while both +970 and +972 are allowed - must be refused, not guessed.
    check('Refuses an ambiguous national number (no country code)', r.reason, 'invalid_number');
  } catch (error) {
    fail('Refuses an ambiguous national number (no country code)', String(error));
  }

  for (const allowed of ['+970599777001', '+972521234567']) {
    try {
      const r = await callCallable('requestOtpPermission', {
        phoneNumber: allowed,
        deviceId: `dev-allow-${allowed}-${Date.now()}`,
      });
      cleanup.push(allowed);
      check(`Allows a permitted country (${allowed.slice(0, 4)})`, r.allowed, true);
    } catch (error) {
      fail(`Allows a permitted country (${allowed.slice(0, 4)})`, String(error));
    }
  }

  // ===========================================================================
  // 2. Resend cooldown: an immediate second request for the same number is refused.
  // ===========================================================================
  try {
    const phone = `+97059900${String(Date.now()).slice(-4)}`;
    const deviceId = `dev-cooldown-${Date.now()}`;
    cleanup.push(phone);

    const first = await callCallable('requestOtpPermission', { phoneNumber: phone, deviceId });
    const second = await callCallable('requestOtpPermission', { phoneNumber: phone, deviceId });

    if (first.allowed === true && second.allowed === false && second.reason === 'cooldown') {
      pass('Resend cooldown blocks an immediate second request', `retryAfter=${second.retryAfterSeconds}s`);
    } else {
      fail(
        'Resend cooldown blocks an immediate second request',
        `first=${JSON.stringify(first)} second=${JSON.stringify(second)}`
      );
    }
  } catch (error) {
    fail('Resend cooldown blocks an immediate second request', String(error));
  }

  // ===========================================================================
  // 3. Per-number hourly cap. Bypass the cooldown by ageing lastSentAt, so this
  //    tests the hourly limit specifically rather than re-testing the cooldown.
  // ===========================================================================
  try {
    const phone = `+97059911${String(Date.now()).slice(-4)}`;
    cleanup.push(phone);
    let lastResult = null;
    let sends = 0;

    for (let i = 0; i < 8; i++) {
      const result = await callCallable('requestOtpPermission', {
        phoneNumber: phone,
        deviceId: `dev-hourly-${i}-${Date.now()}`, // fresh device each time
      });
      lastResult = result;
      if (result.allowed) sends++;
      if (!result.allowed && result.reason === 'number_hourly_limit') break;
      // Age lastSentAt so the cooldown does not mask the hourly cap.
      const { hashPhone } = await import('../dist/modules/auth/otp-rate-limit.js');
      await db
        .collection('otpRateLimits')
        .doc(hashPhone(phone))
        .set(
          { lastSentAt: admin.firestore.Timestamp.fromMillis(Date.now() - 10 * 60 * 1000) },
          { merge: true }
        );
    }

    if (lastResult?.reason === 'number_hourly_limit' && sends === 5) {
      pass('Per-number hourly cap stops sends after the limit', `allowed ${sends}, then blocked`);
    } else {
      fail(
        'Per-number hourly cap stops sends after the limit',
        `sends=${sends} last=${JSON.stringify(lastResult)}`
      );
    }
  } catch (error) {
    fail('Per-number hourly cap stops sends after the limit', String(error));
  }

  // ===========================================================================
  // 4. Lockout after repeated wrong codes.
  // ===========================================================================
  try {
    const phone = `+97059922${String(Date.now()).slice(-4)}`;
    cleanup.push(phone);

    let last = null;
    for (let i = 0; i < 5; i++) {
      last = await callCallable('reportOtpResult', { phoneNumber: phone, outcome: 'failure' });
    }

    if (last?.lockedOut === true) {
      pass('Locks the number out after 5 wrong codes');
    } else {
      fail('Locks the number out after 5 wrong codes', JSON.stringify(last));
    }

    // And a send request while locked out is refused.
    const blocked = await callCallable('requestOtpPermission', {
      phoneNumber: phone,
      deviceId: `dev-locked-${Date.now()}`,
    });
    check('A locked-out number cannot request another code', blocked.reason, 'locked_out');
  } catch (error) {
    fail('Locks the number out after 5 wrong codes', String(error));
  }

  // ===========================================================================
  // 5. Clearing the counters requires PROOF of sign-in, not the caller's word.
  //
  //    A success report clears a lockout, so it is a privilege. Unauthenticated,
  //    it let anyone erase any number's lockout on demand - an attacker
  //    brute-forcing a victim could clear it every five guesses and the lockout
  //    would never bite. It now requires a token whose phone_number claim matches.
  // ===========================================================================
  try {
    const phone = TEST_PHONE;

    // Drive the number toward lockout.
    for (let i = 0; i < 3; i++) {
      await callCallable('reportOtpResult', { phoneNumber: phone, outcome: 'failure' });
    }

    // (a) No credential at all must be refused.
    let refusedAnonymous = false;
    try {
      await callCallable('reportOtpResult', { phoneNumber: phone, outcome: 'success' });
    } catch {
      refusedAnonymous = true;
    }
    if (refusedAnonymous) {
      pass('An unauthenticated success report cannot clear the counters');
    } else {
      fail(
        'An unauthenticated success report cannot clear the counters',
        'the call succeeded - a lockout can be erased by anyone'
      );
    }

    // The failures must still stand after the refused attempt.
    const { hashPhone } = await import('../dist/modules/auth/otp-rate-limit.js');
    const afterRefusal = (await db.collection('otpRateLimits').doc(hashPhone(phone)).get()).data() ?? {};
    if ((afterRefusal.failedAttempts ?? 0) === 3) {
      pass('A refused success report leaves the failure count intact');
    } else {
      fail(
        'A refused success report leaves the failure count intact',
        `failedAttempts=${afterRefusal.failedAttempts}`
      );
    }

    // (b) Signed in as a DIFFERENT number must be refused - otherwise one real
    //     account could clear every other number's lockout.
    const otherPhone = OTHER_TEST_PHONE;
    const otherSession = await sendVerificationCode(otherPhone);
    const otherCode = await readEmulatorCode(otherSession);
    const otherSignIn = await signInWithPhoneCode(otherSession, otherCode);

    let refusedMismatch = false;
    try {
      await callCallable(
        'reportOtpResult',
        { phoneNumber: phone, outcome: 'success' },
        otherSignIn.idToken
      );
    } catch {
      refusedMismatch = true;
    }
    if (refusedMismatch) {
      pass('Signed in as another number cannot clear a third party lockout');
    } else {
      fail(
        'Signed in as another number cannot clear a third party lockout',
        'a third party cleared the lockout'
      );
    }

    // (c) The legitimate path still works - the limiter must not permanently
    //     penalise a real user who eventually signs in.
    const session = await sendVerificationCode(phone);
    const code = await readEmulatorCode(session);
    const signIn = await signInWithPhoneCode(session, code);

    await callCallable(
      'reportOtpResult',
      { phoneNumber: phone, outcome: 'success' },
      signIn.idToken
    );

    // Both sign-ins above created real Auth users. Delete them so the suite leaves
    // no state behind for the later cases that reuse TEST_PHONE.
    for (const uid of [otherSignIn.localId, signIn.localId]) {
      if (uid) await adminApp.auth().deleteUser(uid).catch(() => undefined);
    }

    const cleared = (await db.collection('otpRateLimits').doc(hashPhone(phone)).get()).data() ?? {};
    if ((cleared.failedAttempts ?? 0) === 0 && cleared.lockedUntil === undefined) {
      pass('A verified sign-in for the SAME number clears the failure counters');
    } else {
      fail(
        'A verified sign-in for the SAME number clears the failure counters',
        JSON.stringify(cleared)
      );
    }
  } catch (error) {
    fail('Clearing the counters requires proof of sign-in', String(error));
  }

  // ===========================================================================
  // 6. PRIVACY: the raw phone number must never be stored.
  // ===========================================================================
  try {
    const all = await db.collection('otpRateLimits').get();
    const leaked = [];
    all.forEach((docSnap) => {
      const serialized = JSON.stringify(docSnap.data() ?? {});
      if (/\+\d{9,15}/.test(serialized) || /\+\d{9,15}/.test(docSnap.id)) {
        leaked.push(docSnap.id);
      }
    });
    if (leaked.length === 0) {
      pass('Rate-limit records store a hash, never the raw phone number');
    } else {
      fail(
        'Rate-limit records store a hash, never the raw phone number',
        `${leaked.length} document(s) contain a raw number`
      );
    }
  } catch (error) {
    fail('Rate-limit records store a hash, never the raw phone number', String(error));
  }

  // ===========================================================================
  // 7. THE FULL SIGN-IN ROUND TRIP against the Auth emulator's test number.
  //    This is the positive control for the whole feature: without it, every
  //    check above could pass while sign-in itself was broken.
  // ===========================================================================
  let signedInUid = null;
  try {
    const sessionInfo = await sendVerificationCode(TEST_PHONE);
    const code = await readEmulatorCode(sessionInfo);
    const result = await signInWithPhoneCode(sessionInfo, code);

    if (result.phoneNumber === TEST_PHONE && result.localId) {
      signedInUid = result.localId;
      pass('Full OTP sign-in round trip succeeds with the correct code', result.localId);
    } else {
      fail(
        'Full OTP sign-in round trip succeeds with the correct code',
        `phoneNumber=${result.phoneNumber} localId=${result.localId}`
      );
    }
  } catch (error) {
    fail(
      'Full OTP sign-in round trip succeeds with the correct code',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ===========================================================================
  // 8. NEGATIVE CONTROL: the wrong code must NOT sign anyone in.
  // ===========================================================================
  try {
    const sessionInfo = await sendVerificationCode(TEST_PHONE);
    await readEmulatorCode(sessionInfo); // ensure a code exists, then ignore it
    await signInWithPhoneCode(sessionInfo, '000000');
    fail('Wrong OTP code is rejected', 'sign-in SUCCEEDED with the wrong code');
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toUpperCase();
    if (message.includes('INVALID') || message.includes('CODE') || message.includes('SESSION')) {
      pass('Wrong OTP code is rejected', message.slice(0, 40));
    } else {
      fail('Wrong OTP code is rejected', message);
    }
  }

  // ===========================================================================
  // 9. The signed-in user is a real Firebase Auth user with the phone attached.
  // ===========================================================================
  try {
    if (!signedInUid) throw new Error('no uid from the sign-in step');
    const record = await adminApp.auth().getUser(signedInUid);
    if (record.phoneNumber === TEST_PHONE) {
      pass('Sign-in creates a real Auth user carrying the phone number');
      await adminApp.auth().deleteUser(signedInUid).catch(() => undefined);
    } else {
      fail(
        'Sign-in creates a real Auth user carrying the phone number',
        `phoneNumber=${record.phoneNumber}`
      );
    }
  } catch (error) {
    fail(
      'Sign-in creates a real Auth user carrying the phone number',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  try {
    const { hashPhone } = await import('../dist/modules/auth/otp-rate-limit.js');
    for (const phone of cleanup) {
      await db.collection('otpRateLimits').doc(hashPhone(phone)).delete().catch(() => undefined);
    }
  } catch {
    // noop
  }
  try {
    await adminApp.delete();
  } catch {
    // noop
  }

  const passed = testResults.filter((t) => t.pass).length;
  const failed = testResults.filter((t) => !t.pass).length;
  console.log(
    `\n[QA] OTP auth E2E summary -> total: ${testResults.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] OTP auth E2E FAILED', error);
  process.exit(1);
});
