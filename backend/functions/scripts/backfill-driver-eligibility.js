/* eslint-disable no-console */
const admin = require('firebase-admin');
const fs = require('node:fs');

function parseArgs(argv) {
  const args = {
    apply: false,
    projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'waselneh-prod-414e2',
    limit: 0,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      args.apply = true;
    } else if (token === '--project' && argv[i + 1]) {
      args.projectId = String(argv[i + 1]);
      i += 1;
    } else if (token === '--limit' && argv[i + 1]) {
      args.limit = Number(argv[i + 1]) || 0;
      i += 1;
    }
  }

  return args;
}

function toNonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const VEHICLE_DEFAULT_CAPACITY = {
  taxi_standard: 4,
  family_van: 6,
  minibus: 12,
  premium: 4,
};

function normalizeVehicleType(value) {
  const normalized = toNonEmptyString(value);
  if (!normalized) return null;
  return Object.prototype.hasOwnProperty.call(VEHICLE_DEFAULT_CAPACITY, normalized)
    ? normalized
    : null;
}

function normalizeSeatCapacity(value, fallbackVehicleType) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return Math.min(Math.max(rounded, 1), 14);
  }

  const fallback = normalizeVehicleType(fallbackVehicleType) || 'taxi_standard';
  return VEHICLE_DEFAULT_CAPACITY[fallback];
}

function computeEligibility(data) {
  const driverType = toNonEmptyString(data.driverType);
  const verificationStatus = toNonEmptyString(data.verificationStatus);
  const lineId = toNonEmptyString(data.lineId);
  const licenseId = toNonEmptyString(data.licenseId);

  const reasons = [];
  if (driverType !== 'licensed_line_owner') reasons.push('invalid_driver_type');
  if (verificationStatus !== 'approved') reasons.push('driver_not_approved');
  if (!lineId && !licenseId) reasons.push('missing_line_or_license_link');

  return { isEligible: reasons.length === 0, reasons, driverType, verificationStatus, lineId, licenseId };
}

async function main() {
  const args = parseArgs(process.argv);
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (
    credentialPath &&
    (credentialPath.includes('%CD%') || !fs.existsSync(credentialPath))
  ) {
    console.warn(
      `[Backfill] Ignoring invalid GOOGLE_APPLICATION_CREDENTIALS path: ${credentialPath}`
    );
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  admin.initializeApp({ projectId: args.projectId });

  const db = admin.firestore();
  let query = db.collection('drivers');
  if (args.limit > 0) {
    query = query.limit(args.limit);
  }

  const snapshot = await query.get();
  console.log(`[Backfill] drivers found: ${snapshot.size}`);
  console.log(`[Backfill] mode: ${args.apply ? 'APPLY' : 'DRY_RUN'}`);

  const batches = [];
  let batch = db.batch();
  let batchOps = 0;

  const counters = {
    touched: 0,
    missingDriverType: 0,
    missingVerificationStatus: 0,
    missingVehicleType: 0,
    normalizedSeatCapacity: 0,
    downgradedApprovedWithoutLink: 0,
    forcedOffline: 0,
    stillIneligible: 0,
  };

  const updatesPreview = [];

  for (const doc of snapshot.docs) {
    const current = doc.data() || {};
    const next = { ...current };
    const updates = {};

    if (!toNonEmptyString(current.driverType)) {
      updates.driverType = 'licensed_line_owner';
      counters.missingDriverType += 1;
      next.driverType = 'licensed_line_owner';
    }

    if (!toNonEmptyString(current.verificationStatus)) {
      updates.verificationStatus = 'pending';
      counters.missingVerificationStatus += 1;
      next.verificationStatus = 'pending';
    }

    const normalizedVehicleType = normalizeVehicleType(next.vehicleType);
    if (!normalizedVehicleType) {
      updates.vehicleType = 'taxi_standard';
      counters.missingVehicleType += 1;
      next.vehicleType = 'taxi_standard';
    } else {
      next.vehicleType = normalizedVehicleType;
    }

    const normalizedSeatCapacity = normalizeSeatCapacity(next.seatCapacity, next.vehicleType);
    if (next.seatCapacity !== normalizedSeatCapacity) {
      updates.seatCapacity = normalizedSeatCapacity;
      counters.normalizedSeatCapacity += 1;
      next.seatCapacity = normalizedSeatCapacity;
    }

    const normalizedLineId = toNonEmptyString(next.lineId);
    const normalizedLicenseId = toNonEmptyString(next.licenseId);

    if (next.verificationStatus === 'approved' && !normalizedLineId && !normalizedLicenseId) {
      updates.verificationStatus = 'pending';
      updates.eligibilityAutoDowngradedAt = admin.firestore.FieldValue.serverTimestamp();
      counters.downgradedApprovedWithoutLink += 1;
      next.verificationStatus = 'pending';
    }

    const eligibility = computeEligibility(next);
    if (!eligibility.isEligible) {
      counters.stillIneligible += 1;
    }

    const shouldForceOffline =
      current.isOnline === true || current.status === 'online' || current.isAvailable === true;

    if (!eligibility.isEligible && shouldForceOffline) {
      updates.isOnline = false;
      updates.isAvailable = false;
      updates.status = 'offline';
      updates.availability = 'offline';
      updates.eligibilityBlocked = true;
      updates.eligibilityBlockReasons = eligibility.reasons;
      counters.forcedOffline += 1;
    }

    if (Object.keys(updates).length === 0) {
      continue;
    }

    updates.eligibilityBackfilledAt = admin.firestore.FieldValue.serverTimestamp();
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    counters.touched += 1;
    updatesPreview.push({ driverId: doc.id, updates });

    if (args.apply) {
      batch.set(doc.ref, updates, { merge: true });
      batchOps += 1;

      if (batchOps >= 450) {
        batches.push(batch.commit());
        batch = db.batch();
        batchOps = 0;
      }
    }
  }

  if (args.apply && batchOps > 0) {
    batches.push(batch.commit());
  }

  console.log('[Backfill] summary:', counters);
  console.log('[Backfill] sample updates:', updatesPreview.slice(0, 20));

  if (args.apply) {
    await Promise.all(batches);
    console.log('[Backfill] APPLY complete.');
  } else {
    console.log('[Backfill] Dry-run complete. Re-run with --apply to persist changes.');
  }
}

main().catch((error) => {
  console.error('[Backfill] FAILED', error);
  process.exit(1);
});
