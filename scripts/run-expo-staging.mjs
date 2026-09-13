#!/usr/bin/env node
/**
 * ============================================================================
 * STAGING EXPO LAUNCHER
 * ============================================================================
 *
 * Runs a mobile app against the REAL staging Firebase project with the correct
 * native package and a deterministic Metro port, on Windows and POSIX alike.
 *
 * WHY A SCRIPT AND NOT `cross-env` IN package.json
 *
 *   1. It must LOAD apps/<app>/.env.staging, which is gitignored and therefore
 *      cannot live in package.json.
 *   2. It must REFUSE to launch on a bad configuration - pointing at
 *      production, or requesting emulators in pilot. A `cross-env` prefix
 *      cannot check anything.
 *   3. It adds no dependency. cross-env is not installed in this workspace and
 *      is not worth adding for variable passing Node can already do.
 *
 * PORTS ARE PINNED PER APP, FOR EVERY COMMAND
 *
 * Passenger is 8081, driver is 8082, always. `run:android` previously omitted
 * `--port`, so Expo defaulted it to 8081 and the driver build collided with a
 * running passenger Metro - AFTER Gradle had already finished compiling, which
 * is the most expensive possible moment to discover it.
 *
 * Usage:
 *   node scripts/run-expo-staging.mjs <passenger|driver> <start|android> [extra expo args]
 * ============================================================================
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STAGING_PROJECT_ID = 'waselneh-staging-ayed';
const PRODUCTION_PROJECT_ID = 'waselneh-prod-414e2';

export const EXPECTED_PACKAGE = {
  passenger: 'com.taxiline.passenger.staging',
  driver: 'com.taxiline.driver.staging',
};

/**
 * Metro ports, distinct so both apps can run at once.
 *
 * These are not defaults, they are guarantees: every command for an app uses
 * its own port, so the two apps can never contend for one.
 */
export const METRO_PORT = { passenger: '8081', driver: '8082' };

/**
 * Strip the bare `--` separator that pnpm forwards.
 *
 * `pnpm run driver:staging:android -- --device` hands us `['--', '--device']`.
 * Passing that straight through produced
 *   npx expo run:android --variant debug -- --device
 * where the lone `--` is a meaningless argument to Expo. Only a leading
 * separator is dropped: a later `--` could be meaningful to a nested command.
 */
export function normalizePassthrough(args) {
  const out = [...args];
  while (out.length > 0 && out[0] === '--') out.shift();
  return out;
}

/**
 * Build the Expo argv for an app and command.
 *
 * Exported so tests can assert the exact argument vector without spawning
 * anything - the port bug was invisible precisely because nothing inspected
 * this array.
 */
export function buildExpoArgs(app, command, passthrough = []) {
  const port = METRO_PORT[app];
  const extra = normalizePassthrough(passthrough);

  if (command === 'android') {
    // --port is what was missing. Without it Expo starts Metro on 8081 for
    // BOTH apps and the second one fails after Gradle succeeds.
    return ['expo', 'run:android', '--variant', 'debug', '--port', port, ...extra];
  }

  return ['expo', 'start', '--dev-client', '--port', port, ...extra];
}

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

/** Is a TCP port accepting connections on loopback? */
function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: Number(port), host: '127.0.0.1' });
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(1000);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

/**
 * Which PID holds a port, and what is it? Best effort, read-only.
 *
 * Windows `netstat -ano` plus `tasklist`; `lsof` elsewhere. Returns null when
 * the owner cannot be determined - a missing PID must not block a launch.
 */
function describePortOwner(port) {
  try {
    if (process.platform === 'win32') {
      const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
      const line = (netstat.stdout || '')
        .split(/\r?\n/)
        .find((l) => l.includes(`:${port} `) && l.includes('LISTENING'));
      if (!line) return null;
      const pid = line.trim().split(/\s+/).pop();
      if (!pid) return null;

      const tasklist = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
      });
      const name = (tasklist.stdout || '').split(',')[0]?.replace(/"/g, '').trim();

      // The command line tells us WHICH app owns it - a bare "node.exe" does not.
      const wmic = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue).CommandLine`,
        ],
        { encoding: 'utf8' }
      );
      const commandLine = (wmic.stdout || '').trim();
      return { pid, name: name || 'unknown', commandLine };
    }

    const lsof = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    const line = (lsof.stdout || '').split(/\r?\n/)[1];
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    return { pid: parts[1], name: parts[0], commandLine: '' };
  } catch {
    return null;
  }
}

/** Does this process look like Metro for THIS app in THIS repository? */
function looksLikeOwnMetro(owner, app) {
  if (!owner?.commandLine) return false;
  const cmd = owner.commandLine.toLowerCase();
  return cmd.includes('taxi-line-platform') && cmd.includes(`${app}-app`);
}

/** Does it look like the OTHER mobile app? */
function looksLikeOtherApp(owner, app) {
  if (!owner?.commandLine) return false;
  const other = app === 'passenger' ? 'driver' : 'passenger';
  return owner.commandLine.toLowerCase().includes(`${other}-app`);
}

async function main() {
  const [appArg, commandArg, ...rawPassthrough] = process.argv.slice(2);

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

  const isTrue = (v) => typeof v === 'string' && v.trim().toLowerCase() === 'true';
  if (isTrue(envFile.EXPO_PUBLIC_USE_EMULATORS)) {
    fail(
      '.env.staging requests emulators. Staging is real Firebase; set EXPO_PUBLIC_USE_EMULATORS=false.'
    );
  }
  if (isTrue(envFile.EXPO_PUBLIC_DEV_AUTH_BYPASS)) {
    fail(
      '.env.staging requests the dev auth bypass. That is an auth bypass against a real project; set it to false.'
    );
  }

  const port = METRO_PORT[appArg];

  // --- Port check BEFORE the expensive Gradle compile ------------------------
  //
  // The whole point: a collision discovered after "BUILD SUCCESSFUL" has already
  // cost minutes. Check first, and never kill anything automatically - the
  // process might be a colleague's editor, a debugger, or the other app in use.
  if (await isPortBusy(port)) {
    const owner = describePortOwner(port);
    const pidText = owner?.pid ? `PID ${owner.pid}` : 'PID unknown';
    const nameText = owner?.name ? ` (${owner.name})` : '';

    if (looksLikeOwnMetro(owner, appArg)) {
      // Already serving this very app: reuse rather than fight over the port.
      if (commandArg === 'start') {
        console.log('');
        console.log(`  Metro for ${appArg} is already running on port ${port} (${pidText}).`);
        console.log('  Nothing to do - use that instance, or stop it to start a fresh one.');
        console.log('');
        process.exit(0);
      }
      console.log('');
      console.log(`  Port ${port} is held by this app's own Metro (${pidText}).`);
      console.log('  Continuing: run:android will connect to the running bundler.');
      console.log('');
    } else {
      const whose = looksLikeOtherApp(owner, appArg)
        ? `the OTHER mobile app (${appArg === 'passenger' ? 'driver' : 'passenger'})`
        : 'an unrelated process';
      fail(
        `Port ${port} is already in use by ${whose}.\n` +
          `  port    : ${port}\n` +
          `  pid     : ${owner?.pid ?? 'unknown'}\n` +
          `  process : ${owner?.name ?? 'unknown'}${nameText === '' ? '' : ''}\n` +
          `  command : ${owner?.commandLine ? owner.commandLine.slice(0, 160) : 'unavailable'}\n\n` +
          `${appArg} must use port ${port} so both apps can run together.\n\n` +
          `What to do:\n` +
          `  - If that process is no longer needed, stop it yourself:\n` +
          `        Stop-Process -Id ${owner?.pid ?? '<pid>'}\n` +
          `  - Nothing is killed automatically, on purpose.\n\n` +
          `Stopping BEFORE Gradle so a long compile is not wasted.`
      );
    }
  }

  // --- Compose the environment ------------------------------------------------
  const childEnv = {
    ...process.env,
    ...envFile,
    // Pinned here so a stale shell variable cannot override the file.
    EXPO_PUBLIC_APP_MODE: 'pilot',
    EXPO_PUBLIC_USE_EMULATORS: 'false',
    EXPO_PUBLIC_DEV_AUTH_BYPASS: 'false',
    // Belt and braces: Expo also honours this, so the port holds even if a
    // future edit drops the flag.
    RCT_METRO_PORT: port,
  };

  const expoArgs = buildExpoArgs(appArg, commandArg, rawPassthrough);

  console.log('');
  console.log(`  app       : ${appArg}`);
  console.log(`  mode      : pilot (staging)`);
  console.log(`  project   : ${STAGING_PROJECT_ID}`);
  console.log(`  package   : ${EXPECTED_PACKAGE[appArg]}`);
  console.log(`  metro port: ${port}`);
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
}

// Only run when invoked directly, so the exported helpers stay importable
// from tests without spawning Expo.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
