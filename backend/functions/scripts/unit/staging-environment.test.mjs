import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../../../..', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Firebase aliases default to staging and keep production explicit', () => {
  const aliases = JSON.parse(read('.firebaserc')).projects;
  assert.equal(aliases.default, 'waselneh-staging-ayed');
  assert.equal(aliases.staging, 'waselneh-staging-ayed');
  assert.equal(aliases.production, 'waselneh-prod-414e2');
});

test('staging deploy commands cannot target production', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const name of ['deploy:staging:rules', 'deploy:staging:indexes', 'deploy:staging:functions']) {
    assert.match(scripts[name], /--project waselneh-staging-ayed/);
    assert.doesNotMatch(scripts[name], /waselneh-prod-414e2/);
  }
  assert.match(scripts['deploy:prod'], /confirm-production-deploy/);
  assert.match(scripts['deploy:indexes'], /confirm-production-deploy/);
  assert.match(scripts['deploy:staging:functions'], /firebase\.staging\.json/);
  assert.match(scripts['deploy:staging:functions'], /prepare:staging:functions/);
});

test('staging Functions deploy uses an isolated npm-compatible source', () => {
  const config = JSON.parse(read('firebase.staging.json'));
  assert.equal(config.functions.source, '.firebase/functions-deploy');
  const prepare = read('scripts/prepare-functions-deploy.mjs');
  assert.match(prepare, /file:vendor\/shared/);
  assert.match(prepare, /workspace:\*/);
});

test('production deployment is refused without the exact project confirmation', () => {
  const result = spawnSync(process.execPath, ['scripts/confirm-production-deploy.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Production deploy refused/);
});

for (const app of ['passenger-app', 'driver-app']) {
  test(`${app} preview build has a staging identity and project`, () => {
    const configPath = `apps/${app}/app.config.js`;
    const output = execFileSync(
      process.execPath,
      ['-e', `process.stdout.write(JSON.stringify(require('./${configPath}').expo))`],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          EXPO_PUBLIC_APP_MODE: 'pilot',
          EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'waselneh-staging-ayed',
        },
      }
    );
    const config = JSON.parse(output);
    const role = app === 'passenger-app' ? 'passenger' : 'driver';
    assert.equal(config.android.package, `com.taxiline.${role}.staging`);
    assert.equal(config.ios.bundleIdentifier, `com.taxiline.${role}.staging`);
    assert.equal(config.extra.firebaseProjectId, 'waselneh-staging-ayed');
  });

  test(`${app} preview build refuses the production Firebase project`, () => {
    const result = spawnSync(
      process.execPath,
      ['-e', `require('./apps/${app}/app.config.js')`],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          EXPO_PUBLIC_APP_MODE: 'pilot',
          EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'waselneh-prod-414e2',
        },
      }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pilot builds must use Firebase project waselneh-staging-ayed/);
  });
}

test('manager pilot configuration names only staging resources', () => {
  const env = read('apps/manager-web/.env.pilot');
  assert.match(env, /VITE_FIREBASE_PROJECT_ID=waselneh-staging-ayed/);
  assert.doesNotMatch(env, /waselneh-prod-414e2/);
});

test('local client fallbacks cannot silently target production', () => {
  for (const path of [
    'apps/passenger-app/src/services/firebase/firebase.ts',
    'apps/driver-app/src/services/firebase/firebase.ts',
    'apps/manager-web/src/services/firebase.ts',
  ]) {
    const source = read(path);
    assert.match(source, /demo-taxi-line/);
    assert.doesNotMatch(source, /defaultProjectId = 'waselneh-prod-414e2'/);
    assert.doesNotMatch(source, /\|\| "waselneh-prod-414e2"/);
  }
});
