async function verifyFirebaseIdToken(idToken) {
  const { firebaseAuthAdmin } = require('../config/firebaseAdmin');
  const auth = firebaseAuthAdmin();
  return await auth.verifyIdToken(idToken);
}

module.exports = {
  verifyFirebaseIdToken
};
