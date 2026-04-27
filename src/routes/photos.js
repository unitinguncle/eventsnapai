const express = require('express');
const router = express.Router();
const db = require('../db/client');
const { requireAdmin, requireManager, requireUser } = require('../middleware/auth');
const { validateUuid } = require('../middleware/validateUuid');
const { checkBucketExists, getPresignedUrl, deleteObject } = require('../services/rustfs');
const { deleteSubjectFaces } = require('../services/compreface');

/**
 * GET /events/:eventId/photos
 * Lists all photos for an event with thumbnail URLs.
 * Sorted by photo_date ascending (oldest first), falling back to indexed_at.
 * Accessible by admin, manager, and user (with event_access check).
 */
router.get('/:eventId/photos', requireUser, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  try {
    // If user role, verify event access
    if (req.userRole === 'user') {
      const access = await db.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [req.user.userId, eventId]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'No access to this event' });
      }
    }
    const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];

    const bucketExists = await checkBucketExists(event.bucket_name);
    if (!bucketExists) {
      console.warn(`Bucket ${event.bucket_name} missing in RustFS. Auto-cleaning...`);
      await db.query('DELETE FROM events WHERE id = $1', [eventId]);
      return res.status(404).json({
        error: 'This bucket was deleted in RustFS. The event has been cleaned up.',
        autoDeleted: true
      });
    }

    const photosResult = await db.query(
      `SELECT ip.id, ip.rustfs_object_id, ip.has_faces, ip.face_count, ip.photo_date, ip.indexed_at,
              ip.uploaded_by, u.display_name AS uploader_name, u.username AS uploader_username
       FROM indexed_photos ip
       LEFT JOIN users u ON ip.uploaded_by = u.id
       WHERE ip.event_id = $1
       ORDER BY COALESCE(ip.photo_date, ip.indexed_at) DESC`,
      [eventId]
    );

    const photos = await Promise.all(photosResult.rows.map(async p => {
      const thumbUrl = await getPresignedUrl(event.bucket_name, `thumb_${p.rustfs_object_id}`);
      const fullUrl = await getPresignedUrl(event.bucket_name, p.rustfs_object_id);
      return { ...p, thumbUrl, fullUrl };
    }));

    res.json({
      event,
      photos: photos,
      total: photos.length,
    });
  } catch (err) {
    console.error('List photos error:', err.message);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

/**
 * DELETE /events/:eventId/photos/:photoId
 * Deletes a single photo: removes from RustFS, CompreFace, and Postgres.
 * Accessible by: admin, manager (with event access).
 * Also accessible by collaborative event members who uploaded the photo themselves.
 */
router.delete('/:eventId/photos/:photoId', async (req, res) => {
  const { eventId, photoId } = req.params;

  // Dual-auth: manager OR member (for their own photos in collaborative events)
  const jwt = require('jsonwebtoken');
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Unauthorized — invalid or expired token' }); }

  const db2 = require('../db/client');
  let isMember = false;

  if (payload.role === 'manager' || payload.role === 'admin') {
    // Verify manager access
    if (payload.role === 'manager') {
      const access = await db2.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [payload.userId, eventId]
      ).catch(() => ({ rows: [] }));
      if (!access.rows.length) return res.status(403).json({ error: 'No access to this event' });
    }
  } else if (payload.role === 'user' && payload.eventId === eventId) {
    isMember = true;
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Get the photo record
    const photoResult = await db.query(
      'SELECT * FROM indexed_photos WHERE id = $1 AND event_id = $2',
      [photoId, eventId]
    );
    if (photoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    const photo = photoResult.rows[0];

    // Members can only delete photos they uploaded
    if (isMember && photo.uploaded_by !== payload.userId) {
      return res.status(403).json({ error: 'You can only delete photos you uploaded' });
    }

    // Get the event for bucket name
    const eventResult = await db.query('SELECT bucket_name FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const bucketName = eventResult.rows[0].bucket_name;

    // 1. Delete from RustFS (original + thumbnail)
    try {
      await deleteObject(bucketName, photo.rustfs_object_id);
      await deleteObject(bucketName, `thumb_${photo.rustfs_object_id}`);
    } catch (fsErr) {
      console.warn(`[delete] RustFS delete failed for ${photo.rustfs_object_id}:`, fsErr.message);
    }

    // 2. Delete face subjects from CompreFace
    if (photo.has_faces) {
      await deleteSubjectFaces(eventId, photo.rustfs_object_id);
    }

    // 3. Delete from Postgres (cascades to favorites)
    await db.query('DELETE FROM indexed_photos WHERE id = $1', [photoId]);

    console.log(`[delete] Deleted photo ${photo.rustfs_object_id} from event ${eventId}`);
    res.json({ deleted: true, objectId: photo.rustfs_object_id });
  } catch (err) {
    console.error('Delete photo error:', err.message);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

/**
 * GET /events/:eventId/photos/general
 * Returns all faceless photos for an event with their visibility state.
 * Used by the manager to review what visitors see in the General tab.
 */
router.get('/:eventId/photos/general', requireManager, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  try {
    const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    const event = eventResult.rows[0];

    const photosResult = await db.query(
      `SELECT id, rustfs_object_id, has_faces, face_count, photo_date, indexed_at, visible_in_general
       FROM indexed_photos
       WHERE event_id = $1 AND has_faces = false
       ORDER BY COALESCE(photo_date, indexed_at) DESC`,
      [eventId]
    );

    const photos = await Promise.all(photosResult.rows.map(async p => {
      const thumbUrl = await getPresignedUrl(event.bucket_name, `thumb_${p.rustfs_object_id}`);
      const fullUrl  = await getPresignedUrl(event.bucket_name, p.rustfs_object_id);
      return { ...p, thumbUrl, fullUrl };
    }));

    res.json({ photos, total: photos.length });
  } catch (err) {
    console.error('List general photos error:', err.message);
    res.status(500).json({ error: 'Failed to list general photos' });
  }
});

/**
 * PATCH /events/:eventId/photos/:photoId/general-visibility
 * Toggles whether a faceless photo appears in the visitor General tab.
 * Does NOT delete the photo — it stays in storage and the manager library.
 * Body: { visible: true | false }
 */
router.patch('/:eventId/photos/:photoId/general-visibility', requireManager, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const { visible } = req.body;
  if (typeof visible !== 'boolean') return res.status(400).json({ error: '"visible" must be a boolean' });

  try {
    const result = await db.query(
      `UPDATE indexed_photos SET visible_in_general = $1
       WHERE id = $2 AND event_id = $3 AND has_faces = false
       RETURNING id, visible_in_general`,
      [visible, photoId, eventId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Photo not found or is not a general photo' });
    res.json({ updated: true, visible_in_general: result.rows[0].visible_in_general });
  } catch (err) {
    console.error('Toggle general visibility error:', err.message);
    res.status(500).json({ error: 'Failed to update visibility' });
  }
});

module.exports = router;
