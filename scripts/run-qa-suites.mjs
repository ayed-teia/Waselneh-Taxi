#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Runs every emulator QA suite in order and exits non-zero if any of them fails.
 *
 * Intended to be invoked INSIDE `firebase emulators:exec`, which starts the emulator
 * suite, runs this, and tears it down again:
 *
 *   firebase emulators:exec --project waselneh-prod-414e2 \
 *     --only auth,firestore,functions "node scripts/run-qa-suites.mjs"
 *
 * A single entry point keeps CI and local runs identical, and avoids shell-quoting
 * differences between the Windows and Linux shells (chaining with && inside the
 * emulators:exec argument breaks on Windows).
 *
 * The suites run from backend/functions, because they import the `firebase` and
 * `firebase-admin` packages resolved from that workspace.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(repoRoot, 'backend', 'functions');

const SUITES = [
  'qa-driver-eligibility-e2e.mjs',
  'qa-request-lifecycle-e2e.mjs',
  'qa-cash-payment-e2e.mjs',
  'qa-security-regression-e2e.mjs',
  'qa-pii-scoping-e2e.mjs',
  'qa-scheduled-functions-e2e.mjs',
  'qa-reconciliation-e2e.mjs',
  'qa-seat-accounting-e2e.mjs',
  'qa-search-radius-e2e.mjs',
  'qa-line-queue-e2e.mjs',
  'qa-operations-core-e2e.mjs',
  'qa-route-runs-e2e.mjs',
  'qa-driver-onboarding-e2e.mjs',
  'qa-manager-login-e2e.mjs',
  'qa-otp-auth-e2e.mjs',
  'qa-online-payments-e2e.mjs',
  'qa-referrals-e2e.mjs',
];

const results = [];

for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [path.join('scripts', suite)], {
    cwd: functionsDir,
    stdio: 'inherit',
    env: process.env,
  });
  const code = result.status ?? 1;
  results.push({ suite, code });
  if (code !== 0) {
    console.error(`\n❌ ${suite} exited with code ${code}`);
  }
}

const failed = results.filter((r) => r.code !== 0);

console.log('\n============================================================');
for (const { suite, code } of results) {
  console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  ${suite}`);
}
console.log('============================================================');

if (failed.length > 0) {
  console.error(`\n${failed.length} of ${results.length} QA suite(s) FAILED.\n`);
  process.exit(1);
}

console.log(`\nAll ${results.length} QA suites passed.\n`);
process.exit(0);
