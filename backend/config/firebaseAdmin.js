const admin = require('firebase-admin');

let app;

function firebaseAdmin() {
  if (app) return app;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  const hasExplicitCreds = !!(projectId && clientEmail && privateKey);
  const googleCredsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!hasExplicitCreds && !googleCredsPath) {
    throw new Error(
      'Missing Firebase Admin credentials. Provide FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path.'
    );
  }

  if (hasExplicitCreds) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n')
      })
    });
  } else {
    app = admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
  }

  return app;
}

function firebaseAuthAdmin() {
  firebaseAdmin();
  return admin.auth();
}

function firebaseDbAdmin() {
  firebaseAdmin();
  return admin.firestore();
}

module.exports = {
  firebaseAdmin,
  firebaseAuthAdmin,
  firebaseDbAdmin
};
