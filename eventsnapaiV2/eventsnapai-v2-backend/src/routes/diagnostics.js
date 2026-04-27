'use strict';

/**
 * src/routes/diagnostics.js  (v2)
 * GET /diagnostics — admin-only health check for all external services.
 * Replaces CompreFace check with InsightFace sidecar + Redis queues + SeaweedFS.
 */

const express = require('express');
const { Queue } = require('bullmq');
const db        = require('../db/client');
const redis     = require('../db/redisClient');
const { requireAdmin }  = require('../middleware/auth');
const { sidecarHealth } = require('../services/insightface');
const { s3 }            = require('../services/seaweedfs');
const { ListBucketsCommand } = require('@aws-sdk/client-s3');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  const results = {};

  // 1. Postgres primary + pgvector
  try {
    const { rows } = await db.query(
      `SELECT extversion FROM pg_extension WHERE extname='vector'`
    );
    const { rows: connRows } = await db.query(
      `SELECT count(*) AS connections FROM pg_stat_activity`
    );
    results.postgres_primary = {
      status:      'ok',
      pgvector:    rows[0]?.extversion || 'installed',
      connections: connRows[0]?.connections,
    };
  } catch (e) {
    results.postgres_primary = { status: 'error', message: e.message };
  }

  // 2. Postgres replica lag
  try {
    const { rows } = await db.replica.query(
      `SELECT pg_is_in_recovery() AS is_replica,
              EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds`
    );
    results.postgres_replica = {
      status:      'ok',
      is_replica:  rows[0]?.is_replica,
      lag_seconds: rows[0]?.lag_seconds,
    };
  } catch (e) {
    results.postgres_replica = { status: 'error', message: e.message };
  }

  // 3. InsightFace sidecar
  try {
    const health = await sidecarHealth();
    results.insightface = { status: 'ok', ...health };
  } catch (e) {
    results.insightface = { status: 'error', message: e.message };
  }

  // 4. SeaweedFS S3 API
  try {
    await s3.send(new ListBucketsCommand({}));
    results.seaweedfs = { status: 'ok' };
  } catch (e) {
    results.seaweedfs = { status: 'error', message: e.message };
  }

  // 5. Redis + BullMQ queue stats
  const REDIS_DB_COMPRESS = parseInt(process.env.REDIS_DB_COMPRESS || '0', 10);
  const REDIS_DB_INDEX    = parseInt(process.env.REDIS_DB_INDEX    || '1', 10);
  try {
    const compressQueue = new Queue('compress', {
      connection: redis.getBullMQConnection(REDIS_DB_COMPRESS),
    });
    const indexQueue = new Queue('index', {
      connection: redis.getBullMQConnection(REDIS_DB_INDEX),
    });
    const [cw, ca, cf, iw, ia, ifl] = await Promise.all([
      compressQueue.getWaitingCount(),
      compressQueue.getActiveCount(),
      compressQueue.getFailedCount(),
      indexQueue.getWaitingCount(),
      indexQueue.getActiveCount(),
      indexQueue.getFailedCount(),
    ]);
    await Promise.all([compressQueue.close(), indexQueue.close()]);
    results.queues = {
      status:   'ok',
      compress: { waiting: cw, active: ca, failed: cf },
      index:    { waiting: iw, active: ia, failed: ifl },
    };
  } catch (e) {
    results.queues = { status: 'error', message: e.message };
  }

  // 6. Redis connectivity
  try {
    const dedupClient = redis.getClient(2);
    await dedupClient.ping();
    results.redis = { status: 'ok' };
  } catch (e) {
    results.redis = { status: 'error', message: e.message };
  }

  const allOk = Object.values(results).every(r => r.status === 'ok');
  return res.status(allOk ? 200 : 207).json({ ok: allOk, services: results });
});

module.exports = router;
