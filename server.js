const express = require('express');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database setup ────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'streamhub.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id          TEXT PRIMARY KEY,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    email       TEXT NOT NULL,
    phone       TEXT,
    language    TEXT,
    referral    TEXT,
    notes       TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Mailer setup ──────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// Rate limiter for form submissions
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many requests. Please try again later.' },
});

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check (Render uses this)
app.get('/health', (req, res) => res.json({ ok: true }));

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminHash) {
    // Fallback for first-time setup: plain text comparison
    const plainPassword = process.env.ADMIN_PASSWORD || 'admin123';
    if (password !== plainPassword) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
  } else {
    const match = await bcrypt.compare(password, adminHash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });
  }

  req.session.authenticated = true;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ── Submit request (public) ───────────────────────────────────────────────────
app.post('/api/request', submitLimiter, async (req, res) => {
  const { first_name, last_name, email, phone, language, referral, notes } = req.body;

  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);

  db.prepare(`
    INSERT INTO requests (id, first_name, last_name, email, phone, language, referral, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, first_name.trim(), last_name.trim(), email.trim(), phone||'', language||'', referral||'', notes||'');

  // Send email notification
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      await transporter.sendMail({
        from: `"StreamHub" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `📺 New Stremio request from ${first_name} ${last_name}`,
        html: `
          <div style="font-family:monospace;background:#0a0a0f;color:#eef2f7;padding:32px;max-width:560px">
            <h2 style="color:#e8412a;letter-spacing:4px;font-size:18px">NEW REQUEST</h2>
            <table style="width:100%;border-collapse:collapse;margin-top:20px">
              <tr><td style="padding:8px 0;color:#888;width:120px">Name</td><td style="padding:8px 0">${first_name} ${last_name}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0">${email}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0">${phone || '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Language</td><td style="padding:8px 0">${language || '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Referred by</td><td style="padding:8px 0">${referral || '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#888">Notes</td><td style="padding:8px 0">${notes || '—'}</td></tr>
            </table>
            <div style="margin-top:24px">
              <a href="${process.env.SITE_URL || ''}/admin.html" style="background:#e8412a;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;letter-spacing:2px">OPEN ADMIN PANEL</a>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error('Email send failed:', err.message);
      // Don't fail the request just because email failed
    }
  }

  res.json({ ok: true });
});

// ── Admin API (protected) ─────────────────────────────────────────────────────
app.get('/api/requests', requireAuth, (req, res) => {
  const { status } = req.query;
  const rows = status && status !== 'all'
    ? db.prepare('SELECT * FROM requests WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM requests ORDER BY created_at DESC').all();
  res.json(rows);
});

app.get('/api/stats', requireAuth, (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) as n FROM requests').get().n;
  const pending = db.prepare("SELECT COUNT(*) as n FROM requests WHERE status='pending'").get().n;
  const done    = db.prepare("SELECT COUNT(*) as n FROM requests WHERE status='done'").get().n;
  const skipped = db.prepare("SELECT COUNT(*) as n FROM requests WHERE status='skipped'").get().n;
  res.json({ total, pending, done, skipped });
});

app.patch('/api/requests/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'done', 'skipped'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  db.prepare("UPDATE requests SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/requests/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM requests WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`StreamHub running on port ${PORT}`);
});
