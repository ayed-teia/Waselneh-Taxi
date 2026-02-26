import Constants from 'expo-constants';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/functions';
import { getEmulatorHost } from '../../utils/emulator-host';

export type Auth = firebase.auth.Auth;
export type User = firebase.User;
export type UserCredential = firebase.auth.UserCredential;
export type Firestore = firebase.firestore.Firestore;
export type DocumentSnapshot = firebase.firestore.DocumentSnapshot;
export type QuerySnapshot = firebase.firestore.QuerySnapshot;
export type Functions = firebase.functions.Functions;
export type Unsubscribe = () => void;

const expoConfig = Constants.expoConfig?.extra ?? {};
const useEmulators = expoConfig.useEmulators === true || expoConfig.useEmulators === 'true';
const emulatorHost = getEmulatorHost();
const defaultProjectId = 'waselneh-prod-414e2';
const defaultFirebaseConfig = {
  apiKey: 'AIzaSyAiyhX7HdwSsEAZASVSO2IEDuudS6czDgg',
  authDomain: `${defaultProjectId}.firebaseapp.com`,
  projectId: defaultProjectId,
  storageBucket: `${defaultProjectId}.firebasestorage.app`,
  messagingSenderId: '474645728365',
  appId: '1:474645728365:android:275d36b746d87f9a58c364',
} as const;

const firebaseConfig = {
  apiKey: String(expoConfig.firebaseApiKey || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || defaultFirebaseConfig.apiKey),
  authDomain: String(
    expoConfig.firebaseAuthDomain ||
      process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ||
      `${String(expoConfig.firebaseProjectId || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId)}.firebaseapp.com`
  ),
  projectId: String(expoConfig.firebaseProjectId || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId),
  storageBucket: String(
    expoConfig.firebaseStorageBucket ||
      process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      `${String(expoConfig.firebaseProjectId || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId)}.firebasestorage.app`
  ),
  messagingSenderId: String(
    expoConfig.firebaseMessagingSenderId ||
      process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
      defaultFirebaseConfig.messagingSenderId
  ),
  appId: String(expoConfig.firebaseAppId || process.env.EXPO_PUBLIC_FIREBASE_APP_ID || defaultFirebaseConfig.appId),
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const firebaseAuth = firebase.auth();
export const firebaseDB = firebase.firestore();
export const firebaseFunctions = firebase.app().functions('europe-west1');

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
    return { user: result.user, error: null };
  } catch (error) {
    return { user: null, error: error as Error };
  }
}

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
  return firebaseDB.collection(collectionPath).doc(docId).set(data as firebase.firestore.DocumentData, options || {});
}

export function serverTimestamp() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

export function geoPoint(lat: number, lng: number) {
  return new firebase.firestore.GeoPoint(lat, lng);
}

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
  const callable = firebaseFunctions.httpsCallable(functionName);
  const result = await callable(data);
  return result.data as TResponse;
}
