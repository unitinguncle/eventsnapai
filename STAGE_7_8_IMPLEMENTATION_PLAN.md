# EventSnapAI — Full Implementation Plan
## Stage 7 (Features 1 & 2 + Bug Fixes) + Stage 8 (Features 3 & 4)

**Repo**: https://github.com/unitinguncle/eventsnapai  
**Working branch**: `upcoming-changes`  
**Last hardened code**: Stages 6.0–6.4 (production-deployed)  
**Author**: Written for hand-off — sufficient detail for any AI agent to implement without additional context.

---

## PROJECT CONTEXT (Read Before Coding Anything)

### Technology Stack
- **Backend**: Node.js 20, Express.js, PostgreSQL via `pg` pool
- **Auth**: JWT (`jsonwebtoken`) + static `x-admin-key` (legacy admin path)
- **Storage**: RustFS (S3-compatible), AWS SDK v3
- **Face Recognition**: CompreFace REST API
- **Email**: nodemailer via SMTP (env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`)
- **Container**: Docker, deployed via Portainer, proxy chain: Browser → Cloudflare → NPM → App
- **Database**: PostgreSQL in `compreface-postgres-db` container, `frs` database

### File Structure (post Stage 6.4)
```
src/
  app.js              — Express setup, middleware, routing
  server.js           — listen + graceful shutdown (SIGTERM/SIGINT)
  state.js            — singleton: { isShuttingDown: false }
  db/
    client.js         — pg Pool (use this everywhere, never new pg.Client)
    schema.sql        — idempotent schema (CREATE IF NOT EXISTS + ALTER guards)
    seed.js           — admin user bootstrap on first boot
  middleware/
    auth.js           — requireAdmin / requireManager / requireUser / requireVisitor / issueVisitorToken / extractJwt
    validateUuid.js   — validateUuid(...paramNames) middleware
  routes/
    auth.js           — POST /auth/login, GET /auth/me
    events.js         — event CRUD, manager-delete, token issuance
    upload.js         — photo upload with face indexing (multer)
    photos.js         — photo listing, delete
    search.js         — selfie search (visitor flow)
    favorites.js      — photo favorites (manager + client, shared)
    users.js          — user CRUD + event access grants
    contact.js        — contact form (public POST, admin GET/PATCH)
    diagnostics.js    — CompreFace + RustFS health check
  services/
    rustfs.js         — ensureBucket, uploadImage, deleteObject, getPresignedUrl (pooled S3 client)
    compreface.js     — detectFaces, indexOneFace, searchByFace, deleteSubjectFaces

public/
  admin/index.html    — Admin SPA (vanilla JS, sessionStorage for x-admin-key + authToken)
  manager/index.html  — Manager SPA (vanilla JS, sessionStorage authToken)
  client/index.html   — Client SPA (vanilla JS, sessionStorage authToken)
  visitor/index.html  — Visitor SPA (vanilla JS, sessionStorage token)
  landing/index.html  — Public landing page + contact form
  assets/             — Shared static assets (logos, etc.)
```

### Established Patterns (MUST FOLLOW)
1. **Every new route file**: import `db` from `../db/client`, use `requireAdmin`/`requireManager`/`requireUser` from `../middleware/auth`, apply `validateUuid()` to all UUID route params
2. **Every new route registered in app.js**: add a dedicated rate limiter if the endpoint is public or user-facing
3. **Email**: copy the nodemailer transporter pattern from `src/routes/contact.js` — do NOT create a second SMTP transporter module. Instead, extract it to `src/services/mailer.js` (shared singleton, see Stage 7)
4. **Schema changes**: add columns to both `CREATE TABLE` definition AND `ALTER TABLE ADD COLUMN IF NOT EXISTS` upgrade guard in `schema.sql`
5. **Frontend auth**: manager and client use `sessionStorage.getItem('authToken')`, admin uses `sessionStorage.getItem('adminKey')` (static key) + `sessionStorage.getItem('authToken')` (JWT — if admin logs in via /auth/login)

### Auth Architecture (Critical to Understand)
- **Admin**: Can authenticate via EITHER static `x-admin-key` header OR JWT. Most admin panel code uses `x-admin-key`. JWT is supported as a secondary path.
- **Manager/Client**: JWT only, stored in `sessionStorage` as `authToken`
- **Visitor**: Short-lived JWT (6h) issued by `GET /events/:eventId/token`
- The `api()` function in: **admin** uses `x-admin-key` header | **manager/client** uses `Authorization: Bearer ${authToken}`
- The 401/403 handling in manager/client: already has `ACCESS_REVOKED` detection → `showAccessRevoked()`. Plain 401 (expired JWT) currently does NOT trigger a custom popup — it falls through and shows generic "Failed to load" errors.

---

## ══════════════════════════════════════════════
## STAGE 7 — Communication Layer + Bug Fixes
## ══════════════════════════════════════════════

**Deploy order**: Bug fixes first (7-BugFix), then 7A (Feedback), then 7B (Notifications)
**DB Migration Required**: Yes — 2 new tables before deploying

---

## STAGE 7-BUGFIX — Three Critical Bug Fixes

These must be fixed in this stage before adding new features. They affect production right now.

---

### BUG 1: Contact-us "Failed to load contacts" After Mark Read

**Root Cause**: In `public/admin/index.html`, the `loadContacts()` function:
```javascript
async function loadContacts() {
  try {
    const r = await api('/contact');
    // BUG: no r.ok check here — if r.ok is false, data is an error object
    const data = await r.json();
    // data.filter() crashes if data is { error: '...' } instead of an array
    const unread = data.filter(c => !c.is_read).length;
    ...
  } catch(err) {
    tbody.innerHTML = '<tr><td ...>Failed to load contacts</td></tr>';  // shows this on crash
  }
}
```
The admin `api()` function sends `x-admin-key` — it should never 401. But if the key is somehow missing or invalid (edge case on reload), the response is `{ error: '...' }` not an array, and `.filter()` throws, going to catch.

**Fix**: Add `r.ok` check in `loadContacts()` before calling `r.json()`.

**File to modify**: `public/admin/index.html`

**Exact change** — find `loadContacts()` function and replace with:
```javascript
async function loadContacts() {
  const tbody = document.getElementById('contacts-tbody');
  const empty = document.getElementById('contacts-empty');
  try {
    const r = await api('/contact');
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--err)">
        Failed to load contacts: ${err.error || r.status}
      </td></tr>`;
      return;
    }
    const data = await r.json();
    if (!data || !Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    const unread = data.filter(c => !c.is_read).length;
    if (unread > 0 && !sessionStorage.getItem('contactAlertShown')) {
      document.getElementById('custom-alert-msg').textContent =
        `You have ${unread} unread contact request(s) waiting for you.`;
      document.getElementById('custom-alert-modal').classList.add('open');
      sessionStorage.setItem('contactAlertShown', 'true');
    }
    // Update tab badge with unread count
    const contactTab = document.getElementById('nav-contacts');
    if (contactTab) {
      contactTab.textContent = unread > 0
        ? `Contact us forms (${unread})`
        : 'Contact us forms';
      contactTab.style.color = unread > 0 ? 'var(--err, #ef4444)' : '';
    }
    tbody.innerHTML = data.map(c => `
      <tr class="${c.is_read ? '' : 'unread-row'}" style="${c.is_read ? '' : 'background:rgba(99,102,241,0.06);'}">
        <td>${esc(c.name)}</td>
        <td>${esc(c.contact_info)}</td>
        <td style="max-width:300px;white-space:pre-wrap">${esc(c.message)}</td>
        <td style="font-size:12px;color:var(--hint)">${new Date(c.created_at).toLocaleString('en-IN')}</td>
        <td>
          ${c.is_read
            ? `<span style="color:var(--ok,#22c55e);font-size:12px">✓ Read</span>`
            : `<button class="btn btn-sm btn-primary" onclick="markContactRead('${c.id}')">Mark Read</button>`}
        </td>
      </tr>
    `).join('');
  } catch(err) {
    console.error('loadContacts error:', err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--err)">
      Failed to load contacts. Please refresh.
    </td></tr>`;
  }
}
```

**Rename the nav tab**: Find `id="nav-contacts"` in the HTML and change its initial text content from `"Contacts"` to `"Contact us forms"`.

**Unread count badge on tab**: The fix above updates the tab text with count. Additionally, on admin login, call `loadContacts()` as part of `verifyAndLoad()` so the tab badge is set immediately on page load.

---

### BUG 2: Session Expiry — "Failed to load event" Instead of Custom Popup

**Root Cause**: In manager and client portals, the `api()` function already handles `ACCESS_REVOKED` (403) with `showAccessRevoked()`. But for plain `401` (JWT expired), it re-wraps the response and returns it without throwing. Callers then call `.json()` on the re-wrapped response, get `{ error: 'Unauthorized...' }`, and the catch block shows "Failed to load events" — a generic unhelpful banner.

**Fix**: In both `public/manager/index.html` and `public/client/index.html`, modify the `api()` function so that **plain 401 also triggers a friendly session-expired modal** instead of being silently swallowed.

Also, the page must handle the initial load case: if `authToken` in sessionStorage has expired, and the user refreshes, the first API call returns 401 → should show "session expired" modal with a "Go to Login" button, not "Failed to load events".

**Files to modify**: `public/manager/index.html`, `public/client/index.html`

**New shared modal to add to HTML** (add once near bottom of `<body>`):
```html
<!-- Session Expired Modal -->
<div id="session-expired-modal" style="
  display:none; position:fixed; inset:0; z-index:99999;
  background:rgba(0,0,0,0.7); align-items:center; justify-content:center;
">
  <div style="
    background:var(--surface,#1e1e2e); border-radius:16px; padding:32px 40px;
    max-width:400px; text-align:center; box-shadow:0 8px 40px rgba(0,0,0,0.5);
  ">
    <div style="font-size:48px;margin-bottom:12px">⏱️</div>
    <h2 style="margin:0 0 8px;color:var(--text,#fff)">Session Expired</h2>
    <p style="color:var(--hint,#94a3b8);margin:0 0 24px">
      Your session has expired due to inactivity. Please log in again to continue.
    </p>
    <button onclick="window.location.href='/landing'" style="
      background:var(--accent,#6366f1); color:#fff; border:none;
      padding:12px 28px; border-radius:8px; font-size:15px; cursor:pointer;
    ">Go to Login</button>
  </div>
</div>
```

**Function to show it** (add to JS section):
```javascript
function showSessionExpired() {
  const m = document.getElementById('session-expired-modal');
  if (m) { m.style.display = 'flex'; }
  // Clear stored tokens so auto-restore doesn't loop
  sessionStorage.removeItem('authToken');
  sessionStorage.removeItem('authUser');
}
```

**Modify the `api()` function** — change the 401 handling block:
```javascript
// BEFORE (current — only handles ACCESS_REVOKED, lets plain 401 fall through):
if (r.status === 401 || r.status === 403) {
  let body = null;
  try { body = await r.json(); } catch(_){}
  if (body?.error === 'ACCESS_REVOKED') { showAccessRevoked(); throw new Error('ACCESS_REVOKED'); }
  const patched = new Response(JSON.stringify(body), { status: r.status, headers: r.headers });
  return patched;
}

// AFTER (fix — 401 shows session-expired modal, 403 ACCESS_REVOKED shows revoked modal):
if (r.status === 401 || r.status === 403) {
  let body = null;
  try { body = await r.json(); } catch(_){}
  if (r.status === 403 && body?.error === 'ACCESS_REVOKED') {
    showAccessRevoked();
    throw new Error('ACCESS_REVOKED');
  }
  if (r.status === 401) {
    showSessionExpired();
    throw new Error('SESSION_EXPIRED');
  }
  // 403 non-ACCESS_REVOKED: return patched for caller to handle
  return new Response(JSON.stringify(body), { status: r.status, headers: r.headers });
}
```

**Update all catch blocks** in manager and client to also suppress `SESSION_EXPIRED`:
```javascript
// All catches that currently have:
if(e.message !== 'ACCESS_REVOKED') showBanner('Failed to load events', 'err');
// Should become:
if(e.message !== 'ACCESS_REVOKED' && e.message !== 'SESSION_EXPIRED') showBanner('Failed to load events', 'err');
```
Do this search-and-replace across both files.

---

### BUG 3: Admin Never Gets Logged Out (No Inactivity Timeout)

**Root Cause**: Admin uses `sessionStorage.getItem('adminKey')` which is a static string (the `ADMIN_API_KEY` env var). `sessionStorage` clears when the browser tab is closed, but NOT after idle time. The admin panel has no inactivity timer.

**Note**: Even if admin uses JWT (`authToken`), the JWT has a fixed expiry but there is no check that re-validates the token on page focus or after idle time.

**Fix**: Add an inactivity timeout to the admin panel. After 4 hours of no interaction (mouse move, keypress, click), show a session-expired modal and clear the admin key.

**File to modify**: `public/admin/index.html`

**Add to JS section**:
```javascript
// ── Admin Inactivity Timeout ──────────────────────────────────────────
// Auto-logout admin after 4 hours of inactivity.
// Resets on any user interaction.
const ADMIN_IDLE_MS = 4 * 60 * 60 * 1000; // 4 hours
let adminIdleTimer = null;

function resetAdminIdleTimer() {
  clearTimeout(adminIdleTimer);
  adminIdleTimer = setTimeout(adminIdleLogout, ADMIN_IDLE_MS);
}

function adminIdleLogout() {
  // Show friendly modal before clearing credentials
  const modal = document.getElementById('admin-session-expired-modal');
  if (modal) modal.style.display = 'flex';
  // Clear credentials
  adminKey = '';
  sessionStorage.removeItem('adminKey');
  sessionStorage.removeItem('authToken');
  sessionStorage.removeItem('authUser');
}

// Start timer when admin authenticates
function startAdminIdleTimer() {
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(evt =>
    document.addEventListener(evt, resetAdminIdleTimer, { passive: true })
  );
  resetAdminIdleTimer();
}
```

**Add the session-expired modal to admin HTML** (same style as manager/client):
```html
<!-- Admin Session Expired Modal -->
<div id="admin-session-expired-modal" style="
  display:none; position:fixed; inset:0; z-index:99999;
  background:rgba(0,0,0,0.7); align-items:center; justify-content:center;
">
  <div style="
    background:var(--surface,#1e1e2e); border-radius:16px; padding:32px 40px;
    max-width:400px; text-align:center; box-shadow:0 8px 40px rgba(0,0,0,0.5);
  ">
    <div style="font-size:48px;margin-bottom:12px">🔒</div>
    <h2 style="margin:0 0 8px;color:var(--text,#fff)">Admin Session Expired</h2>
    <p style="color:var(--hint,#94a3b8);margin:0 0 24px">
      Your admin session has expired after 4 hours of inactivity for security.
    </p>
    <button onclick="window.location.href='/landing'" style="
      background:var(--accent,#6366f1); color:#fff; border:none;
      padding:12px 28px; border-radius:8px; font-size:15px; cursor:pointer;
    ">Return to Login</button>
  </div>
</div>
```

**Call `startAdminIdleTimer()`** at the end of `verifyAndLoad()` after the admin is authenticated.

---

## STAGE 7A — Feature 1: Feedback System

### Overview
A floating feedback widget on all 4 portals (admin, manager, client, visitor). Submissions save to DB, email `info@raidcloud.in` with a distinct `[Feedback]` subject, and appear in the admin's dedicated Feedback panel (a new tab, separate from Contact Us).

---

### Step 1: Extract Shared Email Service

**Create**: `src/services/mailer.js`

```javascript
// src/services/mailer.js
// Shared nodemailer transporter singleton.
// Used by contact.js, feedback.js (and any future email-sending routes).
// All SMTP config comes from environment variables — no hardcoded values.
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT, 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send an email. Skips silently if SMTP is not configured.
 * @param {object} opts - { to, subject, text, html? }
 */
async function sendMail(opts) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[mailer] SMTP not configured — email not sent:', opts.subject);
    return;
  }
  await transporter.sendMail({
    from: '"RaidCloud EventSnapAI" <noreply@raidcloud.in>',
    ...opts,
  });
}

module.exports = { sendMail };
```

**Modify `src/routes/contact.js`**: Replace the inline `nodemailer.createTransport(...)` with `const { sendMail } = require('../services/mailer')` and use `sendMail({...})` instead of `transporter.sendMail({...})`.

---

### Step 2: DB Schema for Feedback

**Add to `src/db/schema.sql`** (in the CREATE TABLE section AND add the upgrade guard):
```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Feedback (from manager, client, and visitor portals via floating widget)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS feedback (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  role         TEXT        NOT NULL CHECK (role IN ('manager','user','visitor','admin')),
  display_name TEXT,
  contact_info TEXT,
  event_id     UUID        REFERENCES events(id) ON DELETE SET NULL,
  message      TEXT        NOT NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT false,
  is_pinned    BOOLEAN     NOT NULL DEFAULT false,
  is_discarded BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_role    ON feedback(role);
CREATE INDEX IF NOT EXISTS idx_feedback_is_read ON feedback(is_read);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
```

---

### Step 3: Backend — `src/routes/feedback.js`

**Create this file**:

```javascript
const express  = require('express');
const router   = express.Router();
const db       = require('../db/client');
const { requireAdmin, extractJwt } = require('../middleware/auth');
// NOTE: extractJwt must be exported from auth.js — add to module.exports if not already there
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
```

**Important**: `extractJwt` must be added to `module.exports` in `src/middleware/auth.js`:
```javascript
// Add extractJwt to the exports at bottom of auth.js
module.exports = {
  requireAdmin,
  requireManager,
  requireUser,
  requireVisitor,
  issueVisitorToken,
  extractJwt,   // ADD THIS
};
```

---

### Step 4: Register in `src/app.js`

```javascript
const feedbackRouter = require('./routes/feedback');

// Add rate limiter (near other limiters):
const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many feedback submissions — please wait before trying again' },
});

// Register route (below generalLimiter):
app.use('/feedback', feedbackLimiter, feedbackRouter);
```

---

### Step 5: Shared Feedback Widget (`public/assets/feedback-widget.js` + `.css`)

**`public/assets/feedback-widget.css`**:
```css
/* EventSnapAI Feedback Widget */
#ef-btn {
  position: fixed; bottom: 24px; right: 24px; z-index: 9998;
  width: 48px; height: 48px; border-radius: 50%; border: none;
  background: rgba(99, 102, 241, 0.7); /* indigo, matches app accent */
  color: #fff; font-size: 20px; cursor: pointer;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  opacity: 0.45; transition: opacity 0.2s, transform 0.2s;
  display: flex; align-items: center; justify-content: center;
}
#ef-btn:hover { opacity: 1; transform: scale(1.08); }

#ef-modal-overlay {
  display: none; position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.55); align-items: center; justify-content: center;
}
#ef-modal-overlay.open { display: flex; }

#ef-modal {
  background: var(--surface, #1e1e2e); border-radius: 16px;
  padding: 28px 32px; width: 100%; max-width: 440px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.5);
}
#ef-modal h3 { margin: 0 0 6px; font-size: 18px; color: var(--text, #fff); }
#ef-modal p { margin: 0 0 18px; font-size: 13px; color: var(--hint, #94a3b8); }
#ef-modal label { display: block; font-size: 13px; color: var(--hint, #94a3b8); margin-bottom: 4px; }
#ef-modal input, #ef-modal textarea {
  width: 100%; box-sizing: border-box;
  background: var(--bg, #13131f); border: 1px solid var(--border, #2d2d44);
  border-radius: 8px; padding: 10px 12px; color: var(--text, #fff); font-size: 14px;
  margin-bottom: 14px; outline: none;
}
#ef-modal textarea { height: 100px; resize: vertical; }
#ef-modal input:focus, #ef-modal textarea:focus { border-color: var(--accent, #6366f1); }
#ef-modal-footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
#ef-cancel-btn {
  background: transparent; border: 1px solid var(--border, #2d2d44);
  color: var(--hint, #94a3b8); border-radius: 8px; padding: 9px 18px; cursor: pointer;
}
#ef-submit-btn {
  background: var(--accent, #6366f1); color: #fff; border: none;
  border-radius: 8px; padding: 9px 18px; cursor: pointer; font-size: 14px;
}
#ef-success { display:none; text-align:center; padding: 12px 0; }
#ef-success .ef-tick { font-size: 40px; }
#ef-success p { color: var(--hint, #94a3b8); font-size: 14px; margin: 8px 0 0; }
```

**`public/assets/feedback-widget.js`**:
```javascript
// EventSnapAI Feedback Widget — include on every portal
// Reads authToken from sessionStorage if available (managers/clients/admin)
// Sends feedback to POST /feedback

(function() {
  // Inject CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/assets/feedback-widget.css';
  document.head.appendChild(link);

  // Inject HTML
  document.body.insertAdjacentHTML('beforeend', `
    <button id="ef-btn" title="Send Feedback" aria-label="Open feedback form">💬</button>
    <div id="ef-modal-overlay" role="dialog" aria-modal="true">
      <div id="ef-modal">
        <h3>Send Feedback</h3>
        <p>Share your thoughts, suggestions, or report an issue. We read every message.</p>
        <div id="ef-form-body">
          <label for="ef-name">Your name</label>
          <input id="ef-name" type="text" placeholder="Your name" maxlength="100">
          <label for="ef-contact">Phone or email (optional)</label>
          <input id="ef-contact" type="text" placeholder="How can we reach you?" maxlength="200">
          <label for="ef-message">Message <span style="color:var(--err,#ef4444)">*</span></label>
          <textarea id="ef-msg" placeholder="What's on your mind?" maxlength="2000"></textarea>
        </div>
        <div id="ef-success">
          <div class="ef-tick">✅</div>
          <p>Thank you! Your feedback has been received.</p>
        </div>
        <div id="ef-modal-footer">
          <button id="ef-cancel-btn">Cancel</button>
          <button id="ef-submit-btn">Send Feedback</button>
        </div>
      </div>
    </div>
  `);

  const btn     = document.getElementById('ef-btn');
  const overlay = document.getElementById('ef-modal-overlay');
  const cancelBtn  = document.getElementById('ef-cancel-btn');
  const submitBtn  = document.getElementById('ef-submit-btn');
  const nameInput  = document.getElementById('ef-name');
  const contactInput = document.getElementById('ef-contact');
  const msgInput   = document.getElementById('ef-msg');
  const formBody   = document.getElementById('ef-form-body');
  const successDiv = document.getElementById('ef-success');

  // Pre-fill name from stored user info
  function prefillUser() {
    try {
      const userStr = sessionStorage.getItem('authUser');
      const user = userStr ? JSON.parse(userStr) : null;
      if (user && user.displayName) {
        nameInput.value = user.displayName;
        nameInput.readOnly = true;
        nameInput.style.opacity = '0.6';
      }
    } catch(_) {}
  }

  function openModal() {
    prefillUser();
    overlay.classList.add('open');
    formBody.style.display = 'block';
    successDiv.style.display = 'none';
    msgInput.focus();
  }

  function closeModal() {
    overlay.classList.remove('open');
    msgInput.value = '';
    contactInput.value = '';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Feedback';
  }

  btn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  submitBtn.addEventListener('click', async () => {
    const message = msgInput.value.trim();
    if (!message) { msgInput.style.border = '1px solid var(--err,#ef4444)'; return; }
    msgInput.style.border = '';

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const token = sessionStorage.getItem('authToken');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Get current event context if available (visitor has it in URL hash)
    const eventId = (() => {
      const hash = window.location.hash.replace('#', '');
      // If hash looks like a UUID, use it
      if (/^[0-9a-f-]{36}$/.test(hash)) return hash;
      // Or check global currentEvent variable
      try { return window.currentEvent?.id || null; } catch(_) { return null; }
    })();

    try {
      const r = await fetch('/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          displayName: nameInput.value.trim() || undefined,
          contactInfo: contactInput.value.trim() || undefined,
          eventId: eventId || undefined,
        }),
      });
      if (r.ok) {
        formBody.style.display = 'none';
        document.getElementById('ef-modal-footer').style.display = 'none';
        successDiv.style.display = 'block';
        setTimeout(() => {
          document.getElementById('ef-modal-footer').style.display = 'flex';
          closeModal();
        }, 2500);
      } else {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Feedback';
        alert('Failed to send feedback. Please try again.');
      }
    } catch(_) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Feedback';
      alert('Network error. Please check your connection and try again.');
    }
  });
})();
```

**Add to ALL portal HTML files** (before closing `</body>`):
```html
<script src="/assets/feedback-widget.js"></script>
```

Add to: `public/admin/index.html`, `public/manager/index.html`, `public/client/index.html`, `public/visitor/index.html`

---

### Step 6: Admin Feedback Panel

**In `public/admin/index.html`**, add a "Feedback" navigation tab and a new section panel.

**Add to top nav** (beside "Contact us forms" button):
```html
<button class="top-nav-btn" id="nav-feedback" onclick="switchSection('feedback')">Feedback</button>
```

**Add section div** (beside section-contacts div):
```html
<div id="section-feedback" style="display:none">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
    <h2 style="margin:0">Feedback & Requests</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <select id="feedback-role-filter" onchange="loadFeedback()" style="padding:6px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border);color:var(--text)">
        <option value="">All Roles</option>
        <option value="manager">Manager</option>
        <option value="user">Client</option>
        <option value="visitor">Visitor</option>
        <option value="admin">Admin</option>
      </select>
      <select id="feedback-status-filter" onchange="loadFeedback()" style="padding:6px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border);color:var(--text)">
        <option value="">All</option>
        <option value="unread">Unread</option>
        <option value="pinned">Pinned</option>
      </select>
    </div>
  </div>
  <table class="table" style="width:100%">
    <thead>
      <tr>
        <th>Role</th><th>From</th><th>Contact</th>
        <th>Event</th><th>Message</th><th>Time</th><th>Actions</th>
      </tr>
    </thead>
    <tbody id="feedback-tbody"></tbody>
  </table>
  <div id="feedback-empty" class="empty" style="display:none">
    <div class="empty-title">No feedback received yet</div>
  </div>
</div>
```

**Add JS function `loadFeedback()` and `discardFeedback()`, `pinFeedback()`, `markFeedbackRead()`**:
```javascript
async function loadFeedback() {
  const tbody  = document.getElementById('feedback-tbody');
  const empty  = document.getElementById('feedback-empty');
  const role   = document.getElementById('feedback-role-filter')?.value || '';
  const status = document.getElementById('feedback-status-filter')?.value || '';
  try {
    let url = '/feedback?';
    if (role)            url += `role=${encodeURIComponent(role)}&`;
    if (status==='unread') url += 'unread=true&';
    if (status==='pinned') url += 'pinned=true&';
    const r = await api(url.replace(/&$/, ''));
    if (!r.ok) { tbody.innerHTML = '<tr><td colspan="7" style="color:var(--err);text-align:center">Failed to load</td></tr>'; return; }
    const data = await r.json();

    // Update tab badge
    const countR = await api('/feedback/unread-count');
    if (countR.ok) {
      const { count } = await countR.json();
      const tab = document.getElementById('nav-feedback');
      if (tab) { tab.textContent = count > 0 ? `Feedback (${count})` : 'Feedback'; tab.style.color = count > 0 ? 'var(--err)' : ''; }
    }

    if (!data.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const roleColors = { manager: '#6366f1', user: '#22c55e', visitor: '#f59e0b', admin: '#ef4444' };
    tbody.innerHTML = data.map(f => `
      <tr style="${f.is_read ? '' : 'background:rgba(99,102,241,0.06)'}${f.is_pinned ? ';border-left:3px solid #f59e0b' : ''}">
        <td><span style="
          display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;
          background:${roleColors[f.role]||'#6366f1'}22;color:${roleColors[f.role]||'#6366f1'}">
          ${f.role.toUpperCase()}
        </span></td>
        <td>${esc(f.display_name||'Anonymous')}</td>
        <td style="font-size:12px">${f.contact_info ? esc(f.contact_info) : '<span style="color:var(--hint)">—</span>'}</td>
        <td style="font-size:12px">${f.event_name ? esc(f.event_name) : '<span style="color:var(--hint)">—</span>'}</td>
        <td style="max-width:300px;white-space:pre-wrap;font-size:13px">${esc(f.message)}</td>
        <td style="font-size:11px;color:var(--hint)">${new Date(f.created_at).toLocaleString('en-IN')}</td>
        <td style="white-space:nowrap">
          ${f.is_read ? '<span style="color:var(--ok,#22c55e);font-size:11px">✓ Read</span>' : `<button class="btn btn-sm btn-primary" onclick="markFeedbackRead('${f.id}')">Mark Read</button>`}
          <button class="btn btn-sm" onclick="pinFeedback('${f.id}')" title="${f.is_pinned?'Unpin':'Pin'}">${f.is_pinned?'📌':'📍'}</button>
          <button class="btn btn-sm" onclick="discardFeedback('${f.id}')" title="Discard" style="color:var(--err)">✕</button>
        </td>
      </tr>
    `).join('');
  } catch(e) { console.error('loadFeedback error:', e); }
}

async function markFeedbackRead(id) {
  await api(`/feedback/${id}/read`, { method: 'PATCH' });
  loadFeedback();
}
async function pinFeedback(id) {
  await api(`/feedback/${id}/pin`, { method: 'PATCH' });
  loadFeedback();
}
async function discardFeedback(id) {
  if (!confirm('Discard this feedback? It will be removed from the list.')) return;
  await api(`/feedback/${id}/discard`, { method: 'PATCH' });
  loadFeedback();
}
```

**Modify `switchSection()`** to add `'feedback'` case.

---

## STAGE 7B — Feature 2: Notification System

### Step 1: DB Schema for Notifications

**Add to `src/db/schema.sql`**:
```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Notifications (admin to manager/user one-way push)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID        REFERENCES users(id) ON DELETE CASCADE,
  recipient_role TEXT       CHECK (recipient_role IN ('manager','user')),
  sender_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  is_read       BOOLEAN     NOT NULL DEFAULT false,
  is_pinned     BOOLEAN     NOT NULL DEFAULT false,
  is_discarded  BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- recipient_id NULL + recipient_role set = broadcast to all of that role
-- recipient_id set = targeted to specific user
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread    ON notifications(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_role      ON notifications(recipient_role, is_read);
```

### Step 2: Backend — `src/routes/notifications.js`

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db/client');
const { requireAdmin, requireManager, requireUser } = require('../middleware/auth');
const { validateUuid } = require('../middleware/validateUuid');

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
```

**Register in `src/app.js`**:
```javascript
const notificationsRouter = require('./routes/notifications');
app.use('/notifications', notificationsRouter);
```

No extra rate limiter needed — covered by generalLimiter. The polling is 30s so 120 requests/min limit never triggers for notifications.

---

### Step 3: Admin Notification Composer Panel

**In `public/admin/index.html`**, add a "Send Notification" button/tab in the notification panel (alongside Contact Us Forms and Feedback panels). This requires adding:

1. A bell icon 🔔 button in the top nav bar beside the logout button
2. A slide-over panel or top-level section for notifications

**Bell icon in top bar** (add beside logout button):
```html
<button id="admin-bell-btn" onclick="toggleAdminNotifPanel()" style="
  background:none; border:none; cursor:pointer; position:relative;
  color:var(--text); font-size:20px; padding:4px 8px;
" title="Notifications">
  🔔
  <span id="admin-notif-badge" style="
    display:none; position:absolute; top:0; right:0;
    width:8px; height:8px; border-radius:50%; background:#ef4444;
  "></span>
</button>
```

**Poll for unread counts** on a 60-second interval after login:
```javascript
let adminBellInterval = null;

async function pollAdminUnread() {
  try {
    const [fbR, ctR] = await Promise.all([
      api('/feedback/unread-count'),
      api('/contact?unread=true'),
    ]);
    let total = 0;
    if (fbR.ok) { const d = await fbR.json(); total += d.count || 0; }
    if (ctR.ok) { const d = await ctR.json(); total += (Array.isArray(d) ? d.filter(c=>!c.is_read).length : 0); }
    const badge = document.getElementById('admin-notif-badge');
    if (badge) badge.style.display = total > 0 ? 'block' : 'none';
  } catch(_) {}
}

function startAdminNotifPolling() {
  pollAdminUnread();
  adminBellInterval = setInterval(pollAdminUnread, 60_000);
}
```

Call `startAdminNotifPolling()` in `verifyAndLoad()`.

**Send Notification section** in admin panel:

```html
<div id="section-send-notification" style="display:none">
  <h2>Send Notification to Managers / Clients</h2>
  <div style="max-width:600px">
    <label>Title <span style="color:var(--err)">*</span></label>
    <input id="notif-title" type="text" placeholder="Notification title" maxlength="150"
      style="width:100%;padding:10px;border-radius:8px;background:var(--surface);border:1px solid var(--border);color:var(--text);margin-bottom:12px">
    <label>Message <span style="color:var(--err)">*</span></label>
    <textarea id="notif-body" placeholder="Write your notification message..." maxlength="1000"
      style="width:100%;height:120px;padding:10px;border-radius:8px;background:var(--surface);border:1px solid var(--border);color:var(--text);margin-bottom:12px;resize:vertical"></textarea>
    <label>Send to</label>
    <select id="notif-target" onchange="updateNotifTargetUser()"
      style="width:100%;padding:10px;border-radius:8px;background:var(--surface);border:1px solid var(--border);color:var(--text);margin-bottom:12px">
      <option value="role_manager">All Managers</option>
      <option value="role_user">All Clients</option>
      <option value="specific">Specific User…</option>
    </select>
    <div id="notif-user-select" style="display:none;margin-bottom:12px">
      <label>Select User</label>
      <select id="notif-specific-user"
        style="width:100%;padding:10px;border-radius:8px;background:var(--surface);border:1px solid var(--border);color:var(--text)">
        <!-- populated by loadUsersForNotifDropdown() -->
      </select>
    </div>
    <button class="btn btn-primary" onclick="sendAdminNotification()">Send Notification</button>
    <span id="notif-send-result" style="margin-left:12px;font-size:13px"></span>
  </div>

  <hr style="margin:32px 0;border-color:var(--border)">

  <h3>Sent Notifications</h3>
  <table class="table" style="width:100%">
    <thead><tr><th>To</th><th>Title</th><th>Message</th><th>Sent</th></tr></thead>
    <tbody id="sent-notif-tbody"></tbody>
  </table>
</div>
```

**JS for notification sending**:
```javascript
function updateNotifTargetUser() {
  const val = document.getElementById('notif-target').value;
  document.getElementById('notif-user-select').style.display = val === 'specific' ? 'block' : 'none';
  if (val === 'specific') loadUsersForNotifDropdown();
}

async function loadUsersForNotifDropdown() {
  const sel = document.getElementById('notif-specific-user');
  const r = await api('/users');
  if (!r.ok) return;
  const users = await r.json();
  const managers = users.filter(u => u.role === 'manager' || u.role === 'user');
  sel.innerHTML = managers.map(u =>
    `<option value="${u.id}">${esc(u.display_name)} (${u.role})</option>`
  ).join('');
}

async function sendAdminNotification() {
  const title = document.getElementById('notif-title').value.trim();
  const body  = document.getElementById('notif-body').value.trim();
  const target = document.getElementById('notif-target').value;
  const result = document.getElementById('notif-send-result');

  if (!title || !body) { result.textContent = 'Title and message are required.'; result.style.color='var(--err)'; return; }

  const payload = { title, body };
  if (target === 'specific') {
    payload.recipientId = document.getElementById('notif-specific-user').value;
  } else if (target === 'role_manager') {
    payload.recipientRole = 'manager';
  } else if (target === 'role_user') {
    payload.recipientRole = 'user';
  }

  const r = await api('/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (r.ok) {
    result.textContent = '✓ Notification sent!';
    result.style.color = 'var(--ok,#22c55e)';
    document.getElementById('notif-title').value = '';
    document.getElementById('notif-body').value = '';
    loadSentNotifications();
    setTimeout(() => { result.textContent = ''; }, 4000);
  } else {
    const d = await r.json();
    result.textContent = d.error || 'Failed to send.';
    result.style.color = 'var(--err)';
  }
}

async function loadSentNotifications() {
  const tbody = document.getElementById('sent-notif-tbody');
  if (!tbody) return;
  const r = await api('/notifications/sent');
  if (!r.ok) return;
  const data = await r.json();
  tbody.innerHTML = data.map(n => `
    <tr>
      <td style="font-size:13px">${n.recipient_id ? esc(n.recipient_name||n.recipient_id) : `All ${n.recipient_role}s`}</td>
      <td style="font-weight:600">${esc(n.title)}</td>
      <td style="font-size:13px;max-width:300px;white-space:pre-wrap">${esc(n.body)}</td>
      <td style="font-size:11px;color:var(--hint)">${new Date(n.created_at).toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
}
```

---

### Step 4: Manager Notification Panel (Bell + Toast + Panel)

**In `public/manager/index.html`**, add to top bar:
```html
<button id="mgr-bell-btn" onclick="toggleMgrNotifPanel()" style="
  background:none; border:none; cursor:pointer; position:relative;
  color:var(--text); font-size:20px; padding:4px 8px;
" title="Notifications">
  🔔
  <span id="mgr-notif-badge" style="
    display:none; position:absolute; top:0; right:0;
    width:9px; height:9px; border-radius:50%; background:#ef4444;
  "></span>
</button>
```

**Notification panel HTML** (slide-in from right):
```html
<div id="mgr-notif-panel" style="
  display:none; position:fixed; top:0; right:0; width:360px; height:100vh;
  background:var(--surface,#1e1e2e); border-left:1px solid var(--border);
  z-index:9990; overflow-y:auto; padding:24px 20px; box-shadow:-8px 0 32px rgba(0,0,0,0.4);
">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <h3 style="margin:0">Notifications</h3>
    <button onclick="toggleMgrNotifPanel()" style="background:none;border:none;color:var(--hint);font-size:20px;cursor:pointer">×</button>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:16px">
    <button class="btn btn-sm" onclick="filterMgrNotif('all')" id="mn-filter-all">All</button>
    <button class="btn btn-sm" onclick="filterMgrNotif('unread')" id="mn-filter-unread">Unread</button>
    <button class="btn btn-sm" onclick="filterMgrNotif('pinned')" id="mn-filter-pinned">Pinned</button>
  </div>
  <div id="mgr-notif-list"></div>
</div>
```

**Toast HTML** (add near body end):
```html
<div id="mgr-notif-toast" style="
  display:none; position:fixed; top:20px; right:20px; z-index:99990;
  background:var(--surface,#1e1e2e); border:1px solid var(--border); border-radius:12px;
  padding:14px 18px; max-width:320px; box-shadow:0 8px 32px rgba(0,0,0,0.5);
  animation: slideInRight 0.3s ease;
">
  <div style="display:flex;align-items:flex-start;gap:12px">
    <span style="font-size:20px">🔔</span>
    <div style="flex:1">
      <div id="mgr-toast-title" style="font-weight:600;font-size:14px;color:var(--text)"></div>
      <div id="mgr-toast-body" style="font-size:13px;color:var(--hint);margin-top:4px"></div>
    </div>
    <button onclick="closeMgrToast()" style="background:none;border:none;color:var(--hint);cursor:pointer;font-size:16px">×</button>
  </div>
</div>
```

**Polling and toast JS**:
```javascript
let mgrNotifPollInterval = null;
let mgrLastNotifCheck = null;
let mgrNotifFilter = 'all';
let mgrNotifData = [];
let mgrToastTimer = null;

function startMgrNotifPolling() {
  mgrLastNotifCheck = new Date().toISOString();
  pollMgrNotifications();
  mgrNotifPollInterval = setInterval(pollMgrNotifications, 30_000);
}

async function pollMgrNotifications() {
  try {
    const [countR, listR] = await Promise.all([
      api('/notifications/my/unread-count'),
      api('/notifications/my'),
    ]);
    if (!countR.ok || !listR.ok) return;

    const { count } = await countR.json();
    mgrNotifData = await listR.json();

    // Update badge
    const badge = document.getElementById('mgr-notif-badge');
    if (badge) badge.style.display = count > 0 ? 'block' : 'none';

    // Check for new notifications since last poll (for toast)
    const newOnes = mgrNotifData.filter(n =>
      !n.is_read && new Date(n.created_at) > new Date(mgrLastNotifCheck)
    );
    if (newOnes.length > 0) showMgrToast(newOnes[0]);

    mgrLastNotifCheck = new Date().toISOString();
    renderMgrNotifList();
  } catch(_) {}
}

function showMgrToast(notif) {
  document.getElementById('mgr-toast-title').textContent = notif.title;
  document.getElementById('mgr-toast-body').textContent = notif.body;
  const toast = document.getElementById('mgr-notif-toast');
  toast.style.display = 'block';
  clearTimeout(mgrToastTimer);
  mgrToastTimer = setTimeout(closeMgrToast, 4000);
}

function closeMgrToast() {
  document.getElementById('mgr-notif-toast').style.display = 'none';
}

function toggleMgrNotifPanel() {
  const panel = document.getElementById('mgr-notif-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') renderMgrNotifList();
}

function filterMgrNotif(f) {
  mgrNotifFilter = f;
  ['all','unread','pinned'].forEach(x => {
    document.getElementById(`mn-filter-${x}`)?.classList.toggle('active', x === f);
  });
  renderMgrNotifList();
}

function renderMgrNotifList() {
  const el = document.getElementById('mgr-notif-list');
  if (!el) return;
  let items = mgrNotifData;
  if (mgrNotifFilter === 'unread') items = items.filter(n => !n.is_read);
  if (mgrNotifFilter === 'pinned') items = items.filter(n => n.is_pinned);

  if (!items.length) { el.innerHTML = '<p style="color:var(--hint);text-align:center;margin-top:32px">No notifications</p>'; return; }

  el.innerHTML = items.map(n => `
    <div style="
      background:${n.is_read?'transparent':'rgba(99,102,241,0.08)'};
      border:1px solid ${n.is_pinned?'#f59e0b':n.is_read?'var(--border)':'rgba(99,102,241,0.3)'};
      border-radius:10px; padding:14px; margin-bottom:10px;
    ">
      <div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(n.title)}</div>
      <div style="font-size:13px;color:var(--hint);white-space:pre-wrap;margin-bottom:8px">${esc(n.body)}</div>
      <div style="font-size:11px;color:var(--hint);display:flex;align-items:center;justify-content:space-between">
        <span>${n.sender_name ? `From: ${esc(n.sender_name)}` : 'From: Admin'} · ${new Date(n.created_at).toLocaleString('en-IN')}</span>
        <div style="display:flex;gap:6px">
          ${n.is_read ? '' : `<button class="btn btn-sm btn-primary" onclick="markMgrNotifRead('${n.id}')" style="font-size:11px;padding:3px 8px">Read</button>`}
          <button class="btn btn-sm" onclick="pinMgrNotif('${n.id}')" title="${n.is_pinned?'Unpin':'Pin'}" style="font-size:11px;padding:3px 8px">${n.is_pinned?'📌':'📍'}</button>
          <button class="btn btn-sm" onclick="discardMgrNotif('${n.id}')" title="Discard" style="font-size:11px;padding:3px 8px;color:var(--err)">✕</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function markMgrNotifRead(id) {
  await api(`/notifications/${id}/read`, { method: 'PATCH' });
  pollMgrNotifications();
}
async function pinMgrNotif(id) {
  await api(`/notifications/${id}/pin`, { method: 'PATCH' });
  pollMgrNotifications();
}
async function discardMgrNotif(id) {
  await api(`/notifications/${id}/discard`, { method: 'PATCH' });
  pollMgrNotifications();
}
```

Call `startMgrNotifPolling()` inside the existing `init()` function in manager portal after successful auth.

**Apply same pattern to `public/client/index.html`** — identical bell icon, panel, toast, and polling logic but with element IDs prefixed `cli-` instead of `mgr-`.

---

### Stage 7 — Complete File List

| Action | File | What Changes |
|--------|------|-------------|
| NEW | `src/services/mailer.js` | Shared SMTP singleton |
| NEW | `src/routes/feedback.js` | All feedback routes |
| NEW | `src/routes/notifications.js` | All notification routes |
| NEW | `public/assets/feedback-widget.js` | Floating bubble widget |
| NEW | `public/assets/feedback-widget.css` | Widget styles |
| MODIFY | `src/routes/contact.js` | Use `mailer.js` instead of inline transporter |
| MODIFY | `src/middleware/auth.js` | Export `extractJwt` |
| MODIFY | `src/app.js` | Register feedback + notification routes + feedbackLimiter |
| MODIFY | `src/db/schema.sql` | Add `feedback` + `notifications` tables + upgrade guards |
| MODIFY | `public/admin/index.html` | Bell icon, unread badge polling, Feedback tab/section, Send Notification section, contact tab rename + badge, Bug 1 fix, Bug 3 fix (idle timeout) |
| MODIFY | `public/manager/index.html` | Bell icon, notification panel, toast, 30s polling, Bug 2 fix (session expired modal) |
| MODIFY | `public/client/index.html` | Bell icon, notification panel, toast, 30s polling, Bug 2 fix |
| MODIFY | `public/visitor/index.html` | Feedback widget only |

### Stage 7 — DB Migration (run before deploying)
```bash
docker exec -i compreface-postgres-db psql -U postgres -d frs << 'EOF'
CREATE TABLE IF NOT EXISTS feedback (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  role         TEXT        NOT NULL CHECK (role IN ('manager','user','visitor','admin')),
  display_name TEXT,
  contact_info TEXT,
  event_id     UUID        REFERENCES events(id) ON DELETE SET NULL,
  message      TEXT        NOT NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT false,
  is_pinned    BOOLEAN     NOT NULL DEFAULT false,
  is_discarded BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_role    ON feedback(role);
CREATE INDEX IF NOT EXISTS idx_feedback_is_read ON feedback(is_read);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID        REFERENCES users(id) ON DELETE CASCADE,
  recipient_role TEXT       CHECK (recipient_role IN ('manager','user')),
  sender_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  is_read       BOOLEAN     NOT NULL DEFAULT false,
  is_pinned     BOOLEAN     NOT NULL DEFAULT false,
  is_discarded  BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread    ON notifications(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_role      ON notifications(recipient_role, is_read);
EOF
```

### Stage 7 — Test Gate
- [ ] Bug 1: Mark read contact → contacts list reloads correctly, does NOT show "Failed to load contacts"
- [ ] Bug 1: Contact tab now reads "Contact us forms (N)" with N in red when unread
- [ ] Bug 2: Let manager JWT expire (or manually delete `authToken` from sessionStorage, reload) → Session Expired modal appears, not "Failed to load events"
- [ ] Bug 2: Click "Go to Login" button → redirects to /landing
- [ ] Bug 3: Admin panel auto-logs out after 4 hours idle (test with shorter timer for verification)
- [ ] Visitor submits feedback (no auth) → saved to DB, email received at info@raidcloud.in with subject `[Feedback] Visitor | ...`
- [ ] Manager submits feedback via floating widget → appears in admin Feedback tab with Manager badge
- [ ] Admin feedback panel: Unread filter, Pin action, Discard action all work
- [ ] Admin bell shows red dot when unread feedback or contact exists
- [ ] Admin sends notification to specific manager → manager bell badge appears within 30s
- [ ] Manager sees toast banner for new notification
- [ ] Manager can mark read, pin, discard notifications
- [ ] Admin broadcasts to "All Managers" → all manager accounts see notification
- [ ] Client portal has same bell + panel as manager

---

## ═══════════════════════════════════════════════════
## STAGE 8 — Premium Features (Features 3 & 4)
## ═══════════════════════════════════════════════════

**Risk Level**: 🔴 High — modifies upload pipeline  
**DB Migration Required**: Yes  
**Prerequisite**: Stage 7 must be deployed and stable first

---

## STAGE 8A — Feature 3: Manual JPEG Compression (Premium)

### Overview
A per-event JPEG quality slider for managers. Premium-gated (admin toggle per user).
Compression quality affects the `sharp` processing in `upload.js`.

**Key design decisions (confirmed)**:
- Quality applies to **full photo only**, NOT thumbnails (thumbnails always use system default)
- Gold-colored toggle in admin (not standard blue)
- Slider shows 82 as the default marker with visual callout
- Access refreshes on every API call (no re-login required)

---

### Step 1: DB Changes

**`src/db/schema.sql`** — add column to users and events:
```sql
-- Premium feature flags
ALTER TABLE users ADD COLUMN IF NOT EXISTS feature_manual_compression BOOLEAN NOT NULL DEFAULT false;

-- Per-event JPEG quality (NULL = use system default ~82)
ALTER TABLE events ADD COLUMN IF NOT EXISTS jpeg_quality INTEGER DEFAULT NULL;
```

---

### Step 2: Backend Changes

#### `src/middleware/auth.js`
No changes needed — `feature_manual_compression` is carried on the user record and checked per-route.

#### `src/routes/users.js`
- In `buildUserListQuery()`: add `u.feature_manual_compression, u.feature_album` to the SELECT
- In `router.patch('/:id', ...)`: accept `featureManualCompression` (boolean) and `featureAlbum` (boolean) in body, include in UPDATE SET clause with conditional addition

```javascript
// Inside PATCH /:id handler, after resolving update fields:
const updates = [];
const params = [];
if (typeof displayName !== 'undefined') { params.push(displayName); updates.push(`display_name = $${params.length}`); }
if (typeof isActive !== 'undefined')    { params.push(isActive);    updates.push(`is_active = $${params.length}`); }
if (typeof featureManualCompression !== 'undefined') {
  params.push(Boolean(featureManualCompression));
  updates.push(`feature_manual_compression = $${params.length}`);
}
if (typeof featureAlbum !== 'undefined') {
  params.push(Boolean(featureAlbum));
  updates.push(`feature_album = $${params.length}`);
}
// ... rest of update logic
```

#### `src/routes/auth.js` — `GET /auth/me`
Include `feature_manual_compression` and `feature_album` in the me response so the frontend gets updated flags on every auth check.

#### `src/routes/events.js`
Add new route:
```javascript
/**
 * PATCH /events/:eventId/quality
 * Manager sets JPEG quality for an event. Premium feature only.
 * Body: { quality: 0-100 | null }  — null resets to system default
 */
router.patch('/:eventId/quality', requireManager, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const { quality } = req.body;
  const userId = req.user?.userId;

  // Validate quality value
  if (quality !== null && quality !== undefined) {
    const q = parseInt(quality, 10);
    if (isNaN(q) || q < 0 || q > 100) {
      return res.status(400).json({ error: 'quality must be an integer 0–100 or null' });
    }
  }

  try {
    // Check manager has access to this event
    if (req.userRole !== 'admin') {
      const access = await db.query(
        'SELECT 1 FROM event_access WHERE user_id = $1 AND event_id = $2',
        [userId, eventId]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'No access to this event' });
      }
      // Check premium feature flag
      const userRow = await db.query(
        'SELECT feature_manual_compression FROM users WHERE id = $1',
        [userId]
      );
      if (!userRow.rows[0]?.feature_manual_compression) {
        return res.status(403).json({
          error: 'Manual compression is not enabled for your account. Contact the administrator.',
          upgradeRequired: true,
        });
      }
    }

    await db.query(
      'UPDATE events SET jpeg_quality = $1 WHERE id = $2',
      [quality !== null && quality !== undefined ? parseInt(quality, 10) : null, eventId]
    );
    res.json({ success: true, jpeg_quality: quality ?? null });
  } catch (err) {
    console.error('Set event quality error:', err.message);
    res.status(500).json({ error: 'Failed to set quality' });
  }
});
```

Also include `jpeg_quality` in `GET /events` and `GET /events/my` responses (add to SELECT).

#### `src/services/imageUtils.js` (NEW — shared calibration)
```javascript
// src/services/imageUtils.js
// Image quality calibration and compression estimation utilities.

/**
 * Maps JPEG quality (0-100) to maximum output resolution (px).
 * Calibration points:
 *   quality ≤ 82 → 1920px (current system default resolution)
 *   quality = 92 → 2500px
 *   quality = 100 → 4000px
 * Linear interpolation between anchor points.
 */
function qualityToMaxResolution(quality) {
  const q = Math.max(0, Math.min(100, parseInt(quality, 10)));
  if (q >= 92) return Math.round(2500 + ((q - 92) / 8) * 1500);  // 2500→4000
  if (q >= 82) return Math.round(1920 + ((q - 82) / 10) * 580);  // 1920→2500
  return 1920; // below 82: same as default (smaller file, same max res)
}

/**
 * Estimates output file size in MB.
 * Formula: output = input × (quality/100)^0.7
 * This is an approximation — actual JPEG compression is content-dependent.
 */
function estimateOutputSizeMB(inputMB, quality) {
  const q = Math.max(1, Math.min(100, parseInt(quality, 10)));
  return parseFloat((inputMB * Math.pow(q / 100, 0.7)).toFixed(2));
}

module.exports = { qualityToMaxResolution, estimateOutputSizeMB };
```

#### `src/routes/upload.js`
Modify upload handler to read per-event quality:

```javascript
const { qualityToMaxResolution } = require('../services/imageUtils');
const SYSTEM_DEFAULT_QUALITY = parseInt(process.env.UPLOAD_JPEG_QUALITY || '82', 10);

// Inside the upload handler, after getting eventId and before file processing:
const eventRow = await db.query(
  'SELECT jpeg_quality FROM events WHERE id = $1',
  [eventId]
);
const effectiveQuality = eventRow.rows[0]?.jpeg_quality ?? SYSTEM_DEFAULT_QUALITY;
const maxResolution = qualityToMaxResolution(effectiveQuality);

// Then when calling sharp for the FULL PHOTO (not thumbnail):
// BEFORE (current — uses a hardcoded or env quality):
//   .jpeg({ quality: 85 })   // or whatever it currently is
// AFTER:
//   .resize(maxResolution, maxResolution, { fit: 'inside', withoutEnlargement: true })
//   .jpeg({ quality: effectiveQuality })

// NOTE: Thumbnails continue to use the system default (400px, quality 80 or current setting)
// Do NOT apply effectiveQuality to the thumb_ version
```

**Add `UPLOAD_JPEG_QUALITY` to `.env.example`** and `docker-compose.yml`:
```
UPLOAD_JPEG_QUALITY=82  # System default JPEG quality (0-100). Used when no per-event override is set.
```

---

### Step 3: Admin UI — Gold Premium Toggles

**In `public/admin/index.html`**, user management table — add two columns with gold-colored toggle switches:

**CSS for gold toggle**:
```css
/* Premium feature toggle — gold accent, distinct from standard UI */
.premium-toggle {
  position: relative; display: inline-block; width: 40px; height: 22px;
}
.premium-toggle input { opacity: 0; width: 0; height: 0; }
.premium-toggle .slider {
  position: absolute; cursor: pointer; inset: 0;
  background: var(--border, #2d2d44); border-radius: 22px;
  transition: background 0.2s;
}
.premium-toggle input:checked + .slider { background: #d97706; } /* amber/gold */
.premium-toggle .slider:before {
  content: ''; position: absolute;
  width: 16px; height: 16px; left: 3px; bottom: 3px;
  background: #fff; border-radius: 50%; transition: transform 0.2s;
}
.premium-toggle input:checked + .slider:before { transform: translateX(18px); }
```

**In the user row template**, add two cells:
```javascript
// Inside the user table row render (in loadUsers() function):
<td title="Manual Compression Premium Feature">
  <label class="premium-toggle" title="${u.feature_manual_compression ? 'Enabled — click to disable' : 'Disabled — click to enable'}">
    <input type="checkbox"
      ${u.feature_manual_compression ? 'checked' : ''}
      onchange="togglePremiumFeature('${u.id}', 'featureManualCompression', this.checked)">
    <span class="slider"></span>
  </label>
  <span style="font-size:10px;color:#d97706;display:block;text-align:center">Compress</span>
</td>
<td title="Album Feature Premium">
  <label class="premium-toggle">
    <input type="checkbox"
      ${u.feature_album ? 'checked' : ''}
      onchange="togglePremiumFeature('${u.id}', 'featureAlbum', this.checked)">
    <span class="slider"></span>
  </label>
  <span style="font-size:10px;color:#d97706;display:block;text-align:center">Album</span>
</td>
```

**JS handler**:
```javascript
async function togglePremiumFeature(userId, feature, value) {
  const r = await api(`/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [feature]: value }),
  });
  if (!r.ok) {
    showBanner('Failed to update feature access', 'err');
    loadUsers(); // reload to restore correct state
  } else {
    showBanner(`Premium feature ${value ? 'enabled' : 'disabled'} for user`);
  }
}
```

---

### Step 4: Manager UI — Compression Settings Panel

**In `public/manager/index.html`**, when an event is opened, add a "Compression" settings section in the event detail area:

```html
<!-- Add inside the event detail panel, after the main controls -->
<div id="compression-panel" style="
  background:var(--surface,#1e1e2e); border:1px solid var(--border); border-radius:12px;
  padding:20px 24px; margin-top:20px;
">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
    <span style="font-size:18px">🎛️</span>
    <h3 style="margin:0;font-size:16px">Photo Quality Settings</h3>
    <span id="compression-premium-badge" style="
      font-size:10px;padding:2px 8px;border-radius:10px;
      background:#d9770622;color:#d97706;font-weight:600;
    ">PREMIUM</span>
  </div>

  <div id="compression-gated-msg" style="display:none;
    background:rgba(99,102,241,0.07);border-radius:8px;padding:14px 16px;
    font-size:13px;color:var(--hint);margin-bottom:16px;
  ">
    Manual compression is not active for your account.
    <strong style="color:var(--text)">Contact the administrator to enable this service.</strong>
  </div>

  <div id="compression-controls">
    <!-- Quality slider -->
    <div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <label style="font-size:13px;color:var(--hint)">JPEG Quality</label>
        <span id="quality-value-display" style="font-size:20px;font-weight:700;color:var(--accent)">82</span>
      </div>
      <div style="position:relative;margin-bottom:4px">
        <input type="range" id="quality-slider" min="0" max="100" value="82"
          style="width:100%; accent-color:#6366f1;"
          oninput="onQualitySliderChange(this.value)">
        <!-- Default marker at 82 -->
        <div style="position:absolute;top:-22px;font-size:10px;color:#d97706;font-weight:600;
          left:calc(82% - 12px)">↑ Default</div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--hint)">
        <span>0 (Min)</span><span>82 (System Default)</span><span>100 (Original)</span>
      </div>
    </div>

    <!-- Output resolution (read-only) -->
    <div style="display:flex;gap:16px;margin-bottom:16px">
      <div style="flex:1">
        <label style="font-size:12px;color:var(--hint);display:block;margin-bottom:4px">Max Output Resolution</label>
        <input id="quality-resolution-display" readonly value="1920 px"
          style="width:100%;padding:8px;border-radius:6px;background:rgba(0,0,0,0.2);
          border:1px solid var(--border);color:var(--hint);font-size:14px;text-align:center">
      </div>
      <div style="flex:1">
        <label style="font-size:12px;color:var(--hint);display:block;margin-bottom:4px">Input size (1 photo, MB)</label>
        <input id="compression-input-size" type="number" min="0.1" max="50" step="0.1" value="8"
          style="width:100%;padding:8px;border-radius:6px;background:var(--surface);
          border:1px solid var(--border);color:var(--text);font-size:14px"
          oninput="onQualitySliderChange(document.getElementById('quality-slider').value)">
      </div>
      <div style="flex:1">
        <label style="font-size:12px;color:var(--hint);display:block;margin-bottom:4px">Estimated output size</label>
        <input id="compression-output-size" readonly value="~5.9 MB"
          style="width:100%;padding:8px;border-radius:6px;background:rgba(0,0,0,0.2);
          border:1px solid var(--border);color:var(--hint);font-size:14px;text-align:center">
      </div>
    </div>

    <!-- Warning for high quality -->
    <div id="compression-quality-warning" style="
      display:none;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);
      border-radius:8px;padding:10px 14px;font-size:12px;color:#f59e0b;margin-bottom:16px;
    ">
      ⚠️ Quality above 85 will increase photo file sizes significantly.
      This may slow down photo loading for visitors and clients, especially on mobile connections.
    </div>

    <div style="display:flex;gap:10px">
      <button class="btn" onclick="resetCompressionQuality()">Reset to Default (82)</button>
      <button class="btn btn-primary" onclick="saveCompressionQuality()">Save Setting for This Event</button>
    </div>
    <div id="compression-save-result" style="font-size:13px;margin-top:8px"></div>
  </div>
</div>
```

**JS for compression panel** (add to manager portal):
```javascript
// Calibration (mirrors server-side imageUtils.js — keep in sync)
function qualityToMaxResolution(quality) {
  const q = Math.max(0, Math.min(100, parseInt(quality)));
  if (q >= 92) return Math.round(2500 + ((q - 92) / 8) * 1500);
  if (q >= 82) return Math.round(1920 + ((q - 82) / 10) * 580);
  return 1920;
}
function estimateOutputSizeMB(inputMB, quality) {
  const q = Math.max(1, Math.min(100, parseInt(quality)));
  return (inputMB * Math.pow(q / 100, 0.7)).toFixed(2);
}

function onQualitySliderChange(quality) {
  const q = parseInt(quality);
  document.getElementById('quality-value-display').textContent = q;
  document.getElementById('quality-resolution-display').value = `${qualityToMaxResolution(q)} px`;
  const inputMB = parseFloat(document.getElementById('compression-input-size').value) || 8;
  document.getElementById('compression-output-size').value = `~${estimateOutputSizeMB(inputMB, q)} MB`;
  // Show warning above 85
  document.getElementById('compression-quality-warning').style.display = q > 85 ? 'block' : 'none';
}

function initCompressionPanel(event, user) {
  const panel = document.getElementById('compression-panel');
  const controls = document.getElementById('compression-controls');
  const gatedMsg = document.getElementById('compression-gated-msg');

  if (!user.feature_manual_compression) {
    // Gray out — show gated message, disable controls
    controls.style.opacity = '0.4';
    controls.style.pointerEvents = 'none';
    gatedMsg.style.display = 'block';
  } else {
    controls.style.opacity = '1';
    controls.style.pointerEvents = 'auto';
    gatedMsg.style.display = 'none';
  }

  // Set slider to current event quality (or 82 if null)
  const currentQuality = event.jpeg_quality ?? 82;
  document.getElementById('quality-slider').value = currentQuality;
  onQualitySliderChange(currentQuality);
}

async function saveCompressionQuality() {
  const quality = parseInt(document.getElementById('quality-slider').value);
  const result = document.getElementById('compression-save-result');
  const r = await api(`/events/${currentEvent.id}/quality`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quality }),
  });
  if (r.ok) {
    result.textContent = `✓ Quality set to ${quality} for this event's photos`;
    result.style.color = 'var(--ok,#22c55e)';
    currentEvent.jpeg_quality = quality;
    setTimeout(() => { result.textContent = ''; }, 4000);
  } else {
    const d = await r.json();
    result.textContent = d.error || 'Failed to save';
    result.style.color = 'var(--err)';
  }
}

async function resetCompressionQuality() {
  const r = await api(`/events/${currentEvent.id}/quality`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quality: null }),
  });
  if (r.ok) {
    document.getElementById('quality-slider').value = 82;
    onQualitySliderChange(82);
    currentEvent.jpeg_quality = null;
    document.getElementById('compression-save-result').textContent = '✓ Reset to system default (82)';
    document.getElementById('compression-save-result').style.color = 'var(--ok,#22c55e)';
    setTimeout(() => { document.getElementById('compression-save-result').textContent = ''; }, 3000);
  }
}
```

Call `initCompressionPanel(currentEvent, currentUser)` whenever an event is loaded/opened.

---

## STAGE 8B — Feature 4: Album System (Premium)

### Overview
Manager and client collaboratively curate a shared "print album" of photos per event. Mirrors `favorites.js` exactly but with:
- Per-user premium gate (`feature_album` flag)
- Admin can always see all album contents

### Step 1: DB Changes
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS feature_album BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS photo_album (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    UUID        NOT NULL REFERENCES indexed_photos(id) ON DELETE CASCADE,
  added_by    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_photo_album_event ON photo_album(event_id);
```

### Step 2: `src/routes/album.js` (NEW)

Copy structure of `src/routes/favorites.js` with these additions:
1. At the start of POST and DELETE handlers, check `feature_album` on the user record
2. Admin bypasses the check (as throughout the codebase)

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db/client');
const { requireUser, requireAdmin } = require('../middleware/auth');
const { validateUuid } = require('../middleware/validateUuid');
const { getPresignedUrl } = require('../services/rustfs');

// Shared premium check helper
async function checkAlbumAccess(userId, userRole) {
  if (userRole === 'admin') return true;
  const row = await db.query('SELECT feature_album FROM users WHERE id = $1', [userId]);
  return row.rows[0]?.feature_album === true;
}

/** GET /album/:eventId — list album photo IDs */
router.get('/:eventId', requireUser, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user?.userId;
  try {
    if (req.userRole !== 'admin') {
      const access = await db.query('SELECT 1 FROM event_access WHERE user_id=$1 AND event_id=$2', [userId, eventId]);
      if (!access.rows.length) return res.status(403).json({ error: 'No access to this event' });
    }
    const result = await db.query(
      'SELECT photo_id, added_at FROM photo_album WHERE event_id=$1 ORDER BY added_at DESC',
      [eventId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to list album' }); }
});

/** GET /album/:eventId/photos — full photo objects with presigned URLs */
router.get('/:eventId/photos', requireUser, validateUuid('eventId'), async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user?.userId;
  try {
    if (req.userRole !== 'admin') {
      const access = await db.query('SELECT 1 FROM event_access WHERE user_id=$1 AND event_id=$2', [userId, eventId]);
      if (!access.rows.length) return res.status(403).json({ error: 'No access' });
    }
    const eventResult = await db.query('SELECT bucket_name FROM events WHERE id=$1', [eventId]);
    if (!eventResult.rows.length) return res.status(404).json({ error: 'Event not found' });
    const { bucket_name } = eventResult.rows[0];

    const result = await db.query(
      `SELECT ip.id, ip.rustfs_object_id, ip.has_faces, ip.face_count, ip.photo_date, ip.indexed_at
       FROM photo_album pa
       JOIN indexed_photos ip ON pa.photo_id = ip.id
       WHERE pa.event_id = $1 ORDER BY pa.added_at DESC`,
      [eventId]
    );
    const photos = await Promise.all(result.rows.map(async p => ({
      ...p,
      thumbUrl: await getPresignedUrl(bucket_name, `thumb_${p.rustfs_object_id}`),
      fullUrl:  await getPresignedUrl(bucket_name, p.rustfs_object_id),
    })));
    res.json(photos);
  } catch (err) { res.status(500).json({ error: 'Failed to get album photos' }); }
});

/** POST /album/:eventId/:photoId — add to album (premium gate) */
router.post('/:eventId/:photoId', requireUser, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const userId = req.user?.userId;
  try {
    if (!(await checkAlbumAccess(userId, req.userRole))) {
      return res.status(403).json({
        error: 'Album feature is not enabled for your account. Contact the administrator.',
        upgradeRequired: true,
      });
    }
    if (req.userRole !== 'admin') {
      const access = await db.query('SELECT 1 FROM event_access WHERE user_id=$1 AND event_id=$2', [userId, eventId]);
      if (!access.rows.length) return res.status(403).json({ error: 'No access to this event' });
    }
    await db.query(
      `INSERT INTO photo_album (event_id, photo_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [eventId, photoId, userId]
    );
    res.status(201).json({ added: true });
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Photo or event not found' });
    res.status(500).json({ error: 'Failed to add to album' });
  }
});

/** DELETE /album/:eventId/:photoId — remove from album (premium gate) */
router.delete('/:eventId/:photoId', requireUser, validateUuid('eventId', 'photoId'), async (req, res) => {
  const { eventId, photoId } = req.params;
  const userId = req.user?.userId;
  try {
    if (!(await checkAlbumAccess(userId, req.userRole))) {
      return res.status(403).json({
        error: 'Album feature is not enabled for your account.',
        upgradeRequired: true,
      });
    }
    await db.query('DELETE FROM photo_album WHERE event_id=$1 AND photo_id=$2', [eventId, photoId]);
    res.json({ removed: true });
  } catch (err) { res.status(500).json({ error: 'Failed to remove from album' }); }
});

module.exports = router;
```

**Register in `src/app.js`**:
```javascript
const albumRouter = require('./routes/album');
app.use('/album', albumRouter);
```

---

### Step 3: Manager + Client Frontend

#### Thumbnail Bookmark Icon

**In `public/manager/index.html`**, wherever a photo thumbnail card is rendered (in the library grid), add an album bookmark icon alongside the existing heart icon:

```javascript
// Inside photo card template (near the existing favorite heart icon):
<button class="album-btn ${albumPhotoIds.has(p.id) ? 'in-album' : ''}"
  onclick="toggleAlbum('${p.id}')"
  title="${albumPhotoIds.has(p.id) ? 'Remove from Album' : 'Add to Album'}"
  style="position:absolute;top:8px;right:36px; /* leave room for existing heart */
    background:rgba(0,0,0,0.5);border:none;border-radius:50%;width:28px;height:28px;
    cursor:pointer;color:${albumPhotoIds.has(p.id)?'#f59e0b':'rgba(255,255,255,0.6)'};
    font-size:14px;display:flex;align-items:center;justify-content:center;">
  📚
</button>
```

Where `albumPhotoIds` is a `Set` of photo IDs loaded from `GET /album/:eventId` on event load.

**JS for album toggle** (mirrors favorite toggle logic in manager portal):
```javascript
let albumPhotoIds = new Set();
let albumUndoTimers = {};

async function loadAlbumIds() {
  if (!currentEvent) return;
  try {
    const r = await api(`/album/${currentEvent.id}`);
    if (r.ok) {
      const data = await r.json();
      albumPhotoIds = new Set(data.map(x => x.photo_id));
    }
  } catch(_) {}
}

async function toggleAlbum(photoId) {
  if (!currentUser?.feature_album) {
    showBanner('Album feature is not active for your account. Contact administrator.', 'err');
    return;
  }
  const inAlbum = albumPhotoIds.has(photoId);
  if (inAlbum) {
    // Remove — show 4 second undo
    albumPhotoIds.delete(photoId);
    updateAlbumButtonState(photoId);
    showBanner(`Removed from album — <a href="#" onclick="undoAlbumRemove('${photoId}');return false" style="color:#d97706">Undo</a>`, 'info', 4500);
    albumUndoTimers[photoId] = setTimeout(async () => {
      await api(`/album/${currentEvent.id}/${photoId}`, { method: 'DELETE' });
      delete albumUndoTimers[photoId];
    }, 4000);
  } else {
    // Add immediately
    if (albumUndoTimers[photoId]) {
      clearTimeout(albumUndoTimers[photoId]);
      delete albumUndoTimers[photoId];
    }
    const r = await api(`/album/${currentEvent.id}/${photoId}`, { method: 'POST' });
    if (r.status === 403) {
      const d = await r.json();
      showBanner(d.error || 'Album feature not enabled', 'err');
      return;
    }
    albumPhotoIds.add(photoId);
    updateAlbumButtonState(photoId);
  }
}

function undoAlbumRemove(photoId) {
  clearTimeout(albumUndoTimers[photoId]);
  delete albumUndoTimers[photoId];
  albumPhotoIds.add(photoId);
  updateAlbumButtonState(photoId);
}

function updateAlbumButtonState(photoId) {
  // Find the album button for this photo and update its appearance
  const btn = document.querySelector(`.album-btn[data-photo-id="${photoId}"]`);
  if (btn) {
    btn.classList.toggle('in-album', albumPhotoIds.has(photoId));
    btn.style.color = albumPhotoIds.has(photoId) ? '#f59e0b' : 'rgba(255,255,255,0.6)';
    btn.title = albumPhotoIds.has(photoId) ? 'Remove from Album' : 'Add to Album';
  }
  // Also re-render the photo grid to reflect state
  // OR use targeted DOM update as above for performance
}
```

#### Album Tab in Event View

Add "Album" as a tab beside "Library" and "Favorites":
```html
<button class="tab-btn" id="tab-album" onclick="switchTab('album')">📚 Album</button>
```

Album tab content loads `GET /album/:eventId/photos` and renders the same photo grid.

#### Premium Gate UI — Yellow Banner for Non-Album Users

**If `currentUser.feature_album === false`**:
- Hide the Album tab from navigation entirely
- Show a subtle dismissible yellow banner at the top of the event view:

```html
<div id="album-gate-banner" style="
  display:none; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.25);
  border-radius:8px; padding:10px 16px; margin-bottom:14px;
  display:flex; align-items:center; justify-content:space-between;
  font-size:13px; color:#d97706;
">
  <span>📷 Album feature is not active for your account. Contact the administrator to enable.</span>
  <button onclick="dismissAlbumGateBanner()" style="
    background:none;border:none;color:#d97706;cursor:pointer;font-size:16px;padding:0 4px;
  ">×</button>
</div>
```

```javascript
function initAlbumGate(user) {
  const banner = document.getElementById('album-gate-banner');
  const albumTab = document.getElementById('tab-album');
  if (!user.feature_album) {
    if (albumTab) albumTab.style.display = 'none';
    // Show banner only if not dismissed for this session
    if (!sessionStorage.getItem('albumGateDismissed') && banner) {
      banner.style.display = 'flex';
    }
  } else {
    if (albumTab) albumTab.style.display = '';
    if (banner) banner.style.display = 'none';
  }
}

function dismissAlbumGateBanner() {
  document.getElementById('album-gate-banner').style.display = 'none';
  sessionStorage.setItem('albumGateDismissed', 'true');
}
```

**Apply identical UI pattern to `public/client/index.html`.**

---

### Stage 8 — Complete File List

| Action | File | What Changes |
|--------|------|-------------|
| NEW | `src/routes/album.js` | All album routes |
| NEW | `src/services/imageUtils.js` | qualityToMaxResolution, estimateOutputSizeMB |
| MODIFY | `src/app.js` | Register albumRouter |
| MODIFY | `src/db/schema.sql` | feature_manual_compression + feature_album on users; jpeg_quality on events; photo_album table |
| MODIFY | `src/routes/users.js` | Accept + return featureManualCompression, featureAlbum in PATCH + GET |
| MODIFY | `src/routes/events.js` | PATCH /:eventId/quality (new); include jpeg_quality in GET responses |
| MODIFY | `src/routes/upload.js` | Read jpeg_quality from event record; apply to sharp for full photo only |
| MODIFY | `src/middleware/auth.js` | Include feature flags in auth/me response (or handle in auth.js GET /auth/me) |
| MODIFY | `public/admin/index.html` | Gold premium toggles for Compression + Album per user |
| MODIFY | `public/manager/index.html` | Compression panel, album tab, bookmark icons, yellow gate banner |
| MODIFY | `public/client/index.html` | Album tab, bookmark icons, yellow gate banner |
| MODIFY | `.env.example` | Add UPLOAD_JPEG_QUALITY |
| MODIFY | `docker-compose.yml` | Add UPLOAD_JPEG_QUALITY env var |

### Stage 8 — DB Migration Script
```bash
docker exec -i compreface-postgres-db psql -U postgres -d frs << 'EOF'
ALTER TABLE users ADD COLUMN IF NOT EXISTS feature_manual_compression BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS feature_album BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS jpeg_quality INTEGER DEFAULT NULL;

CREATE TABLE IF NOT EXISTS photo_album (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    UUID        NOT NULL REFERENCES indexed_photos(id) ON DELETE CASCADE,
  added_by    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_photo_album_event ON photo_album(event_id);
EOF
```

### Stage 8 — Test Gate
- [ ] Admin user table shows two gold toggle columns: Compress, Album
- [ ] Toggling Compress on → manager refreshes (no re-login) → compression panel is interactive
- [ ] Compression slider at 82 → shows "Default" marker visually and "1920 px" resolution
- [ ] Compression slider at 92 → shows "2500 px"
- [ ] Compression slider at 100 → shows "4000 px"
- [ ] Slider above 85 → yellow warning appears
- [ ] Input 8MB at quality 82 → estimated output ~5.5MB
- [ ] Save quality 92 for event → upload a photo → confirm on RustFS it uses quality 92 for full photo
- [ ] Thumbnail for same photo uses system default quality (not 92)
- [ ] Manager without feature → compression panel grayed out, gated message visible
- [ ] Admin enables feature_album → manager sees Album tab + 📚 icons on photo thumbnails
- [ ] Manager adds photo to album → client sees it in their Album tab
- [ ] Client removes photo → 4-second undo toast → confirmed removed for manager too (shared list)
- [ ] Manager without feature_album → no album tab visible, subtle yellow banner appears
- [ ] Yellow banner dismissed with [×] → stays dismissed for session (`sessionStorage`)
- [ ] Admin can view all album contents without feature gate restriction

---

## Environment Variables Reference (Full List)

| Variable | Used In | Notes |
|----------|---------|-------|
| `ADMIN_API_KEY` | auth.js (legacy x-admin-key path) | Long random string. Also seeds initial admin password |
| `DELETE_API_KEY` | events.js (admin delete) | Second key required for hard-delete |
| `JWT_SECRET` | auth.js | Long random string. Rotate = all sessions invalidated |
| `JWT_EXPIRES_IN` | auth.js | e.g. `6h`, `24h` |
| `COMPREFACE_URL` | compreface.js | e.g. `http://compreface-api:8080` |
| `COMPREFACE_DET_API_KEY` | compreface.js | Detection service API key |
| `RUSTFS_ENDPOINT` | rustfs.js | Internal endpoint e.g. `http://rustfs_local:9000` |
| `RUSTFS_PUBLIC_ENDPOINT` | rustfs.js | Public endpoint used in presigned URLs |
| `RUSTFS_ACCESS_KEY` | rustfs.js | S3 access key |
| `RUSTFS_SECRET_KEY` | rustfs.js | S3 secret key |
| `FACE_SIMILARITY_THRESHOLD` | search.js | `0.991` (production-tuned) |
| `ALLOWED_ORIGINS` | app.js | Comma-separated, e.g. `https://delivery.raidcloud.in` |
| `UPLOAD_MAX_FILE_SIZE_MB` | upload.js | `20` for 16GB server, `25` for 64GB Unraid |
| `UPLOAD_MAX_FILES_PER_BATCH` | upload.js | `20` for 16GB server, `50` for 64GB Unraid |
| `UPLOAD_JPEG_QUALITY` | upload.js | `82` system default. Per-event override via events.jpeg_quality |
| `SMTP_HOST` | mailer.js | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | mailer.js | `587` |
| `SMTP_SECURE` | mailer.js | `false` for STARTTLS |
| `SMTP_USER` | mailer.js | Gmail address |
| `SMTP_PASS` | mailer.js | Gmail App Password (not account password) |

---

## Deployment Checklist (Per Stage)

### Before Every Deployment
1. Run the DB migration SQL (see each stage's migration script)
2. Add any new env vars to Portainer stack
3. `docker build --no-cache -t my-orchestration-api:latest .`
4. Redeploy via Portainer
5. Check Docker logs: `docker logs orchestration-api-orchestration-api-1 --tail=50`
6. Hit `GET /health` → should return `{"status":"ok","db":"connected"}`
7. Run stage-specific test gate

### Git Workflow
```bash
git config user.name "unitinguncle"
git config user.email "rahul4everyone7168@gmail.com"
git checkout upcoming-changes
# make changes
git add -A
git commit -m "feat: Stage 7 — Feedback + Notification system + Bug fixes"
git push origin upcoming-changes
```
