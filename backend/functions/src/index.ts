/**
 * Taxi Line Platform - Firebase Cloud Functions
 *
 * All business logic lives here.
 * Frontend apps call these functions and listen to Firestore in read-only mode.
 */

import { initializeFirebase } from './core/config';

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
  // Step 32: Cancel flows and kill switch
  passengerCancelTrip,
  driverCancelTrip,
  managerForceCancelTrip,
  managerToggleTrips,
  getSystemConfigCallable,
  // Step 33: Feature flag toggle
  managerToggleFeatureFlag,
} from './api/callable';

// ============================================================================
// Auth Module Functions
// ============================================================================
// TODO: Export auth functions

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
