/**
 * ============================================================================
 * RELEASE PREFLIGHT
 * ============================================================================
 *
 * A pure check that a build's configuration is safe to ship, run against the
 * values a build actually has rather than the values someone meant it to have.
 *
 * WHY validateAppModeConfig WAS NOT ENOUGH
 *
 * It exists, and it is called by exactly ONE consumer - manager-web's firebase.ts.
 * Neither mobile app calls it at all. Its checks are also thin: it catches a
 * `demo-` project id and a missing one, but NOT the placeholder that both committed
 * `.env.pilot` files actually contain today:
 *
 *     EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-real-project-id
 *
 * A build made by copying `.env.pilot` as instructed therefore passes the existing
 * validation while pointing at a project that does not exist. That is the failure
 * this module is built around.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not talk to Firebase, does not verify a project exists, and cannot tell
 * you whether credentials are valid - only a real call can do that, and claiming
 * otherwise would be worse than saying nothing. It checks the SHAPE of a release
 * configuration for the mistakes that are cheap to make and expensive to discover
 * after a store submission.
 *
 * It is wired into no build yet, on purpose: making a release fail is a behaviour
 * change for every environment and belongs in its own reviewable change.
 * ============================================================================
 */

import type { AppMode } from './app-mode.config';

/** How bad a finding is. `blocker` means do not ship this build. */
export type PreflightSeverity = 'blocker' | 'warning';

export interface PreflightFinding {
  severity: PreflightSeverity;
  code: string;
  message: string;
}

export interface PreflightInput {
  mode: AppMode;
  firebaseProjectId?: string | undefined;
  firebaseApiKey?: string | undefined;
  /** What the build ASKED for, not what it got - the distinction matters. */
  emulatorsRequested?: boolean | undefined;
  /** App version string, e.g. from app.config.js. */
  appVersion?: string | undefined;
  /** iOS/Android bundle identifier. */
  bundleIdentifier?: string | undefined;
}

export interface PreflightReport {
  findings: PreflightFinding[];
  blockers: PreflightFinding[];
  warnings: PreflightFinding[];
  /** True when nothing of `blocker` severity was found. */
  safeToShip: boolean;
}

/**
 * Placeholder values that ship in the committed `.env.example` / `.env.pilot`
 * files. A build carrying any of these was made from a template nobody filled in.
 */
const PLACEHOLDER_FRAGMENTS: readonly string[] = [
  'your-real-project-id',
  'your-project-id',
  'your-project',
  'your-api-key',
  '123456789',
  'abc123',
  'changeme',
  'xxx',
];

function looksLikePlaceholder(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  if (!normalised) return false;
  return PLACEHOLDER_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

/**
 * Check a release configuration.
 *
 * Findings are returned rather than thrown: a preflight that throws on the first
 * problem tells an operator about one issue per run, which turns a five-minute fix
 * into five separate builds.
 */
export function checkReleasePreflight(input: PreflightInput): PreflightReport {
  const findings: PreflightFinding[] = [];
  const isRelease = input.mode === 'pilot' || input.mode === 'prod';

  const projectId = input.firebaseProjectId?.trim() ?? '';
  const apiKey = input.firebaseApiKey?.trim() ?? '';

  // --- Firebase project ------------------------------------------------------
  if (!projectId) {
    findings.push({
      severity: isRelease ? 'blocker' : 'warning',
      code: 'missing_project_id',
      message: 'Firebase project id is not set.',
    });
  } else if (isRelease && projectId.startsWith('demo-')) {
    findings.push({
      severity: 'blocker',
      code: 'demo_project_in_release',
      message: `Release build points at the demo project "${projectId}".`,
    });
  } else if (isRelease && looksLikePlaceholder(projectId)) {
    // The case validateAppModeConfig misses, and the one the committed
    // .env.pilot files actually produce.
    findings.push({
      severity: 'blocker',
      code: 'placeholder_project_id',
      message: `Firebase project id "${projectId}" is still a template placeholder.`,
    });
  }

  // --- Credentials -----------------------------------------------------------
  if (isRelease && !apiKey) {
    findings.push({
      severity: 'blocker',
      code: 'missing_api_key',
      message: 'Firebase API key is not set for a release build.',
    });
  } else if (isRelease && apiKey && looksLikePlaceholder(apiKey)) {
    findings.push({
      severity: 'blocker',
      code: 'placeholder_api_key',
      message: 'Firebase API key is still a template placeholder.',
    });
  }

  // --- Emulators -------------------------------------------------------------
  if (isRelease && input.emulatorsRequested === true) {
    // shouldAllowEmulators already BLOCKS this at runtime, so it cannot connect to
    // an emulator. It is still a blocker here: it means the build was made from a
    // dev env file, so everything else in that file is suspect too.
    findings.push({
      severity: 'blocker',
      code: 'emulators_requested_in_release',
      message: `Emulators are requested in ${input.mode} mode - this build came from a dev environment file.`,
    });
  }

  // --- Version and identity --------------------------------------------------
  const version = input.appVersion?.trim() ?? '';
  if (input.mode === 'prod' && /-(pilot|beta|alpha|rc|dev)\b/i.test(version)) {
    findings.push({
      severity: 'warning',
      code: 'prerelease_version_in_prod',
      message: `Production build carries a pre-release version "${version}".`,
    });
  }

  const bundleId = input.bundleIdentifier?.trim() ?? '';
  if (isRelease && !bundleId) {
    findings.push({
      severity: 'warning',
      code: 'missing_bundle_identifier',
      message: 'Bundle identifier is not set.',
    });
  }

  const blockers = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');

  return {
    findings,
    blockers,
    warnings,
    safeToShip: blockers.length === 0,
  };
}

/** A human-readable summary, for a build log or a runbook step. */
export function formatPreflightReport(report: PreflightReport): string {
  if (report.findings.length === 0) return 'Preflight: no findings.';
  const lines = report.findings.map((f) => `  [${f.severity}] ${f.code}: ${f.message}`);
  const verdict = report.safeToShip
    ? 'Preflight: warnings only, safe to ship.'
    : `Preflight: ${report.blockers.length} blocker(s) - DO NOT SHIP.`;
  return [verdict, ...lines].join('\n');
}
