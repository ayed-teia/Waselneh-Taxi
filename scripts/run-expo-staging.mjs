#!/usr/bin/env node
/**
 * ============================================================================
 * STAGING EXPO LAUNCHER
 * ============================================================================
 *
 * Runs a mobile app against the REAL staging Firebase project with the correct
 * native package, on Windows and POSIX alike.
 *
 * WHY A SCRIPT AND NOT `cross-env` IN package.json
 *
 * Three reasons a plain env prefix could not cover:
 *
 *   1. It must LOAD apps/<app>/.env.staging, which is gitignored and therefore
 *      cannot live in package.json.
 *   2. It must REFUSE to launch on a bad configuration - pointing at
 *      production, or requesting emulators in pilot. A `cross-env` prefix
 *      cannot check anything.
 *   3. It adds no dependency. cross-env is not installed in this workspace and
 *      is not worth adding for variable passing Node can already do.
 *
 * Usage:
 *   node scripts/run-expo-staging.mjs <passenger|driver> <start|android> [extra expo args]
 * ============================================================================
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STAGING_PROJECT_ID = 'waselneh-staging-ayed';
const PRODUCTION_PROJECT_ID = 'waselneh-prod-414e2';

const EXPECTED_PACKAGE = {
  passenger: 'com.taxiline.passenger.staging',
  driver: 'com.taxiline.driver.staging',
};

/** Metro ports, kept distinct so both apps can run at once. */
const METRO_PORT = { passenger: '8081', driver: '8082' };

function fail(message) {
  console.error(`\n[staging] ${message}\n`);
  process.exit(1);
}

/** Minimal .env parser: KEY=VALUE, ignoring blanks and # comments. */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const out = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const [appArg, commandArg, ...passthrough] = process.argv.slice(2);

if (!appArg || !EXPECTED_PACKAGE[appArg]) {
  fail('First argument must be "passenger" or "driver".');
}
if (!commandArg || !['start', 'android'].includes(commandArg)) {
  fail('Second argument must be "start" or "android".');
}

const appDir = path.join(REPO_ROOT, 'apps', `${appArg}-app`);
const envPath = path.join(appDir, '.env.staging');
const envFile = parseEnvFile(envPath);

if (!envFile) {
  fail(
    `Missing ${path.relative(REPO_ROOT, envPath)}.\n` +
      `Copy .env.staging.example next to it and fill in the staging values.\n` +
      `It is gitignored on purpose - it carries a real API key.`
  );
}

// --- Refuse a configuration that would touch the wrong project -------------
const projectId = envFile.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
if (projectId === PRODUCTION_PROJECT_ID) {
  fail(
    `.env.staging points at PRODUCTION (${PRODUCTION_PROJECT_ID}).\n` +
      `This launcher only ever targets ${STAGING_PROJECT_ID}.`
  );
}
if (projectId !== STAGING_PROJECT_ID) {
  fail(
    `.env.staging must set EXPO_PUBLIC_FIREBASE_PROJECT_ID=${STAGING_PROJECT_ID}\n` +
      `(found: ${projectId || 'nothing'})`
  );
}

// The app-side guard enforces these too; catching them here gives a clearer
// message before Metro spends a minute bundling.
const isTrue = (v) => typeof v === 'string' && v.trim().toLowerCase() === 'true';
if (isTrue(envFile.EXPO_PUBLIC_USE_EMULATORS)) {
  fail('.env.staging requests emulators. Staging is real Firebase; set EXPO_PUBLIC_USE_EMULATORS=false.');
}
if (isTrue(envFile.EXPO_PUBLIC_DEV_AUTH_BYPASS)) {
  fail('.env.staging requests the dev auth bypass. That is an auth bypass against a real project; set it to false.');
}

// --- Compose the environment ------------------------------------------------
const childEnv = {
  ...process.env,
  ...envFile,
  // Pinned here so a stale shell variable cannot override the file.
  EXPO_PUBLIC_APP_MODE: 'pilot',
  EXPO_PUBLIC_USE_EMULATORS: 'false',
  EXPO_PUBLIC_DEV_AUTH_BYPASS: 'false',
};

const expoArgs =
  commandArg === 'android'
    ? ['expo', 'run:android', '--variant', 'debug', ...passthrough]
    : ['expo', 'start', '--dev-client', '--port', METRO_PORT[appArg], ...passthrough];

console.log('');
console.log(`  app       : ${appArg}`);
console.log(`  mode      : pilot (staging)`);
console.log(`  project   : ${STAGING_PROJECT_ID}`);
console.log(`  package   : ${EXPECTED_PACKAGE[appArg]}`);
console.log(`  emulators : disabled`);
console.log(`  dev bypass: disabled`);
console.log(`  command   : npx ${expoArgs.join(' ')}`);
console.log('');
if (commandArg === 'start') {
  console.log(
    `  If Expo reports "No development build (com.taxiline.${appArg}) is installed",\n` +
      `  the build on the device is the PRODUCTION package. Reinstall with:\n` +
      `      pnpm ${appArg}:staging:android\n`
  );
}

// shell:true is required on Windows for npx resolution.
const child = spawn('npx', expoArgs, {
  cwd: appDir,
  env: childEnv,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => fail(`Failed to launch Expo: ${error.message}`));
