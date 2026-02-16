import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import Constants from 'expo-constants';
import { getEmulatorHost } from '../../utils/emulator-host';

/**
 * Firebase configuration for Driver App
 * 
 * Uses DYNAMIC IMPORTS for auth to avoid "Component auth has not been registered yet" error.
 * Firebase App is initialized synchronously, but Auth/Firestore/Functions use dynamic imports.
 */
const expoConfig = Constants.expoConfig?.extra ?? {};

// Production Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBxSBX302HrkHBt-m0s6rCQDpu74L4Wld0",
  authDomain: "waselneh-prod.firebaseapp.com",
  projectId: "waselneh-prod",
  storageBucket: "waselneh-prod.firebasestorage.app",
  messagingSenderId: "1041356838503",
  appId: "1:1041356838503:web:68c077c6d834057e89a6c2",
  measurementId: "G-FNY3H394G2"
};

// Emulator config
const useEmulators = expoConfig.useEmulators === true || expoConfig.useEmulators === 'true';
const emulatorHost = getEmulatorHost();

const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
} as const;

const FUNCTIONS_REGION = 'europe-west1';

// ============================================================================
// LAZY SINGLETONS
// ============================================================================

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _functions: Functions | null = null;
let _authInitPromise: Promise<Auth> | null = null;

let _authEmulatorConnected = false;
let _firestoreEmulatorConnected = false;
let _functionsEmulatorConnected = false;

// ============================================================================
// FIREBASE APP - Safe to initialize synchronously
// ============================================================================

export function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  
  _app = getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApp();
  
  console.log('✓ Firebase App initialized');
  return _app;
}

// ============================================================================
// FIREBASE AUTH - Uses dynamic import to avoid registration issues
// ============================================================================

// Helper to wait for next microtask (allows Firebase internal registration to complete)
const waitForNextTick = () => new Promise<void>(resolve => setTimeout(resolve, 100));

async function initAuthInternal(): Promise<Auth> {
  const app = getFirebaseApp();
  
  // Wait for Firebase internal component registration to complete
  await waitForNextTick();
  
  // Dynamic imports to avoid "Component auth has not been registered yet"
  const [authModule, asyncStorageModule] = await Promise.all([
    import('firebase/auth'),
    import('@react-native-async-storage/async-storage')
  ]);
  
  // Wait another tick after imports
  await waitForNextTick();
  
  const { initializeAuth, getAuth, getReactNativePersistence, connectAuthEmulator } = authModule;
  const AsyncStorage = asyncStorageModule.default;
  
  try {
    _auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });
    console.log('✓ Firebase Auth initialized with AsyncStorage persistence');
  } catch (error: any) {
    if (error.code === 'auth/already-initialized' || 
        error.message?.includes('already been called')) {
      _auth = getAuth(app);
      console.log('✓ Firebase Auth: using existing instance');
    } else {
      console.warn('Auth init warning:', error.message);
      _auth = getAuth(app);
    }
  }
  
  // Connect to emulator if enabled
  if (useEmulators && !_authEmulatorConnected && _auth) {
    try {
      connectAuthEmulator(_auth, `http://${emulatorHost}:${EMULATOR_PORTS.auth}`, {
        disableWarnings: true,
      });
      _authEmulatorConnected = true;
      console.log(`✓ Auth Emulator: http://${emulatorHost}:${EMULATOR_PORTS.auth}`);
    } catch (e) {
      // Already connected
    }
  }
  
  return _auth;
}

export async function getFirebaseAuthAsync(): Promise<Auth> {
  if (_auth) return _auth;
  
  // Ensure only one initialization happens
  if (!_authInitPromise) {
    _authInitPromise = initAuthInternal();
  }
  
  return _authInitPromise;
}

// Synchronous getter - throws if auth not initialized yet
export function getFirebaseAuth(): Auth {
  if (!_auth) {
    // Start initialization in background and throw
    getFirebaseAuthAsync().catch(console.error);
    throw new Error('Firebase Auth not initialized yet. Use getFirebaseAuthAsync() or call initializeFirebase() first.');
  }
  return _auth;
}

// ============================================================================
// FIRESTORE - Uses dynamic import
// ============================================================================

export async function getFirestoreAsync(): Promise<Firestore> {
  if (_db) return _db;
  
  const app = getFirebaseApp();
  const { getFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  
  _db = getFirestore(app);
  
  if (useEmulators && !_firestoreEmulatorConnected) {
    try {
      connectFirestoreEmulator(_db, emulatorHost, EMULATOR_PORTS.firestore);
      _firestoreEmulatorConnected = true;
      console.log(`✓ Firestore Emulator: ${emulatorHost}:${EMULATOR_PORTS.firestore}`);
    } catch (e) {
      // Already connected
    }
  }
  
  return _db;
}

export function getFirestoreSync(): Firestore {
  if (!_db) {
    getFirestoreAsync().catch(console.error);
    throw new Error('Firestore not initialized yet. Use getFirestoreAsync() or call initializeFirebase() first.');
  }
  return _db;
}

// ============================================================================
// FUNCTIONS - Uses dynamic import
// ============================================================================

export async function getFunctionsAsync(): Promise<Functions> {
  if (_functions) return _functions;
  
  const app = getFirebaseApp();
  const { getFunctions, connectFunctionsEmulator } = await import('firebase/functions');
  
  _functions = getFunctions(app, FUNCTIONS_REGION);
  
  if (useEmulators && !_functionsEmulatorConnected) {
    try {
      connectFunctionsEmulator(_functions, emulatorHost, EMULATOR_PORTS.functions);
      _functionsEmulatorConnected = true;
      console.log(`✓ Functions Emulator: ${emulatorHost}:${EMULATOR_PORTS.functions}`);
    } catch (e) {
      // Already connected
    }
  }
  
  return _functions;
}

export function getFunctionsSync(): Functions {
  if (!_functions) {
    getFunctionsAsync().catch(console.error);
    throw new Error('Functions not initialized yet. Use getFunctionsAsync() or call initializeFirebase() first.');
  }
  return _functions;
}

// ============================================================================
// CONVENIENCE - Initialize all services
// ============================================================================

export function isUsingEmulators(): boolean {
  return useEmulators;
}

export async function initializeFirebase() {
  const app = getFirebaseApp();
  const [auth, db, functions] = await Promise.all([
    getFirebaseAuthAsync(),
    getFirestoreAsync(),
    getFunctionsAsync()
  ]);
  return { app, auth, db, functions };
}

/**
 * Sign in anonymously for dev mode
 */
export async function signInAnonymouslyForDev(): Promise<{ user: import('firebase/auth').User | null; error: Error | null }> {
  try {
    const auth = await getFirebaseAuthAsync();
    const { signInAnonymously } = await import('firebase/auth');
    const result = await signInAnonymously(auth);
    console.log('🔧 DEV MODE: Signed in anonymously with uid:', result.user.uid);
    return { user: result.user, error: null };
  } catch (error) {
    console.error('Failed to sign in anonymously:', error);
    return { user: null, error: error as Error };
  }
}

// Legacy exports - these are now null, use the getter functions
export const app = null as unknown as FirebaseApp;
export const auth = null as unknown as Auth;
export const db = null as unknown as Firestore;
export const functions = null as unknown as Functions;
