import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { 
  parseAppMode, 
  shouldAllowEmulators, 
  getConnectionGuardMessage,
  validateAppModeConfig,
  type AppMode 
} from '@taxi-line/shared';

// Types only - NO direct imports of firebase modules at module level!
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';

/**
 * Firebase configuration for Driver App
 * 
 * Step 33: Go-Live Mode - App Mode Support
 * 
 * CRITICAL: All Firebase services are lazy-initialized to avoid
 * "Component X has not been registered yet" errors in React Native.
 * Firebase components register asynchronously, so we defer all
 * initialization until the services are actually needed.
 */
const expoConfig = Constants.expoConfig?.extra ?? {};

const firebaseConfig = {
  apiKey: (expoConfig.firebaseApiKey as string) || 'demo-api-key',
  authDomain: (expoConfig.firebaseAuthDomain as string) || 'localhost',
  projectId: (expoConfig.firebaseProjectId as string) || 'demo-taxi-line',
  storageBucket: (expoConfig.firebaseStorageBucket as string) || 'demo-taxi-line.appspot.com',
  messagingSenderId: (expoConfig.firebaseMessagingSenderId as string) || '123456789',
  appId: (expoConfig.firebaseAppId as string) || '1:123456789:web:abc123',
};

// ============================================================================
// APP MODE CONFIGURATION (Step 33)
// ============================================================================

const appMode: AppMode = parseAppMode(expoConfig.appMode as string);
const emulatorsRequested = expoConfig.useEmulators === true || expoConfig.useEmulators === 'true';
const useEmulators = shouldAllowEmulators(appMode, emulatorsRequested);
const emulatorHost = (expoConfig.emulatorHost as string) || '127.0.0.1';

// Reduce console logs in pilot/prod (Step 34)
const isDevMode = appMode === 'dev';

// Log connection guard message (always log this once for visibility)
const connectionMessage = getConnectionGuardMessage(appMode, emulatorsRequested);
if (connectionMessage) {
  console.log(connectionMessage);
}

// Validate config and log warnings
const configWarnings = validateAppModeConfig(appMode, firebaseConfig.projectId);
configWarnings.forEach(warning => console.warn(warning));

// Emulator ports (must match firebase.json)
const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
} as const;

const FUNCTIONS_REGION = 'europe-west1';

// ============================================================================
// LAZY FIREBASE APP INITIALIZATION
// ============================================================================

let _app: FirebaseApp | null = null;
let _appPromise: Promise<FirebaseApp> | null = null;

/**
 * Get Firebase App instance (lazy initialized)
 */
export async function getFirebaseApp(): Promise<FirebaseApp> {
  if (_app) return _app;
  if (_appPromise) return _appPromise;

  _appPromise = (async () => {
    const { initializeApp, getApps, getApp } = require('firebase/app');
    
    _app = getApps().length === 0 
      ? initializeApp(firebaseConfig) 
      : getApp();

    // Connection mode already logged at startup via getConnectionGuardMessage()

    return _app!;
  })();

  return _appPromise;
}

// For backwards compatibility - synchronous getter (throws if not initialized)
export function getApp(): FirebaseApp {
  if (!_app) {
    throw new Error('Firebase App not initialized. Call getFirebaseApp() first.');
  }
  return _app;
}

// Legacy export - will be initialized on first access via getFirebaseApp()
export const app: FirebaseApp = null as unknown as FirebaseApp;

// ============================================================================
// LAZY AUTH INITIALIZATION
// ============================================================================

let _auth: Auth | null = null;
let _authPromise: Promise<Auth> | null = null;
let _authEmulatorConnected = false;

/**
 * Get Firebase Auth instance asynchronously
 */
export async function getFirebaseAuthAsync(): Promise<Auth> {
  if (_auth) return _auth;
  if (_authPromise) return _authPromise;

  _authPromise = (async () => {
    const firebaseApp = await getFirebaseApp();
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const { 
      initializeAuth, 
      getAuth,
      getReactNativePersistence,
      connectAuthEmulator 
    } = require('firebase/auth');

    if (Platform.OS === 'web') {
      _auth = getAuth(firebaseApp);
    } else {
      try {
        _auth = initializeAuth(firebaseApp, {
          persistence: getReactNativePersistence(AsyncStorage),
        });
      } catch (error: any) {
        if (error?.code === 'auth/already-initialized') {
          _auth = getAuth(firebaseApp);
        } else {
          throw error;
        }
      }
    }

    // Connect Auth Emulator
    if (useEmulators && !_authEmulatorConnected && _auth) {
      try {
        connectAuthEmulator(_auth, `http://${emulatorHost}:${EMULATOR_PORTS.auth}`, {
          disableWarnings: true,
        });
        _authEmulatorConnected = true;
        if (isDevMode) {
          console.log(`  ✓ Auth Emulator: http://${emulatorHost}:${EMULATOR_PORTS.auth}`);
        }
      } catch {
        // Emulator already connected
      }
    }

    return _auth!;
  })();

  return _authPromise;
}

/**
 * Get Firebase Auth instance (synchronous)
 * @throws if auth not initialized
 */
export function getFirebaseAuth(): Auth {
  if (!_auth) {
    throw new Error('Auth not initialized. Call getFirebaseAuthAsync() first.');
  }
  return _auth;
}

// ============================================================================
// LAZY FIRESTORE INITIALIZATION
// ============================================================================

let _db: Firestore | null = null;
let _dbPromise: Promise<Firestore> | null = null;
let _firestoreEmulatorConnected = false;

/**
 * Get Firestore instance asynchronously
 */
export async function getFirestoreAsync(): Promise<Firestore> {
  if (_db) return _db;
  if (_dbPromise) return _dbPromise;

  _dbPromise = (async () => {
    const firebaseApp = await getFirebaseApp();
    const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
    
    _db = getFirestore(firebaseApp);

    if (useEmulators && !_firestoreEmulatorConnected) {
      try {
        connectFirestoreEmulator(_db, emulatorHost, EMULATOR_PORTS.firestore);
        _firestoreEmulatorConnected = true;
        if (isDevMode) {
          console.log(`  ✓ Firestore Emulator: ${emulatorHost}:${EMULATOR_PORTS.firestore}`);
        }
      } catch {
        // Emulator already connected
      }
    }

    return _db!;
  })();

  return _dbPromise;
}

/**
 * Get Firestore instance (synchronous)
 * @throws if not initialized
 */
export function getFirestoreSync(): Firestore {
  if (!_db) {
    throw new Error('Firestore not initialized. Call getFirestoreAsync() first.');
  }
  return _db;
}

// Legacy export for backwards compatibility
export const db: Firestore = null as unknown as Firestore;

// ============================================================================
// LAZY FUNCTIONS INITIALIZATION
// ============================================================================

let _functions: Functions | null = null;
let _functionsPromise: Promise<Functions> | null = null;
let _functionsEmulatorConnected = false;

/**
 * Get Firebase Functions instance asynchronously
 */
export async function getFunctionsAsync(): Promise<Functions> {
  if (_functions) return _functions;
  if (_functionsPromise) return _functionsPromise;

  _functionsPromise = (async () => {
    const firebaseApp = await getFirebaseApp();
    const { getFunctions, connectFunctionsEmulator } = require('firebase/functions');
    
    _functions = getFunctions(firebaseApp, FUNCTIONS_REGION);

    if (useEmulators && !_functionsEmulatorConnected) {
      try {
        connectFunctionsEmulator(_functions, emulatorHost, EMULATOR_PORTS.functions);
        _functionsEmulatorConnected = true;
        if (isDevMode) {
          console.log(`  ✓ Functions Emulator: ${emulatorHost}:${EMULATOR_PORTS.functions}`);
        }
      } catch {
        // Emulator already connected
      }
    }

    return _functions!;
  })();

  return _functionsPromise;
}

/**
 * Get Functions instance (synchronous)
 * @throws if not initialized
 */
export function getFunctionsSync(): Functions {
  if (!_functions) {
    throw new Error('Functions not initialized. Call getFunctionsAsync() first.');
  }
  return _functions;
}

// Legacy export for backwards compatibility
export const functions: Functions = null as unknown as Functions;

// ============================================================================
// CONVENIENCE: Initialize all services at once
// ============================================================================

/**
 * Initialize all Firebase services
 * Call this early in app startup (e.g., in _layout.tsx useEffect)
 */
export async function initializeFirebase(): Promise<{
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
}> {
  const [app, auth, db, functions] = await Promise.all([
    getFirebaseApp(),
    getFirebaseAuthAsync(),
    getFirestoreAsync(),
    getFunctionsAsync(),
  ]);
  
  return { app, auth, db, functions };
}

/**
 * Check if using emulators
 */
export function isUsingEmulators(): boolean {
  return useEmulators;
}
