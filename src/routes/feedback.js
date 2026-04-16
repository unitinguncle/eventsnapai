const express  = require('express');
const router   = express.Router();
const db       = require('../db/client');
const { requireAdmin, extractJwt } = require('../middleware/auth');
const { validateUuid } = require('../middleware/validateUuid');
const { sendMail }     = require('../services/mailer');

/**
 * POST /feedback
 * Submit feedback from any portal.
 * Auth is OPTIONAL — accepts visitor JWT if present, allows anonymous.
 * If a valid JWT is present, user identity is auto-populated.
 *
 * Body: { message, displayName?, contactInfo?, eventId? }
 */
router.post('/', async (req, res) => {
  const { message, displayName, contactInfo, eventId } = req.body;

  if (!message || message.trim().length < 3) {
    return res.status(400).json({ error: 'Message is required (minimum 3 characters)' });
  }

  // Extract identity from JWT if present (visitor, manager, client, or admin)
  const payload = extractJwt(req); // returns null if no valid JWT
  let submittedBy = null;
  let role = 'visitor';
  let resolvedDisplayName = displayName?.trim() || 'Anonymous';
  let resolvedEventId = eventId || null;

  if (payload) {
    submittedBy = payload.userId || null;
    role = payload.role || 'visitor';
    // For visitor role, JWT has eventId not userId
    if (payload.role === 'visitor') {
      submittedBy = null;
      resolvedEventId = resolvedEventId || payload.eventId || null;
    }
    // Try to get display name from DB for authenticated users
    if (submittedBy) {
      try {
        const userRow = await db.query('SELECT display_name FROM users WHERE id = $1', [submittedBy]);
        if (userRow.rows[0]) resolvedDisplayName = userRow.rows[0].display_name;
      } catch(_) {}
    }
  }

  try {
    const result = await db.query(
      `INSERT INTO feedback (submitted_by, role, display_name, contact_info, event_id, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, role, display_name, contact_info, message, created_at`,
      [submittedBy, role, resolvedDisplayName, contactInfo?.trim() || null, resolvedEventId, message.trim()]
    );

    // Get event name for email context if eventId provided
    let eventName = 'None';
    if (resolvedEventId) {
      try {
        const ev = await db.query('SELECT name FROM events WHERE id = $1', [resolvedEventId]);
        if (ev.rows[0]) eventName = ev.rows[0].name;
      } catch(_) {}
    }

    // Send email notification (non-blocking)
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    sendMail({
      to: 'info@raidcloud.in',
      subject: `[Feedback] ${roleLabel} | ${resolvedDisplayName} — EventSnapAI`,
      text: [
        'Type: Feedback / Feature Request',
        `From: ${resolvedDisplayName} (Role: ${roleLabel})`,
        `Contact: ${contactInfo?.trim() || 'Not provided'}`,
        `Event Context: ${eventName}`,
        '',
        'Message:',
        message.trim(),
      ].join('\n'),
    }).catch(err => console.error('[feedback] Email send failed:', err.message));

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Submit feedback error:', err.message);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

/**
 * GET /feedback
 * Admin: list all feedback.
 * Query params: ?unread=true, ?role=manager|user|visitor|admin, ?pinned=true
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { unread, role, pinned } = req.query;
    let where = ['is_discarded = false'];
    const params = [];

    if (unread === 'true') { params.push(true); where.push(`is_read = $${params.length}`); }
    if (pinned === 'true') { params.push(true); where.push(`is_pinned = $${params.length}`); }
    if (['manager','user','visitor','admin'].includes(role)) {
      params.push(role); where.push(`role = $${params.length}`);
    }

    const query = `
      SELECT f.*, e.name AS event_name
      FROM feedback f
      LEFT JOIN events e ON f.event_id = e.id
      WHERE ${where.join(' AND ')}
      ORDER BY is_pinned DESC, created_at DESC
    `;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List feedback error:', err.message);
    res.status(500).json({ error: 'Failed to list feedback' });
  }
});

/**
 * GET /feedback/unread-count
 * Admin: count of unread, non-discarded feedback items.
 */
router.get('/unread-count', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) FROM feedback WHERE is_read = false AND is_discarded = false'
    );
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

/** PATCH /feedback/:id/read */
router.patch('/:id/read', requireAdmin, validateUuid('id'), async (req, res) => {
  try {
    await db.query('UPDATE feedback SET is_read = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to mark read' }); }
});

/** PATCH /feedback/:id/pin */
router.patch('/:id/pin', requireAdmin, validateUuid('id'), async (req, res) => {
  try {
    await db.query('UPDATE feedback SET is_pinned = NOT is_pinned WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to toggle pin' }); }
});

/** PATCH /feedback/:id/discard */
router.patch('/:id/discard', requireAdmin, validateUuid('id'), async (req, res) => {
  try {
    await db.query('UPDATE feedback SET is_discarded = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to discard' }); }
});

module.exports = router;
