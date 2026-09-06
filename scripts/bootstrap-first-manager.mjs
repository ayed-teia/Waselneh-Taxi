#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ============================================================================
 * BOOTSTRAP THE FIRST MANAGER
 * ============================================================================
 *
 * WHY THIS EXISTS
 * After the R1 privilege-escalation fix, `managerRoles/{uid}` is the ONLY source of
 * truth for manager RBAC. Firestore rules no longer trust `users/{uid}.role`, and
 * `match /managerRoles/{uid}` allows `write: if isManager()` - so creating the very
 * first manager is a chicken-and-egg problem that CANNOT be solved from any client.
 * That is deliberate: it is exactly the hole R1 closed.
 *
 * This script breaks the deadlock the only safe way: with the Admin SDK, which
 * bypasses Firestore rules, run once by an operator who already holds project
 * credentials.
 *
 * RUN IT ONCE, BY A HUMAN, DELIBERATELY.
 * It is not part of any build, deploy or CI step, and nothing calls it automatically.
 *
 * ----------------------------------------------------------------------------
 * ORDER MATTERS
 * ----------------------------------------------------------------------------
 * Run this BEFORE deploying the new firestore.rules. Deploying the hardened rules
 * first locks every human out of the manager dashboard until a manager exists.
 * See docs/PROD_DEPLOY_RUNBOOK.md for the full ordered procedure.
 *
 * ----------------------------------------------------------------------------
 * USAGE
 * ----------------------------------------------------------------------------
 *   # 1. Point at the target project with credentials that can write Firestore:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json
 *   export GCLOUD_PROJECT=waselneh-prod-414e2
 *
 *   # 2. Dry run first - shows exactly what WOULD be written, writes nothing:
 *   node scripts/bootstrap-first-manager.mjs --uid=<FIREBASE_AUTH_UID>
 *
 *   # 3. Then commit to it:
 *   node scripts/bootstrap-first-manager.mjs --uid=<FIREBASE_AUTH_UID> --confirm
 *
 * Options:
 *   --uid=<uid>       REQUIRED. The Firebase Auth UID to make an admin. This is the
 *                     Auth UID (console > Authentication > Users), not an email.
 *   --confirm         REQUIRED to actually write. Without it, this is a dry run.
 *   --role=<role>     Default 'admin'. One of: admin, manager, operations_manager,
 *                     dispatcher, support.
 *   --project=<id>    Overrides GCLOUD_PROJECT.
 *   --claims          Also set the custom auth claims (role/managerRole). Optional;
 *                     the managerRoles document alone is enough for both the rules
 *                     and the backend. The user must re-authenticate for claims to
 *                     take effect.
 *
 * SAFETY
 *   - Refuses to run without BOTH --uid and --confirm (dry run otherwise).
 *   - Refuses to run against the Firestore emulator, so a bootstrap intended for
 *     production cannot silently land in a throwaway emulator (and vice versa).
 *   - Refuses to overwrite an existing managerRoles/{uid} document unless --force.
 *   - Verifies the UID actually exists in Firebase Auth before writing, so a typo
 *     cannot create a role document for a nonexistent account.
 *   - Prints the exact document it will write, and re-reads it back afterwards.
 * ============================================================================
 */

import process from 'node:process';

import admin from 'firebase-admin';

const VALID_ROLES = ['admin', 'manager', 'operations_manager', 'dispatcher', 'support'];

function parseArgs(argv) {
  const args = { confirm: false, force: false, claims: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--confirm') args.confirm = true;
    else if (raw === '--force') args.force = true;
    else if (raw === '--claims') args.claims = true;
    else if (raw.startsWith('--uid=')) args.uid = raw.slice('--uid='.length).trim();
    else if (raw.startsWith('--role=')) args.role = raw.slice('--role='.length).trim();
    else if (raw.startsWith('--project=')) args.project = raw.slice('--project='.length).trim();
    else {
      console.error(`Unknown argument: ${raw}`);
      process.exit(2);
    }
  }
  return args;
}

function die(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);

  // --- refuse to run against an emulator ------------------------------------
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR === 'true') {
    die(
      'Refusing to run: emulator environment variables are set.\n' +
        '   This script is for a REAL project. For local development use the\n' +
        '   emulator-only callable devIssueManagerToken instead.\n' +
        `   FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST ?? '(unset)'}`
    );
  }

  const projectId = args.project || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) {
    die('No project id. Set GCLOUD_PROJECT or pass --project=<project-id>.');
  }

  if (!args.uid) {
    die('--uid=<FIREBASE_AUTH_UID> is required.\n   Find it in the Firebase console under Authentication > Users.');
  }

  const role = args.role || 'admin';
  if (!VALID_ROLES.includes(role)) {
    die(`Invalid --role="${role}". Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn(
      '⚠️  GOOGLE_APPLICATION_CREDENTIALS is not set. Falling back to application-default\n' +
        '   credentials. Make sure they point at the intended project.\n'
    );
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const auth = admin.auth();

  console.log('\n============================================================');
  console.log('  BOOTSTRAP FIRST MANAGER');
  console.log('============================================================');
  console.log(`  project : ${projectId}`);
  console.log(`  uid     : ${args.uid}`);
  console.log(`  role    : ${role}`);
  console.log(`  mode    : ${args.confirm ? 'WRITE' : 'DRY RUN (no writes)'}`);
  console.log('============================================================\n');

  // --- the UID must actually exist ------------------------------------------
  let userRecord;
  try {
    userRecord = await auth.getUser(args.uid);
  } catch {
    die(
      `No Firebase Auth user with uid "${args.uid}" in project ${projectId}.\n` +
        '   Check the uid in the console (Authentication > Users). Refusing to create\n' +
        '   a manager role for an account that does not exist.'
    );
  }
  console.log(
    `✅ Auth user found: ${userRecord.email || userRecord.phoneNumber || '(no email/phone)'}`
  );

  // --- do not clobber an existing role silently -----------------------------
  const roleRef = db.collection('managerRoles').doc(args.uid);
  const existing = await roleRef.get();
  if (existing.exists && !args.force) {
    const data = existing.data() ?? {};
    die(
      `managerRoles/${args.uid} already exists (role="${data.role}", isActive=${data.isActive}).\n` +
        '   This script is for bootstrapping the FIRST manager. Refusing to overwrite.\n' +
        '   Use the managerUpsertStaffRole callable to change an existing role, or pass\n' +
        '   --force if you are certain you want to overwrite it.'
    );
  }

  // Report whether a manager already exists at all - if one does, you probably
  // do not need this script.
  const anyManager = await db.collection('managerRoles').limit(5).get();
  if (!anyManager.empty) {
    console.warn(
      `⚠️  ${anyManager.size}+ managerRoles document(s) already exist in this project.\n` +
        '   Bootstrapping may not be necessary - prefer managerUpsertStaffRole.\n'
    );
  }

  const payload = {
    uid: args.uid,
    role,
    permissions: [], // empty => the backend applies the role's default permissions
    officeIds: [], // empty office + line => global scope
    lineIds: [],
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'bootstrap-first-manager-script',
    bootstrappedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  console.log('Document to write at managerRoles/' + args.uid + ':');
  console.log(JSON.stringify({ ...payload, createdAt: '<serverTimestamp>', updatedAt: '<serverTimestamp>', bootstrappedAt: '<serverTimestamp>' }, null, 2));
  console.log('');

  if (!args.confirm) {
    console.log('DRY RUN - nothing was written.');
    console.log('Re-run with --confirm to apply:\n');
    console.log(
      `  node scripts/bootstrap-first-manager.mjs --uid=${args.uid} --role=${role} --confirm\n`
    );
    process.exit(0);
  }

  await roleRef.set(payload, { merge: true });
  console.log(`✅ Wrote managerRoles/${args.uid}`);

  if (args.claims) {
    await auth.setCustomUserClaims(args.uid, {
      role: role === 'admin' ? 'admin' : 'manager',
      managerRole: role,
    });
    console.log('✅ Set custom auth claims (the user must sign out and back in).');
  }

  // Read back, so the operator sees what actually landed.
  const written = await roleRef.get();
  const data = written.data() ?? {};
  console.log('\nRead back from Firestore:');
  console.log(
    JSON.stringify(
      { uid: data.uid, role: data.role, isActive: data.isActive, permissions: data.permissions, officeIds: data.officeIds, lineIds: data.lineIds },
      null,
      2
    )
  );

  console.log('\n✅ Done. Next steps (see docs/PROD_DEPLOY_RUNBOOK.md):');
  console.log('   1. Set ENVIRONMENT=prod on the deployed functions.');
  console.log('   2. Deploy firestore rules + functions.');
  console.log('   3. Sign in to the manager dashboard as this user and verify access.\n');

  await admin.app().delete();
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ bootstrap-first-manager FAILED');
  console.error(error);
  process.exit(1);
});
