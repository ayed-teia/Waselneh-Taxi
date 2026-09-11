/**
 * Unit tests for the typed Firestore document accessors.
 *
 * WHY THIS MATTERS MORE THAN ITS SIZE SUGGESTS
 *
 * `DocumentSnapshot.data()` is typed `any`, so every field read in this codebase
 * goes through these twelve functions to become something TypeScript can reason
 * about. They are the boundary between untrusted stored data and every callable -
 * and they had no tests at all.
 *
 * They are deliberately NOT validation: a genuinely malformed document should be
 * rejected by a zod schema. These cope with the ordinary case of "read this field,
 * and fall back if it isn't the shape I expect". The tests below pin that
 * distinction, because the failure mode of getting it wrong is silent - a renamed
 * field starts reading as its fallback and nothing errors.
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
  asRecord,
  docData,
  getBoolean,
  getLatLng,
  getNonEmptyString,
  getNumber,
  getRecord,
  getString,
  getStringArray,
  getTimestamp,
  getTimestampDate,
  getTimestampIso,
} = require(path.join(dirname, '..', '..', 'dist', 'core', 'firestore', 'doc-data'));

/** A stand-in for a Firestore Timestamp: duck-typed on toDate(). */
const timestamp = (iso) => ({ toDate: () => new Date(iso) });

describe('docData / asRecord', () => {
  test('a snapshot body is returned as a record', () => {
    assert.deepEqual(docData({ data: () => ({ a: 1 }) }), { a: 1 });
  });

  test('a null or undefined snapshot yields {}, never a throw', () => {
    // Callers do `docData(snap)` before checking `exists`, so this must be safe.
    assert.deepEqual(docData(null), {});
    assert.deepEqual(docData(undefined), {});
  });

  test('a snapshot whose data() returns undefined yields {}', () => {
    // Firestore does this for a document that does not exist.
    assert.deepEqual(docData({ data: () => undefined }), {});
  });

  test('asRecord maps null/undefined to {}', () => {
    assert.deepEqual(asRecord(null), {});
    assert.deepEqual(asRecord(undefined), {});
    assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
  });
});

describe('getString vs getNonEmptyString - a real behavioural difference', () => {
  test('getString returns an empty string as-is', () => {
    // The two functions are named almost identically and behave differently here.
    assert.equal(getString({ a: '' }, 'a', 'fallback'), '');
  });

  test('getNonEmptyString treats empty as absent', () => {
    assert.equal(getNonEmptyString({ a: '' }, 'a', 'fallback'), 'fallback');
  });

  test('getNonEmptyString treats whitespace-only as absent, and trims otherwise', () => {
    assert.equal(getNonEmptyString({ a: '   ' }, 'a', 'fallback'), 'fallback');
    assert.equal(getNonEmptyString({ a: '  hi  ' }, 'a'), 'hi');
  });

  test('getString does NOT trim', () => {
    assert.equal(getString({ a: '  hi  ' }, 'a', ''), '  hi  ');
  });

  test('a non-string falls back rather than being coerced', () => {
    // `String(42)` would be a silent data corruption at the boundary.
    for (const value of [42, true, null, undefined, {}, []]) {
      assert.equal(getString({ a: value }, 'a', 'fb'), 'fb', String(value));
    }
  });

  test('an absent field falls back, and the default fallback is null', () => {
    assert.equal(getString({}, 'missing', 'fb'), 'fb');
    assert.equal(getString({}, 'missing'), null);
  });
});

describe('getNumber', () => {
  test('reads a finite number', () => {
    assert.equal(getNumber({ a: 42 }, 'a', 0), 42);
  });

  test('zero and negatives are real values, not absences', () => {
    // A fare of 0 or a negative adjustment must not silently become the fallback.
    assert.equal(getNumber({ a: 0 }, 'a', 99), 0);
    assert.equal(getNumber({ a: -5 }, 'a', 99), -5);
  });

  test('NaN and Infinity fall back', () => {
    // These arrive from bad arithmetic upstream and would poison money maths.
    assert.equal(getNumber({ a: NaN }, 'a', 7), 7);
    assert.equal(getNumber({ a: Infinity }, 'a', 7), 7);
    assert.equal(getNumber({ a: -Infinity }, 'a', 7), 7);
  });

  test('a numeric STRING falls back rather than being parsed', () => {
    // Coercing "12" to 12 would hide a field that is storing the wrong type.
    assert.equal(getNumber({ a: '12' }, 'a', 7), 7);
  });

  test('the default fallback is null', () => {
    assert.equal(getNumber({}, 'missing'), null);
  });
});

describe('getBoolean', () => {
  test('reads a real boolean', () => {
    assert.equal(getBoolean({ a: true }, 'a', false), true);
    assert.equal(getBoolean({ a: false }, 'a', true), false);
  });

  test('truthy/falsy values are NOT coerced', () => {
    // 'false', 0 and 1 are exactly the values that would flip a permission check.
    for (const value of ['true', 'false', 0, 1, null, undefined]) {
      assert.equal(getBoolean({ a: value }, 'a', false), false, String(value));
    }
  });
});

describe('getStringArray', () => {
  test('reads an array of strings', () => {
    assert.deepEqual(getStringArray({ a: ['x', 'y'] }, 'a'), ['x', 'y']);
  });

  test('non-string members are dropped, the rest kept', () => {
    // Partial data is more useful than none for a list of ids.
    assert.deepEqual(getStringArray({ a: ['x', 1, null, 'y', {}] }, 'a'), ['x', 'y']);
  });

  test('a non-array yields [] rather than throwing', () => {
    assert.deepEqual(getStringArray({ a: 'x' }, 'a'), []);
    assert.deepEqual(getStringArray({}, 'missing'), []);
  });
});

describe('getTimestamp / getTimestampIso / getTimestampDate', () => {
  test('a Timestamp-like value is returned', () => {
    const ts = timestamp('2026-09-11T08:00:00.000Z');
    assert.equal(getTimestamp({ a: ts }, 'a'), ts);
  });

  test('converts to ISO and to Date', () => {
    const ts = timestamp('2026-09-11T08:00:00.000Z');
    assert.equal(getTimestampIso({ a: ts }, 'a'), '2026-09-11T08:00:00.000Z');
    assert.equal(getTimestampDate({ a: ts }, 'a').getTime(), Date.parse('2026-09-11T08:00:00.000Z'));
  });

  test('a plain Date is NOT accepted - only Timestamp-like values', () => {
    // Firestore returns Timestamps; a Date here means someone wrote the wrong type.
    assert.equal(getTimestamp({ a: new Date() }, 'a'), null);
  });

  test('a non-timestamp yields null everywhere', () => {
    for (const value of ['2026-01-01', 1234567890, null, {}, { toDate: 'not a function' }]) {
      assert.equal(getTimestamp({ a: value }, 'a'), null, String(value));
      assert.equal(getTimestampIso({ a: value }, 'a'), null, String(value));
      assert.equal(getTimestampDate({ a: value }, 'a'), null, String(value));
    }
  });

  test('a toDate() that throws yields null rather than propagating', () => {
    // The try/catch matters: one corrupt document must not fail a whole batch.
    const hostile = { toDate: () => { throw new Error('corrupt'); } };
    assert.equal(getTimestampIso({ a: hostile }, 'a'), null);
    assert.equal(getTimestampDate({ a: hostile }, 'a'), null);
  });
});

describe('getRecord', () => {
  test('reads a nested object', () => {
    assert.deepEqual(getRecord({ a: { b: 1 } }, 'a'), { b: 1 });
  });

  test('an ARRAY is not a record', () => {
    // typeof [] === 'object', so without the Array.isArray guard an array would
    // be returned and `getString(getRecord(d,'x'),'0')` would read an element.
    assert.deepEqual(getRecord({ a: [1, 2] }, 'a'), {});
  });

  test('null, a primitive, or an absent field yield {}', () => {
    assert.deepEqual(getRecord({ a: null }, 'a'), {});
    assert.deepEqual(getRecord({ a: 'x' }, 'a'), {});
    assert.deepEqual(getRecord({}, 'missing'), {});
  });

  test('chaining through a missing field is safe', () => {
    // The documented reason getRecord returns {} instead of null.
    assert.equal(getString(getRecord({}, 'nope'), 'deeper', 'fb'), 'fb');
  });
});

describe('getLatLng', () => {
  test('reads a coordinate pair', () => {
    assert.deepEqual(getLatLng({ p: { lat: 32.2, lng: 35.2 } }, 'p'), { lat: 32.2, lng: 35.2 });
  });

  test('zero coordinates are valid', () => {
    // 0,0 is a real point; treating it as absent would be a falsy-check bug.
    assert.deepEqual(getLatLng({ p: { lat: 0, lng: 0 } }, 'p'), { lat: 0, lng: 0 });
  });

  test('either component missing or non-finite yields null', () => {
    // A half-populated point would send a driver to a nonsense location.
    assert.equal(getLatLng({ p: { lat: 32.2 } }, 'p'), null);
    assert.equal(getLatLng({ p: { lng: 35.2 } }, 'p'), null);
    assert.equal(getLatLng({ p: { lat: NaN, lng: 35.2 } }, 'p'), null);
    assert.equal(getLatLng({ p: { lat: 32.2, lng: Infinity } }, 'p'), null);
  });

  test('string coordinates are not parsed', () => {
    assert.equal(getLatLng({ p: { lat: '32.2', lng: '35.2' } }, 'p'), null);
  });

  test('an absent or non-object field yields null', () => {
    assert.equal(getLatLng({}, 'missing'), null);
    assert.equal(getLatLng({ p: 'somewhere' }, 'p'), null);
  });
});
