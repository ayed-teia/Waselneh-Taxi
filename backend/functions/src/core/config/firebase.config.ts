import * as admin from 'firebase-admin';

let initialized = false;

/**
 * Check if running in Firebase Emulator environment
 * The FUNCTIONS_EMULATOR env var is automatically set by Firebase Emulators
 */
export function isEmulatorEnvironment(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.FIRESTORE_EMULATOR_HOST !== undefined
  );
}

/**
 * Initialize Firebase Admin SDK
 * Automatically configures for emulator when running locally
 */
export function initializeFirebase(): admin.app.App {
  if (!initialized) {
    // Admin SDK auto-initializes with emulator when FIREBASE_* env vars are set
    // The emulator sets these automatically
    admin.initializeApp();
    initialized = true;

    if (isEmulatorEnvironment()) {
      console.log('🔧 Firebase Admin SDK initialized in EMULATOR mode');
    } else {
      console.log('🚀 Firebase Admin SDK initialized in PRODUCTION mode');
    }
  }
  return admin.app();
}

export const getFirestore = () => {
  initializeFirebase();
  return admin.firestore();
};

export const getAuth = () => {
  initializeFirebase();
  return admin.auth();
};

export const getMessaging = (): admin.messaging.Messaging => {
  initializeFirebase();
  return admin.messaging();
};
