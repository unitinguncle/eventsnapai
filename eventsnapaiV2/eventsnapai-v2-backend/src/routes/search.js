'use strict';

/**
 * src/routes/search.js  (v2)
 *
 * POST /search
 *   - Visitor JWT required (event-scoped)
 *   - Selfie stays in RAM (multer memoryStorage — single file, ~2-5 MB)
 *   - Embeds selfie via InsightFace sidecar /embed
 *   - pgvector ANN search scoped to event_id (no cross-event leakage)
 *   - Replica-aware: uses standby if lag < threshold
 *   - Returns { myPhotos, generalPhotos, favoritePhotos }
 *   - Frontend contract: unchanged response shape
 */

const express = require('express');
const multer  = require('multer');
const db      = require('../db/client');
const { requireVisitor }   = require('../middleware/auth');
const { embedSelfie }      = require('../services/insightface');
const { searchByEmbedding } = require('../services/insightface');
const { getPresignedUrl }  = require('../services/seaweedfs');

const router = express.Router();

const PRESIGNED_EXPIRY    = parseInt(process.env.PRESIGNED_URL_EXPIRY || '21600', 10);
const INCLUDE_GENERAL     = process.env.INCLUDE_GENERAL_PHOTOS === 'true';

const selfieUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Only image files accepted'), ok);
  },
});

// ── POST /search ──────────────────────────────────────────────────────────
router.post('/', requireVisitor, selfieUpload.single('selfie'), async (req, res) => {
  const { eventId } = req.user; // hard-scoped in JWT — cannot be spoofed

  if (!req.file) {
    return res.status(400).json({ error: 'No selfie uploaded' });
  }

  // 1. Embed selfie via InsightFace sidecar
  let embedding;
  try {
    const result = await embedSelfie(req.file.buffer);
    embedding    = result.embedding;
  } catch (err) {
    if (err.response?.status === 422) {
      return res.status(422).json({
        error: 'No face detected in your selfie. Please try again with better lighting.',
      });
    }
    console.error('[search] Sidecar error:', err.message);
    return res.status(503).json({
      error: 'Face recognition service unavailable. Please try again shortly.',
    });
  }

  // 2. pgvector ANN search — scoped to this event only (replica-aware)
  let matchRows;
  try {
    matchRows = await searchByEmbedding(eventId, embedding, 100);
  } catch (err) {
    console.error('[search] pgvector error:', err.message);
    return res.status(500).json({ error: 'Search failed. Please try again.' });
  }

  if (matchRows.length === 0) {
    return res.json({ myPhotos: [], generalPhotos: [], favoritePhotos: [] });
  }

  // 3. Deduplicate photo IDs (multiple faces in one photo — keep photo once)
  const matchedPhotoIds = [...new Set(matchRows.map(r => r.photo_id))];

  // 4. Fetch photo metadata + favorites status
  const readPool = await db.getReadPool();
  const { rows: photos } = await readPool.query(
    `SELECT ip.id,
            ip.bucket_name,
            ip.object_key,
            ip.thumbnail_url,
            ip.taken_at,
            EXISTS (
              SELECT 1 FROM photo_favorites pf
              WHERE pf.photo_id = ip.id
            ) AS is_favorite
     FROM   indexed_photos ip
     WHERE  ip.id = ANY($1::uuid[])
       AND  ip.event_id = $2
       AND  ip.index_status = 'indexed'`,
    [matchedPhotoIds, eventId]
  );

  // 5. Generate presigned URLs
  const enriched = await Promise.all(photos.map(async (p) => {
    const [origUrl, thumbUrl] = await Promise.all([
      getPresignedUrl(p.bucket_name, p.object_key, PRESIGNED_EXPIRY),
      p.thumbnail_url
        ? getPresignedUrl(p.bucket_name, p.thumbnail_url, PRESIGNED_EXPIRY).catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      id:           p.id,
      url:          origUrl,
      thumbnailUrl: thumbUrl || origUrl,
      takenAt:      p.taken_at,
      isFavorite:   p.is_favorite,
    };
  }));

  // 6. Split into response buckets (same as current contract)
  const favoritePhotos = enriched.filter(p => p.isFavorite);
  const myPhotos       = enriched.filter(p => !p.isFavorite);
  let   generalPhotos  = [];

  // Optional: include non-matched photos (off by default — expensive full-scan)
  if (INCLUDE_GENERAL && matchedPhotoIds.length > 0) {
    const { rows: general } = await readPool.query(
      `SELECT ip.id, ip.bucket_name, ip.object_key, ip.taken_at
       FROM   indexed_photos ip
       WHERE  ip.event_id = $1
         AND  ip.id <> ALL($2::uuid[])
         AND  ip.index_status = 'indexed'
         AND  ip.visible_in_general = true
       ORDER  BY ip.taken_at DESC NULLS LAST
       LIMIT  100`,
      [eventId, matchedPhotoIds]
    );
    generalPhotos = await Promise.all(general.map(async (p) => {
      const url = await getPresignedUrl(p.bucket_name, p.object_key, PRESIGNED_EXPIRY);
      return { id: p.id, url, thumbnailUrl: url, takenAt: p.taken_at };
    }));
  }

  return res.json({ myPhotos, generalPhotos, favoritePhotos });
});

module.exports = router;
