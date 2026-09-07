import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { OTP_LIMITS } from '@taxi-line/shared';

import { docData, getNumber, getTimestamp } from '../../core/firestore/doc-data';
import { logger } from '../../core/logger';

/**
 * ============================================================================
 * OTP RATE LIMITING (server-side)
 * ============================================================================
 *
 * SMS costs money per message and is a well-known abuse target: an unprotected
 * "send me a code" endpoint is a way for someone to spend the project's budget and
 * get its sender range flagged by carriers. A client-side limit is not a limit, it
 * is a suggestion - so the counters live in Firestore and are enforced here.
 *
 * WHAT IS COUNTED, AND WHY BOTH
 *   - per phone NUMBER: stops one number being hammered from many devices.
 *   - per DEVICE/installation: stops one device cycling through many numbers.
 * Keying on only one of the two leaves the other attack wide open.
 *
 * Numbers are normalised to E.164 BEFORE counting, or `0599...`, `+972599...` and
 * `972599...` would be three separate buckets for one person.
 *
 * PRIVACY: the phone number is never stored in plaintext as a document id or field.
 * Counters are keyed by a SHA-256 hash of the E.164 number. This is the same class
 * of PII the driver-PII split moved out of `drivers/{id}`; a rate-limit table is no
 * place to reintroduce it. The hash is not a secret (the number space is small
 * enough to brute-force), but it stops a casual read of the collection from being a
 * phone-number dump.
 *
 * Firestore collection: otpRateLimits/{hash}
 * ============================================================================
 */

import { createHash } from 'node:crypto';

/** Country codes this deployment accepts. Default decision: +970 and +972. */
export const ALLOWED_COUNTRY_CODES = ['+970', '+972'] as const;

export interface RateLimitDecision {
  allowed: boolean;
  /** Machine-readable reason when not allowed. */
  reason?:
    | 'invalid_number'
    | 'country_not_allowed'
    | 'cooldown'
    | 'number_hourly_limit'
    | 'device_hourly_limit'
    | 'locked_out';
  /** Seconds the caller must wait before retrying, when applicable. */
  retryAfterSeconds?: number;
}

/**
 * Normalise a phone number to E.164, or null when it cannot be.
 *
 * Deliberately conservative: it accepts an already-E.164 number, a `00` prefix, or
 * a national number beginning `0` for one of the allowed country codes. Anything
 * else is rejected rather than guessed at - a mis-normalised number sends an SMS to
 * the wrong person.
 */
export function normalizeToE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip everything a human might type as separators.
  let value = raw.trim().replace(/[\s\-().]/g, '');
  if (!value) return null;

  if (value.startsWith('00')) value = `+${value.slice(2)}`;

  if (value.startsWith('+')) {
    return /^\+[1-9]\d{6,14}$/.test(value) ? value : null;
  }

  // A bare national number such as "0599..." is AMBIGUOUS while both +970 and
  // +972 are allowed - it could belong to either. Refuse rather than guess: picking
  // the wrong one sends someone else's code to someone else's phone. The client must
  // supply an explicit country code.
  return null;
}

/** True if an E.164 number is in an allowed country. */
export function isAllowedCountry(e164: string): boolean {
  return ALLOWED_COUNTRY_CODES.some((code) => e164.startsWith(code));
}

/** Hash a phone number for use as a document id. Never store the raw number. */
export function hashPhone(e164: string): string {
  return createHash('sha256').update(e164).digest('hex').slice(0, 40);
}

function withinLastHour(ts: Timestamp | null, now: number): boolean {
  if (!ts) return false;
  return now - ts.toMillis() < 60 * 60 * 1000;
}

/**
 * Decide whether a code may be sent, and record the attempt when it may.
 *
 * Runs in a transaction so two concurrent requests cannot both pass the check.
 */
export async function checkAndRecordOtpSend(
  db: Firestore,
  rawPhone: unknown,
  deviceId: string
): Promise<RateLimitDecision & { phoneE164?: string }> {
  const phoneE164 = normalizeToE164(rawPhone);
  if (!phoneE164) {
    return { allowed: false, reason: 'invalid_number' };
  }
  if (!isAllowedCountry(phoneE164)) {
    return { allowed: false, reason: 'country_not_allowed' };
  }

  const now = Date.now();
  const phoneRef = db.collection('otpRateLimits').doc(hashPhone(phoneE164));
  const deviceRef = db
    .collection('otpRateLimits')
    .doc(`device_${hashPhone(deviceId || 'unknown-device')}`);

  return db.runTransaction(async (transaction) => {
    // ---- reads first (Firestore requires it) ----
    const phoneSnap = await transaction.get(phoneRef);
    const deviceSnap = await transaction.get(deviceRef);
    const phoneData = docData(phoneSnap);
    const deviceData = docData(deviceSnap);

    // Locked out after too many wrong codes?
    const lockedUntil = getTimestamp(phoneData, 'lockedUntil');
    if (lockedUntil && lockedUntil.toMillis() > now) {
      return {
        allowed: false,
        reason: 'locked_out' as const,
        retryAfterSeconds: Math.ceil((lockedUntil.toMillis() - now) / 1000),
        phoneE164,
      };
    }

    // Resend cooldown.
    const lastSentAt = getTimestamp(phoneData, 'lastSentAt');
    if (lastSentAt) {
      const elapsed = (now - lastSentAt.toMillis()) / 1000;
      if (elapsed < OTP_LIMITS.RESEND_COOLDOWN_SECONDS) {
        return {
          allowed: false,
          reason: 'cooldown' as const,
          retryAfterSeconds: Math.ceil(OTP_LIMITS.RESEND_COOLDOWN_SECONDS - elapsed),
          phoneE164,
        };
      }
    }

    // Hourly windows. A window older than an hour resets the count.
    const phoneWindowStart = getTimestamp(phoneData, 'windowStartedAt');
    const phoneSends = withinLastHour(phoneWindowStart, now)
      ? getNumber(phoneData, 'sendsInWindow', 0)
      : 0;
    if (phoneSends >= OTP_LIMITS.MAX_SENDS_PER_NUMBER_PER_HOUR) {
      return {
        allowed: false,
        reason: 'number_hourly_limit' as const,
        retryAfterSeconds: 3600,
        phoneE164,
      };
    }

    const deviceWindowStart = getTimestamp(deviceData, 'windowStartedAt');
    const deviceSends = withinLastHour(deviceWindowStart, now)
      ? getNumber(deviceData, 'sendsInWindow', 0)
      : 0;
    if (deviceSends >= OTP_LIMITS.MAX_SENDS_PER_DEVICE_PER_HOUR) {
      return {
        allowed: false,
        reason: 'device_hourly_limit' as const,
        retryAfterSeconds: 3600,
        phoneE164,
      };
    }

    // ---- writes ----
    transaction.set(
      phoneRef,
      {
        kind: 'phone',
        sendsInWindow: phoneSends + 1,
        windowStartedAt: phoneSends === 0 ? Timestamp.fromMillis(now) : phoneWindowStart,
        lastSentAt: Timestamp.fromMillis(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      deviceRef,
      {
        kind: 'device',
        sendsInWindow: deviceSends + 1,
        windowStartedAt: deviceSends === 0 ? Timestamp.fromMillis(now) : deviceWindowStart,
        lastSentAt: Timestamp.fromMillis(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { allowed: true, phoneE164 };
  });
}

/**
 * Record a failed verification. After MAX_VERIFY_ATTEMPTS the number is locked out
 * for LOCKOUT_MINUTES.
 *
 * The actual code check is Firebase Auth's job - this only counts the failures the
 * client reports, so it is a throttle on brute force, not the verification itself.
 * A client that simply never reports its failures still cannot guess a code, because
 * Firebase Auth is doing the comparison.
 */
export async function recordOtpFailure(
  db: Firestore,
  rawPhone: unknown
): Promise<{ attemptsRemaining: number; lockedOut: boolean }> {
  const phoneE164 = normalizeToE164(rawPhone);
  if (!phoneE164) return { attemptsRemaining: 0, lockedOut: false };

  const ref = db.collection('otpRateLimits').doc(hashPhone(phoneE164));
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = docData(snap);

    const failures = getNumber(data, 'failedAttempts', 0) + 1;
    const lockedOut = failures >= OTP_LIMITS.MAX_VERIFY_ATTEMPTS;

    transaction.set(
      ref,
      {
        kind: 'phone',
        failedAttempts: lockedOut ? 0 : failures,
        ...(lockedOut
          ? { lockedUntil: Timestamp.fromMillis(now + OTP_LIMITS.LOCKOUT_MINUTES * 60 * 1000) }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (lockedOut) {
      logger.warn('[OTP] Number locked out after repeated failures', {
        // Hash only - never log the number itself.
        phoneHash: hashPhone(phoneE164),
        lockoutMinutes: OTP_LIMITS.LOCKOUT_MINUTES,
      });
    }

    return {
      attemptsRemaining: lockedOut ? 0 : OTP_LIMITS.MAX_VERIFY_ATTEMPTS - failures,
      lockedOut,
    };
  });
}

/** Clear the counters for a number after a successful sign-in. */
export async function clearOtpCounters(db: Firestore, rawPhone: unknown): Promise<void> {
  const phoneE164 = normalizeToE164(rawPhone);
  if (!phoneE164) return;
  await db
    .collection('otpRateLimits')
    .doc(hashPhone(phoneE164))
    .set(
      {
        failedAttempts: 0,
        lockedUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}
