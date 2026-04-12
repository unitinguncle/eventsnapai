const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const db      = require('../db/client');
const { requireVisitor }   = require('../middleware/auth');
const { searchByFace }     = require('../services/compreface');
const { getPresignedUrls } = require('../services/rustfs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

router.post('/', requireVisitor, upload.single('selfie'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No selfie image provided' });
  }

  const { eventId } = req.visitor;

  try {
    const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventResult.rows[0];

    // searchByFace filters results to this event via subject prefix "{eventId}__"
    const matchedObjectIds = await searchByFace(req.file.buffer, req.file.mimetype, eventId);

    // General photos (no faces) — always shown to all visitors
    const generalResult = await db.query(
      `SELECT rustfs_object_id FROM indexed_photos
       WHERE event_id = $1 AND has_faces = false
       ORDER BY indexed_at DESC`,
      [eventId]
    );
    const generalIds = generalResult.rows.map(r => r.rustfs_object_id);

    // Curated Favorites (marked by manager/client)
    const favResult = await db.query(
      `SELECT DISTINCT ip.rustfs_object_id FROM photo_favorites pf
       JOIN indexed_photos ip ON pf.photo_id = ip.id
       WHERE pf.event_id = $1`,
      [eventId]
    );
    const favoriteIds = favResult.rows.map(r => r.rustfs_object_id);

    // Verify matched photos belong to this event in DB (double safety check)
    let myPhotoIds = [];
    if (matchedObjectIds.length > 0) {
      const verifyResult = await db.query(
        `SELECT rustfs_object_id FROM indexed_photos
         WHERE event_id = $1 AND rustfs_object_id = ANY($2::text[]) AND has_faces = true`,
        [eventId, matchedObjectIds]
      );
      myPhotoIds = verifyResult.rows.map(r => r.rustfs_object_id);
    }

    const [myPhotos, generalPhotos, favoritePhotos] = await Promise.all([
      myPhotoIds.length > 0 ? getPresignedUrls(event.bucket_name, myPhotoIds) : [],
      generalIds.length  > 0 ? getPresignedUrls(event.bucket_name, generalIds) : [],
      favoriteIds.length > 0 ? getPresignedUrls(event.bucket_name, favoriteIds) : [],
    ]);

    res.json({
      myPhotos,
      generalPhotos,
      favoritePhotos,
      totalMyPhotos:      myPhotos.length,
      totalGeneralPhotos: generalPhotos.length,
      totalFavoritePhotos: favoritePhotos.length,
    });

  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed — please try again' });
  }
});

module.exports = router;
