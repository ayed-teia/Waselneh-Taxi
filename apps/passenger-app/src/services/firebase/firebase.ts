/**
 * Firebase Native SDK Configuration for Passenger App
 * Using @react-native-firebase - auto-initializes from google-services.json
 */
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import functions, { FirebaseFunctionsTypes } from '@react-native-firebase/functions';

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
// FIREBASE INSTANCES - Already initialized by native SDK
// ============================================================================
export const firebaseAuth = auth();
export const firebaseDB = firestore();
export const firebaseFunctions = functions();

// Log initialization status
console.log('✅ Firebase Native initialized:', firebaseAuth.app.name);

// ============================================================================
// AUTH FUNCTIONS
// ============================================================================

/**
 * Get Firebase Auth instance
 */
export function getFirebaseAuth(): Auth {
  return firebaseAuth;
}

/**
 * Async version for compatibility
 */
export async function getFirebaseAuthAsync(): Promise<Auth> {
  return firebaseAuth;
}

/**
 * Get current user
 */
export function getCurrentUser(): User | null {
  return firebaseAuth.currentUser;
}

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChanged(callback: (user: User | null) => void): () => void {
  return firebaseAuth.onAuthStateChanged(callback);
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  await firebaseAuth.signOut();
}

/**
 * Sign in anonymously for dev mode
 */
export async function signInAnonymouslyForDev(): Promise<{ user: User | null; error: Error | null }> {
  try {
    const result = await firebaseAuth.signInAnonymously();
    console.log('🔧 DEV MODE: Signed in anonymously with uid:', result.user.uid);
    return { user: result.user, error: null };
  } catch (error) {
    console.error('Failed to sign in anonymously:', error);
    return { user: null, error: error as Error };
  }
}

// ============================================================================
// FIRESTORE FUNCTIONS
// ============================================================================

/**
 * Get Firestore instance (native)
 */
export function getFirestoreAsync(): Promise<Firestore> {
  return Promise.resolve(firebaseDB);
}

export function getFirestoreSync(): Firestore {
  return firebaseDB;
}

/**
 * Get a document reference
 */
export function getDocRef(collectionPath: string, docId: string) {
  return firebaseDB.collection(collectionPath).doc(docId);
}

/**
 * Get a collection reference
 */
export function getCollectionRef(collectionPath: string) {
  return firebaseDB.collection(collectionPath);
}

/**
 * Set document data
 */
export async function setDocument(collectionPath: string, docId: string, data: any, options?: { merge?: boolean }) {
  return firebaseDB.collection(collectionPath).doc(docId).set(data, options || {});
}

/**
 * Server timestamp
 */
export function serverTimestamp() {
  return firestore.FieldValue.serverTimestamp();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

export async function initializeFirebase() {
  console.log('✅ Firebase Native SDK ready');
  return { 
    auth: firebaseAuth, 
    db: firebaseDB,
    functions: firebaseFunctions
  };
}

export function isUsingEmulators(): boolean {
  return false; // Native SDK - configure emulators differently if needed
}

// ============================================================================
// FUNCTIONS HELPERS
// ============================================================================

/**
 * Get Firebase Functions instance
 */
export function getFunctions(): Functions {
  return firebaseFunctions;
}

/**
 * Async version for compatibility
 */
export async function getFunctionsAsync(): Promise<Functions> {
  return firebaseFunctions;
}

/**
 * Call a Cloud Function by name
 */
export async function callCloudFunction<TRequest, TResponse>(
  functionName: string,
  data: TRequest
): Promise<TResponse> {
  const callable = firebaseFunctions.httpsCallable<TRequest, TResponse>(functionName);
  const result = await callable(data);
  return result.data;
}
