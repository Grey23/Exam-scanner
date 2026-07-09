const jwt = require('jsonwebtoken');
const { verifyFirebaseIdToken } = require('./firebaseAuth');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not configured. Backend JWT authentication is disabled.');
}

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

      if (!JWT_SECRET) {
        console.error('JWT verification attempted without JWT_SECRET configured');
        return res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET is required' });
      }

      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        return next();
      } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    })
    .catch((err) => {
      console.error('verifyToken error:', err);
      res.status(401).json({ error: 'Invalid or expired token' });
    });
};

module.exports = { verifyToken };
