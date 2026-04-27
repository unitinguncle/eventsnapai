'use strict';

/**
 * src/services/websocket.js
 * Socket.io server with @socket.io/redis-adapter for cross-VM event delivery.
 *
 * Manager connects → socket registered on whichever VM Nginx routed to.
 * Worker on any VM publishes → Redis pub/sub → correct VM emits to manager.
 *
 * Events emitted to manager browser:
 *   upload:accepted   { photoId, filename, sessionId }
 *   upload:duplicate  { filename, sessionId }
 *   upload:error      { filename, error, sessionId }
 *   compress:start    { photoId, sessionId }
 *   compress:done     { photoId, thumbnailUrl, sessionId }
 *   compress:duplicate{ photoId, sessionId }
 *   compress:failed   { photoId, error, sessionId }
 *   index:start       { photoId, sessionId }
 *   index:done        { photoId, faceCount, sessionId }
 *   index:no_faces    { photoId, sessionId }
 *   index:failed      { photoId, error, sessionId }
 */

const { Server }       = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const jwt              = require('jsonwebtoken');

let io;

const REDIS_BASE = {
  socket: {
    host: process.env.REDIS_HOST || '192.168.11.200',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB_SOCKETIO || '3', 10),
};

/**
 * initWebSocket(httpServer)
 * Attaches Socket.io to the existing Express HTTP server.
 * Call once from server.js after app.listen().
 */
async function initWebSocket(httpServer) {
  // Two Redis clients required by the adapter (pub + sub)
  const pubClient = createClient(REDIS_BASE);
  const subClient = pubClient.duplicate();

  await Promise.all([pubClient.connect(), subClient.connect()]);

  io = new Server(httpServer, {
    cors: {
      origin:      (process.env.ALLOWED_ORIGINS || '').split(','),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.adapter(createAdapter(pubClient, subClient));

  // ── Auth middleware — validate JWT on connect ────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId    = payload.userId;
      socket.role      = payload.role;
      socket.sessionId = socket.handshake.auth?.sessionId || socket.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    // Join a room named by sessionId so we can target this manager precisely
    socket.join(`session:${socket.sessionId}`);
    console.log(`[ws] ${socket.role} connected — session ${socket.sessionId}`);

    socket.on('disconnect', () => {
      console.log(`[ws] ${socket.role} disconnected — session ${socket.sessionId}`);
    });
  });

  console.log('[ws] Socket.io server ready with Redis adapter');
  return io;
}

/**
 * emitToSession(sessionId, event, data)
 * Emits an event to a specific manager session.
 * Works cross-VM because the Redis adapter handles pub/sub routing.
 * Called from workers — they import this function directly.
 */
function emitToSession(sessionId, event, data) {
  if (!io) {
    console.warn('[ws] emitToSession called before init — skipping');
    return;
  }
  io.to(`session:${sessionId}`).emit(event, data);
}

/**
 * getIO()
 * Returns the Socket.io server instance.
 */
function getIO() {
  return io;
}

module.exports = { initWebSocket, emitToSession, getIO };
