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

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'DELETE'],
}));

app.use(express.json());

// Static frontends
app.use('/admin',   express.static(path.join(__dirname, '../public/admin')));
app.use('/visitor', express.static(path.join(__dirname, '../public/visitor')));

// Rate limiting
const searchLimiter  = rateLimit({ windowMs: 60 * 1000, max: 10,
  message: { error: 'Too many requests — please wait before searching again' } });
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(generalLimiter);

// API routes
app.use('/events', eventsRouter);
app.use('/events', photosRouter);
app.use('/diagnostics', diagnosticsRouter);
app.use('/upload', uploadRouter);
app.use('/search', searchLimiter, searchRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.redirect('/admin'));

// Visitor QR entry point — redirect to visitor app with eventId in hash
app.get('/e/:eventId', (req, res) => {
  res.redirect(`/visitor#${req.params.eventId}`);
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
