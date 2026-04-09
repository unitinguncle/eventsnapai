require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const eventsRouter = require('./routes/events');
const uploadRouter = require('./routes/upload');
const searchRouter = require('./routes/search');
const photosRouter = require('./routes/photos');
const diagnosticsRouter = require('./routes/diagnostics');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');

const { seedAdminUser } = require('./db/seed');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'DELETE', 'PATCH'],
}));

app.use(express.json());

// Static frontends
app.use('/landing', express.static(path.join(__dirname, '../public/landing')));
app.use('/admin',   express.static(path.join(__dirname, '../public/admin')));
app.use('/photographer', express.static(path.join(__dirname, '../public/photographer')));
app.use('/visitor', express.static(path.join(__dirname, '../public/visitor')));

// Serve static assets (logos, images)
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Rate limiting
const searchLimiter  = rateLimit({ windowMs: 60 * 1000, max: 10,
  message: { error: 'Too many requests — please wait before searching again' } });
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(generalLimiter);

// API routes
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/events', eventsRouter);
app.use('/events', photosRouter);
app.use('/diagnostics', diagnosticsRouter);
app.use('/upload', uploadRouter);
app.use('/search', searchLimiter, searchRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.redirect('/landing'));

// Visitor QR entry point — redirect to visitor app with eventId in hash
app.get('/e/:eventId', (req, res) => {
  res.redirect(`/visitor#${req.params.eventId}`);
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Seed default admin user on startup
seedAdminUser().catch(err => {
  console.warn('[boot] Admin seed failed (schema may not have run yet):', err.message);
});

module.exports = app;
