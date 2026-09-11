/**
 * ============================================================================
 * LOG SAFETY - REDACTION AND CORRELATION
 * ============================================================================
 *
 * Two problems, both of the "nothing currently stops it" kind rather than the
 * "it is currently broken" kind.
 *
 * 1. PII IN LOGS
 *
 * Every sensitive value reaching a log today is already hashed - `phoneHash`,
 * `tokenPhoneHash` - which was verified before this module was written, not assumed.
 * But nothing ENFORCES it. A future `logger.info('...', { phoneNumber })` would pass
 * typecheck, lint and CI in silence, and the leak would live in Cloud Logging
 * retention long before anyone noticed.
 *
 * `redactLogContext` strips the known-sensitive field names and replaces them with a
 * marker, so the fact that a field was present is still visible for debugging while
 * its value is not.
 *
 * WHY A DENY-LIST AND NOT AN ALLOW-LIST
 *
 * An allow-list would be stricter, and wrong here: log contexts are free-form and
 * vary per call site across 201 call sites. An allow-list would silently swallow the
 * diagnostic fields that make a log worth reading, and the pressure to add exceptions
 * would erode it within a release. The deny-list targets the categories the mandate
 * names - phone numbers, national IDs, secrets, tokens, payment payloads, document
 * URLs - and is honest that it is not exhaustive.
 *
 * This is a safety net, NOT a licence to pass PII and rely on it. The rule remains:
 * hash it or omit it at the call site.
 *
 * 2. NO CORRELATION ID
 *
 * A passenger action spans several callables - create, dispatch, accept - and today
 * nothing ties their log lines together. `requestId` in this codebase is a
 * tripRequests document id, not a trace.
 *
 * WHY A CLIENT-SUPPLIED ID IS NOT TRUSTED
 *
 * A caller could otherwise send the same id for every request (collapsing unrelated
 * traces), send a 10KB string, or inject newlines to forge log entries. So a client
 * hint is accepted only after hard sanitisation, and anything unusable is replaced by
 * a server-generated id.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';

/** What a redacted value is replaced with. Keeps the field's presence visible. */
export const REDACTED = '[redacted]';

/**
 * Field names whose VALUES must never reach a log.
 *
 * Compared case-insensitively and on a normalised form, so `phone_number`,
 * `phoneNumber` and `PhoneNumber` all match the same entry.
 */
export const SENSITIVE_FIELD_NAMES: readonly string[] = [
  // Contact and identity
  'phone',
  'phonenumber',
  'phonee164',
  'msisdn',
  'nationalid',
  'idnumber',
  'passportnumber',
  'email',
  'fullname',
  'displayname',
  // Credentials and secrets
  'password',
  'secret',
  'secretkey',
  'apikey',
  'token',
  'idtoken',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'sessioninfo',
  // Payment material
  'cardnumber',
  'pan',
  'cvv',
  'cvc',
  'expiry',
  'iban',
  'paymentpayload',
  // Identity documents
  'documenturl',
  'downloadurl',
  'signedurl',
  'storagepath',
  // The code itself
  'otp',
  'otpcode',
  'verificationcode',
];

const SENSITIVE_SET = new Set(SENSITIVE_FIELD_NAMES);

/** Normalise a field name for comparison: lowercase, strip separators. */
function normaliseFieldName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '');
}

/**
 * True when a field name looks like it carries a secret.
 *
 * A name already ending in `hash` is explicitly ALLOWED: `phoneHash` is the correct,
 * intended way to log a phone number, and redacting it would punish the right
 * behaviour and push call sites back to logging the raw value.
 */
export function isSensitiveFieldName(name: string): boolean {
  const normalised = normaliseFieldName(name);
  if (normalised.endsWith('hash')) return false;
  if (SENSITIVE_SET.has(normalised)) return true;
  // Suffix forms: `driverPhone`, `passengerNationalId`, `lahzaSecretKey`.
  return [...SENSITIVE_SET].some(
    (sensitive) => sensitive.length >= 5 && normalised.endsWith(sensitive)
  );
}

/** Depth cap: a log context is not a place for deep object graphs. */
const MAX_DEPTH = 6;

/**
 * Recursively redact sensitive fields from a log context.
 *
 * Arrays and nested objects are walked, because a payment payload nested two levels
 * down leaks exactly as badly as a top-level one. Cycles are handled by a seen-set
 * rather than by throwing: a logger must never be the thing that breaks a request.
 */
export function redactLogContext(
  context: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (context === null || typeof context !== 'object') return context;
  if (depth >= MAX_DEPTH) return '[truncated]';

  // No cast needed: the guard above has already narrowed `context` to `object`.
  if (seen.has(context)) return '[circular]';
  seen.add(context);

  if (Array.isArray(context)) {
    return context.map((item) => redactLogContext(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
    if (isSensitiveFieldName(key)) {
      output[key] = REDACTED;
      continue;
    }
    output[key] = redactLogContext(value, depth + 1, seen);
  }
  return output;
}

/** How long a correlation id may be once sanitised. */
const MAX_CORRELATION_ID_LENGTH = 64;

/**
 * Turn a client-supplied correlation hint into something safe to log, or null.
 *
 * Newlines are the reason this exists at all: an unsanitised value containing `\n`
 * lets a caller forge additional log entries. Everything outside a conservative
 * alphabet is dropped rather than escaped.
 */
export function sanitizeCorrelationId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_-]/g, '');
  if (cleaned.length < 8) return null;
  return cleaned.slice(0, MAX_CORRELATION_ID_LENGTH);
}

/**
 * A correlation id for one logical operation.
 *
 * Prefers a sanitised client hint so a mobile app can tie its own telemetry to the
 * server's, and falls back to a server-generated id. `randomUUID` is injected so a
 * test can assert the fallback without depending on randomness.
 */
export function resolveCorrelationId(
  clientHint?: unknown,
  generate: () => string = randomUUID
): string {
  return sanitizeCorrelationId(clientHint) ?? generate();
}
