import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, handleError, UnauthorizedError, ValidationError } from '../../core/errors';
import { logger } from '../../core/logger';
import {
  checkAndRecordOtpSend,
  clearOtpCounters,
  hashPhone,
  normalizeToE164,
  recordOtpFailure,
} from '../../modules/auth/otp-rate-limit';

/**
 * ============================================================================
 * OTP RATE-LIMIT CALLABLES
 * ============================================================================
 *
 * The client must call `requestOtpPermission` BEFORE asking Firebase Auth to send a
 * code, and report the outcome afterwards. The limits are enforced here, server
 * side, because a client-side limit is not a limit.
 *
 * WHAT THIS DOES AND DOES NOT DO
 * These callables do NOT send the SMS and do NOT verify the code - Firebase Auth
 * does both. They gate how often a client may ask, and count failures so a number
 * can be locked out after repeated wrong codes. An attacker who skips the gate
 * still cannot guess a code, because Firebase Auth performs the comparison; what
 * they would bypass is the send throttle, which is why App Check must be enforced
 * before this ships (see docs/AUTH_ROLLOUT.md).
 *
 * These are deliberately UNAUTHENTICATED - a user signing in has no credential yet.
 * That is exactly why the throttle and App Check matter.
 * ============================================================================
 */

const RequestOtpSchema = z.object({
  phoneNumber: z.string().trim().min(5).max(24),
  /** A stable per-installation id, so one device cannot cycle many numbers. */
  deviceId: z.string().trim().min(1).max(200),
});

const ReportOtpResultSchema = z.object({
  phoneNumber: z.string().trim().min(5).max(24),
  outcome: z.enum(['success', 'failure']),
});

/**
 * The phone number Firebase Auth itself put in the caller's token, normalised.
 *
 * `phone_number` is a RESERVED claim: it is set by Firebase Auth when a phone
 * sign-in actually succeeds, and cannot be forged by the client the way a custom
 * claim or a request field can. That is the whole basis of the check below.
 */
function verifiedPhoneFromToken(request: { auth?: { token?: Record<string, unknown> } }):
  | string
  | null {
  const raw = request.auth?.token?.phone_number;
  return typeof raw === 'string' ? normalizeToE164(raw) : null;
}

interface RequestOtpResponse {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * Ask permission to send an OTP to a number.
 * Returns allowed:false with a reason rather than throwing, so the client can show
 * a useful message (cooldown, locked out, country not supported).
 */
export const requestOtpPermission = onCall<unknown, Promise<RequestOtpResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 20 },
  async (request) => {
    try {
      const parsed = RequestOtpSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid OTP request');
      }

      const db = getFirestore();
      const decision = await checkAndRecordOtpSend(
        db,
        parsed.data.phoneNumber,
        parsed.data.deviceId
      );

      if (!decision.allowed) {
        logger.info('[OTP] Send refused', {
          reason: decision.reason,
          // Hash only - the number itself is PII and never logged.
          phoneHash: decision.phoneE164 ? hashPhone(decision.phoneE164) : null,
        });
      }

      return {
        allowed: decision.allowed,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(decision.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: decision.retryAfterSeconds }
          : {}),
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);

interface ReportOtpResponse {
  attemptsRemaining: number;
  lockedOut: boolean;
}

/**
 * Report the outcome of a verification attempt, so repeated wrong codes lock the
 * number out and a success clears the counters.
 *
 * WHY THE TWO OUTCOMES ARE AUTHORISED DIFFERENTLY
 *
 * A `success` report CLEARS a lockout, so it is a privilege: unauthenticated, it let
 * anyone erase any number's lockout on demand. An attacker brute-forcing a victim's
 * number could call this with the victim's number every five wrong guesses and the
 * 15-minute lockout would never bite - the throttle became decorative. A success
 * report therefore requires a Firebase Auth token whose reserved `phone_number`
 * claim matches the number being cleared: proof the sign-in really happened, for
 * that number, rather than the caller's word for it.
 *
 * A `failure` report only ever TIGHTENS - it increments the counter toward lockout -
 * so it stays unauthenticated by design. The caller has no credential yet at that
 * point in the flow, and requiring one would hand an attacker the easiest possible
 * evasion: never report a failure and never be locked out.
 *
 * This does not make the counter authoritative. Firebase Auth performs the actual
 * code comparison; a client that lies about failures still cannot guess a code. What
 * this protects is the lockout's integrity.
 */
export const reportOtpResult = onCall<unknown, Promise<ReportOtpResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 20 },
  async (request) => {
    try {
      const parsed = ReportOtpResultSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid OTP result report');
      }

      const db = getFirestore();
      const { phoneNumber, outcome } = parsed.data;

      const reportedE164 = normalizeToE164(phoneNumber);
      if (!reportedE164) {
        throw new ValidationError('Invalid phone number');
      }

      if (outcome === 'success') {
        const verifiedE164 = verifiedPhoneFromToken(request);
        if (!verifiedE164) {
          throw new UnauthorizedError('A verified phone sign-in is required to clear counters');
        }
        if (verifiedE164 !== reportedE164) {
          // Signed in as someone else, clearing a third party's lockout.
          logger.warn('[OTP] Success report rejected: token/number mismatch', {
            // Hashes only - two numbers in one log line is still two numbers.
            tokenPhoneHash: hashPhone(verifiedE164),
            reportedPhoneHash: hashPhone(reportedE164),
          });
          throw new ForbiddenError('Cannot clear counters for a different phone number');
        }

        await clearOtpCounters(db, reportedE164);
        return { attemptsRemaining: 0, lockedOut: false };
      }

      return await recordOtpFailure(db, reportedE164);
    } catch (error) {
      throw handleError(error);
    }
  }
);
