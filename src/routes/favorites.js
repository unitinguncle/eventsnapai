const express = require('express');
const router  = express.Router();
const db      = require('../db/client');
const { requireUser } = require('../middleware/auth');
const { validateUuid } = require('../middleware/validateUuid');
const { getPresignedUrl } = require('../services/rustfs');

/**
 * GET /favorites/:eventId
 * List all favorited photo IDs for this event by the current user.
 */
router.get('/:eventId', requireUser, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user?.userId;

  try {
    // Verify user has access to this event
    if (req.userRole !== 'admin') {
      const access = await db.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [userId, eventId]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'No access to this event' });
      }
    }

    const result = await db.query(
      `SELECT pf.photo_id, pf.marked_at
       FROM photo_favorites pf
       WHERE pf.event_id = $1 AND pf.marked_by = $2
       ORDER BY pf.marked_at DESC`,
      [eventId, userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List favorites error:', err.message);
    res.status(500).json({ error: 'Failed to list favorites' });
  }
});

/**
 * GET /favorites/:eventId/photos
 * Get full photo details with presigned URLs for all favorites.
 */
router.get('/:eventId/photos', requireUser, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user?.userId;

  try {
    // Verify access
    if (req.userRole !== 'admin') {
      const access = await db.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [userId, eventId]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'No access to this event' });
      }
    }

    // Get event for bucket name
    const eventResult = await db.query('SELECT bucket_name FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const bucketName = eventResult.rows[0].bucket_name;

    // Get favorited photos
    const result = await db.query(
      `SELECT ip.id, ip.rustfs_object_id, ip.has_faces, ip.face_count, ip.photo_date, ip.indexed_at
       FROM photo_favorites pf
       JOIN indexed_photos ip ON pf.photo_id = ip.id
       WHERE pf.event_id = $1
       ORDER BY pf.marked_at DESC`,
      [eventId]
    );

    // Generate presigned URLs
    const photos = await Promise.all(result.rows.map(async (p) => {
      const thumbUrl = await getPresignedUrl(bucketName, `thumb_${p.rustfs_object_id}`);
      const fullUrl = await getPresignedUrl(bucketName, p.rustfs_object_id);
      return { ...p, thumbUrl, fullUrl };
    }));

    res.json(photos);
  } catch (err) {
    console.error('Get favorite photos error:', err.message);
    res.status(500).json({ error: 'Failed to get favorite photos' });
  }
});

/**
 * POST /favorites/:eventId/:photoId
 * Add a photo to favorites.
 */
router.post('/:eventId/:photoId', requireUser, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const userId = req.user?.userId;

  try {
    // Verify access
    if (req.userRole !== 'admin') {
      const access = await db.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [userId, eventId]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'No access to this event' });
      }
    }

    await db.query(
      `INSERT INTO photo_favorites (event_id, photo_id, marked_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, photo_id, marked_by) DO NOTHING`,
      [eventId, photoId, userId]
    );
    res.status(201).json({ favorited: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Photo or event not found' });
    }
    console.error('Add favorite error:', err.message);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

/**
 * DELETE /favorites/:eventId/:photoId
 * Remove a photo from favorites.
 */
router.delete('/:eventId/:photoId', requireUser, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const userId = req.user?.userId;

  try {
    await db.query(
      'DELETE FROM photo_favorites WHERE event_id = $1 AND photo_id = $2',
      [eventId, photoId]
    );
    res.json({ unfavorited: true });
  } catch (err) {
    console.error('Remove favorite error:', err.message);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

module.exports = router;
