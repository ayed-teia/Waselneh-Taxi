/**
 * Unit tests for the release preflight check.
 *
 * THE CASE THIS EXISTS FOR
 *
 * Both committed `.env.pilot` files contain
 * `EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-real-project-id`, and their own header says
 * "Copy to .env and configure for pilot deployment". A build made by following that
 * instruction without editing the value passes the existing `validateAppModeConfig`
 * - it is not a `demo-` project and it is not missing - while pointing at a project
 * that does not exist.
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
const SHARED = path.join(dirname, '..', '..', '..', '..', 'packages', 'shared', 'dist');
const { checkReleasePreflight, formatPreflightReport } = require(
  path.join(SHARED, 'config', 'release-preflight.config.js')
);

/** A configuration that should ship cleanly. */
function goodProd(over = {}) {
  return {
    mode: 'prod',
    firebaseProjectId: 'waselneh-prod-414e2',
    firebaseApiKey: 'AIzaSyRealLookingKeyValue',
    emulatorsRequested: false,
    appVersion: '1.0.0',
    bundleIdentifier: 'com.taxiline.passenger',
    ...over,
  };
}

const codes = (report) => report.findings.map((f) => f.code);

describe('checkReleasePreflight - a good configuration', () => {
  test('a complete prod config is safe to ship', () => {
    const report = checkReleasePreflight(goodProd());
    assert.deepEqual(report.findings, []);
    assert.equal(report.safeToShip, true);
  });

  test('a complete pilot config is safe to ship', () => {
    const report = checkReleasePreflight(
      goodProd({ mode: 'pilot', appVersion: '1.0.0-pilot' })
    );
    assert.equal(report.safeToShip, true);
  });
});

describe('checkReleasePreflight - the placeholder case', () => {
  test('the committed .env.pilot project id is a BLOCKER', () => {
    // The exact value in apps/*/.env.pilot today.
    const report = checkReleasePreflight(
      goodProd({ mode: 'pilot', firebaseProjectId: 'your-real-project-id' })
    );
    assert.equal(report.safeToShip, false);
    assert.ok(codes(report).includes('placeholder_project_id'), codes(report).join(','));
  });

  test('a placeholder api key is a blocker', () => {
    const report = checkReleasePreflight(goodProd({ firebaseApiKey: 'your-api-key' }));
    assert.equal(report.safeToShip, false);
    assert.ok(codes(report).includes('placeholder_api_key'));
  });

  test('placeholder detection is case-insensitive and matches substrings', () => {
    const report = checkReleasePreflight(
      goodProd({ firebaseProjectId: 'PREFIX-Your-Project-Suffix' })
    );
    assert.ok(codes(report).includes('placeholder_project_id'));
  });

  test('a real project id containing no placeholder fragment passes', () => {
    const report = checkReleasePreflight(goodProd({ firebaseProjectId: 'waselneh-prod-414e2' }));
    assert.equal(report.safeToShip, true);
  });
});

describe('checkReleasePreflight - demo and missing config', () => {
  test('a demo project in a release build is a blocker', () => {
    const report = checkReleasePreflight(goodProd({ firebaseProjectId: 'demo-taxi-line' }));
    assert.equal(report.safeToShip, false);
    assert.ok(codes(report).includes('demo_project_in_release'));
  });

  test('a demo project in DEV mode is fine', () => {
    // demo-taxi-line is the documented default for local development.
    const report = checkReleasePreflight({
      mode: 'dev',
      firebaseProjectId: 'demo-taxi-line',
      emulatorsRequested: true,
    });
    assert.equal(report.safeToShip, true);
  });

  test('a missing project id blocks a release but only warns in dev', () => {
    assert.equal(checkReleasePreflight(goodProd({ firebaseProjectId: '' })).safeToShip, false);

    const devReport = checkReleasePreflight({ mode: 'dev', firebaseProjectId: '' });
    assert.equal(devReport.safeToShip, true);
    assert.ok(codes(devReport).includes('missing_project_id'));
  });

  test('a missing api key blocks a release', () => {
    const report = checkReleasePreflight(goodProd({ firebaseApiKey: undefined }));
    assert.equal(report.safeToShip, false);
    assert.ok(codes(report).includes('missing_api_key'));
  });
});

describe('checkReleasePreflight - emulators', () => {
  test('emulators requested in a release build is a blocker', () => {
    // shouldAllowEmulators already blocks the CONNECTION at runtime. This is still
    // a blocker because it means the build came from a dev env file, so every other
    // value in that file is suspect too.
    const report = checkReleasePreflight(goodProd({ emulatorsRequested: true }));
    assert.equal(report.safeToShip, false);
    assert.ok(codes(report).includes('emulators_requested_in_release'));
  });

  test('emulators requested in dev mode is expected', () => {
    const report = checkReleasePreflight({
      mode: 'dev',
      firebaseProjectId: 'demo-taxi-line',
      emulatorsRequested: true,
    });
    assert.equal(report.safeToShip, true);
  });
});

describe('checkReleasePreflight - version and identity', () => {
  test('a pre-release version in prod warns but does not block', () => {
    // Both apps are on "1.0.0-pilot" today; blocking would be wrong while the
    // pilot is the intended release.
    const report = checkReleasePreflight(goodProd({ appVersion: '1.0.0-pilot' }));
    assert.equal(report.safeToShip, true);
    assert.ok(codes(report).includes('prerelease_version_in_prod'));
  });

  test('a pre-release version in PILOT mode is not flagged', () => {
    const report = checkReleasePreflight(
      goodProd({ mode: 'pilot', appVersion: '1.0.0-pilot' })
    );
    assert.equal(codes(report).includes('prerelease_version_in_prod'), false);
  });

  test('a missing bundle identifier warns', () => {
    const report = checkReleasePreflight(goodProd({ bundleIdentifier: '' }));
    assert.equal(report.safeToShip, true);
    assert.ok(codes(report).includes('missing_bundle_identifier'));
  });
});

describe('checkReleasePreflight - reporting', () => {
  test('every finding is collected, not just the first', () => {
    // A preflight that throws on the first problem turns a five-minute fix into
    // five separate builds.
    const report = checkReleasePreflight({
      mode: 'prod',
      firebaseProjectId: 'your-project-id',
      firebaseApiKey: '',
      emulatorsRequested: true,
      appVersion: '1.0.0-beta',
      bundleIdentifier: '',
    });
    assert.ok(report.findings.length >= 4, `only ${report.findings.length} findings`);
    assert.equal(report.safeToShip, false);
  });

  test('blockers and warnings are separated', () => {
    const report = checkReleasePreflight(goodProd({ appVersion: '1.0.0-pilot' }));
    assert.equal(report.blockers.length, 0);
    assert.equal(report.warnings.length, 1);
  });

  test('formatPreflightReport says DO NOT SHIP when blocked', () => {
    const blocked = checkReleasePreflight(goodProd({ firebaseProjectId: 'your-project-id' }));
    assert.match(formatPreflightReport(blocked), /DO NOT SHIP/);
  });

  test('formatPreflightReport is quiet when there is nothing to say', () => {
    assert.match(formatPreflightReport(checkReleasePreflight(goodProd())), /no findings/);
  });
});
