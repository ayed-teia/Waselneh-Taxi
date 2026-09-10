#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Wipes ALL Firestore data and ALL Auth users from the LOCAL EMULATOR.
 *
 * EMULATOR ONLY. It refuses to run unless FIRESTORE_EMULATOR_HOST is set, and it
 * deletes GOOGLE_APPLICATION_CREDENTIALS first, so it cannot reach a real project.
 *
 * Usage: node scripts/clear-local-demo.mjs
 */
import admin from 'firebase-admin';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = `${host}:8080`;
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${host}:9099`;
}
// A real service-account credential must never be used here.
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Belt and braces: the emulator host must be loopback. Anything else is a mistake.
const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost|\[::1\]):/.test(fsHost)) {
  console.error(`Refusing to run: FIRESTORE_EMULATOR_HOST is "${fsHost}", not a local emulator.`);
  process.exit(1);
}

async function deleteCollection(db, ref) {
  let removed = 0;
  for (;;) {
    const snap = await ref.limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) {
      // Subcollections are not removed by deleting the parent, so recurse first.
      for (const sub of await doc.ref.listCollections()) {
        removed += await deleteCollection(db, sub);
      }
      batch.delete(doc.ref);
    }
    await batch.commit();
    removed += snap.size;
  }
  return removed;
}

async function main() {
  const app = admin.initializeApp({ projectId }, `clear-${Date.now()}`);
  const db = app.firestore();

  console.log(`Clearing emulator data for project "${projectId}" at ${fsHost}\n`);

  const collections = await db.listCollections();
  if (collections.length === 0) {
    console.log('  (Firestore already empty)');
  }
  let total = 0;
  for (const col of collections) {
    const n = await deleteCollection(db, col);
    total += n;
    console.log(`  - ${col.id}: ${n} document(s) deleted`);
  }

  // Auth users too, otherwise a stale dev uid can still sign in.
  const auth = app.auth();
  let deletedUsers = 0;
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    const uids = page.users.map((u) => u.uid);
    if (uids.length > 0) {
      await auth.deleteUsers(uids);
      deletedUsers += uids.length;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(`  - auth users: ${deletedUsers} deleted`);

  await app.delete().catch(() => undefined);
  console.log(`\nDone. ${total} Firestore document(s) and ${deletedUsers} auth user(s) removed.`);
  console.log('The emulator is now empty. Re-seed with: node scripts/seed-local-demo.mjs');
}

main().catch((error) => {
  console.error('Clear FAILED:', error);
  process.exit(1);
});
