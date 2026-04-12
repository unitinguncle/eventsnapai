const express = require('express');
const router = express.Router();
const db = require('../db/client');
const { requireAdmin } = require('../middleware/auth');
const nodemailer = require('nodemailer');

// Set up Nodemailer transporter 
// Assumes standard SMTP settings from environment variables logic, or simply 
// falls back to a sandbox/local config if not configured. 
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * POST /contact
 * Public endpoint to submit a contact request from the landing page.
 */
router.post('/', async (req, res) => {
  const { name, contactInfo, message } = req.body;

  if (!name || !contactInfo || !message) {
    return res.status(400).json({ error: 'Name, email/phone, and message are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO contact_requests (name, contact_info, message)
       VALUES ($1, $2, $3)
       RETURNING id, name, contact_info, message, is_read, created_at`,
      [name.trim(), contactInfo.trim(), message.trim()]
    );

    // Send email asynchronously so it doesn't block the UI response
    const mailOptions = {
      from: '"RaidCloud Contact" <noreply@raidcloud.in>',
      to: 'info@raidcloud.in',
      subject: `New Contact Request from ${name.trim()}`,
      text: `You have received a new contact request from EventSnapAI Landing Page.\n\nName: ${name.trim()}\nContact Info: ${contactInfo.trim()}\n\nMessage:\n${message.trim()}`,
    };

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      transporter.sendMail(mailOptions).catch(err => {
        console.error('[contact] Failed to send email alert:', err.message);
      });
    } else {
      console.warn('[contact] SMTP not configured. Email to info@raidcloud.in was not sent.');
    }

    res.status(201).json({ success: true, request: result.rows[0] });
  } catch (err) {
    console.error('Submit contact request error:', err.message);
    res.status(500).json({ error: 'Failed to submit contact request' });
  }
});

/**
 * GET /contact
 * Admin endpoint to retrieve contact requests. Optionally filter by ?unread=true
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { unread } = req.query;
    let query = 'SELECT * FROM contact_requests ORDER BY created_at DESC';
    if (unread === 'true') {
      query = 'SELECT * FROM contact_requests WHERE is_read = false ORDER BY created_at DESC';
    }
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Get contact requests error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve contact requests' });
  }
});

/**
 * PATCH /contact/:id/read
 * Admin endpoint to mark a request as read.
 */
router.patch('/:id/read', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE contact_requests SET is_read = true WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err.message);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

module.exports = router;
