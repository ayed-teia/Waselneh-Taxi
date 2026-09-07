import { isManagerPasswordAuthEnabled } from '@taxi-line/shared';
import {
  User,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

import { getFirebaseAuth, getFunctionsInstance, isUsingEmulators } from './firebase';

export type ManagerRole = 'admin' | 'manager' | 'operations_manager' | 'dispatcher' | 'support';

export interface ManagerSession {
  userId: string;
  role: ManagerRole;
  permissions: string[];
  officeIds: string[];
  lineIds: string[];
  isGlobalScope: boolean;
  profile: {
    displayName: string | null;
    email: string | null;
  };
}

interface DevIssueManagerTokenResponse {
  uid: string;
  role: ManagerRole;
  token: string;
  permissions: string[];
}

const DEFAULT_MANAGER_ROLE: ManagerRole = 'admin';
let managerSignInPromise: Promise<User> | null = null;

export function subscribeAuthState(
  callback: (user: User | null) => void
): () => void {
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, callback);
}

export async function ensureSignedInManager(
  role: ManagerRole = DEFAULT_MANAGER_ROLE
): Promise<User> {
  const auth = getFirebaseAuth();
  const functions = getFunctionsInstance();

  if (managerSignInPromise) {
    return managerSignInPromise;
  }

  if (!isUsingEmulators() && auth.currentUser) {
    return auth.currentUser;
  }

  if (isUsingEmulators()) {
    const desiredUid = `dev-manager-${role}`;
    if (auth.currentUser?.uid === desiredUid) {
      return auth.currentUser;
    }
  }

  managerSignInPromise = (async () => {
    if (isUsingEmulators()) {
      const issueTokenCallable = httpsCallable<
        { role?: ManagerRole; uid?: string },
        DevIssueManagerTokenResponse
      >(functions, 'devIssueManagerToken');

      const response = await issueTokenCallable({
        role,
        uid: `dev-manager-${role}`,
      });

      const credential = await signInWithCustomToken(auth, response.data.token);
      return credential.user;
    }

    const credential = await signInAnonymously(auth);
    return credential.user;
  })();

  try {
    return await managerSignInPromise;
  } finally {
    managerSignInPromise = null;
  }
}

export async function getManagerSession(): Promise<ManagerSession> {
  const functions = getFunctionsInstance();
  const callable = httpsCallable<Record<string, never>, ManagerSession>(
    functions,
    'getManagerSession'
  );
  const response = await callable({});
  return response.data;
}

export async function signOutManager(): Promise<void> {
  await signOut(getFirebaseAuth());
}

/**
 * ============================================================================
 * PRODUCTION MANAGER SIGN-IN (email + password) - BEHIND A FLAG, DEFAULT OFF
 * ============================================================================
 *
 * WHY EMAIL + PASSWORD RATHER THAN PHONE/OTP
 * A manager can deactivate drivers, change pricing and read every driver's PII. That
 * account should not be recoverable by whoever holds a SIM card. This is structured
 * so MFA or SSO can be layered on later without changing the call sites: everything
 * below establishes IDENTITY only.
 *
 * AUTHORIZATION IS UNCHANGED. Signing in proves who you are; it grants nothing.
 * getManagerSession() remains the only authority, and it resolves role, permissions
 * and scope solely from managerRoles/{uid} (the R1 fix). An authenticated user with
 * no active managerRoles document is rejected there, exactly as before.
 *
 * With the flag OFF the emulator dev-token path is untouched.
 * ============================================================================
 */
export const MANAGER_PASSWORD_AUTH_ENABLED = isManagerPasswordAuthEnabled(
  import.meta.env as unknown as Record<string, string | undefined>
);

export interface ManagerSignInResult {
  user: User;
  session: ManagerSession;
}

/**
 * Sign in with email + password, then resolve the manager session.
 *
 * If the credential is valid but the account is not an active manager,
 * getManagerSession throws and this signs the user back OUT - leaving a
 * half-authenticated non-manager sitting in the dashboard shell would be confusing
 * and is exactly the state R1 was about avoiding.
 */
export async function signInManagerWithPassword(
  email: string,
  password: string
): Promise<ManagerSignInResult> {
  const auth = getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);

  try {
    const session = await getManagerSession();
    return { user: credential.user, session };
  } catch (error) {
    // Authenticated but not authorised: do not leave them signed in.
    await signOut(auth).catch(() => undefined);
    throw error;
  }
}
