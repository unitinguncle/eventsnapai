'use strict';

/**
 * src/db/client.js
 * Postgres connection pools — primary (writes) and replica (reads).
 * Replica routing is decided at the call site using getReadPool().
 * Replica lag is cached in Redis db:4 and checked every 10s by a
 * background interval started in server.js (startReplicaLagMonitor).
 */

const { Pool } = require('pg');
const redis    = require('./redisClient');

// ── Primary pool (all writes, auth checks) ────────────────────────────────
const primaryPool = new Pool({
  connectionString: process.env.POSTGRES_PRIMARY_URL,
  max:             20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'eventsnapai-app',
});

primaryPool.on('error', (err) => {
  console.error('[db:primary] Unexpected pool error:', err.message);
});

// ── Replica pool (read-only searches) ────────────────────────────────────
const replicaPool = new Pool({
  connectionString: process.env.POSTGRES_REPLICA_URL,
  max:             20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'eventsnapai-replica',
});

replicaPool.on('error', (err) => {
  console.error('[db:replica] Unexpected pool error:', err.message);
});

// ── Replica lag threshold ─────────────────────────────────────────────────
const LAG_THRESHOLD_MS = parseInt(process.env.POSTGRES_REPLICA_LAG_THRESHOLD_MS || '2000', 10);
const LAG_CACHE_TTL_S  = parseInt(process.env.REPLICA_LAG_CACHE_TTL_S || '10', 10);
const VM_ID            = process.env.VM_ID || 'vm1';

/**
 * getReadPool()
 * Returns replica pool if lag is acceptable, otherwise falls back to primary.
 * Decision is based on a Redis-cached lag value updated every 10s.
 */
async function getReadPool() {
  try {
    const lagClient = redis.getClient(parseInt(process.env.REDIS_DB_LAG || '4', 10));
    const cached    = await lagClient.get(`replica_lag:${VM_ID}`);
    if (cached !== null && parseInt(cached, 10) < LAG_THRESHOLD_MS) {
      return replicaPool;
    }
  } catch (_) {
    // Redis unavailable — fall back to primary
  }
  return primaryPool;
}

/**
 * startReplicaLagMonitor()
 * Background interval that checks replica lag and writes to Redis db:4.
 * Called once from server.js on startup.
 */
function startReplicaLagMonitor() {
  const check = async () => {
    try {
      const { rows } = await replicaPool.query(
        `SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS lag_ms`
      );
      const lagMs = rows[0]?.lag_ms ?? 999999;
      const lagClient = redis.getClient(parseInt(process.env.REDIS_DB_LAG || '4', 10));
      await lagClient.set(`replica_lag:${VM_ID}`, Math.round(lagMs), { EX: LAG_CACHE_TTL_S * 2 });
    } catch (err) {
      console.error('[db:replica] Lag check failed:', err.message);
    }
  };
  check(); // run immediately on start
  return setInterval(check, LAG_CACHE_TTL_S * 1000);
}

// ── Set pgvector search param on new connections ──────────────────────────
[primaryPool, replicaPool].forEach((pool) => {
  pool.on('connect', (client) => {
    client.query(`SET hnsw.ef_search = ${process.env.HNSW_EF_SEARCH || 64}`).catch(() => {});
  });
});

module.exports = {
  query:    (text, params) => primaryPool.query(text, params),
  primary:  primaryPool,
  replica:  replicaPool,
  getReadPool,
  startReplicaLagMonitor,
};
