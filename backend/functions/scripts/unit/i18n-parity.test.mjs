/**
 * Unit tests for translation parity, plus a live check of BOTH shipped tables.
 *
 * WHY THE LIVE CHECK READS SOURCE TEXT
 *
 * The app translation tables are never compiled - both Expo tsconfigs are
 * `noEmit: true` and neither app has a build script - so they cannot be
 * `require`d. The alternatives were to add a build step to two Expo apps purely to
 * serve a test, or to regex-strip TypeScript into something executable. The second
 * is exactly the shim deleted in Batch 3, and it is not coming back.
 *
 * So the keys are extracted by scanning the source for quoted `'a.b':` literals. No
 * TypeScript is evaluated; nothing is transformed into code. A text scan that finds
 * a key is right or it finds nothing - it cannot silently produce a WRONG table the
 * way a half-working transform can.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const SHARED = path.join(__dirname, '..', '..', '..', '..', 'packages', 'shared', 'dist');
const { checkTranslationParity, findPlaceholderMismatches, findUntranslatedValues } = require(
  path.join(SHARED, 'config', 'i18n-parity.config.js')
);

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const APP_TABLES = [
  ['passenger', path.join(REPO_ROOT, 'apps', 'passenger-app', 'src', 'localization', 'translations.ts')],
  ['driver', path.join(REPO_ROOT, 'apps', 'driver-app', 'src', 'localization', 'translations.ts')],
];

/**
 * Extract `{ en: {...}, ar: {...} }` key/value pairs from a translations source
 * file by text scan. Returns locale tables shaped like the runtime ones.
 */
function readTableFromSource(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const enStart = source.indexOf('en: {');
  const arStart = source.indexOf('ar: {');
  assert.ok(enStart >= 0, `no 'en' block in ${filePath}`);
  assert.ok(arStart > enStart, `no 'ar' block after 'en' in ${filePath}`);

  // Key, then a single- or double-quoted value on the same entry.
  const entry = /'([A-Za-z_][A-Za-z_0-9]*\.[A-Za-z_0-9]+)'\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/g;

  const collect = (text) => {
    const table = {};
    for (const match of text.matchAll(entry)) {
      table[match[1]] = match[3];
    }
    return table;
  };

  return { en: collect(source.slice(enStart, arStart)), ar: collect(source.slice(arStart)) };
}

describe('checkTranslationParity', () => {
  test('identical key sets are consistent', () => {
    const report = checkTranslationParity({
      en: { 'a.one': 'One', 'a.two': 'Two' },
      ar: { 'a.one': 'واحد', 'a.two': 'اثنان' },
    });
    assert.equal(report.isConsistent, true);
    assert.deepEqual(report.problems, []);
    assert.deepEqual(report.allKeys, ['a.one', 'a.two']);
  });

  test('a key missing from ar is reported as showing the fallback language', () => {
    // The silent failure: an Arabic user reads English and nothing is logged.
    const report = checkTranslationParity({
      en: { 'a.one': 'One', 'a.two': 'Two' },
      ar: { 'a.one': 'واحد' },
    });
    assert.equal(report.isConsistent, false);
    assert.equal(report.problems.length, 1);
    assert.deepEqual(report.problems[0], {
      key: 'a.two',
      missingFrom: 'ar',
      userVisibleEffect: 'shows_fallback_language',
    });
  });

  test('a key missing from the fallback locale is reported as showing the raw key', () => {
    // Worse: the user reads "a.two" on screen.
    const report = checkTranslationParity({
      en: { 'a.one': 'One' },
      ar: { 'a.one': 'واحد', 'a.two': 'اثنان' },
    });
    const problem = report.problems.find((p) => p.key === 'a.two');
    assert.equal(problem.missingFrom, 'en');
    assert.equal(problem.userVisibleEffect, 'shows_raw_key');
  });

  test('counts keys per locale', () => {
    const report = checkTranslationParity({
      en: { 'a.one': 'One', 'a.two': 'Two' },
      ar: { 'a.one': 'واحد' },
    });
    assert.deepEqual(report.localeKeyCounts, { en: 2, ar: 1 });
  });

  test('empty tables are consistent rather than an error', () => {
    const report = checkTranslationParity({ en: {}, ar: {} });
    assert.equal(report.isConsistent, true);
    assert.deepEqual(report.allKeys, []);
  });

  test('a non-default fallback locale is honoured', () => {
    const report = checkTranslationParity({ ar: { 'a.one': 'واحد' }, en: {} }, 'ar');
    const problem = report.problems.find((p) => p.missingFrom === 'en');
    assert.equal(problem.userVisibleEffect, 'shows_fallback_language');
  });
});

describe('findPlaceholderMismatches', () => {
  test('a dropped placeholder is found', () => {
    // t() replaces {seconds} literally, so losing it leaves a sentence with no
    // number in it.
    const mismatches = findPlaceholderMismatches(
      {
        en: { 'a.wait': 'Wait {seconds} seconds' },
        ar: { 'a.wait': 'انتظر قليلاً' },
      },
      'en',
      'ar'
    );
    assert.equal(mismatches.length, 1);
    assert.deepEqual(mismatches[0].onlyInA, ['seconds']);
  });

  test('an invented placeholder is found', () => {
    const mismatches = findPlaceholderMismatches(
      { en: { 'a.hi': 'Hello' }, ar: { 'a.hi': 'مرحبا {name}' } },
      'en',
      'ar'
    );
    assert.deepEqual(mismatches[0].onlyInB, ['name']);
  });

  test('matching placeholders are not reported', () => {
    const mismatches = findPlaceholderMismatches(
      { en: { 'a.w': 'Wait {seconds}s' }, ar: { 'a.w': 'انتظر {seconds} ثانية' } },
      'en',
      'ar'
    );
    assert.deepEqual(mismatches, []);
  });
});

describe('findUntranslatedValues', () => {
  test('identical values are listed', () => {
    const same = findUntranslatedValues(
      { en: { 'a.brand': 'Waselneh', 'a.ok': 'OK' }, ar: { 'a.brand': 'Waselneh', 'a.ok': 'حسناً' } },
      'en',
      'ar'
    );
    assert.deepEqual(same, ['a.brand']);
  });
});

describe('THE SHIPPED TABLES - every key exists in both locales', () => {
  for (const [appName, filePath] of APP_TABLES) {
    test(`${appName} app: en and ar key sets match`, () => {
      const tables = readTableFromSource(filePath);
      const report = checkTranslationParity(tables);

      assert.ok(report.allKeys.length > 0, 'no keys were extracted - the scan is broken');
      assert.deepEqual(
        report.problems,
        [],
        `translation drift: ${report.problems
          .map((p) => `${p.key} missing from ${p.missingFrom} (${p.userVisibleEffect})`)
          .join('; ')}`
      );
    });

    test(`${appName} app: placeholders agree across locales`, () => {
      const tables = readTableFromSource(filePath);
      const mismatches = findPlaceholderMismatches(tables, 'en', 'ar');
      assert.deepEqual(
        mismatches,
        [],
        `placeholder drift: ${mismatches
          .map((m) => `${m.key} onlyInEn=[${m.onlyInA}] onlyInAr=[${m.onlyInB}]`)
          .join('; ')}`
      );
    });
  }
});
