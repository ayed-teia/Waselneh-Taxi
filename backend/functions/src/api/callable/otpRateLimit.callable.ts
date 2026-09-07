import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { handleError, ValidationError } from '../../core/errors';
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

      if (!normalizeToE164(phoneNumber)) {
        throw new ValidationError('Invalid phone number');
      }

      if (outcome === 'success') {
        await clearOtpCounters(db, phoneNumber);
        return { attemptsRemaining: 0, lockedOut: false };
      }

      return await recordOtpFailure(db, phoneNumber);
    } catch (error) {
      throw handleError(error);
    }
  }
);
