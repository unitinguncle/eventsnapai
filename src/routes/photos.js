const express = require('express');
const router = express.Router();
const db = require('../db/client');
const { requireAdmin, requireManager, requireUser } = require('../middleware/auth');
const { checkBucketExists, getPresignedUrl, deleteObject } = require('../services/rustfs');
const { deleteSubjectFaces } = require('../services/compreface');

/**
 * GET /events/:eventId/photos
 * Lists all photos for an event with thumbnail URLs.
 * Sorted by photo_date ascending (oldest first), falling back to indexed_at.
 * Accessible by admin, manager, and user (with event_access check).
 */
router.get('/:eventId/photos', requireUser, async (req, res) => {
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
      `SELECT id, rustfs_object_id, has_faces, face_count, photo_date, indexed_at
       FROM indexed_photos
       WHERE event_id = $1
       ORDER BY COALESCE(photo_date, indexed_at) ASC`,
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
 * Accessible by admin, manager, and user.
 */
router.delete('/:eventId/photos/:photoId', requireManager, async (req, res) => {
  const { eventId, photoId } = req.params;

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

module.exports = router;
