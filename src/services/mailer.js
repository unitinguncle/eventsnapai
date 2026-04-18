const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify SMTP connectivity on startup (non-blocking).
// Log a clear error if credentials are missing or wrong so it's visible in Docker logs.
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter.verify().then(() => {
    console.log('[mailer] SMTP connection verified OK — emails will be sent');
  }).catch(err => {
    console.error('[mailer] SMTP connection FAILED — emails will NOT be sent:', err.message);
    console.error('[mailer] Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS env vars');
  });
} else {
  console.warn('[mailer] SMTP_USER or SMTP_PASS not set — email sending is DISABLED');
}

/**
 * Send an email. Skips silently if SMTP is not configured.
 * All errors are logged (not silently swallowed) so they appear in Docker logs.
 * @param {object} opts - { to, subject, text, html? }
 */
async function sendMail(opts) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[mailer] Skipping email (SMTP not configured):', opts.subject);
    return;
  }
  try {
    const info = await transporter.sendMail({
      from: '"RaidCloud EventSnapAI" <noreply@raidcloud.in>',
      ...opts,
    });
    console.log('[mailer] Email sent OK:', opts.subject, '→', info.messageId);
  } catch (err) {
    // Throw so the caller can decide how to handle (e.g. log without crashing)
    console.error('[mailer] Failed to send email:', opts.subject, '|', err.message);
    throw err;
  }
}

module.exports = { sendMail };
