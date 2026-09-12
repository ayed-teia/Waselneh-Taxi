import {
  parseAppMode,
  shouldAllowEmulators,
  getConnectionGuardMessage,
  checkReleasePreflight,
  formatPreflightReport,
  describeEnvironment,
  resolveRuntimeEnvironment,
  type AppMode,
} from '@taxi-line/shared';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, Functions } from 'firebase/functions';

// ============================================================================
// APP MODE CONFIGURATION (Step 33)
// ============================================================================

const requestedMode: AppMode = parseAppMode(import.meta.env.VITE_APP_MODE);
const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
const forceLocalDevMode =
  isLocalHost && import.meta.env.VITE_FORCE_LOCAL_DEV_MODE !== 'false';
const appMode: AppMode = forceLocalDevMode ? 'dev' : requestedMode;
const emulatorsRequested =
  import.meta.env.VITE_USE_EMULATORS === 'true' ||
  (forceLocalDevMode && import.meta.env.VITE_USE_EMULATORS !== 'false');
const useEmulators = shouldAllowEmulators(appMode, emulatorsRequested);
const emulatorHost = import.meta.env.VITE_EMULATOR_HOST || '127.0.0.1';
const expectedReleaseProject =
  appMode === 'pilot'
    ? 'waselneh-staging-ayed'
    : appMode === 'prod'
      ? 'waselneh-prod-414e2'
      : null;
const firebaseProjectId =
  import.meta.env.VITE_FIREBASE_PROJECT_ID || (appMode === 'dev' ? 'demo-taxi-line' : '');

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (appMode === 'dev' ? 'demo-api-key' : ''),
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    (appMode === 'dev' ? 'demo-taxi-line.firebaseapp.com' : ''),
  projectId: firebaseProjectId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    (appMode === 'dev' ? 'demo-taxi-line.firebasestorage.app' : ''),
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || (appMode === 'dev' ? '000000000000' : ''),
  appId: import.meta.env.VITE_FIREBASE_APP_ID || (appMode === 'dev' ? '1:000000000000:web:demo' : ''),
};

const preflight = checkReleasePreflight({
  mode: appMode,
  firebaseProjectId: firebaseConfig.projectId,
  firebaseApiKey: firebaseConfig.apiKey,
  emulatorsRequested,
});

if (expectedReleaseProject && firebaseConfig.projectId !== expectedReleaseProject) {
  throw new Error(
    `[ManagerWeb] ${appMode} must use Firebase project ${expectedReleaseProject}; received ${firebaseConfig.projectId || 'nothing'}.`
  );
}

if (!preflight.safeToShip) {
  throw new Error(`[ManagerWeb] ${formatPreflightReport(preflight)}`);
}

/**
 * Human-readable environment label for the dashboard header.
 *
 * The previous UI showed only "emulator" or "production", so a staging session
 * was labelled PRODUCTION. That is not cosmetic: an operator who believes they
 * are on production hesitates to test, and one who believes staging is
 * production may act on what they see there.
 */
export const environmentLabel = describeEnvironment(
  resolveRuntimeEnvironment({
    appMode,
    useEmulators,
    firebaseProjectId: firebaseConfig.projectId,
  })
);

/** The Firebase project this build is actually talking to. */
export const activeProjectId = firebaseConfig.projectId;

if (forceLocalDevMode && requestedMode !== 'dev') {
  console.warn(
    `[ManagerWeb] Localhost detected. Forcing app mode to 'dev' (requested '${requestedMode}'). Set VITE_FORCE_LOCAL_DEV_MODE=false to opt out.`
  );
}

// Log connection guard message
const connectionMessage = getConnectionGuardMessage(appMode, emulatorsRequested);
if (connectionMessage) {
  console.log(connectionMessage);
}

preflight.warnings.forEach(warning => console.warn(`[ManagerWeb] ${warning.message}`));

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let functions: Functions | null = null;
let firestoreEmulatorConnected = false;
let authEmulatorConnected = false;
let functionsEmulatorConnected = false;

export function initializeFirebase(): FirebaseApp {
  if (!app) {
    app = initializeApp(firebaseConfig);
    // Connection mode already logged at startup via getConnectionGuardMessage()
  }
  return app;
}

export function getFirestoreDb(): Firestore {
  if (!db) {
    const firebaseApp = initializeFirebase();
    db = getFirestore(firebaseApp);
    
    if (useEmulators && !firestoreEmulatorConnected) {
      connectFirestoreEmulator(db, emulatorHost, 8080);
      firestoreEmulatorConnected = true;
      console.log(`  ✓ Firestore Emulator: ${emulatorHost}:8080`);
    }
  }
  return db;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    const firebaseApp = initializeFirebase();
    auth = getAuth(firebaseApp);
    
    if (useEmulators && !authEmulatorConnected) {
      connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
      console.log(`  ✓ Auth Emulator: http://${emulatorHost}:9099`);
      authEmulatorConnected = true;
    }
  }
  return auth;
}

export function getFunctionsInstance(): Functions {
  if (!functions) {
    const firebaseApp = initializeFirebase();
    functions = getFunctions(firebaseApp, 'europe-west1');
    
    if (useEmulators && !functionsEmulatorConnected) {
      connectFunctionsEmulator(functions, emulatorHost, 5001);
      functionsEmulatorConnected = true;
      console.log(`  ✓ Functions Emulator: ${emulatorHost}:5001`);
    }
  }
  return functions;
}

export function isUsingEmulators(): boolean {
  return useEmulators;
}
