require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const path     = require('path');
const rateLimit = require('express-rate-limit');
const morgan   = require('morgan');
const db       = require('./db/client');

const eventsRouter      = require('./routes/events');
const uploadRouter      = require('./routes/upload');
const searchRouter      = require('./routes/search');
const photosRouter      = require('./routes/photos');
const diagnosticsRouter = require('./routes/diagnostics');
const authRouter        = require('./routes/auth');
const usersRouter       = require('./routes/users');
const favoritesRouter   = require('./routes/favorites');
const contactRouter     = require('./routes/contact');

const { seedAdminUser } = require('./db/seed');

const app = express();

// ── Trust proxy ───────────────────────────────────────────────────────────────
// Chain: Browser → Cloudflare (hop 1) → Nginx Proxy Manager (hop 2) → App
// Setting this to 2 ensures req.ip reflects the real client IP so that
// rate limiting works correctly and isn't fooled by Cloudflare's IP range.
app.set('trust proxy', 2);

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'],
}));

app.use(express.json());

// ── HTTP access logging ───────────────────────────────────────────────────────
// morgan logs every request to stdout (Docker logs).
// Format: method path status response-time ms - bytes
// /health is skipped — it fires every 30s from the Docker health check
// and would drown out real traffic in production logs.
app.use(morgan('combined', {
  skip: (req) => req.path === '/health',
}));

// ── Static frontends ──────────────────────────────────────────────────────────
app.use('/landing', express.static(path.join(__dirname, '../public/landing')));
app.use('/admin',   express.static(path.join(__dirname, '../public/admin')));
app.use('/manager', express.static(path.join(__dirname, '../public/manager')));
app.use('/client',  express.static(path.join(__dirname, '../public/client')));
app.use('/visitor', express.static(path.join(__dirname, '../public/visitor')));

// Serve static assets (logos, images)
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

// ── Rate limiting ─────────────────────────────────────────────────────────────
// General limiter — applied to all routes below (health is already served above)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
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
});

// Visitor QR entry limiter — throttles UUID enumeration attempts
const visitorEntryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests — please slow down' },
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/auth',        authRouter);
app.use('/users',       usersRouter);
app.use('/events',      eventsRouter);
app.use('/events',      photosRouter);
app.use('/diagnostics', diagnosticsRouter);
app.use('/upload',      uploadRouter);
app.use('/favorites',   favoritesRouter);
app.use('/search',      searchLimiter, searchRouter);
app.use('/contact',     contactLimiter, contactRouter);

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
