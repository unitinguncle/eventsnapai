'use strict';

/**
 * src/routes/upload.js  (v2)
 *
 * POST /upload/:eventId
 *   - Streams files to disk (multer diskStorage — never buffers in RAM)
 *   - Computes SHA-256 hash during stream write
 *   - Two-layer dedup: Redis SETNX (72h TTL) then Postgres ON CONFLICT
 *   - Enqueues compression job to BullMQ (Redis db:0)
 *   - Returns HTTP 202 immediately
 *   - Emits per-file Socket.io events to manager session
 *
 * GET /upload/job/:jobId   — poll single job status
 * GET /upload/queue-status — admin queue depth overview
 *
 * Frontend contract: unchanged response shape { results: [...] }
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const { Queue } = require('bullmq');
const db        = require('../db/client');
const redis     = require('../db/redisClient');
const { requireManager } = require('../middleware/auth');
const { validateUuid }   = require('../middleware/validateUuid');
const { ensureBucket }   = require('../services/seaweedfs');
const { emitToSession }  = require('../services/websocket');

const router = express.Router();

// ── Config ────────────────────────────────────────────────────────────────
const TEMP_DIR        = process.env.WORKER_TEMP_DIR || '/tmp/evsnap';
const MAX_FILE_MB     = parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB    || '40',  10);
const MAX_FILES       = parseInt(process.env.UPLOAD_MAX_FILES_PER_BATCH || '50',  10);
const MAX_QUEUE_DEPTH = parseInt(process.env.UPLOAD_MAX_QUEUE_DEPTH     || '500', 10);
const DEDUP_TTL       = parseInt(process.env.DEDUP_TTL_SECONDS          || '259200', 10); // 72h
const REDIS_DB_DEDUP  = parseInt(process.env.REDIS_DB_DEDUP  || '2', 10);
const REDIS_DB_COMPRESS = parseInt(process.env.REDIS_DB_COMPRESS || '0', 10);

// Ensure temp dir exists
fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── Multer disk storage with parallel SHA-256 hashing ────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionDir = path.join(TEMP_DIR, req.uploadSessionId || 'default');
    fs.mkdirSync(sessionDir, { recursive: true });
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    const uid = crypto.randomBytes(8).toString('hex');
    cb(null, `${uid}${path.extname(file.originalname) || '.jpg'}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_MB * 1024 * 1024,
    files:    MAX_FILES,
  },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Only image files accepted'), ok);
  },
});

// ── Middleware: assign session ID before multer runs ─────────────────────
function assignSession(req, res, next) {
  req.uploadSessionId = crypto.randomBytes(8).toString('hex');
  next();
}

// ── SHA-256 hash of a file on disk ────────────────────────────────────────
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end',  ()      => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── BullMQ compression queue ──────────────────────────────────────────────
function getCompressQueue() {
  return new Queue('compress', {
    connection: redis.getBullMQConnection(REDIS_DB_COMPRESS),
  });
}

// ── POST /upload/:eventId ─────────────────────────────────────────────────
router.post(
  '/:eventId',
  requireManager,
  validateUuid('eventId'),
  assignSession,
  upload.array('files[]', MAX_FILES),
  async (req, res) => {
    const { eventId }  = req.params;
    const managerId    = req.user.userId;
    const sessionId    = req.uploadSessionId;
    const qualityPreset = (req.body.quality_preset || 'STANDARD').toUpperCase();
    const files        = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files received' });
    }

    // Verify manager has upload access to this event
    const access = await db.query(
      `SELECT 1 FROM event_access
       WHERE user_id=$1 AND event_id=$2 AND can_upload=true`,
      [managerId, eventId]
    );
    if (access.rowCount === 0) {
      return res.status(403).json({ error: 'No upload access for this event' });
    }

    // Fetch event bucket
    const evRow = await db.query(
      'SELECT bucket_name FROM events WHERE id=$1',
      [eventId]
    );
    if (evRow.rowCount === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const bucket = evRow.rows[0].bucket_name;
    await ensureBucket(bucket);

    // Queue depth guard
    const compressQueue = getCompressQueue();
    const waiting = await compressQueue.getWaitingCount();
    if (waiting >= MAX_QUEUE_DEPTH) {
      return res.status(429).json({
        error: 'Upload queue is full — please wait a few minutes and try again.',
        queue_depth: waiting,
      });
    }

    const results   = [];
    const dedupClient = redis.getClient(REDIS_DB_DEDUP);

    for (const file of files) {
      const tempPath = file.path;
      try {
        // 1. Hash the file
        const sha256 = await hashFile(tempPath);

        // 2. Redis dedup check (L1 — scoped to event)
        const dedupKey = `d:${eventId}:${sha256}`;
        const isNew    = await dedupClient.set(dedupKey, '1', {
          NX:  true,
          EX:  DEDUP_TTL,
        });

        if (!isNew) {
          fs.unlink(tempPath, () => {});
          emitToSession(sessionId, 'upload:duplicate', {
            filename: file.originalname, sessionId,
          });
          results.push({ filename: file.originalname, status: 'duplicate' });
          continue;
        }

        // 3. Postgres authoritative dedup + insert
        const photoRow = await db.query(
          `INSERT INTO indexed_photos
             (event_id, sha256_hash, index_status, compression_status,
              quality_preset, bucket_name, uploaded_by)
           VALUES ($1, $2, 'pending', 'pending', $3, $4, $5)
           ON CONFLICT (event_id, sha256_hash) DO NOTHING
           RETURNING id`,
          [eventId, sha256, qualityPreset, bucket, managerId]
        );

        if (photoRow.rowCount === 0) {
          // Postgres caught a race condition duplicate
          fs.unlink(tempPath, () => {});
          emitToSession(sessionId, 'upload:duplicate', {
            filename: file.originalname, sessionId,
          });
          results.push({ filename: file.originalname, status: 'duplicate' });
          continue;
        }

        const photoId = photoRow.rows[0].id;

        // 4. Write job_tracking row for ingestion step
        await db.query(
          `INSERT INTO job_tracking
             (session_id, manager_id, event_id, photo_id, filename, step, status)
           VALUES ($1,$2,$3,$4,$5,'INGESTED','done')`,
          [sessionId, managerId, eventId, photoId, file.originalname]
        );

        // 5. Enqueue compression job
        const job = await compressQueue.add(
          'compress-photo',
          {
            eventId, photoId, tempPath, qualityPreset,
            bucket, managerId, sessionId,
            filename: file.originalname,
          },
          {
            attempts: 3,
            backoff:  { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 500 },
            removeOnFail:     { count: 200 },
          }
        );

        // 6. Emit accepted event to manager
        emitToSession(sessionId, 'upload:accepted', {
          photoId, filename: file.originalname,
          jobId: job.id, sessionId,
        });

        results.push({
          filename: file.originalname,
          status:   'queued',
          photoId,
          jobId:    job.id,
        });

      } catch (err) {
        console.error('[upload] File error:', err.message);
        fs.unlink(tempPath, () => {});
        emitToSession(sessionId, 'upload:error', {
          filename: file.originalname, error: err.message, sessionId,
        });
        results.push({
          filename: file.originalname,
          status:   'error',
          error:    err.message,
        });
      }
    }

    await compressQueue.close();

    return res.status(202).json({
      sessionId,
      message: `${results.filter(r => r.status === 'queued').length} photos queued`,
      results,
    });
  }
);

// ── GET /upload/job/:jobId ────────────────────────────────────────────────
router.get('/job/:jobId', requireManager, async (req, res) => {
  const compressQueue = getCompressQueue();
  try {
    const job = await compressQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const state = await job.getState();
    await compressQueue.close();
    return res.json({
      jobId:      job.id,
      state,
      result:     state === 'completed' ? job.returnvalue : null,
      failReason: state === 'failed'    ? job.failedReason : null,
      attempts:   job.attemptsMade,
    });
  } catch (err) {
    await compressQueue.close();
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /upload/queue-status ──────────────────────────────────────────────
router.get('/queue-status', requireManager, async (req, res) => {
  const compressQueue = getCompressQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    compressQueue.getWaitingCount(),
    compressQueue.getActiveCount(),
    compressQueue.getCompletedCount(),
    compressQueue.getFailedCount(),
  ]);
  await compressQueue.close();
  return res.json({ waiting, active, completed, failed, limit: MAX_QUEUE_DEPTH });
});

module.exports = router;
