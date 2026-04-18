const jwt = require('jsonwebtoken');
const db  = require('../db/client');

/**
 * Protects admin routes.
 * Accepts EITHER:
 *   - Legacy: header x-admin-key matching ADMIN_API_KEY
 *   - JWT:    Authorization: Bearer <token> with role = 'admin'
 *
 * The x-admin-key path is kept for backward compatibility (e.g. curl scripts,
 * Postman, any non-browser tooling that predates the JWT login system).
 * NOTE: the legacy key path does NOT perform a live is_active DB check —
 * it bypasses that check entirely. This is a known limitation of the legacy path.
 *
 * TODO (future stage): Once all callers are confirmed to use JWT, deprecate
 * the x-admin-key header and remove this dual-path logic.
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
 * Protects manager routes.
 * Accepts JWT with role = 'manager' or 'admin' (admins can do everything).
 * Also performs a live is_active check against the DB on every request.
 * If the admin has deactivated the account, returns 403 immediately.
 */
async function requireManager(req, res, next) {
  // Admin API key also grants manager-level access (no live check needed for legacy key)
  const apiKey = req.headers['x-admin-key'];
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
    req.userRole = 'admin';
    return next();
  }

  const payload = extractJwt(req);
  if (payload && (payload.role === 'manager' || payload.role === 'admin')) {
    // Live is_active check — catch admin-revoked sessions immediately
    try {
      const result = await db.query(
        'SELECT is_active FROM users WHERE id = $1',
        [payload.userId]
      );
      if (result.rows.length === 0 || !result.rows[0].is_active) {
        return res.status(403).json({ error: 'ACCESS_REVOKED' });
      }
    } catch (dbErr) {
      console.error('[auth] DB check failed in requireManager:', dbErr.message);
      return res.status(500).json({ error: 'Authentication check failed' });
    }

    req.user     = payload;
    req.userRole = payload.role;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized — manager access required' });
}

/**
 * Protects user routes (event "client" accounts).
 * Accepts JWT with role = 'user', 'manager', or 'admin'.
 * Also performs a live is_active check against the DB on every request.
 */
async function requireUser(req, res, next) {
  const apiKey = req.headers['x-admin-key'];
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
    req.userRole = 'admin';
    return next();
  }

  const payload = extractJwt(req);
  if (payload && ['user', 'manager', 'admin'].includes(payload.role)) {
    // Live is_active check — catch admin-revoked sessions immediately
    try {
      const result = await db.query(
        'SELECT is_active FROM users WHERE id = $1',
        [payload.userId]
      );
      if (result.rows.length === 0 || !result.rows[0].is_active) {
        return res.status(403).json({ error: 'ACCESS_REVOKED' });
      }
    } catch (dbErr) {
      console.error('[auth] DB check failed in requireUser:', dbErr.message);
      return res.status(500).json({ error: 'Authentication check failed' });
    }

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
  requireManager,
  requireUser,
  requireVisitor,
  issueVisitorToken,
};
