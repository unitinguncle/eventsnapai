const jwt = require('jsonwebtoken');

/**
 * Protects admin routes.
 * Accepts EITHER:
 *   - Legacy: header x-admin-key matching ADMIN_API_KEY
 *   - JWT:    Authorization: Bearer <token> with role = 'admin'
 * This ensures backward compatibility with the existing admin panel.
 */
function requireAdmin(req, res, next) {
  // Legacy API key path (existing admin panel)
  const apiKey = req.headers['x-admin-key'];
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
    req.userRole = 'admin';
    return next();
  }

  // JWT path (new login system)
  const payload = extractJwt(req);
  if (payload && payload.role === 'admin') {
    req.user     = payload;
    req.userRole = 'admin';
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized — invalid admin key or token' });
}

/**
 * Protects photographer routes.
 * Accepts JWT with role = 'photographer' or 'admin' (admins can do everything).
 */
function requirePhotographer(req, res, next) {
  // Admin API key also grants photographer-level access
  const apiKey = req.headers['x-admin-key'];
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
    req.userRole = 'admin';
    return next();
  }

  const payload = extractJwt(req);
  if (payload && (payload.role === 'photographer' || payload.role === 'admin')) {
    req.user     = payload;
    req.userRole = payload.role;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized — photographer access required' });
}

/**
 * Protects user routes (event "client" accounts).
 * Accepts JWT with role = 'user', 'photographer', or 'admin'.
 */
function requireUser(req, res, next) {
  const apiKey = req.headers['x-admin-key'];
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
    req.userRole = 'admin';
    return next();
  }

  const payload = extractJwt(req);
  if (payload && ['user', 'photographer', 'admin'].includes(payload.role)) {
    req.user     = payload;
    req.userRole = payload.role;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized — login required' });
}

/**
 * Issues a short-lived JWT for a visitor tied to a specific event.
 * Call this when a visitor opens a QR code URL.
 */
function issueVisitorToken(eventId) {
  return jwt.sign(
    { eventId, role: 'visitor' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '6h' }
  );
}

/**
 * Protects visitor search routes.
 * Expects header: Authorization: Bearer <token>
 * Attaches decoded payload to req.visitor
 */
function requireVisitor(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — missing token' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'visitor') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.visitor = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract and verify a JWT from the Authorization header.
 * Returns the decoded payload or null.
 */
function extractJwt(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  try {
    return jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = {
  requireAdmin,
  requirePhotographer,
  requireUser,
  requireVisitor,
  issueVisitorToken,
};
