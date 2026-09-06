/* eslint-disable no-console */
/**
 * QA: manager payment-reconciliation classification.
 *
 * The classification that decides whether money counts as collected used to be inline
 * in PaymentReconciliationPage, so it was only verifiable by eye. It now lives in
 * apps/manager-web/src/services/reconciliation.ts as pure functions, and this suite
 * exercises them directly against fixtures.
 *
 * This deliberately does NOT need the emulator - the logic is pure - but it is wired
 * into pnpm qa:all so it runs with everything else and cannot rot unnoticed.
 *
 * NOTE ON WHAT THIS DOES AND DOES NOT COVER: it verifies the classification, not the
 * rendering. The page itself has never been run in a browser (see
 * FINAL_HARDENING_REPORT.md); this closes the part that is logic rather than pixels.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testResults = [];

function pass(name, details = '') {
  testResults.push({ name, pass: true, details });
  console.log(`✅ ${name}${details ? ` - ${details}` : ''}`);
}

function fail(name, details) {
  testResults.push({ name, pass: false, details });
  console.error(`❌ ${name} - ${details}`);
}

function check(name, actual, expected) {
  if (actual === expected) pass(name);
  else fail(name, `expected "${expected}", got "${actual}"`);
}

/**
 * The module is TypeScript in the manager-web app and there is no TS runtime here,
 * so strip the types with a minimal transform. The logic is plain JS; only type
 * annotations, interfaces and `import type` need removing.
 */
async function loadReconciliation() {
  const src = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'apps',
    'manager-web',
    'src',
    'services',
    'reconciliation.ts'
  );
  if (!fs.existsSync(src)) throw new Error(`not found: ${src}`);

  let code = fs.readFileSync(src, 'utf8');
  // Drop type-only declarations.
  code = code
    .replace(/^export type [\s\S]*?;$/gm, '')
    .replace(/^export interface [\s\S]*?^}$/gm, '')
    .replace(/^interface [\s\S]*?^}$/gm, '');
  // Drop type annotations on params/returns and generics.
  code = code
    .replace(/<[^<>()]*>\(/g, '(')
    .replace(/:\s*readonly\s+[A-Za-z][\w<>[\]|'". ]*(?=[,)])/g, '')
    .replace(/:\s*Map<[^>]*>/g, '')
    .replace(/:\s*[A-Za-z][\w<>[\]|'". ]*(?=\s*[,)])/g, '')
    .replace(/\)\s*:\s*[A-Za-z][\w<>[\]|'". ]*\s*\{/g, ') {');

  const dataUrl =
    'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');
  return import(dataUrl);
}

async function main() {
  let mod;
  try {
    mod = await loadReconciliation();
  } catch (error) {
    fail('load reconciliation module', error instanceof Error ? error.message : String(error));
    console.log('\n[QA] Reconciliation summary -> total: 1, passed: 0, failed: 1');
    process.exit(1);
  }

  const { classifyTrip, indexPaymentsByTrip, findOrphanedPayments, summarize } = mod;

  const payment = (tripId) => ({ paymentId: `pay_${tripId}`, tripId });

  // ===========================================================================
  // The four states the manager actually acts on.
  // ===========================================================================
  check(
    'COLLECTED: trip paid + payment record exists',
    classifyTrip({ tripId: 't1', paymentStatus: 'paid' }, payment('t1')),
    'collected'
  );

  check(
    'UNCOLLECTED: trip completed but payment still pending',
    classifyTrip({ tripId: 't2', paymentStatus: 'pending' }, null),
    'uncollected'
  );

  check(
    'UNRECORDED: trip says paid but NO payment document',
    classifyTrip({ tripId: 't3', paymentStatus: 'paid' }, null),
    'unrecorded'
  );

  // A pending trip that somehow has a payment row is still "uncollected" as far as
  // the trip is concerned - the trip is the source of truth for whether the ride
  // was paid for, the ledger row alone does not settle it.
  check(
    'UNCOLLECTED: pending trip with a stray payment row is not "collected"',
    classifyTrip({ tripId: 't4', paymentStatus: 'pending' }, payment('t4')),
    'uncollected'
  );

  // An unknown/garbage status must never be read as paid.
  check(
    'UNCOLLECTED: unknown paymentStatus is never treated as paid',
    classifyTrip({ tripId: 't5', paymentStatus: 'weird_value' }, payment('t5')),
    'uncollected'
  );

  check(
    'UNCOLLECTED: failed payment status is not collected',
    classifyTrip({ tripId: 't6', paymentStatus: 'failed' }, payment('t6')),
    'uncollected'
  );

  // ===========================================================================
  // ORPHANED payments: a ledger row whose trip is not in the set.
  // ===========================================================================
  try {
    const trips = [
      { tripId: 'a', paymentStatus: 'paid' },
      { tripId: 'b', paymentStatus: 'pending' },
    ];
    const payments = [payment('a'), payment('zzz-missing')];
    const orphans = findOrphanedPayments(payments, trips);
    if (orphans.length === 1 && orphans[0].tripId === 'zzz-missing') {
      pass('ORPHANED: a payment whose trip is absent is flagged');
    } else {
      fail(
        'ORPHANED: a payment whose trip is absent is flagged',
        `got ${JSON.stringify(orphans.map((o) => o.tripId))}`
      );
    }
  } catch (error) {
    fail('ORPHANED: a payment whose trip is absent is flagged', String(error));
  }

  try {
    const orphans = findOrphanedPayments([payment('a')], [{ tripId: 'a', paymentStatus: 'paid' }]);
    if (orphans.length === 0) pass('ORPHANED: a matched payment is NOT flagged as orphaned');
    else fail('ORPHANED: a matched payment is NOT flagged as orphaned', `got ${orphans.length}`);
  } catch (error) {
    fail('ORPHANED: a matched payment is NOT flagged as orphaned', String(error));
  }

  // ===========================================================================
  // The join and the totals.
  // ===========================================================================
  try {
    const idx = indexPaymentsByTrip([payment('x'), payment('y')]);
    if (idx.get('x')?.paymentId === 'pay_x' && idx.get('nope') === undefined) {
      pass('index: payments are matched to trips by tripId');
    } else {
      fail('index: payments are matched to trips by tripId', 'lookup mismatch');
    }
  } catch (error) {
    fail('index: payments are matched to trips by tripId', String(error));
  }

  try {
    // A payment with an empty tripId must not become a wildcard match.
    const idx = indexPaymentsByTrip([{ paymentId: 'p0', tripId: '' }, payment('x')]);
    if (idx.size === 1 && idx.has('x')) {
      pass('index: a payment with no tripId is ignored, not matched to everything');
    } else {
      fail(
        'index: a payment with no tripId is ignored, not matched to everything',
        `map size ${idx.size}`
      );
    }
  } catch (error) {
    fail('index: a payment with no tripId is ignored, not matched to everything', String(error));
  }

  try {
    const totals = summarize(['collected', 'collected', 'uncollected', 'unrecorded']);
    if (
      totals.collectedCount === 2 &&
      totals.uncollectedCount === 1 &&
      totals.unrecordedCount === 1
    ) {
      pass('totals: per-state counts are correct');
    } else {
      fail('totals: per-state counts are correct', JSON.stringify(totals));
    }
  } catch (error) {
    fail('totals: per-state counts are correct', String(error));
  }

  const passed = testResults.filter((t) => t.pass).length;
  const failed = testResults.filter((t) => !t.pass).length;
  console.log(
    `\n[QA] Reconciliation summary -> total: ${testResults.length}, passed: ${passed}, failed: ${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Reconciliation FAILED', error);
  process.exit(1);
});
