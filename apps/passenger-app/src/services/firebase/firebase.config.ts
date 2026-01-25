import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import Constants from 'expo-constants';

/**
 * Firebase configuration
 * Replace with your actual Firebase config from Firebase Console
 * Environment variables are loaded via Expo Constants
 */
const expoConfig = Constants.expoConfig?.extra ?? {};

const firebaseConfig = {
  apiKey: (expoConfig.firebaseApiKey as string) || 'your-api-key',
  authDomain: (expoConfig.firebaseAuthDomain as string) || 'your-project.firebaseapp.com',
  projectId: (expoConfig.firebaseProjectId as string) || 'your-project-id',
  storageBucket: (expoConfig.firebaseStorageBucket as string) || 'your-project.appspot.com',
  messagingSenderId: (expoConfig.firebaseMessagingSenderId as string) || '123456789',
  appId: (expoConfig.firebaseAppId as string) || '1:123456789:web:abc123',
};

let app: FirebaseApp;
let auth: Auth;

export function initializeFirebase(): FirebaseApp {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0]!;
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    const firebaseApp = initializeFirebase();
    auth = getAuth(firebaseApp);
  }
  return auth;
}

// Initialize on import
initializeFirebase();
