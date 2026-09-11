/**
 * Unit tests for log redaction and correlation ids.
 *
 * WHAT THESE PROTECT
 *
 * Every sensitive value reaching a log today is already hashed - verified by scanning
 * all 201 logger call sites before this module was written, not assumed. The problem
 * is that nothing ENFORCES it: a future `logger.info('...', { phoneNumber })` would
 * pass typecheck, lint and CI in silence, and the leak would sit in Cloud Logging
 * retention long before anyone noticed.
 *
 * The correlation id is the other half. A client-supplied trace id is attacker-
 * controlled input: unsanitised, a newline in it forges log entries, a constant value
 * collapses every trace into one, and a huge string bloats every entry.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  REDACTED,
  isSensitiveFieldName,
  redactLogContext,
  resolveCorrelationId,
  sanitizeCorrelationId,
} = require(path.join(dirname, '..', '..', 'dist', 'core', 'logger', 'log-safety'));

describe('isSensitiveFieldName', () => {
  test('flags the categories the mandate names', () => {
    for (const name of [
      'phoneNumber',
      'nationalId',
      'secretKey',
      'idToken',
      'password',
      'cardNumber',
      'documentUrl',
      'otpCode',
    ]) {
      assert.equal(isSensitiveFieldName(name), true, name);
    }
  });

  test('matching ignores case and separators', () => {
    for (const name of ['phone_number', 'PhoneNumber', 'PHONE-NUMBER', 'national_id']) {
      assert.equal(isSensitiveFieldName(name), true, name);
    }
  });

  test('a hashed field is explicitly ALLOWED', () => {
    // phoneHash is the correct way to log a phone number. Redacting it would punish
    // the right behaviour and push call sites back to logging the raw value.
    assert.equal(isSensitiveFieldName('phoneHash'), false);
    assert.equal(isSensitiveFieldName('tokenPhoneHash'), false);
    assert.equal(isSensitiveFieldName('reportedPhoneHash'), false);
  });

  test('prefixed forms are caught', () => {
    assert.equal(isSensitiveFieldName('driverPhone'), true);
    assert.equal(isSensitiveFieldName('passengerNationalId'), true);
    assert.equal(isSensitiveFieldName('lahzaSecretKey'), true);
  });

  test('ordinary diagnostic fields are NOT flagged', () => {
    // These are real field names from the existing call sites. Redacting them would
    // make the logs useless and the guard would be ripped out within a release.
    for (const name of [
      'tripId',
      'driverId',
      'passengerId',
      'status',
      'reason',
      'amount',
      'devUserId',
      'tripPassengerId',
      'lineId',
      'officeId',
    ]) {
      assert.equal(isSensitiveFieldName(name), false, name);
    }
  });
});

describe('redactLogContext', () => {
  test('replaces a sensitive value but keeps the key visible', () => {
    // Knowing the field was present is useful for debugging; its value is not.
    const out = redactLogContext({ tripId: 't1', phoneNumber: '+970599000111' });
    assert.deepEqual(out, { tripId: 't1', phoneNumber: REDACTED });
  });

  test('redacts nested objects', () => {
    // A payment payload two levels down leaks exactly as badly as a top-level one.
    const out = redactLogContext({ payment: { reference: 'r1', cardNumber: '4111111111111111' } });
    assert.deepEqual(out, { payment: { reference: 'r1', cardNumber: REDACTED } });
  });

  test('redacts inside arrays', () => {
    const out = redactLogContext({ drivers: [{ driverId: 'd1', phone: '+97059' }] });
    assert.deepEqual(out, { drivers: [{ driverId: 'd1', phone: REDACTED }] });
  });

  test('leaves primitives and non-objects alone', () => {
    assert.equal(redactLogContext('a string'), 'a string');
    assert.equal(redactLogContext(42), 42);
    assert.equal(redactLogContext(null), null);
    assert.equal(redactLogContext(undefined), undefined);
  });

  test('a circular reference yields a marker rather than throwing', () => {
    // A logger must never be the thing that breaks a request.
    const circular = { tripId: 't1' };
    circular.self = circular;
    const out = redactLogContext(circular);
    assert.equal(out.tripId, 't1');
    assert.equal(out.self, '[circular]');
  });

  test('excessive depth is truncated rather than recursed forever', () => {
    let deep = { value: 'bottom' };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    const out = redactLogContext(deep);
    assert.equal(JSON.stringify(out).includes('[truncated]'), true);
  });

  test('an already-hashed context passes through untouched', () => {
    // This is the shape the codebase actually logs today.
    const context = { phoneHash: 'abc123', reason: 'cooldown' };
    assert.deepEqual(redactLogContext(context), context);
  });
});

describe('sanitizeCorrelationId', () => {
  test('accepts a plausible id', () => {
    assert.equal(sanitizeCorrelationId('abc123def456'), 'abc123def456');
    assert.equal(sanitizeCorrelationId('trace-01_ABC'), 'trace-01_ABC');
  });

  test('strips characters that could forge a log entry', () => {
    // A newline is the whole reason this function exists.
    assert.equal(sanitizeCorrelationId('abc123def\n[fake] injected'), 'abc123deffakeinjected');
  });

  test('rejects a value too short to be a real trace', () => {
    assert.equal(sanitizeCorrelationId('abc'), null);
    assert.equal(sanitizeCorrelationId(''), null);
    assert.equal(sanitizeCorrelationId('!!!!!!!!!!'), null);
  });

  test('rejects a non-string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      assert.equal(sanitizeCorrelationId(value), null, String(value));
    }
  });

  test('caps the length so one caller cannot bloat every entry', () => {
    const long = 'a'.repeat(500);
    assert.equal(sanitizeCorrelationId(long).length, 64);
  });
});

describe('resolveCorrelationId', () => {
  test('prefers a usable client hint', () => {
    // So a mobile app can tie its own telemetry to the server's.
    assert.equal(resolveCorrelationId('client-trace-123', () => 'generated'), 'client-trace-123');
  });

  test('generates when the hint is missing or unusable', () => {
    assert.equal(resolveCorrelationId(undefined, () => 'generated'), 'generated');
    assert.equal(resolveCorrelationId('bad', () => 'generated'), 'generated');
    assert.equal(resolveCorrelationId(42, () => 'generated'), 'generated');
  });

  test('the real generator produces a distinct id each time', () => {
    const a = resolveCorrelationId();
    const b = resolveCorrelationId();
    assert.notEqual(a, b);
    assert.ok(a.length > 8, a);
  });
});
