require('dotenv').config();
const app   = require('./app');
const db    = require('./db/client');
const state = require('./state');

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Orchestration API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

/**
 * Graceful shutdown handler.
 *
 * Sequence on SIGTERM (Docker stop / Portainer redeploy) or SIGINT (Ctrl+C):
 *   1. Set isShuttingDown = true  → upload.js immediately returns 503 to any
 *      new upload request, so no new long-running work can start.
 *   2. server.close()            → stop accepting new TCP connections.
 *   3. Wait for in-flight requests to drain (existing uploads run to completion).
 *   4. Close the Postgres pool cleanly.
 *   5. process.exit(0)           → clean exit, Docker marks container stopped.
 *
 * A 60-second hard timeout forces exit if connections won't drain — prevents
 * the container from hanging indefinitely if a request is truly stuck.
 * .unref() on the timeout means it won't block the clean exit path.
 */
function shutdown(signal) {
  console.log(`[shutdown] ${signal} received — entering maintenance mode, draining connections`);
  state.isShuttingDown = true;

  server.close(async () => {
    console.log('[shutdown] All connections drained — closing DB pool');
    try {
      await db.end();
    } catch (err) {
      console.warn('[shutdown] DB pool close error (non-fatal):', err.message);
    }
    console.log('[shutdown] Clean exit');
    process.exit(0);
  });

  // Force exit after 60 seconds if connections stall
  setTimeout(() => {
    console.error('[shutdown] Forced exit after 60s — some in-flight requests may have been dropped');
    process.exit(1);
  }, 60_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
