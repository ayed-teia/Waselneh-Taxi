import firebase from 'firebase/compat/app';

import { callFunction } from '../api/callable';
import { firebaseAuth } from '../firebase';
import type { User } from '../firebase';

/**
 * ============================================================================
 * PHONE / OTP SIGN-IN
 * ============================================================================
 *
 * BEHIND A FLAG, DEFAULT OFF. `isPhoneAuthEnabled()` (packages/shared) gates whether
 * the UI is reachable at all; the dev/anonymous sign-in is untouched and remains the
 * path when the flag is off. Merging this changes nothing until a human enables it
 * after real-device QA.
 *
 * FLOW
 *   1. requestOtpPermission (callable) - server-side rate limiting. Called BEFORE
 *      Firebase Auth, so an abusive client is stopped before any SMS is billed.
 *   2. firebase.auth().signInWithPhoneNumber(...) - Firebase sends the SMS.
 *   3. confirmation.confirm(code) - Firebase verifies. We never see the code.
 *   4. reportOtpResult (callable) - records success/failure so repeated wrong codes
 *      lock the number out.
 *
 * WHAT NEEDS A REAL DEVICE (cannot be verified in the emulator - see
 * docs/AUTH_ROLLOUT.md): the reCAPTCHA / App Check verifier, APNs silent push on
 * iOS, Play Integrity on Android, and actual SMS delivery. In the emulator the
 * verifier is not evaluated at all.
 * ============================================================================
 */

/** Country codes this deployment accepts. Mirrors the server-side allow-list. */
export const ALLOWED_COUNTRY_CODES = ['+970', '+972'] as const;

export interface OtpRequestResult {
  ok: boolean;
  /** Machine-readable reason when refused, for a localized message. */
  reason?: string;
  retryAfterSeconds?: number;
}

export interface PhoneSignInSession {
  /** Opaque handle used to confirm the code. */
  confirm: (code: string) => Promise<User | null>;
}

interface RequestOtpResponse {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * A stable per-installation id, so the server can rate-limit one device cycling
 * through many numbers. Not a security control on its own - a determined caller can
 * change it - which is why the per-number limit exists too and why App Check must be
 * enforced before this ships.
 */
function getDeviceId(): string {
  const KEY = 'waselneh.deviceId';
  try {
    const existing = globalThis.localStorage?.getItem(KEY);
    if (existing) return existing;
    const fresh = `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    globalThis.localStorage?.setItem(KEY, fresh);
    return fresh;
  } catch {
    // React Native has no localStorage; a per-process id is still useful.
    return `rn-${Math.random().toString(36).slice(2)}`;
  }
}

/** True when the number is in an allowed country and looks like E.164. */
export function isAcceptablePhoneNumber(phoneNumber: string): boolean {
  const trimmed = phoneNumber.trim().replace(/[\s\-().]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(trimmed)) return false;
  return ALLOWED_COUNTRY_CODES.some((code) => trimmed.startsWith(code));
}

/**
 * Ask the server for permission to send a code. Always call this first: it is the
 * only place the send limits are actually enforced.
 */
export async function requestOtpPermission(phoneNumber: string): Promise<OtpRequestResult> {
  try {
    const result = await callFunction<
      { phoneNumber: string; deviceId: string },
      RequestOtpResponse
    >('requestOtpPermission', { phoneNumber, deviceId: getDeviceId() });

    return {
      ok: result.allowed === true,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: result.retryAfterSeconds }
        : {}),
    };
  } catch {
    // Fail CLOSED: if the limiter cannot be reached we do not send an SMS.
    return { ok: false, reason: 'rate_limit_unavailable' };
  }
}

/**
 * Start phone sign-in. `verifier` is the reCAPTCHA verifier; on a real device this
 * comes from the platform, and the emulator ignores it.
 */
export async function startPhoneSignIn(
  phoneNumber: string,
  verifier: firebase.auth.ApplicationVerifier
): Promise<PhoneSignInSession> {
  const confirmation = await firebaseAuth.signInWithPhoneNumber(phoneNumber, verifier);

  return {
    confirm: async (code: string) => {
      try {
        const credential = await confirmation.confirm(code);
        // Tell the server this number succeeded, clearing its failure counters.
        await reportOtpOutcome(phoneNumber, 'success');
        return credential?.user ?? null;
      } catch (error) {
        // Count the failure so repeated wrong codes lock the number out.
        await reportOtpOutcome(phoneNumber, 'failure');
        throw error;
      }
    },
  };
}

export interface OtpOutcomeResult {
  attemptsRemaining: number;
  lockedOut: boolean;
}

/** Report a verification outcome. Never throws - reporting must not break sign-in. */
export async function reportOtpOutcome(
  phoneNumber: string,
  outcome: 'success' | 'failure'
): Promise<OtpOutcomeResult | null> {
  try {
    return await callFunction<
      { phoneNumber: string; outcome: 'success' | 'failure' },
      OtpOutcomeResult
    >('reportOtpResult', { phoneNumber, outcome });
  } catch {
    return null;
  }
}
