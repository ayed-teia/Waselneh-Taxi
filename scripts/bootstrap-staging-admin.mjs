#!/usr/bin/env node
/**
 * ============================================================================
 * ONE-TIME STAGING ADMIN BOOTSTRAP
 * ============================================================================
 *
 * Creates the first `managerRoles/{uid}` document in STAGING so a human can sign
 * in to Manager Web. Nothing else can create it: `managerRoles` is
 * `allow write: if false` for clients, and every manager callable requires an
 * active document, so without this the dashboard is unreachable by design.
 *
 * WHY A DEDICATED SCRIPT WITH A HARD PROJECT CHECK
 *
 * This grants full administrative authority. Every deploy and backfill script in
 * this repository targets a project by name, and one wrong name here would mint
 * an admin in PRODUCTION. So the project is required on the command line, must
 * match staging exactly, and production is rejected by name.
 *
 * NO CREDENTIALS ARE EMBEDDED. Authentication comes from the ambient Google
 * credentials (GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth
 * application-default login`).
 *
 * It does NOT create a Firebase Auth user, and does not know or ask for an email
 * or password. Create the user first (Console or CLI), then pass its UID here.
 * Identity and authorization stay separate: the password proves who you are,
 * `managerRoles/{uid}` decides what you may do.
 *
 * USAGE
 *
 *   # 1. Dry run - prints what WOULD be written, touches nothing.
 *   node scripts/bootstrap-staging-admin.mjs \
 *     --project waselneh-staging-ayed --uid <FIREBASE_AUTH_UID> --dry-run
 *
 *   # 2. Apply.
 *   node scripts/bootstrap-staging-admin.mjs \
 *     --project waselneh-staging-ayed --uid <FIREBASE_AUTH_UID>
 *
 *   # Optional: also set custom claims (satisfies firestore.rules hasManagerClaim()
 *   # without a document read). The managerRoles document remains the source of
 *   # truth for callables either way.
 *   node scripts/bootstrap-staging-admin.mjs \
 *     --project waselneh-staging-ayed --uid <UID> --set-claims
 *
 * Find a UID: Firebase Console -> Authentication -> Users -> the "User UID" column.
 * ============================================================================
 */

import admin from 'firebase-admin';

const STAGING_PROJECT_ID = 'waselneh-staging-ayed';
const PRODUCTION_PROJECT_ID = 'waselneh-prod-414e2';

function fail(message) {
  console.error(`\n[bootstrap] ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { project: '', uid: '', dryRun: false, setClaims: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--project' && argv[i + 1]) {
      args.project = String(argv[i + 1]);
      i += 1;
    } else if (token === '--uid' && argv[i + 1]) {
      args.uid = String(argv[i + 1]).trim();
      i += 1;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--set-claims') {
      args.setClaims = true;
    } else {
      fail(`Unknown argument: ${token}`);
    }
  }
  return args;
}

const args = parseArgs(process.argv);

// --- Project gate -----------------------------------------------------------
if (!args.project) {
  fail(`--project is required. This script only ever targets ${STAGING_PROJECT_ID}.`);
}
if (args.project === PRODUCTION_PROJECT_ID) {
  fail(
    `REFUSING to touch production (${PRODUCTION_PROJECT_ID}).\n` +
      `This script exists for staging only.`
  );
}
if (args.project !== STAGING_PROJECT_ID) {
  fail(`--project must be exactly "${STAGING_PROJECT_ID}" (received "${args.project}").`);
}
if (!args.uid) {
  fail(
    '--uid is required: the Firebase Auth UID of an EXISTING user.\n' +
      'Firebase Console -> Authentication -> Users -> "User UID".\n' +
      'This script never creates users and never handles passwords.'
  );
}

// Refuse to run against an emulator: this is a real-project operation, and a
// silently-set env var would make the write vanish into a local emulator.
if (process.env.FIRESTORE_EMULATOR_HOST) {
  fail(
    `FIRESTORE_EMULATOR_HOST is set (${process.env.FIRESTORE_EMULATOR_HOST}).\n` +
      'Unset it: this bootstrap targets the real staging project.'
  );
}

const app = admin.initializeApp({ projectId: args.project });
const db = app.firestore();

/**
 * The document shape getManagerProfile() requires.
 *
 * `permissions: []` is deliberate, not a placeholder: an empty array makes the
 * backend fall back to the role defaults, so admin capabilities stay defined in
 * one place (rbac.config.ts) rather than being frozen into this document.
 *
 * `isActive` must be literally true - both the backend and firestore.rules gate
 * on `=== true`, so a missing field fails closed on both sides.
 */
const managerRole = {
  uid: args.uid,
  role: 'admin',
  permissions: [],
  officeIds: [],
  lineIds: [],
  isActive: true,
  updatedBy: 'bootstrap',
};

async function main() {
  const ref = db.collection('managerRoles').doc(args.uid);
  const existing = await ref.get();

  console.log('');
  console.log(`  project   : ${args.project}`);
  console.log(`  uid       : ${args.uid}`);
  console.log(`  document  : managerRoles/${args.uid}`);
  console.log(`  exists    : ${existing.exists ? 'YES (will be merged)' : 'no (will be created)'}`);
  console.log(`  set claims: ${args.setClaims ? 'yes' : 'no'}`);
  console.log(`  mode      : ${args.dryRun ? 'DRY RUN - nothing is written' : 'APPLY'}`);
  console.log('');
  console.log('  document to write:');
  console.log(
    JSON.stringify(
      { ...managerRole, createdAt: '<serverTimestamp>', updatedAt: '<serverTimestamp>' },
      null,
      2
    )
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')
  );
  console.log('');

  if (existing.exists) {
    const current = existing.data() ?? {};
    console.log(
      `  NOTE: a document already exists (role=${current.role}, isActive=${current.isActive}).`
    );
    console.log('  It will be merged, not replaced.');
    console.log('');
  }

  // Verify the Auth user exists before writing an authorization document for it.
  // A managerRoles document for a non-existent uid is dead weight nobody can use.
  try {
    const user = await app.auth().getUser(args.uid);
    console.log(`  auth user : found (${user.email ?? 'no email'})`);
  } catch {
    fail(
      `No Firebase Auth user with uid "${args.uid}" in ${args.project}.\n` +
        'Create the user first (Console -> Authentication -> Add user), then re-run.'
    );
  }

  if (args.dryRun) {
    console.log('\n  Dry run complete. Re-run without --dry-run to apply.\n');
    return;
  }

  await ref.set(
    {
      ...managerRole,
      createdAt: existing.exists
        ? (existing.data()?.createdAt ?? admin.firestore.FieldValue.serverTimestamp())
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`  ✓ wrote managerRoles/${args.uid}`);

  if (args.setClaims) {
    // Optional. firestore.rules accepts either a claim or an active document;
    // the callables only read the document. Claims need a token refresh
    // (sign out and back in) before they take effect.
    await app.auth().setCustomUserClaims(args.uid, { role: 'admin', managerRole: 'admin' });
    console.log('  ✓ set custom claims { role: admin, managerRole: admin }');
    console.log('    The user must sign out and in again for claims to appear in their token.');
  }

  console.log('\n  Done. Sign in to Manager Web with this user.\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n[bootstrap] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
