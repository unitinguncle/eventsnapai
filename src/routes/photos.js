const express = require('express');
const router = express.Router();
const db = require('../db/client');
const { requireAdmin } = require('../middleware/auth');
const { checkBucketExists, getPresignedUrl } = require('../services/rustfs');

router.get('/:eventId/photos', requireAdmin, async (req, res) => {
  const { eventId } = req.params;
  try {
    const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // FIX: was eventResult.rows (array) — must be rows[0]
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
      `SELECT rustfs_object_id, has_faces, indexed_at
       FROM indexed_photos
       WHERE event_id = $1
       ORDER BY indexed_at DESC`,
      [eventId]
    );

    const photos = await Promise.all(photosResult.rows.map(async p => {
      const thumbUrl = await getPresignedUrl(event.bucket_name, `thumb_${p.rustfs_object_id}`);
      return { ...p, thumbUrl };
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

module.exports = router;
