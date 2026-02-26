/**
 * Firebase Native SDK configuration for Passenger App.
 * Uses @react-native-firebase (native config via google-services.json).
 */
import Constants from 'expo-constants';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import '@react-native-firebase/functions';
import type { FirebaseFunctionsTypes } from '@react-native-firebase/functions';
import { getEmulatorHost } from '../../utils/emulator-host';

// ============================================================================
// TYPES
// ============================================================================
export type Auth = FirebaseAuthTypes.Module;
export type User = FirebaseAuthTypes.User;
export type UserCredential = FirebaseAuthTypes.UserCredential;
export type Firestore = FirebaseFirestoreTypes.Module;
export type DocumentSnapshot = FirebaseFirestoreTypes.DocumentSnapshot;
export type QuerySnapshot = FirebaseFirestoreTypes.QuerySnapshot;
export type Functions = FirebaseFunctionsTypes.Module;
export type Unsubscribe = () => void;

// ============================================================================
// FIREBASE INSTANCES
// ============================================================================
const expoConfig = Constants.expoConfig?.extra ?? {};
const useEmulators = expoConfig.useEmulators === true || expoConfig.useEmulators === 'true';
const emulatorHost = getEmulatorHost();
const functionsRegion = 'europe-west1';

export const firebaseAuth = auth();
export const firebaseDB = firestore();
export const firebaseFunctions = firebaseAuth.app.functions(functionsRegion);

let emulatorsConnected = false;

function ensureEmulatorsConnected() {
  if (!useEmulators || emulatorsConnected) {
    return;
  }

  try {
    firebaseAuth.useEmulator(`http://${emulatorHost}:9099`);
  } catch {
    // already connected
  }

  try {
    firebaseDB.useEmulator(emulatorHost, 8080);
  } catch {
    // already connected
  }

  try {
    firebaseFunctions.useEmulator(emulatorHost, 5001);
  } catch {
    // already connected
  }

  emulatorsConnected = true;
}

ensureEmulatorsConnected();
console.log('Firebase Native initialized:', firebaseAuth.app.name, `functionsRegion=${functionsRegion}`);

// ============================================================================
// AUTH
// ============================================================================
export function getFirebaseAuth(): Auth {
  return firebaseAuth;
}

export async function getFirebaseAuthAsync(): Promise<Auth> {
  return firebaseAuth;
}

export function getCurrentUser(): User | null {
  return firebaseAuth.currentUser;
}

export function onAuthStateChanged(callback: (user: User | null) => void): () => void {
  return firebaseAuth.onAuthStateChanged(callback);
}

export async function signOut(): Promise<void> {
  await firebaseAuth.signOut();
}

export async function signInAnonymouslyForDev(): Promise<{ user: User | null; error: Error | null }> {
  try {
    const result = await firebaseAuth.signInAnonymously();
    console.log('DEV MODE: signed in anonymously with uid:', result.user.uid);
    return { user: result.user, error: null };
  } catch (error) {
    console.error('Failed to sign in anonymously:', error);
    return { user: null, error: error as Error };
  }
}

// ============================================================================
// FIRESTORE
// ============================================================================
export function getFirestoreAsync(): Promise<Firestore> {
  return Promise.resolve(firebaseDB);
}

export function getFirestoreSync(): Firestore {
  return firebaseDB;
}

export function getDocRef(collectionPath: string, docId: string) {
  return firebaseDB.collection(collectionPath).doc(docId);
}

export function getCollectionRef(collectionPath: string) {
  return firebaseDB.collection(collectionPath);
}

export async function setDocument(
  collectionPath: string,
  docId: string,
  data: unknown,
  options?: { merge?: boolean }
) {
  return firebaseDB.collection(collectionPath).doc(docId).set(data as FirebaseFirestoreTypes.DocumentData, options || {});
}

export function serverTimestamp() {
  return firestore.FieldValue.serverTimestamp();
}

// ============================================================================
// INITIALIZATION
// ============================================================================
export async function initializeFirebase() {
  ensureEmulatorsConnected();
  return {
    auth: firebaseAuth,
    db: firebaseDB,
    functions: firebaseFunctions,
  };
}

export function isUsingEmulators(): boolean {
  return useEmulators;
}

// ============================================================================
// FUNCTIONS
// ============================================================================
export function getFunctions(): Functions {
  return firebaseFunctions;
}

export async function getFunctionsAsync(): Promise<Functions> {
  return firebaseFunctions;
}

export async function callCloudFunction<TRequest, TResponse>(
  functionName: string,
  data: TRequest
): Promise<TResponse> {
  const callable = firebaseFunctions.httpsCallable<TRequest, TResponse>(functionName);
  const result = await callable(data);
  return result.data;
}
