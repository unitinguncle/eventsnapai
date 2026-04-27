require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const path     = require('path');
const rateLimit = require('express-rate-limit');
const morgan   = require('morgan');
const jwt      = require('jsonwebtoken');
const db       = require('./db/client');

const eventsRouter      = require('./routes/events');
const uploadRouter      = require('./routes/upload');
const searchRouter      = require('./routes/search');
const photosRouter      = require('./routes/photos');
const diagnosticsRouter = require('./routes/diagnostics');
const authRouter        = require('./routes/auth');
const usersRouter       = require('./routes/users');
const favoritesRouter   = require('./routes/favorites');
const albumRouter       = require('./routes/album');
const contactRouter     = require('./routes/contact');
const feedbackRouter    = require('./routes/feedback');
const notificationsRouter = require('./routes/notifications');
const collabRouter        = require('./routes/collab');

const { seedAdminUser } = require('./db/seed');

const app = express();

// ── Trust proxy ───────────────────────────────────────────────────────────────
// Chain: Browser → Cloudflare (hop 1) → Nginx Proxy Manager (hop 2) → App
// Setting this to 2 ensures req.ip reflects the real client IP so that
// rate limiting works correctly and isn't fooled by Cloudflare's IP range.
app.set('trust proxy', 2);

app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ─────────────────────────────────────────────────────────────────────
// React Native mobile clients send NO Origin header — we must allow null-origin
// requests so the Android/iOS app can hit the API without being blocked.
// Browser clients still restricted to ALLOWED_ORIGINS.
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (native mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length === 0 || allowed.includes('*') || allowed.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin "${origin}" not in ALLOWED_ORIGINS`));
  },
  methods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'],
  allowedHeaders: ['Authorization', 'Content-Type', 'x-admin-key', 'x-delete-key'],
  credentials: true,
}));

app.use(express.json());

// ── HTTP access logging ───────────────────────────────────────────────────────
// Custom compact format: timestamp | METHOD /path  STATUS  Xms
// Skips: /health (Docker health check every 30s)
//        GET /favorites/* (10s polling from manager/client)
//        GET /notifications/my* (30s polling)
//        GET /feedback/unread-count (60s polling)
//        GET /contact?unread=true  (60s polling)
morgan.token('ts', () => new Date().toISOString().replace('T', ' ').slice(0, 19));
app.use(morgan(':ts | :method :url  :status  :response-time ms  [:res[content-length]b]', {
  skip: (req) => {
    if (req.path === '/health') return true;
    if (req.method !== 'GET') return false; // always log mutations
    if (req.path.startsWith('/favorites/')) return true;
    if (req.path.startsWith('/album/')) return true;      // 10s polling
    if (req.path.startsWith('/collab/') && req.method === 'GET' &&
        (req.path.endsWith('/group-favorites/ids') || req.path.endsWith('/my-favorites/ids'))) return true;
    if (req.path.startsWith('/notifications/my')) return true;
    if (req.path === '/feedback/unread-count') return true;
    if (req.path === '/contact' && req.query.unread) return true;
    return false;
  },
}));

// ── Static frontends ──────────────────────────────────────────────────────────
app.use('/landing', express.static(path.join(__dirname, '../public/landing')));
app.use('/admin',   express.static(path.join(__dirname, '../public/admin')));
app.use('/manager', express.static(path.join(__dirname, '../public/manager')));
app.use('/client',  express.static(path.join(__dirname, '../public/client')));
app.use('/visitor', express.static(path.join(__dirname, '../public/visitor')));

// Serve static assets (logos, images)
// Note: public/assets is listed first so feedback-widget.js is found there.
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ── Health check (BEFORE rate limiter) ───────────────────────────────────────
// Does a lightweight DB ping on every check.
// Returns 200 {status:'ok', db:'connected'} when healthy.
// Returns 503 {status:'degraded', db:'disconnected'} when Postgres is unreachable.
// Registered before generalLimiter so Docker/Portainer health probes are never 429'd.
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'disconnected' });
  }
});

// ── App Links / Universal Links well-known endpoints ─────────────────────────
// These MUST be served before the rate limiter so Android/iOS OS verification
// (which happens at app install time) never gets rate-limited.
//
// Android App Links: allows the native app to intercept delivery.raidcloud.in/e/*
// links so scanning a QR with the system camera opens the app, not the browser.
// SHA-256 fingerprint is populated via ANDROID_CERT_FINGERPRINT env var after
// the first EAS build generates the signing keystore.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const fingerprint = process.env.ANDROID_CERT_FINGERPRINT || '';
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.raidcloud.eventsnapai',
      sha256_cert_fingerprints: fingerprint ? [fingerprint] : [],
    },
  }]);
});

// iOS Universal Links (placeholder — activate when APPLE_TEAM_ID is set)
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const teamId = process.env.APPLE_TEAM_ID || '';
  res.json({
    applinks: {
      details: teamId ? [{
        appIDs: [`${teamId}.com.raidcloud.eventsnapai`],
        components: [{ '/': '/e/*', comment: 'EventSnapAI QR entry point' }],
      }] : [],
    },
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
// General limiter — applied to all routes below (health + well-known served above)
// Uses JWT userId as the key when a valid token is present, falling back to IP.
// This is essential for mobile: many users share the same carrier-NAT IP address
// and would otherwise hit a single IP-based limit collectively.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        if (payload?.userId) return `user:${payload.userId}`;
      } catch {}
    }
    return `ip:${req.ip}`;
  },
});
app.use(generalLimiter);

// Search limiter — facially recognition inference is expensive
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests — please wait before searching again' },
});

// Contact form limiter — 5 per minute prevents spam/flood from landing page
const contactLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many contact submissions — please wait before trying again' },
  skip: (req) => req.method !== 'POST', // Only rate-limit submissions, not admin reads
});

// Feedback limiter
const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many feedback submissions — please wait before trying again' },
});

// Visitor QR entry limiter — throttles UUID enumeration attempts
const visitorEntryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests — please slow down' },
});

// ── API routes ────────────────────────────────────────────────────────────────
const state = require('./state');
const { extractJwt } = require('./middleware/auth');
app.use((req, res, next) => {
  // Allow admins to login and use /users endpoints during maintenance
  if (state.isMaintenanceMode && !req.path.startsWith('/auth') && !req.path.startsWith('/users')) {
    
    // Whitelist Admin requests from being blocked
    if (req.headers['x-admin-key'] === process.env.ADMIN_API_KEY) {
      return next();
    }
    const payload = extractJwt(req);
    if (payload && payload.role === 'admin') {
      return next();
    }
    
    return res.status(503).json({ error: 'MAINTENANCE_MODE' });
  }
  next();
});

app.use('/auth',        authRouter);
app.use('/users',       usersRouter);
app.use('/events',      eventsRouter);
app.use('/events',      photosRouter);
app.use('/diagnostics', diagnosticsRouter);
app.use('/upload',      uploadRouter);
app.use('/favorites',   favoritesRouter);
app.use('/album',       albumRouter);
app.use('/search',      searchLimiter, searchRouter);
app.use('/contact',     contactLimiter, contactRouter);
app.use('/feedback',    feedbackLimiter, feedbackRouter);
app.use('/notifications', notificationsRouter);
app.use('/collab',        collabRouter);

app.get('/', (req, res) => res.redirect('/landing'));

// Visitor QR entry point — redirect to visitor app with eventId in hash.
// Rate-limited to throttle automated UUID enumeration.
app.get('/e/:eventId', visitorEntryLimiter, (req, res) => {
  res.redirect(`/visitor#${req.params.eventId}`);
});

// ── 404 + Global error handler ────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  // Log full stack trace in development for easier debugging
  if (process.env.NODE_ENV !== 'production') {
    console.error('Unhandled error stack:', err.stack);
  } else {
    console.error('Unhandled error:', err.message);
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ── Boot tasks ────────────────────────────────────────────────────────────────
// Seed default admin user on startup
seedAdminUser().catch(err => {
  console.warn('[boot] Admin seed failed (schema may not have run yet):', err.message);
});

module.exports = app;
