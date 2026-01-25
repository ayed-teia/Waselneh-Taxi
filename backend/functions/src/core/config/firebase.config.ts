import * as admin from 'firebase-admin';

let initialized = false;

export function initializeFirebase(): admin.app.App {
  if (!initialized) {
    admin.initializeApp();
    initialized = true;
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

export const getMessaging = () => {
  initializeFirebase();
  return admin.messaging();
};
