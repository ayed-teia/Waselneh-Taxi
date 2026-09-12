/**
 * Regression tests for the STAGING client configuration of all three apps.
 *
 * These read the real config files rather than a copy, so they fail if someone
 * edits app.config.js, .env.local or the launcher and breaks the staging path.
 *
 * WHAT THEY PROTECT
 *
 * - pilot builds must resolve the `.staging` native package, or `expo start
 *   --dev-client` looks for the production package and reports
 *   "No development build (com.taxiline.passenger) is installed" even though a
 *   staging build IS on the device.
 * - pilot must never resolve to the production Firebase project.
 * - Manager Web pilot must require real password auth, because the anonymous
 *   fallback was removed - without the flag there is no way in.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(dirname, '..', '..', '..', '..');

const STAGING_PROJECT = 'waselneh-staging-ayed';
const PRODUCTION_PROJECT = 'waselneh-prod-414e2';

/**
 * Evaluate an app.config.js in a child process with a controlled environment.
 * A child process is used because app.config.js reads process.env at module
 * scope and caches in require.cache.
 */
function loadAppConfig(appDir, env) {
  const script =
    'const c = require("./app.config.js");' +
    'process.stdout.write(JSON.stringify({' +
    ' androidPackage: c.expo.android.package,' +
    ' iosBundle: c.expo.ios.bundleIdentifier,' +
    ' appMode: c.expo.extra.appMode,' +
    ' projectId: c.expo.extra.firebaseProjectId,' +
    ' useEmulators: c.expo.extra.useEmulators,' +
    '}));';
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(REPO_ROOT, appDir),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/** Does app.config.js throw for this environment? */
function appConfigThrows(appDir, env) {
  try {
    execFileSync(process.execPath, ['-e', 'require("./app.config.js");'], {
      cwd: path.join(REPO_ROOT, appDir),
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    return false;
  } catch {
    return true;
  }
}

const APPS = [
  {
    name: 'passenger',
    dir: 'apps/passenger-app',
    stagingPackage: 'com.taxiline.passenger.staging',
    productionPackage: 'com.taxiline.passenger',
  },
  {
    name: 'driver',
    dir: 'apps/driver-app',
    stagingPackage: 'com.taxiline.driver.staging',
    productionPackage: 'com.taxiline.driver',
  },
];

describe('pilot builds resolve the staging native package', () => {
  for (const app of APPS) {
    test(`${app.name}: pilot uses ${app.stagingPackage}`, () => {
      const config = loadAppConfig(app.dir, {
        EXPO_PUBLIC_APP_MODE: 'pilot',
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: STAGING_PROJECT,
      });
      assert.equal(config.androidPackage, app.stagingPackage);
      assert.equal(config.iosBundle, app.stagingPackage);
    });

    test(`${app.name}: pilot package differs from production`, () => {
      // If these ever collide, a staging install silently replaces production
      // on the same device and `expo start --dev-client` cannot tell them apart.
      const config = loadAppConfig(app.dir, {
        EXPO_PUBLIC_APP_MODE: 'pilot',
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: STAGING_PROJECT,
      });
      assert.notEqual(config.androidPackage, app.productionPackage);
    });

    test(`${app.name}: pilot carries the staging Firebase project`, () => {
      const config = loadAppConfig(app.dir, {
        EXPO_PUBLIC_APP_MODE: 'pilot',
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: STAGING_PROJECT,
      });
      assert.equal(config.projectId, STAGING_PROJECT);
    });

    test(`${app.name}: pilot REFUSES the production project`, () => {
      assert.equal(
        appConfigThrows(app.dir, {
          EXPO_PUBLIC_APP_MODE: 'pilot',
          EXPO_PUBLIC_FIREBASE_PROJECT_ID: PRODUCTION_PROJECT,
        }),
        true,
        'pilot pointing at production must throw at config load'
      );
    });

    test(`${app.name}: pilot refuses a missing project id`, () => {
      assert.equal(
        appConfigThrows(app.dir, { EXPO_PUBLIC_APP_MODE: 'pilot' }),
        true
      );
    });
  }
});

describe('the staging launcher enforces its own invariants', () => {
  const launcher = fs.readFileSync(path.join(REPO_ROOT, 'scripts/run-expo-staging.mjs'), 'utf8');

  test('it pins the staging project and names production only to reject it', () => {
    assert.match(launcher, /STAGING_PROJECT_ID = 'waselneh-staging-ayed'/);
    assert.match(launcher, /REFUSING to touch production|points at PRODUCTION/);
  });

  test('it forces emulators and the dev bypass off', () => {
    assert.match(launcher, /EXPO_PUBLIC_USE_EMULATORS: 'false'/);
    assert.match(launcher, /EXPO_PUBLIC_DEV_AUTH_BYPASS: 'false'/);
  });

  test('it uses --dev-client so the staging build is selected', () => {
    // Without --dev-client, expo start offers Expo Go, which cannot load a
    // custom native package at all.
    assert.match(launcher, /--dev-client/);
  });

  test('it gives each app its own Metro port', () => {
    assert.match(launcher, /passenger: '8081'/);
    assert.match(launcher, /driver: '8082'/);
  });
});

describe('the staging admin bootstrap is production-safe', () => {
  const script = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts/bootstrap-staging-admin.mjs'),
    'utf8'
  );

  test('it rejects the production project by name', () => {
    assert.match(script, /REFUSING to touch production/);
  });

  test('it requires an exact staging project match', () => {
    assert.match(script, /--project must be exactly/);
  });

  test('it writes the document shape getManagerProfile requires', () => {
    // isActive must be literally true: backend and rules both gate on === true.
    assert.match(script, /role: 'admin'/);
    assert.match(script, /isActive: true/);
    assert.match(script, /updatedBy: 'bootstrap'/);
    assert.match(script, /permissions: \[\]/);
  });

  test('it supports a dry run', () => {
    assert.match(script, /--dry-run/);
    assert.match(script, /DRY RUN - nothing is written/);
  });

  test('it embeds no credentials', () => {
    // Ambient Google credentials only - never a key in the repository.
    assert.doesNotMatch(script, /BEGIN PRIVATE KEY|serviceAccountKey|private_key/);
  });
});

describe('Manager Web staging configuration', () => {
  const envLocalPath = path.join(REPO_ROOT, 'apps/manager-web/.env.local');

  test('.env.local exists and targets staging with password auth on', (t) => {
    if (!fs.existsSync(envLocalPath)) {
      // Gitignored by design, so it is absent on CI. Skip rather than fail:
      // a false failure here would train people to ignore this suite.
      t.skip('.env.local is gitignored and not present in this environment');
      return;
    }
    const env = fs.readFileSync(envLocalPath, 'utf8');
    assert.match(env, /VITE_APP_MODE=pilot/);
    assert.match(env, /VITE_USE_EMULATORS=false/);
    assert.match(env, /VITE_FORCE_LOCAL_DEV_MODE=false/);
    assert.match(env, /VITE_ENABLE_MANAGER_PASSWORD_AUTH=true/);
    assert.match(env, new RegExp(`VITE_FIREBASE_PROJECT_ID=${STAGING_PROJECT}`));
    // The production project must not appear as a VALUE anywhere.
    for (const line of env.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      assert.ok(
        !line.includes(PRODUCTION_PROJECT),
        `production project id must never be a configured value: ${line}`
      );
    }
  });

  test('manager auth has no anonymous fallback outside the emulator', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/manager-web/src/services/manager-auth.service.ts'),
      'utf8'
    );
    // An anonymous user can never hold a managerRoles document, so anonymous
    // sign-in against a real project only creates junk and then fails.
    assert.doesNotMatch(source, /signInAnonymously/);
    assert.match(source, /Anonymous access is only available against the Firebase emulator/);
  });

  test('authorization still comes from managerRoles, not users/{uid}.role', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'backend/functions/src/modules/auth/manager-rbac.ts'),
      'utf8'
    );
    assert.match(source, /collection\('managerRoles'\)/);
    assert.match(source, /isActive !== true/);
    // The R1 fix: users/{uid} must never be consulted for role or permissions.
    assert.doesNotMatch(source, /collection\('users'\)/);
  });

  test('the environment indicator can report Staging distinctly', () => {
    const app = fs.readFileSync(path.join(REPO_ROOT, 'apps/manager-web/src/App.tsx'), 'utf8');
    // The old UI hardcoded a two-way emulator/production choice.
    assert.doesNotMatch(app, /txt\('إنتاج', 'production'\)/);
    assert.match(app, /environmentLabel/);
  });
});

describe('notification registration survives a missing EAS project id', () => {
  for (const app of ['passenger', 'driver']) {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, `apps/${app}-app/src/services/notifications/push-notifications.ts`),
      'utf8'
    );

    test(`${app}: a missing EAS project id skips only the token`, () => {
      // getExpoPushTokenAsync throws "No projectId found" without one. That
      // exception used to escape and abort registerNotificationDevice, so the
      // userDevices document was never written.
      assert.match(source, /if \(!projectId\) \{/);
      assert.match(source, /No EAS project id configured/);
    });

    test(`${app}: the token request itself cannot abort registration`, () => {
      assert.match(source, /Expo push token request failed; continuing without it/);
    });

    test(`${app}: the warning distinguishes EAS from Firebase project id`, () => {
      // Confusing the two is the most likely wrong fix.
      assert.match(source, /NOT the Firebase project id/);
    });

    test(`${app}: userDevices is still written when there is no token`, () => {
      // The write must not sit behind a token check.
      assert.match(source, /expoPushTokens = arrayUnion\(expoPushToken\)|if \(expoPushToken\)/);
      assert.match(source, /userDevices/);
    });
  }
});
