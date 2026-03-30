const jwt = require('jsonwebtoken');
const { verifyFirebaseIdToken } = require('./firebaseAuth');

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No authentication token provided' });
  }

  // Try Firebase ID token first (frontend uses Firebase Auth).
  Promise.resolve()
    .then(async () => {
      try {
        const decoded = await verifyFirebaseIdToken(token);
        req.user = {
          id: decoded.uid,
          email: decoded.email,
          name: decoded.name,
          userType: decoded.userType || decoded.role || decoded.user_type
        };
        return next();
      } catch {
        // fallback to JWT
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.user = decoded;
        return next();
      } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    })
    .catch(() => res.status(401).json({ error: 'Invalid or expired token' }));
};

module.exports = { verifyToken };
