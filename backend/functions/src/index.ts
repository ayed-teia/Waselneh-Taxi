/**
 * Taxi Line Platform - Firebase Cloud Functions
 *
 * All business logic lives here.
 * Frontend apps call these functions and listen to Firestore in read-only mode.
 */

import { initializeFirebase } from './core/config';

// Initialize Firebase Admin SDK
initializeFirebase();

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
  driverArrived,
  startTrip,
  completeTrip,
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
// TODO: Export trip functions

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
