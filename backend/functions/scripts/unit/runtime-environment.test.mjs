/**
 * Regression tests for runtime environment resolution and the connection guard.
 *
 * THE BUGS THESE PIN
 *
 * 1. `const DEV_MODE = true` was hardcoded in both mobile entry points, so an
 *    emulator-only login ran against real staging no matter what the env said.
 * 2. Ad-hoc truthiness checks meant the STRING "false" could be treated as true.
 * 3. A dev id in .env (EXPO_PUBLIC_DEV_DRIVER_ID) looked, in practice, like
 *    permission to use the dev login.
 * 4. Nothing cross-checked app mode against the Firebase project id, so a pilot
 *    build could silently point at production.
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
const {
  parseEnvFlag,
  resolveRuntimeEnvironment,
  checkConnectionGuard,
  assertSafeRuntimeEnvironment,
  describeEnvironment,
  REQUIRED_PROJECT_BY_MODE,
} = require(path.join(SHARED, 'config', 'runtime-environment.config.js'));

describe('parseEnvFlag - the string "false" is never truthy', () => {
  test('the literal string "false" parses as false', () => {
    // The headline bug: a non-empty string is truthy in JS.
    assert.equal(parseEnvFlag('false'), false);
  });

  test('other falsey-intent strings are false', () => {
    for (const value of ['False', 'FALSE', '0', 'no', 'off', '', '   ', 'yes', '1']) {
      assert.equal(parseEnvFlag(value), false, JSON.stringify(value));
    }
  });

  test('only the literal "true" is true, case and padding tolerant', () => {
    for (const value of ['true', 'TRUE', ' True ']) {
      assert.equal(parseEnvFlag(value), true, JSON.stringify(value));
    }
  });

  test('a real boolean true is accepted (Expo Constants can pre-parse)', () => {
    assert.equal(parseEnvFlag(true), true);
    assert.equal(parseEnvFlag(false), false);
  });

  test('non-strings are false, never a crash', () => {
    for (const value of [undefined, null, 0, 1, {}, []]) {
      assert.equal(parseEnvFlag(value), false, String(value));
    }
  });
});

describe('pilot never activates the mobile dev auth bypass', () => {
  test('pilot with every dev flag set still refuses the bypass', () => {
    // Exactly the driver-app situation: flags on, mode pilot.
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      useEmulators: 'true',
      devAuthBypass: 'true',
      firebaseProjectId: 'waselneh-staging-ayed',
    });
    assert.equal(env.devAuthBypassEnabled, false);
    assert.equal(env.useEmulators, false, 'emulators must be refused outside dev');
  });

  test('prod refuses the bypass too', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'prod',
      useEmulators: 'true',
      devAuthBypass: 'true',
      firebaseProjectId: 'waselneh-prod-414e2',
    });
    assert.equal(env.devAuthBypassEnabled, false);
    assert.equal(env.useEmulators, false);
  });

  test('dev WITH emulators and an explicit bypass is the only enabling case', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'dev',
      useEmulators: 'true',
      devAuthBypass: 'true',
      firebaseProjectId: 'demo-taxi-line',
    });
    assert.equal(env.devAuthBypassEnabled, true);
  });

  test('dev WITHOUT emulators refuses the bypass', () => {
    // Dev against real Firebase is still real Firebase.
    const env = resolveRuntimeEnvironment({
      appMode: 'dev',
      useEmulators: 'false',
      devAuthBypass: 'true',
      firebaseProjectId: 'waselneh-staging-ayed',
    });
    assert.equal(env.devAuthBypassEnabled, false);
  });

  test('dev with emulators but no explicit bypass refuses it', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'dev',
      useEmulators: 'true',
      devAuthBypass: 'false',
      firebaseProjectId: 'demo-taxi-line',
    });
    assert.equal(env.devAuthBypassEnabled, false);
  });
});

describe('a dev id alone does not enable the bypass', () => {
  test('EXPO_PUBLIC_DEV_DRIVER_ID is data, not permission', () => {
    // The id is not even an input to the decision, so presence cannot enable it.
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      useEmulators: 'false',
      devAuthBypass: 'false',
      firebaseProjectId: 'waselneh-staging-ayed',
    });
    assert.equal(env.devAuthBypassEnabled, false);
  });

  test('an unset bypass flag defaults to disabled', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'dev',
      useEmulators: 'true',
      firebaseProjectId: 'demo-taxi-line',
    });
    assert.equal(env.devAuthBypassEnabled, false);
  });
});

describe('pilot never connects to emulators', () => {
  test('pilot requesting emulators resolves to disabled AND is reported', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      useEmulators: 'true',
      firebaseProjectId: 'waselneh-staging-ayed',
    });
    assert.equal(env.useEmulators, false);

    // The guard must still complain: silently downgrading hides a broken build.
    const violations = checkConnectionGuard(env, 'true', 'false');
    assert.ok(
      violations.some((v) => v.code === 'emulators_in_release'),
      JSON.stringify(violations)
    );
  });

  test('pilot requesting the dev bypass is a guard violation', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      devAuthBypass: 'true',
      firebaseProjectId: 'waselneh-staging-ayed',
    });
    const violations = checkConnectionGuard(env, 'false', 'true');
    assert.ok(violations.some((v) => v.code === 'dev_bypass_in_release'));
  });
});

describe('mode and Firebase project must agree', () => {
  test('pilot pinned to staging', () => {
    assert.equal(REQUIRED_PROJECT_BY_MODE.pilot, 'waselneh-staging-ayed');
  });

  test('prod pinned to production', () => {
    assert.equal(REQUIRED_PROJECT_BY_MODE.prod, 'waselneh-prod-414e2');
  });

  test('pilot pointing at PRODUCTION is refused', () => {
    // The failure that must never ship silently.
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      firebaseProjectId: 'waselneh-prod-414e2',
    });
    const violations = checkConnectionGuard(env);
    assert.ok(
      violations.some((v) => v.code === 'wrong_project_for_mode'),
      JSON.stringify(violations)
    );
  });

  test('pilot on staging passes cleanly', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      useEmulators: 'false',
      devAuthBypass: 'false',
      firebaseProjectId: 'waselneh-staging-ayed',
    });
    assert.deepEqual(checkConnectionGuard(env, 'false', 'false'), []);
  });

  test('a release build with no project id is refused', () => {
    const env = resolveRuntimeEnvironment({ appMode: 'pilot', firebaseProjectId: '' });
    assert.ok(checkConnectionGuard(env).some((v) => v.code === 'missing_project_id'));
  });

  test('dev is not pinned to any project', () => {
    const env = resolveRuntimeEnvironment({ appMode: 'dev', firebaseProjectId: 'demo-taxi-line' });
    assert.equal(env.requiredProjectId, null);
    assert.deepEqual(checkConnectionGuard(env), []);
  });
});

describe('assertSafeRuntimeEnvironment', () => {
  test('throws on an unsafe combination', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      firebaseProjectId: 'waselneh-prod-414e2',
    });
    assert.throws(() => assertSafeRuntimeEnvironment(env), /wrong_project_for_mode/);
  });

  test('is silent on a safe one', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      firebaseProjectId: 'waselneh-staging-ayed',
    });
    assert.doesNotThrow(() => assertSafeRuntimeEnvironment(env, 'false', 'false'));
  });
});

describe('describeEnvironment - staging is never called production', () => {
  test('pilot reads as Staging with the project name', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'pilot',
      firebaseProjectId: 'waselneh-staging-ayed',
    });
    const label = describeEnvironment(env);
    assert.match(label, /Staging/);
    assert.match(label, /waselneh-staging-ayed/);
    assert.doesNotMatch(label, /Production/i);
  });

  test('prod reads as Production', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'prod',
      firebaseProjectId: 'waselneh-prod-414e2',
    });
    assert.match(describeEnvironment(env), /Production \/ waselneh-prod-414e2/);
  });

  test('emulators read as Development / Emulator', () => {
    const env = resolveRuntimeEnvironment({
      appMode: 'dev',
      useEmulators: 'true',
      firebaseProjectId: 'demo-taxi-line',
    });
    assert.equal(describeEnvironment(env), 'Development / Emulator');
  });
});
