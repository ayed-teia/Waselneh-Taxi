/**
 * Unit tests for the daily reconciliation window.
 *
 * This is the one part of the scheduled scaffold that can be proven today: the
 * provider call behind it is unimplemented (no Lahza credentials exist), but the
 * window arithmetic is pure and runs unattended at 03:00, so a boundary error would
 * silently double-count or skip a day's money with nobody watching.
 *
 * The window is HALF-OPEN, [from, to). A closed window counts a payment landing
 * exactly on midnight on both days, which surfaces later as a phantom duplicate.
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
const { previousUtcDayWindow } = require(
  path.join(dirname, '..', '..', 'dist', 'modules', 'reconciliation')
);

const DAY_MS = 24 * 60 * 60 * 1000;

describe('previousUtcDayWindow', () => {
  test('returns exactly the previous UTC day', () => {
    const window = previousUtcDayWindow(Date.UTC(2026, 8, 11, 3, 0, 0));
    assert.equal(window.fromIso, '2026-09-10T00:00:00.000Z');
    assert.equal(window.toIso, '2026-09-11T00:00:00.000Z');
  });

  test('the window is exactly 24 hours', () => {
    const window = previousUtcDayWindow(Date.UTC(2026, 8, 11, 3, 0, 0));
    const span = new Date(window.toIso).getTime() - new Date(window.fromIso).getTime();
    assert.equal(span, DAY_MS);
  });

  test('the run time within the day does not move the window', () => {
    // 03:00 and 23:59 on the same UTC day must reconcile the same day.
    const early = previousUtcDayWindow(Date.UTC(2026, 8, 11, 3, 0, 0));
    const late = previousUtcDayWindow(Date.UTC(2026, 8, 11, 23, 59, 59));
    assert.deepEqual(early, late);
  });

  test('midnight exactly still reconciles the day before', () => {
    const window = previousUtcDayWindow(Date.UTC(2026, 8, 11, 0, 0, 0));
    assert.equal(window.fromIso, '2026-09-10T00:00:00.000Z');
    assert.equal(window.toIso, '2026-09-11T00:00:00.000Z');
  });

  test('consecutive days abut exactly - no gap and no overlap', () => {
    // The property that matters: yesterday's `to` is today's `from`. A gap loses a
    // day of payments; an overlap reports the same payment twice.
    const day1 = previousUtcDayWindow(Date.UTC(2026, 8, 11, 3, 0, 0));
    const day2 = previousUtcDayWindow(Date.UTC(2026, 8, 12, 3, 0, 0));
    assert.equal(day1.toIso, day2.fromIso);
  });

  test('crosses a month boundary', () => {
    const window = previousUtcDayWindow(Date.UTC(2026, 9, 1, 3, 0, 0));
    assert.equal(window.fromIso, '2026-09-30T00:00:00.000Z');
    assert.equal(window.toIso, '2026-10-01T00:00:00.000Z');
  });

  test('crosses a year boundary', () => {
    const window = previousUtcDayWindow(Date.UTC(2027, 0, 1, 3, 0, 0));
    assert.equal(window.fromIso, '2026-12-31T00:00:00.000Z');
    assert.equal(window.toIso, '2027-01-01T00:00:00.000Z');
  });

  test('handles a leap day', () => {
    const window = previousUtcDayWindow(Date.UTC(2028, 2, 1, 3, 0, 0));
    assert.equal(window.fromIso, '2028-02-29T00:00:00.000Z');
  });

  test('boundaries are midnight, never the run time', () => {
    // If the window were built from `now` rather than the start of the day, a
    // delayed run would shift the window and leak payments into the next report.
    const window = previousUtcDayWindow(Date.UTC(2026, 8, 11, 3, 17, 42));
    assert.ok(window.fromIso.endsWith('T00:00:00.000Z'), window.fromIso);
    assert.ok(window.toIso.endsWith('T00:00:00.000Z'), window.toIso);
  });
});
