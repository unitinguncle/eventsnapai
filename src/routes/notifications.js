const express = require('express');
const router  = require('express').Router();
const db      = require('../db/client');
const { requireAdmin, requireManager, requireUser } = require('../middleware/auth');
const { validateUuid } = require('../middleware/validateUuid');

// Expo push notification SDK (for mobile app push delivery)
let expo = null;
try {
  const { Expo } = require('expo-server-sdk');
  expo = new Expo();
} catch {
  console.warn('[notifications] expo-server-sdk not installed — push notifications disabled. Run: npm install expo-server-sdk');
}

/**
 * POST /notifications
 * Admin sends a notification to a specific user OR broadcasts to a role.
 * Body: { title, body, recipientId?, recipientRole? }
 *   - recipientId set → targeted to that user
 *   - recipientRole set (no recipientId) → broadcast to all of that role
 *   - neither → error
 */
router.post('/', requireAdmin, async (req, res) => {
  const { title, body, recipientId, recipientRole } = req.body;
  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Title and body are required' });
  }
  if (!recipientId && !recipientRole) {
    return res.status(400).json({ error: 'Either recipientId or recipientRole is required' });
  }
  if (recipientRole && !['manager','user'].includes(recipientRole)) {
    return res.status(400).json({ error: 'recipientRole must be manager or user' });
  }

  const senderId = req.user?.userId || null; // null for legacy x-admin-key

  try {
    const result = await db.query(
      `INSERT INTO notifications (recipient_id, recipient_role, sender_id, title, body)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [recipientId || null, recipientId ? null : recipientRole, senderId, title.trim(), body.trim()]
    );

    // ── Expo push notification dispatch (non-blocking) ────────────────────────
    // Fires AFTER the DB insert so the in-app notification always exists,
    // even if the push delivery fails.
    if (expo) {
      (async () => {
        try {
          let pushTokens = [];
          if (recipientId) {
            const r = await db.query(
              'SELECT expo_push_token FROM users WHERE id = $1 AND expo_push_token IS NOT NULL AND is_active = true',
              [recipientId]
            );
            if (r.rows[0]?.expo_push_token) pushTokens.push(r.rows[0].expo_push_token);
          } else if (recipientRole) {
            const r = await db.query(
              'SELECT expo_push_token FROM users WHERE role = $1 AND expo_push_token IS NOT NULL AND is_active = true',
              [recipientRole]
            );
            pushTokens = r.rows.map(row => row.expo_push_token);
          }

          const { Expo } = require('expo-server-sdk');
          const validTokens = pushTokens.filter(t => Expo.isExpoPushToken(t));
          if (validTokens.length > 0) {
            const messages = validTokens.map(to => ({
              to,
              sound: 'default',
              title: title.trim(),
              body: body.trim(),
              data: {
                notificationType: 'admin_notification',
                notificationId: result.rows[0].id,
              },
              priority: 'high',
            }));
            const chunks = expo.chunkPushNotifications(messages);
            for (const chunk of chunks) {
              await expo.sendPushNotificationsAsync(chunk);
            }
            console.log(`[push] Sent to ${validTokens.length} device(s)`);
          }
        } catch (pushErr) {
          // Non-fatal: DB notification is already persisted
          console.warn('[push] Push dispatch error:', pushErr.message);
        }
      })();
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Recipient user not found' });
    console.error('Send notification error:', err.message);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

/**
 * GET /notifications/my
 * Returns notifications for the current user:
 *  - Where recipient_id = user's ID (direct)
 *  - OR where recipient_id IS NULL AND recipient_role = user's role (broadcast)
 * Excludes discarded items.
 */
router.get('/my', requireUser, async (req, res) => {
  const userId = req.user?.userId;
  const userRole = req.userRole;
  try {
    const result = await db.query(
      `SELECT n.*, u.display_name AS sender_name
       FROM notifications n
       LEFT JOIN users u ON n.sender_id = u.id
       WHERE n.is_discarded = false
       AND (
         n.recipient_id = $1
         OR (n.recipient_id IS NULL AND n.recipient_role = $2)
       )
       ORDER BY n.is_pinned DESC, n.created_at DESC
       LIMIT 100`,
      [userId, userRole]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get my notifications error:', err.message);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

/**
 * GET /notifications/my/unread-count
 * Count of unread non-discarded notifications for current user.
 */
router.get('/my/unread-count', requireUser, async (req, res) => {
  const userId = req.user?.userId;
  const userRole = req.userRole;
  try {
    const result = await db.query(
      `SELECT COUNT(*) FROM notifications
       WHERE is_read = false AND is_discarded = false
       AND (recipient_id = $1 OR (recipient_id IS NULL AND recipient_role = $2))`,
      [userId, userRole]
    );
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

/** PATCH /notifications/:id/read — mark a specific notification as read */
router.patch('/:id/read', requireUser, validateUuid('id'), async (req, res) => {
  const userId = req.user?.userId;
  const userRole = req.userRole;
  try {
    await db.query(
      `UPDATE notifications SET is_read = true WHERE id = $1
       AND (recipient_id = $2 OR (recipient_id IS NULL AND recipient_role = $3))`,
      [req.params.id, userId, userRole]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to mark read' }); }
});

/** PATCH /notifications/:id/pin */
router.patch('/:id/pin', requireUser, validateUuid('id'), async (req, res) => {
  const userId = req.user?.userId;
  const userRole = req.userRole;
  try {
    await db.query(
      `UPDATE notifications SET is_pinned = NOT is_pinned WHERE id = $1
       AND (recipient_id = $2 OR (recipient_id IS NULL AND recipient_role = $3))`,
      [req.params.id, userId, userRole]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to toggle pin' }); }
});

/** PATCH /notifications/:id/discard */
router.patch('/:id/discard', requireUser, validateUuid('id'), async (req, res) => {
  const userId = req.user?.userId;
  const userRole = req.userRole;
  try {
    await db.query(
      `UPDATE notifications SET is_discarded = true WHERE id = $1
       AND (recipient_id = $2 OR (recipient_id IS NULL AND recipient_role = $3))`,
      [req.params.id, userId, userRole]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to discard' }); }
});

/** GET /notifications/sent — admin view of sent notifications */
router.get('/sent', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT n.*, u.display_name AS recipient_name
       FROM notifications n
       LEFT JOIN users u ON n.recipient_id = u.id
       ORDER BY n.created_at DESC LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to get sent notifications' }); }
});

module.exports = router;
