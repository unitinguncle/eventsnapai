const jwt = require('jsonwebtoken');

/**
 * Protects photographer/admin routes.
 * Expects header: x-admin-key: <ADMIN_API_KEY>
 */
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — invalid admin key' });
  }
  next();
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

module.exports = { requireAdmin, requireVisitor, issueVisitorToken };
