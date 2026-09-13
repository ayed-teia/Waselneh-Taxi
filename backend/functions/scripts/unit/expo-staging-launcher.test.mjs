/**
 * Regression tests for the staging Expo launcher.
 *
 * THE BUG THESE PIN
 *
 * `buildExpoArgs` omitted `--port` for the `android` command while including it
 * for `start`. Expo therefore defaulted `run:android` to 8081 for BOTH apps, so
 * launching the driver while passenger Metro was running failed with:
 *
 *     CommandError: Port "8081" became busy running another process while the
 *     app was compiling. Re-run command to use a new port.
 *
 * Gradle had already succeeded by then - the collision is only discovered when
 * Expo tries to start the bundler, minutes into the run. That is why the port
 * is now both pinned per app AND checked before compilation starts.
 *
 * A second defect: `pnpm run driver:staging:android -- --device` forwards
 * `['--', '--device']`, and passing that straight through produced
 *     npx expo run:android --variant debug -- --device
 * with a meaningless bare separator.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(dirname, '..', '..', '..', '..');
const LAUNCHER = path.join(REPO_ROOT, 'scripts', 'run-expo-staging.mjs');

const { buildExpoArgs, normalizePassthrough, METRO_PORT, EXPECTED_PACKAGE } = await import(
  `file://${LAUNCHER.replace(/\\/g, '/')}`
);

describe('deterministic Metro ports', () => {
  test('passenger is always 8081, driver always 8082', () => {
    assert.equal(METRO_PORT.passenger, '8081');
    assert.equal(METRO_PORT.driver, '8082');
  });

  test('the two apps never share a port', () => {
    // The whole point: both must be able to run simultaneously.
    assert.notEqual(METRO_PORT.passenger, METRO_PORT.driver);
  });

  for (const [app, port] of Object.entries({ passenger: '8081', driver: '8082' })) {
    for (const command of ['start', 'android']) {
      test(`${app}:${command} passes --port ${port}`, () => {
        const args = buildExpoArgs(app, command, []);
        const portIndex = args.indexOf('--port');
        assert.ok(portIndex >= 0, `--port missing from: ${args.join(' ')}`);
        assert.equal(args[portIndex + 1], port);
      });
    }
  }

  test('android no longer relies on the Expo default port', () => {
    // The exact regression: this used to be ['expo','run:android','--variant','debug'].
    const args = buildExpoArgs('driver', 'android', []);
    assert.deepEqual(args, [
      'expo',
      'run:android',
      '--variant',
      'debug',
      '--port',
      '8082',
    ]);
  });

  test('start keeps --dev-client so the staging build is selected', () => {
    const args = buildExpoArgs('passenger', 'start', []);
    assert.ok(args.includes('--dev-client'));
    assert.deepEqual(args, ['expo', 'start', '--dev-client', '--port', '8081']);
  });
});

describe('argument forwarding', () => {
  test('a leading pnpm "--" separator is stripped', () => {
    assert.deepEqual(normalizePassthrough(['--', '--device']), ['--device']);
  });

  test('repeated leading separators are all stripped', () => {
    assert.deepEqual(normalizePassthrough(['--', '--', '--device']), ['--device']);
  });

  test('a separator that is not leading is preserved', () => {
    // It could be meaningful to a nested command; only the pnpm artefact goes.
    assert.deepEqual(normalizePassthrough(['--device', '--', 'x']), ['--device', '--', 'x']);
  });

  test('an empty passthrough stays empty', () => {
    assert.deepEqual(normalizePassthrough([]), []);
  });

  test('--device reaches Expo with no stray separator', () => {
    const args = buildExpoArgs('driver', 'android', ['--', '--device']);
    assert.deepEqual(args, [
      'expo',
      'run:android',
      '--variant',
      'debug',
      '--port',
      '8082',
      '--device',
    ]);
    assert.ok(!args.includes('--'), `bare separator leaked: ${args.join(' ')}`);
  });

  test('multiple passthrough flags survive in order', () => {
    const args = buildExpoArgs('passenger', 'android', ['--', '--device', '--no-install']);
    assert.deepEqual(args.slice(-2), ['--device', '--no-install']);
    assert.ok(!args.includes('--'));
  });

  test('passthrough is appended AFTER --port, so it can override deliberately', () => {
    const args = buildExpoArgs('driver', 'start', ['--', '--clear']);
    assert.ok(args.indexOf('--clear') > args.indexOf('--port'));
  });
});

describe('occupied-port handling is checked before Gradle', () => {
  const source = fs.readFileSync(LAUNCHER, 'utf8');

  test('the port check runs before Expo is spawned', () => {
    const checkAt = source.indexOf('isPortBusy(port)');
    const spawnAt = source.indexOf("spawn('npx'");
    assert.ok(checkAt > 0, 'no port check found');
    assert.ok(spawnAt > 0, 'no spawn found');
    assert.ok(
      checkAt < spawnAt,
      'the port must be checked BEFORE spawning Expo, or Gradle runs first and the compile is wasted'
    );
  });

  test('a busy port reports port, pid, process and corrective action', () => {
    assert.match(source, /port {4}: \$\{port\}/);
    assert.match(source, /pid {5}: \$\{owner\?\.pid/);
    assert.match(source, /process : \$\{owner\?\.name/);
    assert.match(source, /Stop-Process -Id/);
  });

  test('nothing is killed automatically', () => {
    // Killing an unknown process could take out an editor, a debugger, or the
    // other app someone is actively using.
    assert.match(source, /Nothing is killed automatically, on purpose/);
    assert.doesNotMatch(source, /spawnSync\(\s*['"]taskkill/);
    assert.doesNotMatch(source, /Stop-Process -Id \$\{owner\?\.pid\}['"]\s*\]/);
  });

  test('the same app reusing its own Metro is allowed', () => {
    assert.match(source, /looksLikeOwnMetro/);
    assert.match(source, /already running on port/);
  });

  test('the other mobile app is named explicitly when it holds the port', () => {
    assert.match(source, /looksLikeOtherApp/);
    assert.match(source, /the OTHER mobile app/);
  });
});

describe('staging safety is unchanged by the port work', () => {
  const source = fs.readFileSync(LAUNCHER, 'utf8');

  test('production is still rejected by name', () => {
    assert.match(source, /REFUSING to touch production|points at PRODUCTION/);
  });

  test('emulators and the dev bypass are still forced off', () => {
    assert.match(source, /EXPO_PUBLIC_USE_EMULATORS: 'false'/);
    assert.match(source, /EXPO_PUBLIC_DEV_AUTH_BYPASS: 'false'/);
  });

  test('the staging package ids are unchanged', () => {
    assert.equal(EXPECTED_PACKAGE.passenger, 'com.taxiline.passenger.staging');
    assert.equal(EXPECTED_PACKAGE.driver, 'com.taxiline.driver.staging');
  });
});
