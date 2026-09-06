#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ============================================================================
 * MIGRATE DRIVER PII INTO drivers/{driverId}/private/pii
 * ============================================================================
 *
 * WHY
 * `nationalId`, `phone` and the driver's legal `fullName` used to live on the
 * `drivers/{driverId}` document. Firestore read rules are per-DOCUMENT, not per-field,
 * so the passenger on an active trip - who legitimately reads that document for the
 * driver card - received the PII with it. (Before the read-scoping fix, ANY
 * authenticated user could read and enumerate all of them.)
 *
 * This script moves those fields into a private subcollection that only the driver and
 * managers can read, and seeds `displayName` on the parent document so the passenger
 * app still has a name to render.
 *
 * WHAT IT DOES, PER DRIVER
 *   1. writes  drivers/{id}/private/pii   <- { fullName, nationalId, phone }
 *   2. sets    drivers/{id}.displayName   <- displayName ?? fullName   (if not set)
 *   3. deletes drivers/{id}.fullName, .nationalId, .phone
 *
 * Steps 1 and 2/3 run in ONE batched write per driver, so a driver is never left with
 * their PII deleted but not copied.
 *
 * ----------------------------------------------------------------------------
 * SAFETY - READ THIS
 * ----------------------------------------------------------------------------
 *   - DRY RUN BY DEFAULT. Without --confirm it only reports what it would do.
 *   - Requires an explicit --project, so it cannot silently hit a default project.
 *   - Refuses to touch production unless you ALSO pass --i-understand-this-is-prod.
 *   - Idempotent: a driver whose PII doc already exists and whose parent doc is
 *     already clean is skipped. Safe to re-run after an interruption.
 *   - --backup=<file> writes every pre-migration driver document to a local JSON file
 *     before any change. STRONGLY recommended; the deletion is not reversible without it.
 *
 * THIS HAS NEVER BEEN RUN AGAINST ANY REAL PROJECT. Run it against the emulator or a
 * staging copy first, verify the manager dashboard and a passenger trip still work,
 * and take the backup.
 *
 * ----------------------------------------------------------------------------
 * USAGE
 * ----------------------------------------------------------------------------
 *   # dry run against the emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node scripts/migrate-driver-pii.mjs --project=waselneh-prod-414e2
 *
 *   # apply, with a backup
 *   node scripts/migrate-driver-pii.mjs --project=<id> \
 *     --backup=./driver-backup.json --confirm
 *
 * Options:
 *   --project=<id>                  REQUIRED.
 *   --confirm                       Actually write. Omitted => dry run.
 *   --backup=<path>                 Write pre-migration driver docs to this JSON file.
 *   --i-understand-this-is-prod     Required in addition to --confirm for waselneh-prod-*.
 *   --limit=<n>                     Process at most n drivers (useful for a first pass).
 * ============================================================================
 */

import fs from 'node:fs';
import process from 'node:process';

import admin from 'firebase-admin';

const PII_FIELDS = ['fullName', 'nationalId', 'phone'];

function parseArgs(argv) {
  const args = { confirm: false, prodAck: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--confirm') args.confirm = true;
    else if (raw === '--i-understand-this-is-prod') args.prodAck = true;
    else if (raw.startsWith('--project=')) args.project = raw.slice('--project='.length).trim();
    else if (raw.startsWith('--backup=')) args.backup = raw.slice('--backup='.length).trim();
    else if (raw.startsWith('--limit=')) args.limit = Number(raw.slice('--limit='.length));
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

  if (!args.project) {
    die('--project=<project-id> is required. Refusing to guess the target project.');
  }
  if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit <= 0)) {
    die('--limit must be a positive number.');
  }

  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const looksLikeProd = /prod/i.test(args.project) && !isEmulator;

  if (looksLikeProd && args.confirm && !args.prodAck) {
    die(
      `Refusing to write to "${args.project}" (looks like production).\n` +
        '   Re-run with --i-understand-this-is-prod if that is genuinely intended,\n' +
        '   and take a --backup first.'
    );
  }

  admin.initializeApp({ projectId: args.project });
  const db = admin.firestore();

  console.log('\n============================================================');
  console.log('  MIGRATE DRIVER PII -> drivers/{id}/private/pii');
  console.log('============================================================');
  console.log(`  project : ${args.project}`);
  console.log(`  target  : ${isEmulator ? `EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST})` : 'REAL PROJECT'}`);
  console.log(`  mode    : ${args.confirm ? 'WRITE' : 'DRY RUN (no writes)'}`);
  console.log(`  backup  : ${args.backup || '(none - not recommended for a real run)'}`);
  console.log('============================================================\n');

  const snapshot = await db.collection('drivers').get();
  let docs = snapshot.docs;
  if (args.limit) docs = docs.slice(0, args.limit);

  console.log(`Found ${snapshot.size} driver document(s); processing ${docs.length}.\n`);

  if (args.backup) {
    const backup = docs.map((d) => ({ id: d.id, data: d.data() }));
    fs.writeFileSync(args.backup, JSON.stringify(backup, null, 2));
    console.log(`💾 Wrote pre-migration backup of ${backup.length} document(s) to ${args.backup}\n`);
  } else if (args.confirm) {
    console.warn('⚠️  No --backup given. The PII field deletion is NOT reversible without one.\n');
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of docs) {
    const driverId = docSnap.id;
    const data = docSnap.data() ?? {};

    const present = PII_FIELDS.filter((f) => data[f] !== undefined);
    const piiRef = db.collection('drivers').doc(driverId).collection('private').doc('pii');
    const existingPii = await piiRef.get();

    if (present.length === 0 && existingPii.exists) {
      skipped++;
      console.log(`  ⏭  ${driverId}: already migrated`);
      continue;
    }
    if (present.length === 0 && !existingPii.exists) {
      skipped++;
      console.log(`  ⏭  ${driverId}: no PII fields to move`);
      continue;
    }

    const pii = {
      driverId,
      fullName: typeof data.fullName === 'string' ? data.fullName : null,
      nationalId: typeof data.nationalId === 'string' ? data.nationalId : null,
      phone: typeof data.phone === 'string' ? data.phone : null,
    };

    // Keep a passenger-facing name on the parent doc.
    const displayName =
      typeof data.displayName === 'string' && data.displayName.trim()
        ? data.displayName
        : pii.fullName;

    console.log(
      `  →  ${driverId}: move [${present.join(', ')}]` +
        (displayName && !data.displayName ? `, set displayName="${displayName}"` : '')
    );

    if (!args.confirm) continue;

    try {
      // One batch, so PII is never deleted without having been copied.
      const batch = db.batch();
      batch.set(
        piiRef,
        {
          ...pii,
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
          migratedBy: 'migrate-driver-pii-script',
        },
        { merge: true }
      );

      const parentUpdate = {};
      for (const field of PII_FIELDS) {
        if (data[field] !== undefined) {
          parentUpdate[field] = admin.firestore.FieldValue.delete();
        }
      }
      if (displayName && !data.displayName) parentUpdate.displayName = displayName;

      batch.update(docSnap.ref, parentUpdate);
      await batch.commit();
      migrated++;
    } catch (error) {
      failed++;
      console.error(`  ❌ ${driverId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n------------------------------------------------------------');
  console.log(`  processed : ${docs.length}`);
  console.log(`  migrated  : ${migrated}`);
  console.log(`  skipped   : ${skipped}`);
  console.log(`  failed    : ${failed}`);
  console.log('------------------------------------------------------------');

  if (!args.confirm) {
    console.log('\nDRY RUN - nothing was written. Re-run with --confirm to apply.\n');
  } else {
    console.log('\n✅ Done. Verify: the manager drivers list still shows national IDs and');
    console.log('   phones, and a passenger on an active trip still sees the driver card.\n');
  }

  await admin.app().delete();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\n❌ migrate-driver-pii FAILED');
  console.error(error);
  process.exit(1);
});
