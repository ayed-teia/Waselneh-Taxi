/**
 * Dev Mode Authentication Helper
 * 
 * In emulator/dev mode, allows bypassing Firebase Auth for testing.
 * The client can pass a `devUserId` in the request data which will be used
 * as the authenticated user ID.
 * 
 * ⚠️ SECURITY WARNING: this bypasses Firebase Auth entirely, so it must be reachable
 * ONLY from the local emulator. It is gated on the two variables the Firebase emulator
 * sets automatically and that a deployed function never has:
 *   - FUNCTIONS_EMULATOR === 'true'
 *   - FIRESTORE_EMULATOR_HOST
 */

import { CallableRequest } from 'firebase-functions/v2/https';
import { logger } from '../logger';

/**
 * Check if we are genuinely running inside the Firebase emulator.
 *
 * SECURITY (R2): this previously also returned true when ENVIRONMENT === 'dev'.
 * ENVIRONMENT is a plain configurable variable that DEFAULTS to 'dev'
 * (see core/env/env.ts), so any deployed environment that had not explicitly
 * overridden it would accept an unauthenticated caller's `devUserId` and act as
 * that user - a complete authentication bypass reachable from the public internet.
 *
 * The gate is now exactly the two variables the emulator sets automatically and
 * that a deployed Cloud Function never has. This intentionally matches
 * isEmulatorEnvironment() in core/config/firebase.config.ts.
 */
export function isEmulatorMode(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.FIRESTORE_EMULATOR_HOST !== undefined
  );
}

/**
 * Get the user ID from a callable request.
 * 
 * In production: Uses request.auth.uid (Firebase Auth)
 * In dev/emulator: Falls back to request.data.devUserId if no auth
 * 
 * @param request - The callable request
 * @returns User ID or null if not authenticated
 */
export function getAuthenticatedUserId(request: CallableRequest<unknown>): string | null {
  // First check Firebase Auth
  if (request.auth?.uid) {
    return request.auth.uid;
  }

  // In emulator mode, allow devUserId fallback
  if (isEmulatorMode()) {
    const data = request.data as { devUserId?: string } | undefined;
    if (data?.devUserId) {
      logger.info('🔧 [DevAuth] Using dev mode user ID', { devUserId: data.devUserId });
      return data.devUserId;
    }
  }

  return null;
}

/**
 * Require authentication - throws if not authenticated
 * 
 * @param request - The callable request
 * @param context - Context for error message (e.g., "create trip")
 * @returns User ID
 * @throws UnauthorizedError if not authenticated
 */
export function requireAuth(request: CallableRequest<unknown>, context: string): string {
  const userId = getAuthenticatedUserId(request);
  
  if (!userId) {
    throw new Error(`Authentication required to ${context}`);
  }

  return userId;
}
