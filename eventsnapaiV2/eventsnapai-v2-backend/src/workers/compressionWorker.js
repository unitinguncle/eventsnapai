'use strict';

/**
 * src/workers/compressionWorker.js
 * BullMQ consumer for the 'compress' queue (Redis db:0).
 *
 * Per job:
 *   1. Read temp file from disk
 *   2. PREMIUM path: stream direct to SeaweedFS (no sharp)
 *      STANDARD/HIGH path: sharp transform → stream to SeaweedFS
 *   3. Generate thumbnail via sharp (all presets)
 *   4. ETag dedup check via Redis
 *   5. Update Postgres indexed_photos
 *   6. Enqueue indexing job (Redis db:1)
 *   7. Emit Socket.io events to manager session
 *   8. Delete temp file
 *
 * On 3rd failure: email alert + move temp file to /tmp/evsnap/failed/
 */

const { Worker, Queue } = require('bullmq');
const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');
const db      = require('../db/client');
const redis   = require('../db/redisClient');
const seaweed = require('../services/seaweedfs');
const { emitToSession } = require('../services/websocket');
const { sendMail }      = require('../services/mailer');

const REDIS_DB_COMPRESS = parseInt(process.env.REDIS_DB_COMPRESS || '0', 10);
const REDIS_DB_INDEX    = parseInt(process.env.REDIS_DB_INDEX    || '1', 10);
const REDIS_DB_DEDUP    = parseInt(process.env.REDIS_DB_DEDUP    || '2', 10);
const CONCURRENCY       = parseInt(process.env.COMPRESSION_CONCURRENCY || '3', 10);
const TEMP_DIR          = process.env.WORKER_TEMP_DIR || '/tmp/evsnap';
const FAILED_DIR        = path.join(TEMP_DIR, 'failed');
const ETAG_TTL          = 7 * 24 * 60 * 60; // 7 days

// Quality preset → sharp settings
const QUALITY_PRESETS = {
  STANDARD: {
    resize:  { width: parseInt(process.env.QUALITY_STANDARD_WIDTH || '1920', 10), height: parseInt(process.env.QUALITY_STANDARD_WIDTH || '1920', 10), fit: 'inside', withoutEnlargement: true },
    jpeg:    { quality: parseInt(process.env.QUALITY_STANDARD_JPEG || '82', 10) },
    premium: false,
  },
  HIGH: {
    resize:  { width: parseInt(process.env.QUALITY_HIGH_WIDTH || '2800', 10), height: parseInt(process.env.QUALITY_HIGH_WIDTH || '2800', 10), fit: 'inside', withoutEnlargement: true },
    jpeg:    { quality: parseInt(process.env.QUALITY_HIGH_JPEG || '92', 10) },
    premium: false,
  },
  PREMIUM: {
    jpeg:    { quality: parseInt(process.env.QUALITY_PREMIUM_JPEG || '100', 10) },
    premium: true, // bypass sharp compression entirely
  },
};

const THUMB_QUALITY = parseInt(process.env.QUALITY_PREMIUM_THUMB_JPEG || '85', 10);

fs.mkdirSync(FAILED_DIR, { recursive: true });

// ── Worker ────────────────────────────────────────────────────────────────
const worker = new Worker(
  'compress',
  async (job) => {
    const { eventId, photoId, tempPath, qualityPreset, bucket, managerId, sessionId, filename } = job.data;
    const preset = QUALITY_PRESETS[qualityPreset] || QUALITY_PRESETS.STANDARD;

    job.log(`Compressing ${filename} (${qualityPreset}) — photo ${photoId}`);
    emitToSession(sessionId, 'compress:start', { photoId, sessionId });

    // Update job tracking
    await db.query(
      `INSERT INTO job_tracking (session_id, manager_id, event_id, photo_id, filename, step, status)
       VALUES ($1,$2,$3,$4,$5,'COMPRESSED','processing')
       ON CONFLICT DO NOTHING`,
      [sessionId, managerId, eventId, photoId, filename]
    );
    await db.query(
      `UPDATE indexed_photos SET compression_status='processing' WHERE id=$1`,
      [photoId]
    );

    if (!fs.existsSync(tempPath)) {
      throw new Error(`Temp file not found: ${tempPath}`);
    }

    // ── Main photo upload ───────────────────────────────────────────────
    const origKey = seaweed.photoKey(eventId, photoId);
    let origEtag;

    if (preset.premium) {
      // PREMIUM: stream directly — no sharp transform
      const readStream = fs.createReadStream(tempPath);
      const result     = await seaweed.uploadStream(bucket, origKey, readStream, 'image/jpeg');
      origEtag = result.etag;
    } else {
      // STANDARD / HIGH: sharp transform stream
      const readStream    = fs.createReadStream(tempPath);
      const sharpTransform = sharp()
        .resize(preset.resize)
        .jpeg(preset.jpeg);
      const transformedStream = readStream.pipe(sharpTransform);
      const result = await seaweed.uploadStream(bucket, origKey, transformedStream, 'image/jpeg');
      origEtag = result.etag;
    }

    // ── ETag dedup check ────────────────────────────────────────────────
    const dedupClient = redis.getClient(REDIS_DB_DEDUP);
    const etagKey     = `etag:${eventId}:${origEtag}`;
    const etagNew     = await dedupClient.set(etagKey, origKey, { NX: true, EX: ETAG_TTL });

    if (!etagNew) {
      // ETag collision — delete just-uploaded object, point at existing
      const existingKey = await dedupClient.get(etagKey);
      await seaweed.deleteObject(bucket, origKey);
      await db.query(
        `UPDATE indexed_photos
         SET compression_status='done', object_key=$1, bucket_name=$2
         WHERE id=$3`,
        [existingKey || origKey, bucket, photoId]
      );
      emitToSession(sessionId, 'compress:duplicate', { photoId, sessionId });
      await db.query(
        `UPDATE job_tracking SET status='duplicate' WHERE photo_id=$1 AND step='COMPRESSED'`,
        [photoId]
      );
      fs.unlink(tempPath, () => {});
      return { photoId, status: 'duplicate' };
    }

    // ── Thumbnail (all presets) ──────────────────────────────────────────
    const thumbKey    = seaweed.thumbKey(eventId, photoId);
    const thumbBuffer = await sharp(tempPath)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
    await seaweed.uploadBuffer(bucket, thumbKey, thumbBuffer, 'image/jpeg');

    // ── Update Postgres ──────────────────────────────────────────────────
    await db.query(
      `UPDATE indexed_photos
       SET compression_status='done',
           object_key=$1,
           thumbnail_url=$2,
           bucket_name=$3,
           compressed_url=$4
       WHERE id=$5`,
      [origKey, thumbKey, bucket, origKey, photoId]
    );
    await db.query(
      `UPDATE job_tracking SET status='done'
       WHERE photo_id=$1 AND step='COMPRESSED'`,
      [photoId]
    );

    // ── Delete temp file ─────────────────────────────────────────────────
    fs.unlink(tempPath, () => {});

    // ── Enqueue indexing job ─────────────────────────────────────────────
    const indexQueue = new Queue('index', {
      connection: redis.getBullMQConnection(REDIS_DB_INDEX),
    });
    await indexQueue.add(
      'index-photo',
      { eventId, photoId, bucket, objectKey: origKey, managerId, sessionId, filename },
      {
        attempts: 3,
        backoff:  { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 500 },
        removeOnFail:     { count: 200 },
      }
    );
    await indexQueue.close();

    // ── Emit done to manager ─────────────────────────────────────────────
    const thumbUrl = `${process.env.SEAWEEDFS_S3_ENDPOINT}/${bucket}/${thumbKey}`;
    emitToSession(sessionId, 'compress:done', { photoId, thumbnailUrl: thumbUrl, sessionId });

    job.log(`Compression done — photo ${photoId}`);
    return { photoId, status: 'done' };
  },
  {
    connection:       redis.getBullMQConnection(REDIS_DB_COMPRESS),
    concurrency:      CONCURRENCY,
    removeOnComplete: { count: 500 },
    removeOnFail:     { count: 200 },
  }
);

// ── Failure handler ───────────────────────────────────────────────────────
worker.on('failed', async (job, err) => {
  console.error(`[compress-worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);

  if (job?.attemptsMade >= 3) {
    const { photoId, tempPath, managerId, eventId, filename, sessionId } = job?.data || {};

    // Move temp file to failed directory
    if (tempPath && fs.existsSync(tempPath)) {
      const failedPath = path.join(FAILED_DIR, path.basename(tempPath));
      fs.rename(tempPath, failedPath, () => {});
    }

    // Update DB
    if (photoId) {
      await db.query(
        `UPDATE indexed_photos SET compression_status='upload_failed' WHERE id=$1`,
        [photoId]
      ).catch(() => {});
      await db.query(
        `UPDATE job_tracking SET status='failed', error_msg=$1
         WHERE photo_id=$2 AND step='COMPRESSED'`,
        [err.message, photoId]
      ).catch(() => {});
    }

    // Emit to manager
    if (sessionId) {
      emitToSession(sessionId, 'compress:failed', { photoId, error: err.message, sessionId });
    }

    // Email alert
    if (process.env.ALERT_EMAIL_COMPRESS_FAILURE !== 'false') {
      await sendMail({
        to:      process.env.ALERT_EMAIL_TO || 'info@raidcloud.in',
        subject: `[EventSnapAI] Compression failed — ${filename || photoId}`,
        text:    `Photo compression failed after 3 retries.\n\nEvent: ${eventId}\nPhoto: ${photoId}\nFile: ${filename}\nError: ${err.message}\n\nCheck the admin panel to retry.`,
      }).catch(() => {});
    }
  }
});

worker.on('completed', (job, result) => {
  console.log(`[compress-worker] Job ${job.id} done — ${result?.status}`);
});

worker.on('error', (err) => {
  console.error('[compress-worker] Worker error:', err.message);
});

console.log(`[compress-worker] Started — concurrency=${CONCURRENCY}`);
