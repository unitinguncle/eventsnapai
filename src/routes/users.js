const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const db      = require('../db/client');
const { requireAdmin, requirePhotographer } = require('../middleware/auth');

const SALT_ROUNDS = 12;

/**
 * GET /users
 * List all users. Optionally filter by ?role=admin|photographer|user
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { role } = req.query;
    let query = `
      SELECT 
        u.id, u.username, u.display_name, u.role, u.is_active, u.created_at,
        creator.display_name AS creator_name,
        (
          SELECT string_agg(e.bucket_name, ', ') 
          FROM event_access ea 
          JOIN events e ON ea.event_id = e.id 
          WHERE ea.user_id = u.id
        ) AS assigned_buckets
      FROM users u
      LEFT JOIN users creator ON u.created_by = creator.id
      ORDER BY u.created_at DESC
    `;
    let params = [];

    if (role && ['admin', 'photographer', 'user'].includes(role)) {
      query = `
        SELECT 
          u.id, u.username, u.display_name, u.role, u.is_active, u.created_at,
          creator.display_name AS creator_name,
          (
            SELECT string_agg(e.bucket_name, ', ') 
            FROM event_access ea 
            JOIN events e ON ea.event_id = e.id 
            WHERE ea.user_id = u.id
          ) AS assigned_buckets
        FROM users u
        LEFT JOIN users creator ON u.created_by = creator.id
        WHERE u.role = $1 
        ORDER BY u.created_at DESC
      `;
      params = [role];
    }

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List users error:', err.message);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * POST /users
 * Create a new user. Admin or Photographer.
 * Body: { username, password, displayName, role, eventId? }
 */
router.post('/', requirePhotographer, async (req, res) => {
  const { username, password, displayName, role, eventId } = req.body;

  if (!username || !password || !displayName || !role) {
    return res.status(400).json({ error: 'username, password, displayName, and role are required' });
  }

  if (!['admin', 'photographer', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin, photographer, or user' });
  }

  // Photographers can only create clients
  if (req.userRole === 'photographer' && role !== 'user') {
    return res.status(403).json({ error: 'Photographers can only create user accounts' });
  }

  // If a photographer tries to assign an event, ensure they have access to it
  if (req.userRole === 'photographer' && eventId) {
    const accessCheck = await db.query(
      'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
      [req.user.userId, eventId]
    );
    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this event' });
    }
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const cleanUsername = username.toLowerCase().trim();
  if (!/^[a-z0-9._-]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username must be lowercase alphanumeric (dots, dashes, underscores allowed)' });
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    const createdBy = req.user?.userId || null;

    const result = await db.query(
      `INSERT INTO users (username, password_hash, display_name, role, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, display_name, role, is_active, created_at`,
      [cleanUsername, hash, displayName.trim(), role, createdBy]
    );

    const newUser = result.rows[0];

    // Auto-assign event if provided
    if (eventId) {
      await db.query(
        `INSERT INTO event_access (user_id, event_id, can_upload, can_delete, can_manage)
         VALUES ($1, $2, false, false, false)
         ON CONFLICT DO NOTHING`,
        [newUser.id, eventId]
      );
    }

    console.log(`[users] Created ${role} user: ${cleanUsername}`);
    res.status(201).json(newUser);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with that username already exists' });
    }
    console.error('Create user error:', err.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PATCH /users/:id
 * Update user details (displayName, is_active). Admin only.
 * Body: { displayName?, isActive? }
 */
router.patch('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { displayName, isActive } = req.body;

  try {
    const existing = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = [];
    const values  = [];
    let idx = 1;

    if (displayName !== undefined) {
      updates.push(`display_name = $${idx++}`);
      values.push(displayName.trim());
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(!!isActive);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, username, display_name, role, is_active, created_at`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update user error:', err.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * PATCH /users/:id/password
 * Reset a user's password. Admin only.
 * Body: { password }
 */
router.patch('/:id/password', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await db.query('SELECT id, username FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);

    console.log(`[users] Password reset for: ${existing.rows[0].username}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Password reset error:', err.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * DELETE /users/:id
 * Delete a user. Admin only. Cannot delete yourself.
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Prevent self-deletion via JWT
    if (req.user?.userId === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const existing = await db.query('SELECT id, username, role FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.query('DELETE FROM users WHERE id = $1', [id]);

    console.log(`[users] Deleted user: ${existing.rows[0].username} (${existing.rows[0].role})`);
    res.json({ deleted: true, id });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * GET /users/:id/events
 * List events a user has access to. Admin only.
 */
router.get('/:id/events', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT e.id, e.name, e.bucket_name, e.created_at, ea.can_upload, ea.can_delete, ea.can_manage
       FROM event_access ea JOIN events e ON ea.event_id = e.id
       WHERE ea.user_id = $1 ORDER BY e.created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List user events error:', err.message);
    res.status(500).json({ error: 'Failed to list user events' });
  }
});

/**
 * POST /users/:id/events
 * Grant a user access to an event. Admin only.
 * Body: { eventId, canUpload?, canDelete?, canManage? }
 */
router.post('/:id/events', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { eventId, canUpload = true, canDelete = true, canManage = false } = req.body;

  if (!eventId) {
    return res.status(400).json({ error: 'eventId is required' });
  }

  try {
    await db.query(
      `INSERT INTO event_access (user_id, event_id, can_upload, can_delete, can_manage)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, event_id) DO UPDATE SET can_upload=$3, can_delete=$4, can_manage=$5`,
      [id, eventId, canUpload, canDelete, canManage]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'User or event not found' });
    }
    console.error('Grant event access error:', err.message);
    res.status(500).json({ error: 'Failed to grant event access' });
  }
});

/**
 * DELETE /users/:id/events/:eventId
 * Revoke a user's access to an event. Admin only.
 */
router.delete('/:id/events/:eventId', requireAdmin, async (req, res) => {
  const { id, eventId } = req.params;
  try {
    await db.query('DELETE FROM event_access WHERE user_id = $1 AND event_id = $2', [id, eventId]);
    res.json({ revoked: true });
  } catch (err) {
    console.error('Revoke event access error:', err.message);
    res.status(500).json({ error: 'Failed to revoke event access' });
  }
});

module.exports = router;
