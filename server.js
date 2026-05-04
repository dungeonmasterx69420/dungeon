const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'dungeon.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS applicants (
    id            TEXT PRIMARY KEY,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT,
    language      TEXT,
    referral      TEXT,
    notes         TEXT,
    type          TEXT NOT NULL DEFAULT 'new',
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS members (
    id                TEXT PRIMARY KEY,
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    email             TEXT NOT NULL,
    phone             TEXT,
    language          TEXT,
    referral          TEXT,
    notes             TEXT,
    stremio_email     TEXT,
    stremio_pass      TEXT,
    applicant_id      TEXT,
    subscription_start DATETIME,
    subscription_end   DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id          TEXT PRIMARY KEY,
    member_id   TEXT NOT NULL,
    member_name TEXT NOT NULL,
    member_email TEXT NOT NULL,
    subject     TEXT NOT NULL,
    message     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add missing columns to existing tables (safe on re-deploy)
try { db.exec(`ALTER TABLE applicants ADD COLUMN type TEXT NOT NULL DEFAULT 'new'`); } catch(e) {}
try { db.exec(`ALTER TABLE members ADD COLUMN subscription_start DATETIME`); } catch(e) {}
try { db.exec(`ALTER TABLE members ADD COLUMN subscription_end DATETIME`); } catch(e) {}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dungeon-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'Too many requests.' } });
const loginLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts.' } });

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireMember(req, res, next) {
  if (req.session && req.session.member) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Admin auth ────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  const adminPassword = (process.env.ADMIN_PASSWORD || 'p00p').trim();
  const submitted = (password || '').trim();
  console.log(`Login attempt. Expected: "${adminPassword}" Got: "${submitted}" Match: ${submitted === adminPassword}`);
  if (submitted !== adminPassword) return res.status(401).json({ error: 'Incorrect password' });
  req.session.authenticated = true;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ ok: true });
  });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authenticated: !!(req.session && req.session.authenticated) }));

// ── Member auth ───────────────────────────────────────────────────────────────
app.post('/api/member/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const member = db.prepare('SELECT * FROM members WHERE LOWER(stremio_email)=LOWER(?)').get(email.trim());
  if (!member || member.stremio_pass !== password.trim())
    return res.status(401).json({ error: 'Incorrect email or password.' });
  req.session.member = { id: member.id, first_name: member.first_name, last_name: member.last_name, email: member.email };
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ ok: true });
  });
});

app.post('/api/member/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/member/me', (req, res) => {
  if (!req.session || !req.session.member) return res.json({ authenticated: false });
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.session.member.id);
  if (!m) return res.json({ authenticated: false });
  res.json({ authenticated: true, member: {
    id: m.id, first_name: m.first_name, last_name: m.last_name, email: m.email,
    subscription_start: m.subscription_start, subscription_end: m.subscription_end,
    stremio_email: m.stremio_email,
  }});
});

// ── Public: submit application ────────────────────────────────────────────────
app.post('/api/apply', submitLimiter, (req, res) => {
  const { first_name, last_name, email, phone, language, referral, notes, type } = req.body;
  if (!first_name || !last_name || !email) return res.status(400).json({ error: 'Name and email are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.prepare(`INSERT INTO applicants (id, first_name, last_name, email, phone, language, referral, notes, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, first_name.trim(), last_name.trim(), email.trim(), phone||'', language||'', referral||'', notes||'', type||'new');
  res.json({ ok: true });
});

// ── Member: renewal application (logged in) ───────────────────────────────────
app.post('/api/member/renew', requireMember, submitLimiter, (req, res) => {
  const m = req.session.member;
  const { notes } = req.body;
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.prepare(`INSERT INTO applicants (id, first_name, last_name, email, notes, type) VALUES (?, ?, ?, ?, ?, 'renewal')`)
    .run(id, m.first_name, m.last_name, m.email, notes||'');
  res.json({ ok: true });
});

// ── Member: support message ───────────────────────────────────────────────────
app.post('/api/member/support', requireMember, submitLimiter, (req, res) => {
  const m = req.session.member;
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.prepare(`INSERT INTO support_messages (id, member_id, member_name, member_email, subject, message) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, m.id, `${m.first_name} ${m.last_name}`, m.email, subject.trim(), message.trim());
  res.json({ ok: true });
});

// ── Admin: applicants ─────────────────────────────────────────────────────────
app.get('/api/applicants', requireAuth, (req, res) => {
  const { status } = req.query;
  const rows = (status && status !== 'all')
    ? db.prepare('SELECT * FROM applicants WHERE status=? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM applicants ORDER BY created_at DESC').all();
  res.json(rows);
});

app.patch('/api/applicants/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE applicants SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/applicants/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM applicants WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Promote new applicant → member with subscription start
app.post('/api/applicants/:id/promote', requireAuth, (req, res) => {
  const applicant = db.prepare('SELECT * FROM applicants WHERE id=?').get(req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Not found' });
  const { stremio_email, stremio_pass } = req.body;
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const now = new Date();
  const end = new Date(now); end.setMonth(end.getMonth() + 1);
  db.prepare(`INSERT INTO members (id, first_name, last_name, email, phone, language, referral, notes, stremio_email, stremio_pass, applicant_id, subscription_start, subscription_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, applicant.first_name, applicant.last_name, applicant.email, applicant.phone, applicant.language, applicant.referral, applicant.notes, stremio_email||'', stremio_pass||'', applicant.id, now.toISOString(), end.toISOString());
  db.prepare('UPDATE applicants SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run('approved', applicant.id);
  res.json({ ok: true });
});

// Renew existing member's subscription by 1 month from today (or from current end if still active)
app.post('/api/members/:id/renew', requireAuth, (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const base = member.subscription_end && new Date(member.subscription_end) > new Date()
    ? new Date(member.subscription_end)
    : new Date();
  const newEnd = new Date(base); newEnd.setMonth(newEnd.getMonth() + 1);
  const newStart = member.subscription_start || new Date().toISOString();
  db.prepare('UPDATE members SET subscription_start=?, subscription_end=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(newStart, newEnd.toISOString(), member.id);
  res.json({ ok: true });
});

// ── Admin: members ────────────────────────────────────────────────────────────
app.get('/api/members', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM members ORDER BY created_at DESC').all());
});

app.patch('/api/members/:id', requireAuth, (req, res) => {
  const { stremio_email, stremio_pass, notes } = req.body;
  db.prepare(`UPDATE members SET stremio_email=?, stremio_pass=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(stremio_email||'', stremio_pass||'', notes||'', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/members/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM members WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Admin: support messages ───────────────────────────────────────────────────
app.get('/api/support', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM support_messages ORDER BY created_at DESC').all());
});

app.patch('/api/support/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['open','resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE support_messages SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/support/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM support_messages WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, (req, res) => {
  res.json({
    applicants: db.prepare('SELECT COUNT(*) as n FROM applicants').get().n,
    pending:    db.prepare("SELECT COUNT(*) as n FROM applicants WHERE status='pending'").get().n,
    members:    db.prepare('SELECT COUNT(*) as n FROM members').get().n,
    denied:     db.prepare("SELECT COUNT(*) as n FROM applicants WHERE status='denied'").get().n,
    support:    db.prepare("SELECT COUNT(*) as n FROM support_messages WHERE status='open'").get().n,
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Dungeon running on port ${PORT}`);
  console.log(`Admin password: "${(process.env.ADMIN_PASSWORD || 'p00p').trim()}"`);
});
