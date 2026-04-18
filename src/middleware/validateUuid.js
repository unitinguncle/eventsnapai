const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that specified route param fields are valid UUID v4 format.
 *
 * Usage in routes:
 *   router.get('/:eventId/photos', requireUser, validateUuid('eventId'), handler)
 *   router.delete('/:eventId/photos/:photoId', requireManager, validateUuid('eventId', 'photoId'), handler)
 *
 * Returns HTTP 400 with a clear error if any specified param fails UUID format validation.
 * This prevents malformed input (injections, oversized strings) from ever reaching DB queries.
 */
function validateUuid(...fields) {
  return (req, res, next) => {
    for (const field of fields) {
      const value = req.params[field];
      if (value !== undefined && !UUID_REGEX.test(value)) {
        return res.status(400).json({ error: `Invalid ${field} format — must be a valid UUID` });
      }
    }
    next();
  };
}

module.exports = { validateUuid };
