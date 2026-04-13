const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const db      = require('../db/client');
const { requireAdmin, requireManager } = require('../middleware/auth');
const { validateUuid } = require('../middleware/validateUuid');

const SALT_ROUNDS = 12;

/**
 * Builds the full user list SELECT query.
 * @param {string} whereClause - Optional SQL WHERE clause (e.g. 'WHERE u.role = $1')
 */
function buildUserListQuery(whereClause = '') {
  return `
    SELECT
      u.id, u.username, u.display_name, u.role, u.is_active, u.created_at,
      u.mobile, u.email,
      creator.display_name AS creator_name,
      (
        SELECT json_agg(json_build_object(
          'id', e.id,
          'name', e.name,
          'bucket_name', e.bucket_name,
          'created_at', e.created_at,
          'can_upload', ea.can_upload,
          'can_delete', ea.can_delete,
          'can_manage', ea.can_manage,
          'photo_count', COALESCE(ic.photo_count, 0)
        ))
        FROM event_access ea
        JOIN events e ON ea.event_id = e.id
        LEFT JOIN (
          SELECT event_id, COUNT(*) AS photo_count FROM indexed_photos GROUP BY event_id
        ) ic ON ic.event_id = e.id
        WHERE ea.user_id = u.id
      ) AS assigned_buckets_json
    FROM users u
    LEFT JOIN users creator ON u.created_by = creator.id
    ${whereClause}
    ORDER BY u.created_at DESC
  `;
}

/**
 * GET /users
 * List all users. Optionally filter by ?role=admin|manager|user
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { role } = req.query;
    const validRoles = ['admin', 'manager', 'user'];
    const useRoleFilter = role && validRoles.includes(role);

    const query  = buildUserListQuery(useRoleFilter ? 'WHERE u.role = $1' : '');
    const params = useRoleFilter ? [role] : [];

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List users error:', err.message);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * GET /past-customers
 * List all archived past customers. Admin only.
 */
router.get('/past-customers', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM past_customers ORDER BY deleted_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List past customers error:', err.message);
    res.status(500).json({ error: 'Failed to list past customers' });
  }
});

/**
 * POST /users
 * Create a new user. Admin or Manager.
 * Body: { username, password, displayName, role, eventId? }
 */
router.post('/', requireManager, async (req, res) => {
  const { username, password, displayName, role, eventId, mobile, email } = req.body;

  if (!username || !password || !displayName || !role) {
    return res.status(400).json({ error: 'username, password, displayName, and role are required' });
  }

  if (!mobile) {
    return res.status(400).json({ error: 'Mobile number is required' });
  }

  const cleanMobile = mobile.trim();
  const cleanEmail = email ? email.trim() : null;

  // Indian mobile validation: 10 digits, starts 6–9, optional +91/91 prefix
  const phoneRe = /^(?:\+91|91)?[6-9]\d{9}$/;
  if (!phoneRe.test(cleanMobile.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Invalid mobile number format' });
  }

  if (cleanEmail && !/\S+@\S+\.\S+/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (!['admin', 'manager', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin, manager, or user' });
  }

  // Managers can only create clients
  if (req.userRole === 'manager' && role !== 'user') {
    return res.status(403).json({ error: 'Managers can only create user accounts' });
  }

  // If a manager tries to assign an event, ensure they have access to it
  if (req.userRole === 'manager' && eventId) {
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
      `INSERT INTO users (username, password_hash, display_name, role, created_by, mobile, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, display_name, role, is_active, created_at, mobile, email`,
      [cleanUsername, hash, displayName.trim(), role, createdBy, cleanMobile, cleanEmail]
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
router.patch('/:id', requireAdmin, validateUuid('id'), async (req, res) => {
  const { id } = req.params;
  const { displayName, isActive, username, mobile, email } = req.body;

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
    if (username !== undefined) {
      updates.push(`username = $${idx++}`);
      values.push(username.toLowerCase().trim());
    }
    if (mobile !== undefined) {
      updates.push(`mobile = $${idx++}`);
      values.push(mobile ? mobile.trim() : null);
    }

    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(email ? email.trim() : null);
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
 * Reset a user's password. Admin or manager (for users they created).
 * Also accepts PUT for compatibility.
 * Body: { password }
 */
async function handlePasswordReset(req, res) {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await db.query('SELECT id, username, created_by FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If requester is a manager (not admin), only allow resetting users they created
    if (req.userRole === 'manager') {
      if (existing.rows[0].created_by !== req.user.userId) {
        return res.status(403).json({ error: 'You can only reset passwords for users you created' });
      }
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);

    console.log(`[users] Password reset for: ${existing.rows[0].username}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Password reset error:', err.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
}
router.patch('/:id/password', requireManager, validateUuid('id'), handlePasswordReset);
router.put('/:id/password', requireManager, validateUuid('id'), handlePasswordReset);

/**
 * DELETE /users/:id
 * Delete a user. Admin only. Cannot delete yourself.
 * Managers with assigned events cannot be deleted — events must be removed first.
 */
router.delete('/:id', requireAdmin, validateUuid('id'), async (req, res) => {
  const { id } = req.params;

  try {
    // Prevent self-deletion via JWT
    if (req.user?.userId === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const existing = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userToDelete = existing.rows[0];

    // Block deletion of managers who still have events assigned
    if (userToDelete.role === 'manager') {
      const eventCount = await db.query(
        'SELECT COUNT(*) AS cnt FROM event_access WHERE user_id = $1',
        [id]
      );
      const cnt = parseInt(eventCount.rows[0].cnt, 10);
      if (cnt > 0) {
        return res.status(409).json({
          error: `This manager has ${cnt} event${cnt !== 1 ? 's' : ''} assigned. Delete or unassign all events before deleting this account.`,
          eventCount: cnt,
        });
      }
    }

    await db.query('BEGIN');
    
    // Archive to past_customers
    await db.query(
      `INSERT INTO past_customers (original_user_id, username, display_name, role, mobile, email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userToDelete.username, userToDelete.display_name, userToDelete.role, userToDelete.mobile, userToDelete.email]
    );

    await db.query('DELETE FROM users WHERE id = $1', [id]);
    await db.query('COMMIT');

    console.log(`[users] Archived & Deleted user: ${userToDelete.username} (${userToDelete.role})`);
    res.json({ deleted: true, id });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * GET /users/:id/events
 * List events a user has access to. Admin only.
 */
router.get('/:id/events', requireAdmin, validateUuid('id'), async (req, res) => {
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
router.post('/:id/events', requireAdmin, validateUuid('id'), async (req, res) => {
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
router.delete('/:id/events/:eventId', requireAdmin, validateUuid('id', 'eventId'), async (req, res) => {
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
