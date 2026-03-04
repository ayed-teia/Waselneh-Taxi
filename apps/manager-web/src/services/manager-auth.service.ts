import {
  User,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
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

  if (auth.currentUser) {
    return auth.currentUser;
  }

  const credential = await signInAnonymously(auth);
  return credential.user;
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
