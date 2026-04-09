const express = require('express');
const router  = express.Router();
const db      = require('../db/client');
const { requireAdmin, requirePhotographer, issueVisitorToken } = require('../middleware/auth');
const { ensureBucket, deleteBucket }      = require('../services/rustfs');

/**
 * POST /events
 * Admin creates a new event — creates a RustFS bucket.
 * Face isolation is handled via CompreFace subject prefixing (no per-event app needed).
 * Body: { name: string, bucketName: string }
 */
router.post('/', requireAdmin, async (req, res) => {
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

    res.status(201).json(result.rows[0]);
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
 * Admin lists all events.
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM events ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('List events error:', err.message);
    res.status(500).json({ error: 'Failed to list events' });
  }
});

/**
 * GET /events/my
 * Photographer lists their assigned events (via event_access table).
 * Admin gets all events.
 */
router.get('/my', requirePhotographer, async (req, res) => {
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
 * Permanently deletes an event, its RustFS bucket, and all Postgres records.
 * Protected by both x-admin-key and x-delete-key headers.
 * Note: CompreFace subjects for this event must be cleaned up separately via
 * the CompreFace UI (filter by subject prefix "{eventId}__") or left as orphans
 * since they won't appear in any search results (event no longer exists in DB).
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

    // Delete RustFS bucket and all photos
    try {
      await deleteBucket(event.bucket_name);
    } catch (fsErr) {
      console.warn('RustFS bucket delete failed (continuing):', fsErr.message);
    }

    // Delete from Postgres (cascades to indexed_photos)
    await db.query('DELETE FROM events WHERE id = $1', [eventId]);

    res.json({ deleted: true, eventId });
  } catch (err) {
    console.error('Delete event error:', err.message);
    res.status(500).json({ error: 'Failed to delete event' });
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
