/**
 * Taxi Line Platform - Firebase Cloud Functions
 *
 * All business logic lives here.
 * Frontend apps call these functions and listen to Firestore in read-only mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import { initializeFirebase } from './core/config';

function loadEnvFromFileIfNeeded(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/functions/.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();

      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }

    return;
  }
}

loadEnvFromFileIfNeeded();

// Initialize Firebase Admin SDK
initializeFirebase();

console.log('MAPBOX TOKEN BACKEND:', !!(process.env.MAPBOX_ACCESS_TOKEN || '').trim());
if (!(process.env.MAPBOX_ACCESS_TOKEN || '').trim()) {
  console.error(
    '[Mapbox] MAPBOX_ACCESS_TOKEN is missing in backend/functions/.env (or runtime env). Route estimation will use mock fallback.'
  );
}

// ============================================================================
// HTTP Endpoints
// ============================================================================
export { health } from './api/http';

// ============================================================================
// Callable Functions
// ============================================================================
export {
  ping,
  estimateTrip,
  createTripRequest,
  dispatchTripRequest,
  acceptTripRequest,
  rejectTripRequest,
  driverArrived,
  startTrip,
  completeTrip,
  submitRating,
  submitPassengerRating,
  createSupportTicket,
  getDriverEarningsSummary,
  // Step 32: Cancel flows and kill switch
  passengerCancelTrip,
  driverCancelTrip,
  managerForceCancelTrip,
  managerToggleTrips,
  managerSetDriverEligibility,
  getSystemConfigCallable,
  // Step 33: Feature flag toggle
  managerToggleFeatureFlag,
} from './api/callable';

// ============================================================================
// Auth Module Functions
// ============================================================================
export { enforceDriverEligibility } from './modules/auth';

// ============================================================================
// Users Module Functions
// ============================================================================
// TODO: Export user functions

// ============================================================================
// Trips Module Functions
// ============================================================================
export { expireDriverRequests, expireStaleTrips } from './modules/trips';

// ============================================================================
// Pricing Module Functions
// ============================================================================
// TODO: Export pricing functions

// ============================================================================
// Matching Module Functions
// ============================================================================
// TODO: Export matching functions

// ============================================================================
// Notifications Module Functions
// ============================================================================
// TODO: Export notification functions
