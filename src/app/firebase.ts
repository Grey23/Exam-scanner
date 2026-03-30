import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { environment } from 'src/environments/environment';

export function firebaseApp() {
  if (getApps().length) {
    return getApp();
  }
  return initializeApp(environment.firebaseConfig);
}

export function firebaseAuth() {
  return getAuth(firebaseApp());
}

export function firebaseDb() {
  return getFirestore(firebaseApp());
}

export function firebaseFunctions() {
  const fn = getFunctions(firebaseApp(), 'us-central1');

  // In development you previously forced all Function calls to the local
  // emulator on http://localhost:5001, which causes net::ERR_CONNECTION_REFUSED
  // whenever the emulator is not running. To make the app "just work"
  // without any local emulator, we now call the deployed Cloud Functions
  // by default. If you ever want to use the emulator again, set
  // (window as any).__USE_FUNCTIONS_EMULATOR__ = true in the browser console
  // before the app initializes.
  if (!environment.production && (window as any).__USE_FUNCTIONS_EMULATOR__ === true) {
    try {
      connectFunctionsEmulator(fn, 'localhost', 5001);
    } catch {
      // ignore if already connected
    }
  }

  return fn;
}
