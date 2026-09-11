/* eslint-disable no-console */
/**
 * QA E2E: manager settlement reconciliation.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 *
 * It proves the parts we own: authorisation, office scoping, input validation, and
 * - most importantly - that "we could not check" never masquerades as "we checked
 * and found nothing". With online payments disabled (the default) the stub adapter
 * has no fetchSettlement, so the callable must report providerAvailable: false
 * rather than an empty, reassuring report.
 *
 * It CANNOT prove anything about Lahza's real settlement format. No credentials
 * exist, no live call is made, and none is faked. The mismatch taxonomy itself is
 * covered by pure unit tests against fixtures.
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
    const error = new Error(body?.error?.message || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  return body.result;
}

async function expectRejected(name, data, label) {
  try {
    await callFn(name, data);
    throw new Error(`${label}: expected rejection but the call succeeded`);
  } catch (error) {
    if (String(error.message).startsWith(`${label}:`)) throw error;
    return error.message;
  }
}

async function main() {
  const app = admin.initializeApp({ projectId }, `qa-settle-${Date.now()}`);
  const db = app.firestore();
  const suffix = Date.now();
  const cleanup = [];

  const GLOBAL_MANAGER = `settle-admin-${suffix}`;
  const SCOPED_MANAGER = `settle-scoped-${suffix}`;
  const OUTSIDER = `settle-outsider-${suffix}`;
  const OFFICE = `SETTLE_OFFICE_${suffix}`;

  // A global admin and an office-scoped manager: scoping is the thing most easily
  // got wrong on a financial endpoint.
  //
  // Both carry `permissions: []` on purpose. getManagerProfile uses the explicit
  // array only when non-empty and otherwise falls back to the role defaults, and
  // the `manager` role already grants manage_payments. So SCOPED_MANAGER clears the
  // permission gate and can only fail on scope - which is precisely what the scope
  // assertion below needs. Granting manage_payments explicitly would prove the same
  // thing, but a fixture that passes for the wrong reason is worse than no fixture:
  // with `permissions: ['x']` the scoped case would still fail, just on the
  // permission check, and the test would go green having never exercised scope.
  //
  // isGlobalScope is derived (officeIds.length === 0 && lineIds.length === 0), not
  // stored, so the empty arrays on GLOBAL_MANAGER are what make it global.
  for (const [uid, role, officeIds] of [
    [GLOBAL_MANAGER, 'admin', []],
    [SCOPED_MANAGER, 'manager', [OFFICE]],
  ]) {
    const ref = db.collection('managerRoles').doc(uid);
    await ref.set({
      uid,
      role,
      permissions: [],
      officeIds,
      lineIds: [],
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    cleanup.push(ref);
  }

  const WINDOW = {
    fromIso: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    toIso: new Date().toISOString(),
  };

  // ===========================================================================
  // 1. The callable is actually deployed.
  //
  // Export wiring is two hops - api/callable/index.ts AND the named block in
  // src/index.ts - and a callable missing from the second compiles, passes every
  // unit test, and never deploys. Only a 404 probe catches that.
  //
  // This sends no devUserId, so a deployed function answers 401. That is a pass:
  // the assertion is on routing, not on authorisation.
  // ===========================================================================
  try {
    const response = await fetch(
      `http://${emulatorHost}:${functionsPort}/${projectId}/${REGION}/managerReconcileSettlement`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      }
    );
    assert(response.status !== 404, 'managerReconcileSettlement is not deployed');
    pass('managerReconcileSettlement is deployed', `HTTP ${response.status}`);
  } catch (error) {
    fail('managerReconcileSettlement is deployed', error.message);
  }

  // ===========================================================================
  // 2. THE CORE PROPERTY: unavailable must never look like "nothing found".
  // ===========================================================================
  try {
    const report = await callFn('managerReconcileSettlement', {
      devUserId: GLOBAL_MANAGER,
      ...WINDOW,
    });
    assert(
      report.providerAvailable === false,
      `expected providerAvailable false with payments disabled, got ${report.providerAvailable}`
    );
    assert(typeof report.reason === 'string' && report.reason.length > 0, 'no reason given');
    assert(report.totals === null, 'totals must be null when nothing could be compared');
    assert(report.comparedCount === 0, `comparedCount should be 0, got ${report.comparedCount}`);
    assert(Array.isArray(report.findings) && report.findings.length === 0, 'findings must be empty');
    pass('Reports providerAvailable:false rather than an empty report', report.reason);
  } catch (error) {
    fail('Reports providerAvailable:false rather than an empty report', error.message);
  }

  // ===========================================================================
  // 3. Authorisation.
  // ===========================================================================
  try {
    await expectRejected(
      'managerReconcileSettlement',
      { devUserId: OUTSIDER, ...WINDOW },
      'non-manager'
    );
    pass('A non-manager cannot reconcile settlements');
  } catch (error) {
    fail('A non-manager cannot reconcile settlements', error.message);
  }

  try {
    const message = await expectRejected(
      'managerReconcileSettlement',
      { devUserId: SCOPED_MANAGER, ...WINDOW },
      'scoped-manager'
    );
    assert(/global/i.test(message), `expected a scope refusal, got: ${message}`);
    pass('An office-scoped manager cannot reconcile platform-wide settlements');
  } catch (error) {
    fail('An office-scoped manager cannot reconcile platform-wide settlements', error.message);
  }

  // ===========================================================================
  // 4. Input validation - a reversed or absent window is refused.
  // ===========================================================================
  try {
    await expectRejected(
      'managerReconcileSettlement',
      { devUserId: GLOBAL_MANAGER, fromIso: WINDOW.toIso, toIso: WINDOW.fromIso },
      'reversed-window'
    );
    pass('A reversed date window is refused');
  } catch (error) {
    fail('A reversed date window is refused', error.message);
  }

  try {
    await expectRejected(
      'managerReconcileSettlement',
      { devUserId: GLOBAL_MANAGER },
      'missing-window'
    );
    pass('A missing date window is refused');
  } catch (error) {
    fail('A missing date window is refused', error.message);
  }

  try {
    await expectRejected(
      'managerReconcileSettlement',
      { devUserId: GLOBAL_MANAGER, ...WINDOW, limit: 999999 },
      'oversized-limit'
    );
    pass('An oversized limit is refused rather than silently clamped');
  } catch (error) {
    fail('An oversized limit is refused rather than silently clamped', error.message);
  }

  // --- cleanup ---------------------------------------------------------------
  for (const ref of cleanup.reverse()) await ref.delete().catch(() => undefined);
  await app.delete().catch(() => undefined);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[QA] Settlement reconciliation E2E summary -> total: ${results.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Settlement reconciliation E2E FAILED', error);
  process.exit(1);
});
