/**
 * ============================================================================
 * AUTH FEATURE FLAGS
 * ============================================================================
 *
 * Production phone/OTP sign-in is SCAFFOLDED BUT NOT ENABLED.
 *
 * Everything needed to turn it on is either a Firebase console action or a
 * decision that has not been made yet (SMS budget, allowed countries, App Check
 * enforcement, store test numbers). Half-enabling it would break the existing
 * dev login for no gain, so it ships OFF and the existing dev sign-in path is
 * completely untouched.
 *
 * See docs/AUTH_ROLLOUT.md for the console steps, the server-side rate limiting
 * that must exist BEFORE this is switched on, and the open decisions.
 *
 * TO ENABLE (only after that document's prerequisites are done):
 *   set EXPO_PUBLIC_ENABLE_PHONE_AUTH=true for the app build.
 *
 * This is intentionally an env flag rather than a remote/Firestore flag: auth is
 * the one surface where a remote toggle could lock every user out of the app,
 * and a build-time flag cannot be flipped by accident in production.
 * ============================================================================
 */

function readEnvFlag(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

/**
 * Whether the production phone/OTP sign-in UI is available.
 * DEFAULTS TO FALSE, including when the variable is absent or malformed.
 */
export function isPhoneAuthEnabled(env?: Record<string, string | undefined>): boolean {
  const source = env ?? (typeof process !== 'undefined' ? process.env : {});
  return readEnvFlag(source?.EXPO_PUBLIC_ENABLE_PHONE_AUTH);
}

/**
 * Limits the OTP flow must respect. These are enforced SERVER-SIDE before phone
 * auth is enabled - a client-side limit is not a limit, it is a suggestion.
 * See docs/AUTH_ROLLOUT.md.
 */
export const OTP_LIMITS = {
  /** Codes that may be requested for one phone number per hour. */
  MAX_SENDS_PER_NUMBER_PER_HOUR: 5,
  /** Codes that may be requested from one device/IP per hour. */
  MAX_SENDS_PER_DEVICE_PER_HOUR: 10,
  /** Wrong-code attempts before the number is locked out. */
  MAX_VERIFY_ATTEMPTS: 5,
  /** Lockout duration once MAX_VERIFY_ATTEMPTS is hit. */
  LOCKOUT_MINUTES: 15,
  /** Seconds a user must wait before requesting another code. */
  RESEND_COOLDOWN_SECONDS: 60,
} as const;

/**
 * Whether manager-web offers production email+password sign-in.
 * DEFAULTS TO FALSE. With it off, manager-web keeps using the emulator dev-token
 * path and nothing changes.
 *
 * Vite exposes build-time vars on `import.meta.env`, so manager-web passes that in
 * explicitly rather than relying on `process.env`, which does not exist in a browser
 * bundle.
 *
 * TO ENABLE: set VITE_ENABLE_MANAGER_PASSWORD_AUTH=true for the manager-web build,
 * AFTER creating the manager accounts and seeding their managerRoles documents. See
 * docs/AUTH_ROLLOUT.md.
 */
export function isManagerPasswordAuthEnabled(env?: Record<string, string | undefined>): boolean {
  const source =
    env ?? (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {});
  return readEnvFlag(source?.VITE_ENABLE_MANAGER_PASSWORD_AUTH);
}

/**
 * ⚠️  TAXI-LINE FIFO QUEUE - DEFAULT OFF, AND NEEDS DRIVER SIGN-OFF.
 *
 * This one is not merely a technical rollout switch. When it is on, dispatch offers
 * trips by queue position rather than by proximity, so the forfeit rules decide who
 * earns money on a given day. Those rules should be agreed WITH a group of drivers
 * before anyone flips this - shipping a fairness policy drivers have not accepted is
 * how a platform gets a strike rather than a bug report.
 *
 * See docs/REMAINING_PLAN.md for the default policy and the open questions.
 *
 * TO ENABLE: TAXI_LINE_QUEUE_ENABLED=true in the FUNCTIONS environment. It is a
 * server-side flag because dispatch runs server-side; a client flag would be
 * meaningless here.
 */
export function isTaxiLineQueueEnabled(env?: Record<string, string | undefined>): boolean {
  const source =
    env ?? (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {});
  return readEnvFlag(source?.TAXI_LINE_QUEUE_ENABLED);
}

/**
 * ⚠️  ONLINE PAYMENTS - DEFAULT OFF, AND NO REAL PROCESSOR IS WIRED.
 *
 * With this off, the payments module is inert: no charge is ever created, the
 * webhook rejects every request, and CASH remains the only path to `paid`. That is
 * the current, shipping behaviour and it is unchanged.
 *
 * It is server-side because money state may only advance server-side. There is
 * deliberately no client flag - an app build must never be able to decide whether
 * it is allowed to pay.
 *
 * TO ENABLE: ONLINE_PAYMENTS_ENABLED=true in the FUNCTIONS environment - but ONLY
 * after a real PaymentProvider adapter exists. Enabling it today selects the
 * StubProvider, which marks trips paid for free. See docs/REMAINING_PLAN.md.
 */
export function isOnlinePaymentsEnabled(env?: Record<string, string | undefined>): boolean {
  const source =
    env ?? (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {});
  return readEnvFlag(source?.ONLINE_PAYMENTS_ENABLED);
}
