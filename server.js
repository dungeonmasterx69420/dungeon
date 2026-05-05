const express    = require('express');
const Database   = require('better-sqlite3');
const bcrypt     = require('bcryptjs');
const session    = require('express-session');
const rateLimit  = require('express-rate-limit');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

const app  = express();
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
    id                 TEXT PRIMARY KEY,
    first_name         TEXT NOT NULL,
    last_name          TEXT NOT NULL,
    email              TEXT NOT NULL,
    phone              TEXT,
    language           TEXT,
    referral           TEXT,
    notes              TEXT,
    stremio_email      TEXT,
    stremio_pass       TEXT,
    applicant_id       TEXT,
    subscription_start DATETIME,
    subscription_end   DATETIME,
    expiry_warned      INTEGER DEFAULT 0,
    expired_notified   INTEGER DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id           TEXT PRIMARY KEY,
    member_id    TEXT NOT NULL,
    member_name  TEXT NOT NULL,
    member_email TEXT NOT NULL,
    subject      TEXT NOT NULL,
    message      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe column migrations
const migrations = [
  `ALTER TABLE applicants ADD COLUMN type TEXT NOT NULL DEFAULT 'new'`,
  `ALTER TABLE members ADD COLUMN subscription_start DATETIME`,
  `ALTER TABLE members ADD COLUMN subscription_end DATETIME`,
  `ALTER TABLE members ADD COLUMN expiry_warned INTEGER DEFAULT 0`,
  `ALTER TABLE members ADD COLUMN expired_notified INTEGER DEFAULT 0`,
];
for (const m of migrations) { try { db.exec(m); } catch(e) {} }

// ── Mailer ────────────────────────────────────────────────────────────────────
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
const SITE_URL   = (process.env.SITE_URL || 'https://dungeon.onrender.com').replace(/\/$/, '');

const transporter = GMAIL_USER && GMAIL_PASS
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
  : null;

async function sendMail(to, subject, html) {
  if (!transporter) {
    console.log(`[email skipped — no credentials] To: ${to} | Subject: ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"Warden" <${GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[email sent] To: ${to} | Subject: ${subject}`);
  } catch (err) {
    console.error(`[email failed] ${err.message}`);
  }
}

// ── Email templates ───────────────────────────────────────────────────────────
function emailShell(body) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#1a1a1a;font-family:'Cinzel',Georgia,serif;color:#d4c4a8;padding:32px 16px}
  .shell{max-width:560px;margin:0 auto;background:#111009;border:1px solid rgba(180,50,50,0.35)}
  .top-bar{background:#0d0b08;padding:20px 32px;border-bottom:1px solid rgba(180,50,50,0.25);display:flex;align-items:center;gap:10px}
  .top-name{font-size:18px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#cc3333}
  .body{padding:36px 32px}
  .rule{width:100%;height:1px;background:linear-gradient(90deg,transparent,#b22222,transparent);margin:28px 0}
  h2{font-size:20px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#e8dcc8;margin-bottom:16px}
  p{font-size:14px;letter-spacing:0.04em;color:#9a8a78;line-height:1.9;margin-bottom:14px}
  p strong{color:#d4c4a8;font-weight:400}
  .cred-box{background:#0a0806;border:1px solid rgba(180,50,50,0.25);padding:18px 20px;margin:20px 0}
  .cred-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
  .cred-row:last-child{border-bottom:none}
  .cred-label{font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#5a4a38}
  .cred-val{font-size:14px;color:#d4c4a8}
  .btn{display:inline-block;margin-top:24px;padding:14px 28px;background:transparent;border:1px solid #b22222;color:#cc3333;font-family:'Cinzel',Georgia,serif;font-size:12px;letter-spacing:0.35em;text-transform:uppercase;text-decoration:none}
  .footer{padding:18px 32px;border-top:1px solid rgba(180,50,50,0.15);text-align:center;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#3a2a20}
</style>
</head>
<body>
<div class="shell">
  <div class="top-bar">
    <div class="top-name">Dungeon</div>
  </div>
  <div class="body">
    ${body}
  </div>
  <div class="footer">The Warden &mdash; dungeonmasterx69420@gmail.com</div>
</div>
</body>
</html>`;
}

function emailApplicationReceived(firstName) {
  return emailShell(`
    <h2>Petition Received</h2>
    <div class="rule"></div>
    <p>Greetings, <strong>${firstName}</strong>.</p>
    <p>Thy scroll has been delivered to the keeper. It shall be reviewed and thou shalt receive word when a decision has been made.</p>
    <p>Patience is a virtue within these walls.</p>
    <p style="margin-top:24px;font-size:12px;color:#5a4a38">— The Warden</p>
  `);
}

function emailWelcome(firstName, stremioEmail, stremioPass, subEnd) {
  const fmtDate = new Date(subEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return emailShell(`
    <h2>Entry Granted</h2>
    <div class="rule"></div>
    <p>Greetings, <strong>${firstName}</strong>. The gates have been opened. Thou hast been granted access to the Dungeon.</p>
    <p>The Dungeon is thy passage to a world of film and television — without the burden of a separate paid service for every title thou seekest. Rather than subscribing to platform after platform, Stremio serves as thy single portal to it all. One app. Everything.</p>
    <p>Thy Stremio credentials have been prepared:</p>
    <div class="cred-box">
      <div class="cred-row"><span class="cred-label">Email</span><span class="cred-val">${stremioEmail}</span></div>
      <div class="cred-row"><span class="cred-label">Password</span><span class="cred-val">${stremioPass}</span></div>
      <div class="cred-row"><span class="cred-label">Access Expires</span><span class="cred-val">${fmtDate}</span></div>
    </div>
    <p>Head to <strong>web.stremio.com</strong> and sign in. Visit thy dashboard for setup guides, support, and to manage thy subscription.</p>
    <a href="${SITE_URL}/login.html" class="btn">Enter the Dungeon</a>
    <div class="rule"></div>
    <p style="font-size:12px;color:#5a4a38">Keep thy credentials safe. Do not share them. Thy access is personal and non-transferable.</p>
    <p style="margin-top:16px;font-size:12px;color:#5a4a38">— The Warden</p>
  `);
}

function emailExpiringSoon(firstName, subEnd) {
  const fmtDate = new Date(subEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return emailShell(`
    <h2>Thy Access Wanes</h2>
    <div class="rule"></div>
    <p>Greetings, <strong>${firstName}</strong>.</p>
    <p>The torches grow dim. Thy subscription expires on <strong>${fmtDate}</strong> — three days hence.</p>
    <p>If thou wishest to remain within these walls, submit a renewal request from thy dashboard before the gates close.</p>
    <a href="${SITE_URL}/renew.html" class="btn">Request Renewal</a>
    <p style="margin-top:24px;font-size:12px;color:#5a4a38">— The Warden</p>
  `);
}

function emailExpired(firstName) {
  return emailShell(`
    <h2>Thy Access Has Ended</h2>
    <div class="rule"></div>
    <p>Greetings, <strong>${firstName}</strong>.</p>
    <p>Thy subscription has come to its end. The gates have closed. Thy Stremio access will no longer be active.</p>
    <p>Should thou wish to return, submit a new request. The keeper will review it and open the gates once more.</p>
    <a href="${SITE_URL}/apply.html" class="btn">Seek Re-Entry</a>
    <p style="margin-top:24px;font-size:12px;color:#5a4a38">— The Warden</p>
  `);
}

// ── Subscription cron — runs every hour ───────────────────────────────────────
function runSubscriptionCron() {
  const now      = new Date();
  const in3days  = new Date(now); in3days.setDate(in3days.getDate() + 3);

  // Expiring within 3 days — warn once
  const expiring = db.prepare(`
    SELECT * FROM members
    WHERE subscription_end IS NOT NULL
    AND expiry_warned = 0
    AND datetime(subscription_end) <= datetime(?)
    AND datetime(subscription_end) > datetime(?)
  `).all(in3days.toISOString(), now.toISOString());

  for (const m of expiring) {
    sendMail(m.email, 'Thy Access Wanes — Dungeon', emailExpiringSoon(m.first_name, m.subscription_end));
    db.prepare('UPDATE members SET expiry_warned=1 WHERE id=?').run(m.id);
    console.log(`[cron] Expiry warning sent to ${m.email}`);
  }

  // Expired — notify once
  const expired = db.prepare(`
    SELECT * FROM members
    WHERE subscription_end IS NOT NULL
    AND expired_notified = 0
    AND datetime(subscription_end) <= datetime(?)
  `).all(now.toISOString());

  for (const m of expired) {
    sendMail(m.email, 'Thy Access Has Ended — Dungeon', emailExpired(m.first_name));
    db.prepare('UPDATE members SET expired_notified=1 WHERE id=?').run(m.id);
    console.log(`[cron] Expired notification sent to ${m.email}`);
  }
}

// Run cron on startup and every hour
runSubscriptionCron();
setInterval(runSubscriptionCron, 60 * 60 * 1000);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dungeon-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
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

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ── Admin auth ────────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  const adminPassword = (process.env.ADMIN_PASSWORD || 'p00p').trim();
  const submitted = (password || '').trim();
  console.log(`Login attempt. Expected: "${adminPassword}" Got: "${submitted}" Match: ${submitted === adminPassword}`);
  if (submitted !== adminPassword) return res.status(401).json({ error: 'Incorrect password' });
  req.session.authenticated = true;
  req.session.save(err => {
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
  req.session.save(err => {
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
app.post('/api/apply', submitLimiter, async (req, res) => {
  const { first_name, last_name, email, phone, language, referral, notes, type } = req.body;
  if (!first_name || !last_name || !email) return res.status(400).json({ error: 'Name and email are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.prepare(`INSERT INTO applicants (id, first_name, last_name, email, phone, language, referral, notes, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, first_name.trim(), last_name.trim(), email.trim(), phone||'', language||'', referral||'', notes||'', type||'new');

  // Email applicant confirmation
  await sendMail(
    email.trim(),
    'Petition Received — Dungeon',
    emailApplicationReceived(first_name.trim())
  );

  res.json({ ok: true });
});

// ── Member: renewal ───────────────────────────────────────────────────────────
app.post('/api/member/renew', requireMember, submitLimiter, (req, res) => {
  const m = req.session.member;
  const { notes } = req.body;
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.prepare(`INSERT INTO applicants (id, first_name, last_name, email, notes, type) VALUES (?, ?, ?, ?, ?, 'renewal')`)
    .run(id, m.first_name, m.last_name, m.email, notes||'');
  res.json({ ok: true });
});

// ── Member: support ───────────────────────────────────────────────────────────
app.post('/api/member/support', requireMember, submitLimiter, (req, res) => {
  const m = req.session.member;
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.prepare(`INSERT INTO support_messages (id, member_id, member_name, member_email, subject, message) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, m.id, `${m.first_name} ${m.last_name}`, m.email, subject.trim(), message.trim());
  res.json({ ok: true });
});

// ── Member: suggest ───────────────────────────────────────────────────────────
app.post('/api/member/suggest', requireMember, submitLimiter, (req, res) => {
  const m = req.session.member;
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Both fields are required.' });
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.prepare(`INSERT INTO support_messages (id, member_id, member_name, member_email, subject, message) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, m.id, `${m.first_name} ${m.last_name}`, m.email, '[Suggestion] ' + subject.trim(), message.trim());
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

// Promote applicant → member + send welcome email
app.post('/api/applicants/:id/promote', requireAuth, async (req, res) => {
  const applicant = db.prepare('SELECT * FROM applicants WHERE id=?').get(req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Not found' });

  const { stremio_email, stremio_pass } = req.body;
  const id  = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const now = new Date();
  const end = new Date(now); end.setMonth(end.getMonth() + 1);

  db.prepare(`
    INSERT INTO members (id, first_name, last_name, email, phone, language, referral, notes, stremio_email, stremio_pass, applicant_id, subscription_start, subscription_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, applicant.first_name, applicant.last_name, applicant.email,
         applicant.phone, applicant.language, applicant.referral, applicant.notes,
         stremio_email||'', stremio_pass||'', applicant.id,
         now.toISOString(), end.toISOString());

  db.prepare('UPDATE applicants SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run('approved', applicant.id);

  // Send welcome email
  await sendMail(
    applicant.email,
    'Entry Granted — Dungeon',
    emailWelcome(applicant.first_name, stremio_email||'', stremio_pass||'', end.toISOString())
  );

  res.json({ ok: true });
});

// Renew member subscription + reset warning flags
app.post('/api/members/:id/renew', requireAuth, (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const base = member.subscription_end && new Date(member.subscription_end) > new Date()
    ? new Date(member.subscription_end) : new Date();
  const newEnd = new Date(base); newEnd.setMonth(newEnd.getMonth() + 1);
  const newStart = member.subscription_start || new Date().toISOString();
  db.prepare(`UPDATE members SET subscription_start=?, subscription_end=?, expiry_warned=0, expired_notified=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
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
  console.log(`Email: ${transporter ? `configured (${GMAIL_USER})` : 'not configured'}`);
});
