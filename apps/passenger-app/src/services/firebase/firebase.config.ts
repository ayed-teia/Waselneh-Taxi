/**
 * Firebase configuration for Driver App
 * Using @react-native-firebase (Native SDK) for better reliability
 */
import firebaseApp from '@react-native-firebase/app';
import firebaseAuth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import Constants from 'expo-constants';
import { getEmulatorHost } from '../../utils/emulator-host';

// Re-export types
export type Auth = FirebaseAuthTypes.Module;
export type User = FirebaseAuthTypes.User;
export type UserCredential = FirebaseAuthTypes.UserCredential;

const expoConfig = Constants.expoConfig?.extra ?? {};

// Production Firebase configuration (for Firestore/Functions that still use JS SDK)
// Note: These values should match your Firebase project settings
// The native SDK uses google-services.json, but JS SDK needs this config
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: `${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "your-project"}.firebaseapp.com`,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: `${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "your-project"}.firebasestorage.app`,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "",
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

let _jsApp: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _functions: Functions | null = null;

let _firestoreEmulatorConnected = false;
let _functionsEmulatorConnected = false;

// ============================================================================
// FIREBASE AUTH - Using @react-native-firebase (Native SDK)
// ============================================================================

/**
 * Get Firebase Auth instance using the native SDK
 * This is the most reliable way to use Firebase Auth in React Native
 */
export function getFirebaseAuth(): Auth {
  return firebaseAuth();
}

// Async version for compatibility with existing code
export async function getFirebaseAuthAsync(): Promise<Auth> {
  return firebaseAuth();
}

// ============================================================================
// FIREBASE APP - For Firestore/Functions (JS SDK)
// ============================================================================

export function getFirebaseApp(): FirebaseApp {
  if (_jsApp) return _jsApp;
  
  _jsApp = getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApp();
  
  console.log('✓ Firebase JS App initialized (for Firestore/Functions)');
  return _jsApp;
}

// ============================================================================
// FIRESTORE - Uses JS SDK (native SDK Firestore is paid in @react-native-firebase)
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
    throw new Error('Firestore not initialized yet. Use getFirestoreAsync() first.');
  }
  return _db;
}

// ============================================================================
// FUNCTIONS - Uses JS SDK
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
    throw new Error('Functions not initialized yet. Use getFunctionsAsync() first.');
  }
  return _functions;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export function isUsingEmulators(): boolean {
  return useEmulators;
}

export async function initializeFirebase() {
  const app = getFirebaseApp();
  const auth = getFirebaseAuth();
  const db = await getFirestoreAsync();
  const functions = await getFunctionsAsync();
  
  console.log('✓ Firebase initialized (Native Auth + JS SDK Firestore/Functions)');
  return { app, auth, db, functions };
}

/**
 * Sign in anonymously for dev mode
 */
export async function signInAnonymouslyForDev(): Promise<{ user: User | null; error: Error | null }> {
  try {
    const auth = getFirebaseAuth();
    const result = await auth.signInAnonymously();
    console.log('🔧 DEV MODE: Signed in anonymously with uid:', result.user.uid);
    return { user: result.user, error: null };
  } catch (error) {
    console.error('Failed to sign in anonymously:', error);
    return { user: null, error: error as Error };
  }
}

/**
 * Get current user
 */
export function getCurrentUser(): User | null {
  return getFirebaseAuth().currentUser;
}

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChanged(callback: (user: User | null) => void): () => void {
  return getFirebaseAuth().onAuthStateChanged(callback);
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  await getFirebaseAuth().signOut();
}
