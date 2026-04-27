const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const db      = require('../db/client');

/**
 * POST /auth/login
 * Authenticates an admin, manager, or user by username + password.
 * Returns a JWT token containing { userId, username, role }.
 *
 * Body: { username: string, password: string }
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await db.query(
      'SELECT id, username, password_hash, display_name, role, is_active FROM users WHERE username = $1',
      [username.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact your administrator.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      {
        userId:   user.id,
        username: user.username,
        role:     user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '6h' }
    );

    res.json({
      token,
      user: {
        id:          user.id,
        username:    user.username,
        displayName: user.display_name,
        role:        user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed — please try again' });
  }
});

/**
 * GET /auth/me
 * Returns the current user's info from a valid JWT.
 * Used by frontends to verify token validity on page load.
 */
router.get('/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);

    const result = await db.query(
      'SELECT id, username, display_name, role, is_active, feature_manual_compression, feature_album, feature_collab_events FROM users WHERE id = $1',
      [payload.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Account not found or deactivated' });
    }

    const user = result.rows[0];
    res.json({
      id:          user.id,
      username:    user.username,
      displayName: user.display_name,
      role:        user.role,
      featureManualCompression: user.feature_manual_compression,
      featureAlbum:             user.feature_album,
      featureCollabEvents:      user.feature_collab_events,
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

/**
 * POST /auth/member-login
 * Authenticates a collaborative event member.
 * Body: { username, password, eventId }
 * Returns a JWT with { userId, username, role: 'user', eventId, displayName }
 */
router.post('/member-login', async (req, res) => {
  const { username, password, eventId } = req.body;

  if (!username || !password || !eventId) {
    return res.status(400).json({ error: 'username, password, and eventId are required' });
  }

  try {
    // Verify the event exists and is collaborative
    const eventResult = await db.query(
      'SELECT id, name, is_collaborative FROM events WHERE id = $1',
      [eventId]
    );
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (!eventResult.rows[0].is_collaborative) {
      return res.status(400).json({ error: 'This event does not support member login' });
    }

    // Find the user
    const userResult = await db.query(
      `SELECT u.id, u.username, u.password_hash, u.display_name, u.role, u.is_active
       FROM users u
       JOIN event_access ea ON ea.user_id = u.id
       WHERE u.username = $1 AND ea.event_id = $2 AND u.role = 'user'`,
      [username.toLowerCase().trim(), eventId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact the event organizer.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Check upload permission
    const accessResult = await db.query(
      'SELECT can_upload FROM event_access WHERE user_id = $1 AND event_id = $2',
      [user.id, eventId]
    );
    const canUpload = accessResult.rows[0]?.can_upload ?? true;

    const token = jwt.sign(
      {
        userId:      user.id,
        username:    user.username,
        displayName: user.display_name,
        role:        user.role,
        eventId,         // scoped to this event
        canUpload,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '6h' }
    );

    res.json({
      token,
      member: {
        id:          user.id,
        username:    user.username,
        displayName: user.display_name,
        role:        user.role,
        eventId,
        canUpload,
        eventName:   eventResult.rows[0].name,
      },
    });
  } catch (err) {
    console.error('Member login error:', err.message);
    res.status(500).json({ error: 'Login failed — please try again' });
  }
});

module.exports = router;
