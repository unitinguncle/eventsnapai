// src/routes/album.js
// Premium shared print album — collaborative per-event curation by manager + client.
// Mirrors favorites.js structure but with feature_album premium gate on mutations.
//
// Access rules:
//   GET  routes — any user with event access can read the album (admin bypasses event check)
//   POST/DELETE — requires feature_album = true on the user record (admin always bypasses)
//
// 403 body includes { upgradeRequired: true } so frontends can show the right gate message.

const express = require('express');
const router  = express.Router();
const db      = require('../db/client');
const { requireUser }  = require('../middleware/auth');
const { validateUuid } = require('../middleware/validateUuid');
const { getPresignedUrl } = require('../services/rustfs');

/**
 * Checks whether a user has the album premium feature enabled.
 * Admin role always returns true — admin bypasses all feature gates.
 *
 * @param {string} userId
 * @param {string} userRole
 * @returns {Promise<boolean>}
 */
async function checkAlbumAccess(userId, userRole) {
  if (userRole === 'admin') return true;
  const row = await db.query('SELECT feature_album FROM users WHERE id = $1', [userId]);
  return row.rows[0]?.feature_album === true;
}

/**
 * GET /album/:eventId
 * Returns photo IDs currently in the album for this event.
 * Used by frontends to initialise the albumPhotoIds Set without fetching full photo objects.
 */
router.get('/:eventId', requireUser, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user?.userId;

  try {
    if (req.userRole !== 'admin') {
      const access = await db.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [userId, eventId]
      );
      if (!access.rows.length) return res.status(403).json({ error: 'No access to this event' });
    }

    const result = await db.query(
      'SELECT photo_id, added_at FROM photo_album WHERE event_id = $1 ORDER BY added_at DESC',
      [eventId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List album IDs error:', err.message);
    res.status(500).json({ error: 'Failed to list album' });
  }
});

/**
 * GET /album/:eventId/photos
 * Returns full photo objects with presigned thumb and full URLs.
 * Used to render the Album tab grid.
 */
router.get('/:eventId/photos', requireUser, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user?.userId;

  try {
    if (req.userRole !== 'admin') {
      const access = await db.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [userId, eventId]
      );
      if (!access.rows.length) return res.status(403).json({ error: 'No access to this event' });
    }

    const eventResult = await db.query('SELECT bucket_name FROM events WHERE id = $1', [eventId]);
    if (!eventResult.rows.length) return res.status(404).json({ error: 'Event not found' });
    const { bucket_name } = eventResult.rows[0];

    const result = await db.query(
      `SELECT ip.id, ip.rustfs_object_id, ip.has_faces, ip.face_count, ip.photo_date, ip.indexed_at
       FROM photo_album pa
       JOIN indexed_photos ip ON pa.photo_id = ip.id
       WHERE pa.event_id = $1 ORDER BY pa.added_at DESC`,
      [eventId]
    );

    const photos = await Promise.all(result.rows.map(async (p) => ({
      ...p,
      thumbUrl: await getPresignedUrl(bucket_name, `thumb_${p.rustfs_object_id}`),
      fullUrl:  await getPresignedUrl(bucket_name, p.rustfs_object_id),
    })));

    res.json(photos);
  } catch (err) {
    console.error('Get album photos error:', err.message);
    res.status(500).json({ error: 'Failed to get album photos' });
  }
});

/**
 * POST /album/:eventId/:photoId
 * Add a photo to the shared album.
 * Requires feature_album = true (admin bypasses).
 */
router.post('/:eventId/:photoId', requireUser, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const userId = req.user?.userId;

  try {
    // Premium gate
    if (!(await checkAlbumAccess(userId, req.userRole))) {
      return res.status(403).json({
        error: 'Album feature is not enabled for your account. Contact the administrator.',
        upgradeRequired: true,
      });
    }

    // Event access check
    if (req.userRole !== 'admin') {
      const access = await db.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [userId, eventId]
      );
      if (!access.rows.length) return res.status(403).json({ error: 'No access to this event' });
    }

    await db.query(
      `INSERT INTO photo_album (event_id, photo_id, added_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [eventId, photoId, userId]
    );
    res.status(201).json({ added: true });
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Photo or event not found' });
    console.error('Add to album error:', err.message);
    res.status(500).json({ error: 'Failed to add to album' });
  }
});

/**
 * DELETE /album/:eventId/:photoId
 * Remove a photo from the shared album.
 * Requires feature_album = true (admin bypasses).
 */
router.delete('/:eventId/:photoId', requireUser, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const userId = req.user?.userId;

  try {
    // Premium gate
    if (!(await checkAlbumAccess(userId, req.userRole))) {
      return res.status(403).json({
        error: 'Album feature is not enabled for your account.',
        upgradeRequired: true,
      });
    }

    await db.query(
      'DELETE FROM photo_album WHERE event_id = $1 AND photo_id = $2',
      [eventId, photoId]
    );
    res.json({ removed: true });
  } catch (err) {
    console.error('Remove from album error:', err.message);
    res.status(500).json({ error: 'Failed to remove from album' });
  }
});

module.exports = router;
