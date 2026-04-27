const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const db      = require('../db/client');
const { requireManager, requireMember } = require('../middleware/auth');
const { validateUuid }                   = require('../middleware/validateUuid');
const { getPresignedUrl }                = require('../services/rustfs');

const SALT_ROUNDS = 12;
const MAX_MEMBERS = 25; // Security cap per collaborative event

// ─── Helper: verify manager owns (has access to) a collaborative event ────────
async function assertManagerAccess(userId, eventId, res) {
  const ev = await db.query(
    'SELECT id, is_collaborative FROM events WHERE id = $1',
    [eventId]
  );
  if (ev.rows.length === 0) {
    res.status(404).json({ error: 'Event not found' });
    return null;
  }
  if (!ev.rows[0].is_collaborative) {
    res.status(400).json({ error: 'This endpoint is only available for collaborative events' });
    return null;
  }
  const access = await db.query(
    'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
    [userId, eventId]
  );
  if (access.rows.length === 0) {
    res.status(403).json({ error: 'You do not have access to this event' });
    return null;
  }
  return ev.rows[0];
}

/**
 * POST /collab/:eventId/members
 * Manager adds a new member to a collaborative event.
 * Body: { displayName, username, password }
 * No mobile required for collaborative members.
 */
router.post('/:eventId/members', requireManager, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const { displayName, username, password } = req.body;
  const managerId = req.user?.userId;

  if (!displayName || !username || !password) {
    return res.status(400).json({ error: 'displayName, username, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const cleanUsername = username.toLowerCase().trim();
  if (!/^[a-z0-9._-]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username must be lowercase alphanumeric (dots, dashes, underscores allowed)' });
  }

  const event = await assertManagerAccess(managerId, eventId, res);
  if (!event) return;

  // Enforce member cap
  const countResult = await db.query(
    `SELECT COUNT(*) AS cnt FROM event_access ea
     JOIN users u ON ea.user_id = u.id
     WHERE ea.event_id = $1 AND u.role = 'user'`,
    [eventId]
  );
  if (parseInt(countResult.rows[0].cnt, 10) >= MAX_MEMBERS) {
    return res.status(400).json({ error: `Collaborative events are limited to ${MAX_MEMBERS} members` });
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.query('BEGIN');

    const userResult = await db.query(
      `INSERT INTO users (username, password_hash, display_name, role, created_by)
       VALUES ($1, $2, $3, 'user', $4)
       RETURNING id, username, display_name, role, created_at`,
      [cleanUsername, hash, displayName.trim(), managerId]
    );
    const newUser = userResult.rows[0];

    await db.query(
      `INSERT INTO event_access (user_id, event_id, can_upload, can_delete, can_manage)
       VALUES ($1, $2, true, false, false)`,
      [newUser.id, eventId]
    );

    await db.query('COMMIT');
    console.log(`[collab] Member created: ${cleanUsername} for event ${eventId}`);
    res.status(201).json(newUser);
  } catch (err) {
    await db.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with that username already exists' });
    }
    console.error('[collab] Create member error:', err.message);
    res.status(500).json({ error: 'Failed to create member' });
  }
});

/**
 * GET /collab/:eventId/members
 * Manager lists all members of a collaborative event with upload counts.
 */
router.get('/:eventId/members', requireManager, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const managerId = req.user?.userId;

  const event = await assertManagerAccess(managerId, eventId, res);
  if (!event) return;

  try {
    const result = await db.query(
      `SELECT
         u.id, u.username, u.display_name, u.created_at, u.is_active,
         ea.can_upload, ea.granted_at,
         COALESCE(up.photo_count, 0) AS photo_count
       FROM event_access ea
       JOIN users u ON ea.user_id = u.id
       LEFT JOIN (
         SELECT uploaded_by, COUNT(*) AS photo_count
         FROM indexed_photos
         WHERE event_id = $1
         GROUP BY uploaded_by
       ) up ON up.uploaded_by = u.id
       WHERE ea.event_id = $1 AND u.role = 'user'
       ORDER BY ea.granted_at ASC`,
      [eventId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[collab] List members error:', err.message);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

/**
 * DELETE /collab/:eventId/members/:memberId
 * Manager removes a member from the collaborative event (revokes access).
 * Does NOT delete the user account itself.
 */
router.delete('/:eventId/members/:memberId', requireManager, validateUuid('eventId', 'memberId'), async (req, res) => {
  const { eventId, memberId } = req.params;
  const managerId = req.user?.userId;

  const event = await assertManagerAccess(managerId, eventId, res);
  if (!event) return;

  try {
    await db.query(
      'DELETE FROM event_access WHERE user_id = $1 AND event_id = $2',
      [memberId, eventId]
    );
    res.json({ removed: true });
  } catch (err) {
    console.error('[collab] Remove member error:', err.message);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

/**
 * PATCH /collab/:eventId/members/:memberId/upload
 * Manager toggles a member's upload permission.
 * Body: { canUpload: boolean }
 */
router.patch('/:eventId/members/:memberId/upload', requireManager, validateUuid('eventId', 'memberId'), async (req, res) => {
  const { eventId, memberId } = req.params;
  const { canUpload } = req.body;
  const managerId = req.user?.userId;

  if (typeof canUpload !== 'boolean') {
    return res.status(400).json({ error: 'canUpload must be a boolean' });
  }

  const event = await assertManagerAccess(managerId, eventId, res);
  if (!event) return;

  try {
    await db.query(
      'UPDATE event_access SET can_upload = $1 WHERE user_id = $2 AND event_id = $3',
      [canUpload, memberId, eventId]
    );
    res.json({ updated: true, canUpload });
  } catch (err) {
    console.error('[collab] Toggle upload error:', err.message);
    res.status(500).json({ error: 'Failed to update member permissions' });
  }
});

/**
 * PATCH /collab/:eventId/members/:memberId/password
 * Manager resets a member's password.
 * Body: { password }
 */
router.patch('/:eventId/members/:memberId/password', requireManager, validateUuid('eventId', 'memberId'), async (req, res) => {
  const { eventId, memberId } = req.params;
  const { password } = req.body;
  const managerId = req.user?.userId;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const event = await assertManagerAccess(managerId, eventId, res);
  if (!event) return;

  try {
    // Verify member belongs to this event
    const access = await db.query(
      `SELECT u.id FROM users u JOIN event_access ea ON ea.user_id = u.id
       WHERE u.id = $1 AND ea.event_id = $2 AND u.role = 'user'`,
      [memberId, eventId]
    );
    if (access.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in this event' });
    }
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, memberId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[collab] Reset member password error:', err.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ─── All Photos (member view) ─────────────────────────────────────────────────

/**
 * GET /collab/:eventId/all-photos
 * Member (or manager) retrieves all photos for a collaborative event,
 * including uploader display name and initials for the badge.
 * Supports optional ?uploadedBy=userId filter.
 */
router.get('/:eventId/all-photos', validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const { uploadedBy } = req.query;

  // Accept either manager or member tokens
  let requesterId = null;
  let isManager = false;

  // Try manager first
  const { requireManager: rm, requireMember: rmbr } = require('../middleware/auth');

  // Manual dual-auth check (can't use middleware conditionally in a clean way)
  const jwt = require('jsonwebtoken');
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — missing token' });
  }
  let payload;
  try {
    payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }

  if (payload.role === 'manager' || payload.role === 'admin') {
    isManager = true;
    requesterId = payload.userId;
    // Verify manager access
    const access = await db.query(
      'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
      [requesterId, eventId]
    ).catch(() => ({ rows: [] }));
    if (!access.rows.length && payload.role !== 'admin') {
      return res.status(403).json({ error: 'No access to this event' });
    }
  } else if (payload.role === 'user') {
    requesterId = payload.userId;
    // Verify member access
    const access = await db.query(
      'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
      [requesterId, eventId]
    ).catch(() => ({ rows: [] }));
    if (!access.rows.length) {
      return res.status(403).json({ error: 'No access to this event' });
    }
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Verify event is collaborative
    const evResult = await db.query(
      'SELECT bucket_name, is_collaborative FROM events WHERE id = $1',
      [eventId]
    );
    if (evResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = evResult.rows[0];
    if (!event.is_collaborative) {
      return res.status(400).json({ error: 'Not a collaborative event' });
    }

    let query = `
      SELECT
        ip.id, ip.rustfs_object_id, ip.has_faces, ip.face_count,
        ip.photo_date, ip.indexed_at, ip.uploaded_by,
        u.display_name AS uploader_name,
        u.username AS uploader_username
      FROM indexed_photos ip
      LEFT JOIN users u ON ip.uploaded_by = u.id
      WHERE ip.event_id = $1
    `;
    const params = [eventId];

    if (uploadedBy) {
      query += ` AND ip.uploaded_by = $2`;
      params.push(uploadedBy);
    }

    query += ` ORDER BY COALESCE(ip.photo_date, ip.indexed_at) DESC`;

    const photosResult = await db.query(query, params);

    const photos = await Promise.all(photosResult.rows.map(async p => {
      const thumbUrl = await getPresignedUrl(event.bucket_name, `thumb_${p.rustfs_object_id}`);
      const fullUrl  = await getPresignedUrl(event.bucket_name, p.rustfs_object_id);
      return { ...p, thumbUrl, fullUrl };
    }));

    res.json({ photos, total: photos.length });
  } catch (err) {
    console.error('[collab] All photos error:', err.message);
    res.status(500).json({ error: 'Failed to load photos' });
  }
});

/**
 * GET /collab/:eventId/uploaders
 * Returns distinct uploaders for the filter chip bar.
 * Accessible by manager and members.
 */
router.get('/:eventId/uploaders', validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;

  const jwt = require('jsonwebtoken');
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try {
    payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
  if (!['manager', 'admin', 'user'].includes(payload.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const result = await db.query(
      `SELECT DISTINCT u.id, u.display_name, u.username,
              COUNT(ip.id) AS photo_count
       FROM indexed_photos ip
       JOIN users u ON ip.uploaded_by = u.id
       WHERE ip.event_id = $1
       GROUP BY u.id, u.display_name, u.username
       ORDER BY u.display_name`,
      [eventId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[collab] Uploaders error:', err.message);
    res.status(500).json({ error: 'Failed to load uploaders' });
  }
});

// ─── Group Favorites (manager-curated, visible to all members) ────────────────

/**
 * GET /collab/:eventId/group-favorites
 * Returns all group-favorited photos with presigned URLs.
 * Accessible by manager and members.
 */
router.get('/:eventId/group-favorites', validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;

  const jwt = require('jsonwebtoken');
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try {
    payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!['manager', 'admin', 'user'].includes(payload.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const evResult = await db.query('SELECT bucket_name FROM events WHERE id = $1', [eventId]);
    if (evResult.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    const { bucket_name } = evResult.rows[0];

    const result = await db.query(
      `SELECT ip.id, ip.rustfs_object_id, ip.has_faces, ip.photo_date, ip.indexed_at,
              ip.uploaded_by, u.display_name AS uploader_name,
              gf.marked_at
       FROM group_favorites gf
       JOIN indexed_photos ip ON gf.photo_id = ip.id
       LEFT JOIN users u ON ip.uploaded_by = u.id
       WHERE gf.event_id = $1
       ORDER BY gf.marked_at DESC`,
      [eventId]
    );

    const photos = await Promise.all(result.rows.map(async p => {
      const thumbUrl = await getPresignedUrl(bucket_name, `thumb_${p.rustfs_object_id}`);
      const fullUrl  = await getPresignedUrl(bucket_name, p.rustfs_object_id);
      return { ...p, thumbUrl, fullUrl };
    }));

    res.json({ photos, total: photos.length });
  } catch (err) {
    console.error('[collab] Group favorites error:', err.message);
    res.status(500).json({ error: 'Failed to load group favorites' });
  }
});

/**
 * GET /collab/:eventId/group-favorites/ids
 * Returns just the photo_id set for the group favorites (fast sync check).
 */
router.get('/:eventId/group-favorites/ids', validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  try {
    const result = await db.query(
      'SELECT photo_id FROM group_favorites WHERE event_id = $1',
      [eventId]
    );
    res.json(result.rows.map(r => r.photo_id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load group favorite IDs' });
  }
});

/**
 * POST /collab/:eventId/group-favorites/:photoId
 * Manager toggles a photo as a Group Favorite.
 */
router.post('/:eventId/group-favorites/:photoId', requireManager, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const managerId = req.user?.userId;

  const event = await assertManagerAccess(managerId, eventId, res);
  if (!event) return;

  try {
    await db.query(
      `INSERT INTO group_favorites (event_id, photo_id, marked_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, photo_id) DO NOTHING`,
      [eventId, photoId, managerId]
    );
    res.status(201).json({ groupFavorited: true });
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Photo or event not found' });
    console.error('[collab] Add group fav error:', err.message);
    res.status(500).json({ error: 'Failed to add group favorite' });
  }
});

/**
 * DELETE /collab/:eventId/group-favorites/:photoId
 * Manager removes a Group Favorite.
 */
router.delete('/:eventId/group-favorites/:photoId', requireManager, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const managerId = req.user?.userId;

  const event = await assertManagerAccess(managerId, eventId, res);
  if (!event) return;

  try {
    await db.query(
      'DELETE FROM group_favorites WHERE event_id = $1 AND photo_id = $2',
      [eventId, photoId]
    );
    res.json({ groupUnfavorited: true });
  } catch (err) {
    console.error('[collab] Remove group fav error:', err.message);
    res.status(500).json({ error: 'Failed to remove group favorite' });
  }
});

// ─── Personal Favorites (per-member) ─────────────────────────────────────────

/**
 * GET /collab/:eventId/my-favorites/ids
 * Returns the authenticated member's personal favorite photo IDs.
 */
router.get('/:eventId/my-favorites/ids', validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;

  const jwt = require('jsonwebtoken');
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const userId = payload.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await db.query(
      'SELECT photo_id FROM photo_favorites WHERE event_id = $1 AND marked_by = $2',
      [eventId, userId]
    );
    res.json(result.rows.map(r => r.photo_id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load favorites' });
  }
});

/**
 * GET /collab/:eventId/my-favorites
 * Returns photos that the authenticated member personally favorited.
 */
router.get('/:eventId/my-favorites', validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;

  const jwt = require('jsonwebtoken');
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const userId = payload.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const evResult = await db.query('SELECT bucket_name FROM events WHERE id = $1', [eventId]);
    if (evResult.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    const { bucket_name } = evResult.rows[0];

    const result = await db.query(
      `SELECT ip.id, ip.rustfs_object_id, ip.has_faces, ip.photo_date, ip.indexed_at,
              ip.uploaded_by, u.display_name AS uploader_name,
              pf.marked_at
       FROM photo_favorites pf
       JOIN indexed_photos ip ON pf.photo_id = ip.id
       LEFT JOIN users u ON ip.uploaded_by = u.id
       WHERE pf.event_id = $1 AND pf.marked_by = $2
       ORDER BY pf.marked_at DESC`,
      [eventId, userId]
    );

    const photos = await Promise.all(result.rows.map(async p => {
      const thumbUrl = await getPresignedUrl(bucket_name, `thumb_${p.rustfs_object_id}`);
      const fullUrl  = await getPresignedUrl(bucket_name, p.rustfs_object_id);
      return { ...p, thumbUrl, fullUrl };
    }));

    res.json({ photos, total: photos.length });
  } catch (err) {
    console.error('[collab] My favorites error:', err.message);
    res.status(500).json({ error: 'Failed to load favorites' });
  }
});

/**
 * POST /collab/:eventId/my-favorites/:photoId
 * Member adds a personal favorite.
 */
router.post('/:eventId/my-favorites/:photoId', validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;

  const jwt = require('jsonwebtoken');
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const userId = payload.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await db.query(
      `INSERT INTO photo_favorites (event_id, photo_id, marked_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, photo_id, marked_by) DO NOTHING`,
      [eventId, photoId, userId]
    );
    res.status(201).json({ favorited: true });
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Photo or event not found' });
    console.error('[collab] Add personal fav error:', err.message);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

/**
 * DELETE /collab/:eventId/my-favorites/:photoId
 * Member removes a personal favorite.
 */
router.delete('/:eventId/my-favorites/:photoId', validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;

  const jwt = require('jsonwebtoken');
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const userId = payload.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await db.query(
      'DELETE FROM photo_favorites WHERE event_id = $1 AND photo_id = $2 AND marked_by = $3',
      [eventId, photoId, userId]
    );
    res.json({ unfavorited: true });
  } catch (err) {
    console.error('[collab] Remove personal fav error:', err.message);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

module.exports = router;
