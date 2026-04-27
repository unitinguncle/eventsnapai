'use strict';

/**
 * src/db/redisClient.js
 * Redis client factory — one logical client per database index.
 * Databases:
 *   0  compression queue  (BullMQ, AOF)
 *   1  indexing queue     (BullMQ, AOF)
 *   2  dedup hash cache   (volatile)
 *   3  socket.io pub/sub  (volatile)
 *   4  replica lag cache  (volatile)
 */

const { createClient } = require('redis');

const clients = {};

const BASE_CONFIG = {
  socket: {
    host:           process.env.REDIS_HOST || '192.168.11.200',
    port:           parseInt(process.env.REDIS_PORT || '6379', 10),
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
  password: process.env.REDIS_PASSWORD || undefined,
};

/**
 * getClient(db)
 * Returns a connected Redis client for the given database index.
 * Creates and connects on first call, reuses on subsequent calls.
 */
function getClient(db = 0) {
  if (clients[db]) return clients[db];

  const client = createClient({ ...BASE_CONFIG, database: db });

  client.on('error', (err) => {
    console.error(`[redis:db${db}] Error:`, err.message);
  });

  client.on('reconnecting', () => {
    console.warn(`[redis:db${db}] Reconnecting...`);
  });

  // Connect immediately — caller awaits via ready promise below
  client.connect().catch((err) => {
    console.error(`[redis:db${db}] Connect failed:`, err.message);
  });

  clients[db] = client;
  return client;
}

/**
 * getBullMQConnection(db)
 * Returns a plain ioredis-compatible connection config for BullMQ.
 * BullMQ manages its own connection pool internally.
 */
function getBullMQConnection(db) {
  return {
    host:     process.env.REDIS_HOST || '192.168.11.200',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db,
    maxRetriesPerRequest: null, // required by BullMQ
  };
}

/**
 * closeAll()
 * Gracefully close all open Redis connections.
 * Called on SIGTERM in server.js.
 */
async function closeAll() {
  await Promise.all(Object.values(clients).map((c) => c.quit().catch(() => {})));
}

module.exports = { getClient, getBullMQConnection, closeAll };
