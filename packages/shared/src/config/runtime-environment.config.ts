/**
 * ============================================================================
 * RUNTIME ENVIRONMENT RESOLUTION AND CONNECTION GUARD
 * ============================================================================
 *
 * One place that answers, for every app: which mode am I in, may I use
 * emulators, may I use a development auth bypass, and which Firebase project
 * must I be talking to.
 *
 * WHY THIS EXISTS
 *
 * Three separate bugs shared one shape - a boolean decision made somewhere the
 * environment could not reach:
 *
 *   1. `const DEV_MODE = true` was hardcoded in both mobile entry points, so
 *      EXPO_PUBLIC_APP_MODE / USE_EMULATORS / DEV_AUTH_BYPASS were ignored and
 *      an emulator-only login ran against real staging.
 *   2. Ad-hoc `x === true || x === 'true'` checks were repeated per call site,
 *      so each site could drift.
 *   3. Nothing cross-checked mode against project id, so a pilot build could
 *      point at production and no one would be told.
 *
 * A dev bypass is not a convenience toggle. It signs a user in without a
 * credential, so outside `dev` it is an authentication bypass against a real
 * project. Hence: three independent conditions, all required, and a guard that
 * refuses the contradictory combinations outright.
 * ============================================================================
 */

import type { AppMode } from './app-mode.config';
import { parseAppMode } from './app-mode.config';

/** The Firebase project each release mode is REQUIRED to use. */
export const REQUIRED_PROJECT_BY_MODE: Readonly<Record<AppMode, string | null>> = {
  dev: null, // emulator/demo projects vary; nothing to pin
  pilot: 'waselneh-staging-ayed',
  prod: 'waselneh-prod-414e2',
};

/**
 * Parse an environment flag as a boolean.
 *
 * ONLY the literal string "true" (any case, trimmed) is true. Everything else -
 * including "false", "0", "no", "", undefined, and the STRING "false" that a
 * naive truthiness check would accept - is false.
 *
 * A real boolean `true` is also accepted, because Expo Constants can deliver an
 * already-parsed value from app.config.js.
 */
export function parseEnvFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return value.trim().toLowerCase() === 'true';
}

export interface RuntimeEnvironmentInput {
  appMode?: unknown;
  useEmulators?: unknown;
  devAuthBypass?: unknown;
  firebaseProjectId?: unknown;
}

export interface RuntimeEnvironment {
  mode: AppMode;
  /** Emulators are permitted ONLY in dev, and only when explicitly requested. */
  useEmulators: boolean;
  /**
   * The emulator-only login path may run ONLY when all three hold:
   * mode is dev, emulators are on, and the bypass flag is explicitly true.
   */
  devAuthBypassEnabled: boolean;
  firebaseProjectId: string;
  /** The project this mode requires, or null when unpinned (dev). */
  requiredProjectId: string | null;
}

/**
 * Resolve the runtime environment from raw values.
 *
 * Pure: takes values, returns a decision. Callers supply `process.env`,
 * `Constants.expoConfig.extra`, or `import.meta.env`.
 */
export function resolveRuntimeEnvironment(
  input: RuntimeEnvironmentInput
): RuntimeEnvironment {
  const mode = parseAppMode(typeof input.appMode === 'string' ? input.appMode : undefined);
  const emulatorsRequested = parseEnvFlag(input.useEmulators);
  const bypassRequested = parseEnvFlag(input.devAuthBypass);

  // Emulators outside dev are refused here, not at the call site.
  const useEmulators = mode === 'dev' && emulatorsRequested;

  // THREE independent conditions. A dev id being present in .env is NOT one of
  // them: EXPO_PUBLIC_DEV_DRIVER_ID / _PASSENGER_ID are data, not permission.
  const devAuthBypassEnabled = mode === 'dev' && useEmulators && bypassRequested;

  return {
    mode,
    useEmulators,
    devAuthBypassEnabled,
    firebaseProjectId:
      typeof input.firebaseProjectId === 'string' ? input.firebaseProjectId.trim() : '',
    requiredProjectId: REQUIRED_PROJECT_BY_MODE[mode],
  };
}

export interface ConnectionGuardViolation {
  code:
    | 'emulators_in_release'
    | 'dev_bypass_in_release'
    | 'wrong_project_for_mode'
    | 'missing_project_id';
  message: string;
}

/**
 * Fail-fast guard: the combinations that must never ship.
 *
 * Returns violations rather than throwing, so a caller can decide between
 * throwing at startup (mobile) and rendering a blocking error (web). Callers
 * that ignore the result get no protection - `assertSafeRuntimeEnvironment`
 * below is the throwing form.
 */
export function checkConnectionGuard(
  env: RuntimeEnvironment,
  rawEmulatorsRequested: unknown = false,
  rawBypassRequested: unknown = false
): ConnectionGuardViolation[] {
  const violations: ConnectionGuardViolation[] = [];
  const isRelease = env.mode === 'pilot' || env.mode === 'prod';

  // Report what was ASKED for, not what resolveRuntimeEnvironment already
  // downgraded - otherwise a misconfigured build looks clean.
  if (isRelease && parseEnvFlag(rawEmulatorsRequested)) {
    violations.push({
      code: 'emulators_in_release',
      message: `${env.mode} mode requested Firebase emulators. Emulators are dev-only.`,
    });
  }

  if (isRelease && parseEnvFlag(rawBypassRequested)) {
    violations.push({
      code: 'dev_bypass_in_release',
      message: `${env.mode} mode requested the development auth bypass. That is an authentication bypass against a real project.`,
    });
  }

  if (isRelease && !env.firebaseProjectId) {
    violations.push({
      code: 'missing_project_id',
      message: `${env.mode} mode has no Firebase project id configured.`,
    });
  } else if (
    env.requiredProjectId &&
    env.firebaseProjectId &&
    env.firebaseProjectId !== env.requiredProjectId
  ) {
    violations.push({
      code: 'wrong_project_for_mode',
      message: `${env.mode} mode must use Firebase project "${env.requiredProjectId}" but is configured for "${env.firebaseProjectId}".`,
    });
  }

  return violations;
}

/** Throwing form of the guard, for startup paths that must not continue. */
export function assertSafeRuntimeEnvironment(
  env: RuntimeEnvironment,
  rawEmulatorsRequested: unknown = false,
  rawBypassRequested: unknown = false
): void {
  const violations = checkConnectionGuard(env, rawEmulatorsRequested, rawBypassRequested);
  if (violations.length === 0) return;
  throw new Error(
    `[ConnectionGuard] Unsafe configuration:\n${violations
      .map((v) => `  - ${v.code}: ${v.message}`)
      .join('\n')}`
  );
}

/** Human-readable environment label. Staging is NEVER called production. */
export function describeEnvironment(env: RuntimeEnvironment): string {
  if (env.useEmulators) return 'Development / Emulator';
  if (env.mode === 'dev') return 'Development';
  if (env.mode === 'pilot') return `Staging / ${env.firebaseProjectId || 'unknown project'}`;
  return `Production / ${env.firebaseProjectId || 'unknown project'}`;
}
