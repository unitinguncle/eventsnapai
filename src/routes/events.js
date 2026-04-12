const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcrypt');
const db       = require('../db/client');
const { requireAdmin, requireManager, requireUser, issueVisitorToken } = require('../middleware/auth');
const { ensureBucket, deleteBucket } = require('../services/rustfs');

/**
 * POST /events
 * Manager or Admin creates a new event — creates a RustFS bucket.
 * Face isolation is handled via CompreFace subject prefixing (no per-event app needed).
 * Body: { name: string, bucketName: string }
 */
router.post('/', requireManager, async (req, res) => {
  const { name, bucketName } = req.body;

  if (!name || !bucketName) {
    return res.status(400).json({ error: 'name and bucketName are required' });
  }

  if (!/^[a-z0-9-]+$/.test(bucketName)) {
    return res.status(400).json({ error: 'bucketName must be lowercase alphanumeric with hyphens only' });
  }

  try {
    await ensureBucket(bucketName);

    const ownerId = req.user?.userId || null;

    const result = await db.query(
      'INSERT INTO events (name, bucket_name, owner_id) VALUES ($1, $2, $3) RETURNING *',
      [name, bucketName, ownerId]
    );

    const event = result.rows[0];

    // If a manager created it, grant them access so it shows up in their list
    if (req.userRole === 'manager' && ownerId) {
      await db.query(
        `INSERT INTO event_access (user_id, event_id, can_upload, can_delete, can_manage)
         VALUES ($1, $2, true, true, true)`,
        [ownerId, event.id]
      );
    }

    res.status(201).json(event);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An event with that bucket name already exists' });
    }
    console.error('Create event error:', err.message);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

/**
 * GET /events
 * Admin lists all events, enriched with owner name and photo count.
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        e.*,
        u.display_name AS owner_name,
        u.username     AS owner_username,
        COALESCE(ic.photo_count, 0) AS photo_count
      FROM events e
      LEFT JOIN users u ON u.id = e.owner_id
      LEFT JOIN (
        SELECT event_id, COUNT(*) AS photo_count
        FROM indexed_photos
        GROUP BY event_id
      ) ic ON ic.event_id = e.id
      ORDER BY e.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('List events error:', err.message);
    res.status(500).json({ error: 'Failed to list events' });
  }
});

/**
 * GET /events/my
 * Manager lists their assigned events (via event_access table).
 * Admin gets all events.
 */
router.get('/my', requireUser, async (req, res) => {
  try {
    let result;
    if (req.userRole === 'admin') {
      result = await db.query('SELECT * FROM events ORDER BY created_at DESC');
    } else {
      result = await db.query(
        `SELECT e.* FROM events e
         JOIN event_access ea ON ea.event_id = e.id
         WHERE ea.user_id = $1
         ORDER BY e.created_at DESC`,
        [req.user.userId]
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('List my events error:', err.message);
    res.status(500).json({ error: 'Failed to list events' });
  }
});

/**
 * DELETE /events/:eventId
 * Admin-only: Permanently deletes an event, its RustFS bucket, and all Postgres records.
 * Protected by both x-admin-key and x-delete-key headers.
 */
router.delete('/:eventId', requireAdmin, async (req, res) => {
  const deleteKey = req.headers['x-delete-key'];
  if (!deleteKey || deleteKey !== process.env.DELETE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — invalid delete key' });
  }

  const { eventId } = req.params;

  try {
    const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventResult.rows[0];

    // Delete RustFS bucket and all photos (list-then-delete already implemented in deleteBucket)
    try {
      await deleteBucket(event.bucket_name);
    } catch (fsErr) {
      console.warn('RustFS bucket delete failed (continuing):', fsErr.message);
    }

    // Delete from Postgres (cascades to indexed_photos, photo_favorites, event_access)
    await db.query('DELETE FROM events WHERE id = $1', [eventId]);

    res.json({ deleted: true, eventId });
  } catch (err) {
    console.error('Delete event error:', err.message);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

/**
 * DELETE /events/:eventId/manager-delete
 * Manager self-service event deletion.
 * Requires the manager's own password for confirmation.
 * Steps:
 *   1. Verify manager has access to the event
 *   2. Verify manager's password via bcrypt
 *   3. Delete client users exclusively linked to this event
 *   4. Delete RustFS bucket + all objects
 *   5. Delete event from Postgres (cascades to indexed_photos, photo_favorites, event_access)
 */
router.delete('/:eventId/manager-delete', requireManager, async (req, res) => {
  const { eventId } = req.params;
  const { password } = req.body;
  const userId = req.user?.userId;

  if (!password) {
    return res.status(400).json({ error: 'Password is required to confirm deletion' });
  }

  try {
    // 1. Verify manager has access to this event
    const accessResult = await db.query(
      'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
      [userId, eventId]
    );
    if (accessResult.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this event' });
    }

    // 2. Verify manager's own password
    const userResult = await db.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const passwordValid = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Incorrect password — deletion cancelled' });
    }

    // 3. Get event info
    const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventResult.rows[0];

    // 4. Find and delete client users who only have access to THIS event
    //    (users with role='user' linked only to this event via event_access)
    const exclusiveClientsResult = await db.query(
      `SELECT u.id FROM users u
       JOIN event_access ea ON ea.user_id = u.id
       WHERE u.role = 'user' AND ea.event_id = $1
       AND (
         SELECT COUNT(*) FROM event_access ea2 WHERE ea2.user_id = u.id
       ) = 1`,
      [eventId]
    );
    for (const client of exclusiveClientsResult.rows) {
      await db.query('DELETE FROM users WHERE id = $1', [client.id]);
      console.log(`[manager-delete] Deleted exclusive client user: ${client.id}`);
    }

    // 5. Delete RustFS bucket and all its objects
    try {
      await deleteBucket(event.bucket_name);
      console.log(`[manager-delete] Deleted RustFS bucket: ${event.bucket_name}`);
    } catch (fsErr) {
      // Log but continue — DB cleanup is more critical
      console.warn(`[manager-delete] RustFS bucket delete failed for ${event.bucket_name}:`, fsErr.message);
    }

    // 6. Delete event from Postgres (cascades to indexed_photos, photo_favorites, event_access)
    await db.query('DELETE FROM events WHERE id = $1', [eventId]);
    console.log(`[manager-delete] Deleted event ${eventId} by manager ${userId}`);

    res.json({ deleted: true, eventId, bucketName: event.bucket_name });
  } catch (err) {
    console.error('Manager delete event error:', err.message);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

/**
 * GET /events/:eventId/clients
 * Returns any clients explicitly linked to this event (used by managers).
 */
router.get('/:eventId/clients', requireManager, async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await db.query(
      `SELECT u.id, u.username, u.display_name, u.created_at
       FROM users u
       JOIN event_access ea ON u.id = ea.user_id
       WHERE ea.event_id = $1 AND u.role = 'user'
       ORDER BY ea.granted_at DESC`,
      [eventId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List event clients error:', err.message);
    res.status(500).json({ error: 'Failed to list clients' });
  }
});

/**
 * GET /events/:eventId/token
 * Visitor entry point — issues a short-lived JWT for the event.
 */
router.get('/:eventId/token', async (req, res) => {
  const { eventId } = req.params;
  try {
    const result = await db.query('SELECT id, name FROM events WHERE id = $1', [eventId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const token = issueVisitorToken(eventId);
    res.json({ token, event: result.rows[0] });
  } catch (err) {
    console.error('Token issue error:', err.message);
    res.status(500).json({ error: 'Failed to issue token' });
  }
});

module.exports = router;
