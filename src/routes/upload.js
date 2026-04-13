const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const crypto  = require('crypto');
const sharp   = require('sharp');
const exifr   = require('exifr');
const db      = require('../db/client');
const { requireManager }           = require('../middleware/auth');
const { validateUuid }             = require('../middleware/validateUuid');
const state                        = require('../state');
const { uploadImage }                   = require('../services/rustfs');
const { detectFaces, indexOneFace }     = require('../services/compreface');

// Memory budget reasoning:
//   Server RAM: 16GB | CompreFace stack: ~5.5GB | Available: ~5.7GB
//   Worst case: 3 concurrent managers × 20 files × 20MB = 1.2GB — safe
//   At 50 files × 10 managers = 10GB — guaranteed OOM crash
//   These limits are tuned for the current 16GB server.
//   On the planned 64GB Unraid migration, bump MAX_FILES_PER_BATCH to 50 and fileSize to 25MB.
const MAX_FILE_SIZE_MB = parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB  || '20',  10);
const MAX_FILES_BATCH  = parseInt(process.env.UPLOAD_MAX_FILES_PER_BATCH || '20', 10);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files:    MAX_FILES_BATCH,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

router.post('/:eventId', requireManager, validateUuid('eventId'), (req, res, next) => {
  // Reject new uploads while server is draining for shutdown.
  // In-flight batches already running complete normally; only NEW requests blocked.
  if (state.isShuttingDown) {
    return res.status(503).json({
      error: 'Server is entering maintenance mode — please retry in a moment',
    });
  }
  next();
}, upload.array('files', 50), async (req, res) => {
  const { eventId } = req.params;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [eventId]);
  if (eventResult.rows.length === 0) {
    return res.status(404).json({ error: 'Event not found' });
  }
  const event = eventResult.rows[0];

  const results = [];

  for (const file of req.files) {
    let objectId = 'unknown_file';
    try {
      // Subject budget: CompreFace has a 50-character hard limit on subject names.
      // Subject format: "{eventId}__{objectId}"
      // eventId (UUID) = 36 chars, separator = 2 chars → objectId budget = 12 chars.
      // 8-char hex hash + ".jpg" = exactly 12 chars → total = 50 chars. ✓
      const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 8);
      objectId = `${fileHash}.jpg`;

      // Duplicate check
      const dup = await db.query(
        'SELECT 1 FROM indexed_photos WHERE event_id = $1 AND rustfs_object_id = $2',
        [eventId, objectId]
      );
      if (dup.rows.length > 0) {
        results.push({ objectId, facesIndexed: 0, status: 'skipped', reason: 'duplicate' });
        continue;
      }

      // .rotate() applies EXIF orientation so crop coordinates are correct for
      // any phone camera orientation. Then resize and compress.
      const compressedBuffer = await sharp(file.buffer)
        .rotate()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();

      const mimeType = 'image/jpeg';
      const metadata = await sharp(compressedBuffer).metadata();
      const imgW = metadata.width;
      const imgH = metadata.height;

      // Upload to RustFS
      await uploadImage(event.bucket_name, objectId, compressedBuffer, mimeType);

      // Thumbnail Generation (Upload-Time)
      try {
        const thumbBuffer = await sharp(file.buffer)
          .rotate()
          .resize({ width: 150, height: 150, fit: 'cover' })
          .jpeg({ quality: 60 })
          .toBuffer();
        await uploadImage(event.bucket_name, `thumb_${objectId}`, thumbBuffer, 'image/jpeg');
      } catch (thumbErr) {
        console.warn(`[upload] Thumbnail generation failed for ${objectId}:`, thumbErr.message);
      }

      // EXIF date extraction
      let photoDate = null;
      try {
        const exif = await exifr.parse(file.buffer, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
        photoDate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate || null;
      } catch (exifErr) {
        // EXIF not available — photoDate stays null
      }

      // ── Multi-face indexing ───────────────────────────────────────────────
      // Detect all faces, then index each one as a padded crop.
      // Padding gives CompreFace enough face context (ears, jawline, forehead)
      // to produce reliable embeddings. Without padding, tight bounding boxes
      // cause the recognition detector to miss or mis-score faces.
      let faceCount = 0;
      let hasFaces  = false;

      try {
        const boxes = await detectFaces(compressedBuffer, mimeType);

        if (boxes.length === 0) {
          console.log(`[upload] No faces detected in ${objectId} — goes to General`);
          hasFaces  = false;
          faceCount = 0;
        } else {
          console.log(`[upload] ${boxes.length} face(s) detected in ${objectId}`);
          let indexed = 0;

          for (const box of boxes) {
            try {
              const { x_min, y_min, x_max, y_max } = box;

              // 30% padding around each face crop.
              // This keeps context (hair, ears, chin) that the recognition
              // model needs — without it, tight crops hurt match accuracy.
              const w       = x_max - x_min;
              const h       = y_max - y_min;
              const marginX = w * 0.30;
              const marginY = h * 0.30;
              const left    = Math.max(0, Math.round(x_min - marginX));
              const top     = Math.max(0, Math.round(y_min - marginY));
              const cropW   = Math.min(imgW - left, Math.round(w + marginX * 2));
              const cropH   = Math.min(imgH - top,  Math.round(h + marginY * 2));

              const cropBuffer = await sharp(compressedBuffer)
                .extract({ left, top, width: cropW, height: cropH })
                .jpeg({ quality: 90 })
                .toBuffer();

              const result = await indexOneFace(cropBuffer, mimeType, eventId, objectId);
              if (result) indexed++;
            } catch (cropErr) {
              console.warn(`[upload] Face crop/index failed for ${objectId}:`, cropErr.message);
            }
          }

          faceCount = indexed;
          hasFaces  = indexed > 0;
          console.log(`[upload] Indexed ${indexed}/${boxes.length} faces for ${objectId}`);
        }
      } catch (detErr) {
        console.warn(`[upload] Detection failed for ${objectId}:`, detErr.response?.data?.message || detErr.message);
        hasFaces  = false;
        faceCount = 0;
      }

      await db.query(
        `INSERT INTO indexed_photos (event_id, rustfs_object_id, has_faces, face_count, photo_date)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [eventId, objectId, hasFaces, faceCount, photoDate]
      );

      results.push({ objectId, facesIndexed: faceCount, hasFaces, status: 'ok' });

    } catch (err) {
      console.error(`[upload] Failed for ${file.originalname}:`, err.message);
      results.push({ objectId, status: 'error', error: err.message });
    }
  }

  res.status(207).json({ results });
});

module.exports = router;
