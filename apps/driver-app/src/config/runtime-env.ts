/**
 * ============================================================================
 * DRIVER RUNTIME ENVIRONMENT
 * ============================================================================
 *
 * The single answer to "which mode am I in, and what am I allowed to do".
 *
 * WHAT THIS REPLACED
 *
 * `app/index.tsx` carried `const DEV_MODE = true;` - a hardcoded constant that
 * read no environment variable at all. Setting EXPO_PUBLIC_APP_MODE=pilot,
 * USE_EMULATORS=false and DEV_AUTH_BYPASS=false changed nothing, because the
 * gate never consulted them. An emulator-only login path therefore ran against
 * whatever project the build pointed at.
 *
 * Values come from `Constants.expoConfig.extra` first (app.config.js already
 * resolved them at build time) and fall back to `process.env` for Metro dev.
 * ============================================================================
 */

import {
  assertSafeRuntimeEnvironment,
  checkConnectionGuard,
  describeEnvironment,
  parseEnvFlag,
  resolveRuntimeEnvironment,
  type RuntimeEnvironment,
} from '@taxi-line/shared';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

/** What the build ASKED for, before any safety downgrade. Kept for the guard. */
const rawEmulatorsRequested =
  extra.useEmulators ?? process.env.EXPO_PUBLIC_USE_EMULATORS ?? false;
const rawDevBypassRequested =
  extra.devAuthBypass ?? process.env.EXPO_PUBLIC_DEV_AUTH_BYPASS ?? false;

export const runtimeEnv: RuntimeEnvironment = resolveRuntimeEnvironment({
  appMode: extra.appMode ?? process.env.EXPO_PUBLIC_APP_MODE,
  useEmulators: rawEmulatorsRequested,
  devAuthBypass: rawDevBypassRequested,
  firebaseProjectId: extra.firebaseProjectId ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
});

/**
 * True only when mode is dev AND emulators are on AND the bypass is explicitly
 * requested. Note what is absent: EXPO_PUBLIC_DEV_DRIVER_ID. A dev id is
 * data, never permission.
 */
export const isDevAuthBypassEnabled = runtimeEnv.devAuthBypassEnabled;

export const isUsingEmulators = runtimeEnv.useEmulators;

export const environmentLabel = describeEnvironment(runtimeEnv);

/**
 * Fail fast on a contradictory configuration - pilot with emulators, pilot with
 * a dev bypass, or a mode pointing at the wrong Firebase project.
 *
 * In a release build this throws: shipping a pilot app silently wired to
 * production is worse than refusing to start. In dev it warns, so an incomplete
 * local .env does not block work.
 */
export function enforceConnectionGuard(): void {
  const violations = checkConnectionGuard(
    runtimeEnv,
    rawEmulatorsRequested,
    rawDevBypassRequested
  );
  if (violations.length === 0) return;

  if (runtimeEnv.mode === 'dev') {
    for (const violation of violations) {
      console.warn(`[ConnectionGuard] ${violation.code}: ${violation.message}`);
    }
    return;
  }

  assertSafeRuntimeEnvironment(runtimeEnv, rawEmulatorsRequested, rawDevBypassRequested);
}

/** Re-exported so call sites parse flags the same way rather than inventing checks. */
export { parseEnvFlag };
