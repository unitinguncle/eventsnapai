// Shared application runtime state.
// This module is a singleton in Node's require cache — any module that
// requires it reads and writes the same object instance.
//
// Currently used to propagate the graceful shutdown signal from server.js
// to route handlers (specifically upload.js) so new long-running requests
// can be rejected immediately with a 503 instead of being accepted and then
// hard-killed mid-way when the process exits.
module.exports = {
  isShuttingDown: false,
};
