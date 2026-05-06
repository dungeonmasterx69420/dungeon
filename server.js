const express    = require('express');
const Database   = require('better-sqlite3');
const bcrypt     = require('bcryptjs');
const session    = require('express-session');
const rateLimit  = require('express-rate-limit');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Constants ─────────────────────────────────────────────────────────────────
const WARDEN_EMAIL = 'dungeonmasterx69420@gmail.com';

// ── Database ──────────────────────────────────────────────────────────────────
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const AVATAR_DIR  = path.join(DATA_DIR, 'avatars');
if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

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
    screen_name   TEXT,
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
    profile_id         TEXT,
    subscription_start DATETIME,
    subscription_end   DATETIME,
    expiry_warned      INTEGER DEFAULT 0,
    expired_notified   INTEGER DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id            TEXT PRIMARY KEY,
    screen_name   TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    avatar_url    TEXT,
    avatar_color  TEXT NOT NULL DEFAULT '#60a5fa',
    tier          TEXT NOT NULL DEFAULT 'neut',
    applicant_id  TEXT,
    member_id     TEXT,
    setup_done    INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Safe migrations
const migrations = [
  `ALTER TABLE applicants ADD COLUMN type TEXT NOT NULL DEFAULT 'new'`,
  `ALTER TABLE applicants ADD COLUMN screen_name TEXT`,
  `ALTER TABLE members ADD COLUMN subscription_start DATETIME`,
  `ALTER TABLE members ADD COLUMN subscription_end DATETIME`,
  `ALTER TABLE members ADD COLUMN expiry_warned INTEGER DEFAULT 0`,
  `ALTER TABLE members ADD COLUMN expired_notified INTEGER DEFAULT 0`,
  `ALTER TABLE members ADD COLUMN profile_id TEXT`,
];
for (const m of migrations) { try { db.exec(m); } catch(e) {} }

// Tier config
const TIERS = {
  neut:    { label: 'Neut',      color: '#e2e8e4' },
  member:  { label: 'Member',    color: '#60a5fa' },
  mod:     { label: 'Moderator', color: '#34d399' },
  admin:   { label: 'Admin',     color: '#f87171' },
  warden:  { label: 'Warden',    color: '#fbbf24' },
};

function genId() { return crypto.randomBytes(8).toString('hex'); }

function avatarColors() {
  const colors = ['#60a5fa','#34d399','#f87171','#fbbf24','#a78bfa','#fb7185','#38bdf8','#4ade80'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Mailer ────────────────────────────────────────────────────────────────────
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
const SITE_URL   = (process.env.SITE_URL || 'https://dungeon.onrender.com').replace(/\/$/, '');

const transporter = GMAIL_USER && GMAIL_PASS
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS } })
  : null;

async function sendMail(to, subject, html) {
  if (!transporter) { console.log(`[email skipped] To: ${to} | ${subject}`); return; }
  try {
    await transporter.sendMail({ from: `"Warden" <${GMAIL_USER}>`, to, subject, html });
    console.log(`[email sent] To: ${to} | ${subject}`);
  } catch (err) { console.error(`[email failed] ${err.message}`); }
}

function emailShell(body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0b0f0e;font-family:Inter,sans-serif;color:#e2e8e4;padding:32px 16px}.shell{max-width:560px;margin:0 auto;background:#111915;border:1px solid rgba(52,211,153,0.15);border-radius:12px;overflow:hidden}.top{background:#0b0f0e;padding:18px 28px;border-bottom:1px solid rgba(52,211,153,0.12)}.logo{font-size:18px;font-weight:700;color:#34d399;letter-spacing:0.1em}.body{padding:32px 28px}.rule{height:1px;background:linear-gradient(90deg,transparent,rgba(52,211,153,0.3),transparent);margin:24px 0}h2{font-size:18px;font-weight:600;color:#e2e8e4;margin-bottom:12px}p{font-size:14px;color:#94a3a0;line-height:1.8;margin-bottom:12px}p strong{color:#e2e8e4;font-weight:500}.box{background:#172118;border:1px solid rgba(52,211,153,0.15);border-radius:8px;padding:16px 18px;margin:18px 0}.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(52,211,153,0.08);font-size:13px}.row:last-child{border-bottom:none}.lbl{color:#6b8f7a}.val{color:#e2e8e4}.btn{display:inline-block;margin-top:20px;padding:12px 24px;background:#34d399;border-radius:8px;color:#0b0f0e;font-size:13px;font-weight:600;text-decoration:none}.foot{padding:16px 28px;border-top:1px solid rgba(52,211,153,0.08);text-align:center;font-size:11px;color:#6b8f7a}</style>
</head><body><div class="shell"><div class="top"><div class="logo">Dungeon</div></div><div class="body">${body}</div><div class="foot">Dungeon &mdash; ${GMAIL_USER}</div></div></body></html>`;
}

function emailApplicationReceived(firstName, screenName) {
  return emailShell(`<h2>Application Received</h2><div class="rule"></div><p>Hi <strong>${firstName}</strong>,</p><p>Your application has been received. A moderator will review it shortly and you'll hear back at this email address.</p><p>Your username <strong>@${screenName}</strong> has been reserved while your application is pending.</p><br><p style="font-size:12px;color:#6b8f7a">— The Warden</p>`);
}

function emailWelcome(firstName, screenName, stremioEmail, stremioPass, subEnd) {
  const fmtDate = new Date(subEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return emailShell(`<h2>Access Granted</h2><div class="rule"></div><p>Welcome, <strong>${firstName}</strong>. Your application has been approved and your account is ready.</p><p>Dungeon gives you access to a world of film and television through Stremio — one app instead of paying for a separate subscription for every show or movie you want to watch.</p><div class="box"><div class="row"><span class="lbl">Username</span><span class="val">@${screenName}</span></div><div class="row"><span class="lbl">Stremio Email</span><span class="val">${stremioEmail}</span></div><div class="row"><span class="lbl">Stremio Password</span><span class="val">${stremioPass}</span></div><div class="row"><span class="lbl">Access Expires</span><span class="val">${fmtDate}</span></div></div><p>Head to web.stremio.com and sign in, then visit your dashboard for guides, support and more.</p><a href="${SITE_URL}/login.html" class="btn">Go to Dashboard</a><div class="rule"></div><p style="font-size:12px;color:#6b8f7a">Keep your credentials private. Your access is personal and non-transferable. — The Warden</p>`);
}

function emailExpiringSoon(firstName, subEnd) {
  const fmtDate = new Date(subEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return emailShell(`<h2>Subscription Expiring Soon</h2><div class="rule"></div><p>Hi <strong>${firstName}</strong>,</p><p>Your Dungeon subscription expires on <strong>${fmtDate}</strong> — 3 days from now. Submit a renewal request from your dashboard to keep your access.</p><a href="${SITE_URL}/renew.html" class="btn">Request Renewal</a><br><p style="margin-top:20px;font-size:12px;color:#6b8f7a">— The Warden</p>`);
}

function emailExpired(firstName) {
  return emailShell(`<h2>Subscription Expired</h2><div class="rule"></div><p>Hi <strong>${firstName}</strong>,</p><p>Your Dungeon subscription has ended. Your Stremio access is no longer active.</p><p>If you'd like to return, submit a new application and the team will get you set up again.</p><a href="${SITE_URL}/apply.html" class="btn">Apply Again</a><br><p style="margin-top:20px;font-size:12px;color:#6b8f7a">— The Warden</p>`);
}

function emailModApproval(applicantName, screenName, applicantEmail, applicantId) {
  return emailShell(`<h2>Mod Approval — Action Required</h2><div class="rule"></div><p>A moderator has approved an application. You need to create their Stremio account and grant access.</p><div class="box"><div class="row"><span class="lbl">Name</span><span class="val">${applicantName}</span></div><div class="row"><span class="lbl">Username</span><span class="val">@${screenName}</span></div><div class="row"><span class="lbl">Email</span><span class="val">${applicantEmail}</span></div></div><p>Log into the admin panel and grant access to complete the process.</p><a href="${SITE_URL}/admin.html" class="btn">Open Admin Panel</a>`);
}

// ── Cron ──────────────────────────────────────────────────────────────────────
function runSubscriptionCron() {
  const now = new Date();
  const in3days = new Date(now); in3days.setDate(in3days.getDate() + 3);
  const expiring = db.prepare(`SELECT * FROM members WHERE subscription_end IS NOT NULL AND expiry_warned=0 AND datetime(subscription_end)<=datetime(?) AND datetime(subscription_end)>datetime(?)`).all(in3days.toISOString(), now.toISOString());
  for (const m of expiring) {
    sendMail(m.email, 'Your Dungeon subscription is expiring soon', emailExpiringSoon(m.first_name, m.subscription_end));
    db.prepare('UPDATE members SET expiry_warned=1 WHERE id=?').run(m.id);
  }
  const expired = db.prepare(`SELECT * FROM members WHERE subscription_end IS NOT NULL AND expired_notified=0 AND datetime(subscription_end)<=datetime(?)`).all(now.toISOString());
  for (const m of expired) {
    sendMail(m.email, 'Your Dungeon subscription has ended', emailExpired(m.first_name));
    db.prepare('UPDATE members SET expired_notified=1 WHERE id=?').run(m.id);
  }
}
runSubscriptionCron();
setInterval(runSubscriptionCron, 60 * 60 * 1000);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve avatars
app.use('/avatars', express.static(AVATAR_DIR));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dungeon-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
}));

const submitLimiter = rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: 'Too many requests.' } });
const loginLimiter  = rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Too many attempts.' } });

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireMember(req, res, next) {
  if (req.session?.member) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireMod(req, res, next) {
  if (!req.session?.member) return res.status(401).json({ error: 'Unauthorized' });
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id);
  if (!profile || !['mod','admin','warden'].includes(profile.tier)) return res.status(403).json({ error: 'Forbidden' });
  req.profile = profile;
  next();
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
app.get('/api/me', (req, res) => res.json({ authenticated: !!(req.session?.authenticated) }));

// ── Member auth ───────────────────────────────────────────────────────────────
app.post('/api/member/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const member = db.prepare('SELECT * FROM members WHERE LOWER(stremio_email)=LOWER(?)').get(email.trim());
  if (!member || member.stremio_pass !== password.trim()) return res.status(401).json({ error: 'Incorrect email or password.' });
  req.session.member = { id: member.id, first_name: member.first_name, last_name: member.last_name, email: member.email };

  // Ensure a profile exists for existing members who predate the profile system
  const existingProfile = db.prepare('SELECT id FROM profiles WHERE member_id=?').get(member.id);
  if (!existingProfile) {
    // Generate a unique placeholder screen name from their first name
    let baseName = member.first_name.replace(/[^a-zA-Z0-9_]/g,'').slice(0,16) || 'member';
    let screenName = baseName;
    let attempt = 0;
    while (db.prepare('SELECT id FROM profiles WHERE LOWER(screen_name)=LOWER(?)').get(screenName)) {
      attempt++;
      screenName = baseName + attempt;
    }
    // Determine tier — warden if email matches
    const tier = member.email.toLowerCase() === 'dungeonmasterx69420@gmail.com' ? 'warden' : 'member';
    const profileId = genId();
    db.prepare(`INSERT INTO profiles (id, screen_name, email, avatar_color, tier, member_id, setup_done) VALUES (?,?,?,?,?,?,0)`)
      .run(profileId, screenName, member.email, avatarColors(), tier, member.id);
    db.prepare('UPDATE members SET profile_id=? WHERE id=?').run(profileId, member.id);
    console.log(`[profile] Created placeholder profile for existing member ${member.email} → @${screenName}`);
  }

  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ ok: true });
  });
});

app.post('/api/member/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/member/me', (req, res) => {
  if (!req.session?.member) return res.json({ authenticated: false });
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.session.member.id);
  if (!m) return res.json({ authenticated: false });
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(m.id);
  res.json({ authenticated: true, member: {
    id: m.id, first_name: m.first_name, last_name: m.last_name, email: m.email,
    subscription_start: m.subscription_start, subscription_end: m.subscription_end,
    stremio_email: m.stremio_email,
    profile: profile || null,
    setup_done: profile?.setup_done || 0,
  }});
});

// ── Profiles ──────────────────────────────────────────────────────────────────

// Get profile by ID or screen_name (members only)
app.get('/api/profiles/:id', requireMember, (req, res) => {
  const id = req.params.id;
  const profile = id.startsWith('@')
    ? db.prepare('SELECT id,screen_name,avatar_url,avatar_color,tier,created_at FROM profiles WHERE LOWER(screen_name)=LOWER(?)').get(id.slice(1))
    : db.prepare('SELECT id,screen_name,avatar_url,avatar_color,tier,created_at FROM profiles WHERE id=?').get(id);
  if (!profile) return res.status(404).json({ error: 'Not found' });
  res.json(profile);
});

// Directory — all profiles (members only)
app.get('/api/profiles', requireMember, (req, res) => {
  const profiles = db.prepare(`
    SELECT id, screen_name, avatar_url, avatar_color, tier, created_at
    FROM profiles ORDER BY CASE tier WHEN 'warden' THEN 0 WHEN 'admin' THEN 1 WHEN 'mod' THEN 2 WHEN 'member' THEN 3 WHEN 'neut' THEN 4 ELSE 5 END, created_at ASC
  `).all();
  res.json(profiles);
});

// Setup profile (screen name + avatar)
app.post('/api/member/profile/setup', requireMember, (req, res) => {
  const { screen_name, avatar_color } = req.body;
  if (!screen_name) return res.status(400).json({ error: 'Screen name is required.' });

  // Validate screen name: 3-20 chars, alphanumeric + underscore only, no spaces
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(screen_name))
    return res.status(400).json({ error: 'Screen name must be 3–20 characters, letters, numbers and underscores only.' });

  const existing = db.prepare('SELECT id FROM profiles WHERE LOWER(screen_name)=LOWER(?) AND member_id!=?').get(screen_name, req.session.member.id);
  if (existing) return res.status(400).json({ error: 'That username is already taken.' });

  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id);
  if (profile) {
    db.prepare('UPDATE profiles SET screen_name=?, avatar_color=?, setup_done=1, updated_at=CURRENT_TIMESTAMP WHERE member_id=?')
      .run(screen_name.trim(), avatar_color || profile.avatar_color, req.session.member.id);
  } else {
    db.prepare(`INSERT INTO profiles (id, screen_name, email, avatar_color, tier, member_id, setup_done) VALUES (?,?,?,?,?,?,1)`)
      .run(genId(), screen_name.trim(), req.session.member.email, avatar_color || avatarColors(), 'member', req.session.member.id);
  }
  res.json({ ok: true });
});

// Upload avatar (base64 image)
app.post('/api/member/profile/avatar', requireMember, (req, res) => {
  const { image } = req.body; // base64 data URL
  if (!image) return res.status(400).json({ error: 'No image provided.' });

  const matches = image.match(/^data:image\/(jpeg|png|gif|webp);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'Invalid image format.' });

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const data = Buffer.from(matches[2], 'base64');
  if (data.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 5MB.' });

  const filename = `${req.session.member.id}.${ext}`;
  const filepath = path.join(AVATAR_DIR, filename);
  fs.writeFileSync(filepath, data);

  const avatarUrl = `/avatars/${filename}`;
  db.prepare('UPDATE profiles SET avatar_url=?, updated_at=CURRENT_TIMESTAMP WHERE member_id=?')
    .run(avatarUrl, req.session.member.id);

  res.json({ ok: true, avatar_url: avatarUrl });
});

// ── Admin: promote profile tier ───────────────────────────────────────────────
app.patch('/api/admin/profiles/:id/tier', requireAuth, (req, res) => {
  const { tier } = req.body;
  if (!Object.keys(TIERS).includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
  db.prepare('UPDATE profiles SET tier=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(tier, req.params.id);
  res.json({ ok: true });
});

// Admin: get all profiles
app.get('/api/admin/profiles', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all());
});

// ── Mod panel ─────────────────────────────────────────────────────────────────
app.get('/api/mod/applicants', requireMod, (req, res) => {
  const rows = db.prepare("SELECT * FROM applicants WHERE status='pending' ORDER BY created_at DESC").all();
  res.json(rows);
});

app.post('/api/mod/applicants/:id/approve', requireMod, async (req, res) => {
  const applicant = db.prepare('SELECT * FROM applicants WHERE id=?').get(req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Not found' });

  // Mark as mod-approved (pending admin action)
  db.prepare("UPDATE applicants SET status='mod_approved', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(applicant.id);

  // Email the warden
  await sendMail(
    WARDEN_EMAIL,
    `Mod Approval: @${applicant.screen_name || applicant.first_name} — Action Required`,
    emailModApproval(`${applicant.first_name} ${applicant.last_name}`, applicant.screen_name || '—', applicant.email, applicant.id)
  );

  res.json({ ok: true });
});

app.post('/api/mod/applicants/:id/deny', requireMod, (req, res) => {
  db.prepare("UPDATE applicants SET status='denied', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ── Public: submit application ────────────────────────────────────────────────
app.post('/api/apply', submitLimiter, async (req, res) => {
  const { first_name, last_name, email, phone, language, referral, notes, screen_name } = req.body;
  if (!first_name || !last_name || !email) return res.status(400).json({ error: 'Name and email are required.' });
  if (!screen_name) return res.status(400).json({ error: 'A username is required.' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(screen_name)) return res.status(400).json({ error: 'Username must be 3–20 characters, letters, numbers and underscores only.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  // Check screen name not already taken
  const taken = db.prepare('SELECT id FROM profiles WHERE LOWER(screen_name)=LOWER(?)').get(screen_name);
  if (taken) return res.status(400).json({ error: 'That username is already taken. Please choose another.' });

  const id = genId();
  db.prepare(`INSERT INTO applicants (id, first_name, last_name, email, phone, language, referral, notes, screen_name, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`)
    .run(id, first_name.trim(), last_name.trim(), email.trim(), phone||'', language||'', referral||'', notes||'', screen_name.trim());

  // Create a Neut profile immediately
  const profileId = genId();
  db.prepare(`INSERT OR IGNORE INTO profiles (id, screen_name, email, avatar_color, tier, applicant_id) VALUES (?,?,?,?,'neut',?)`)
    .run(profileId, screen_name.trim(), email.trim(), avatarColors(), id);

  await sendMail(email.trim(), 'Application Received — Dungeon', emailApplicationReceived(first_name.trim(), screen_name.trim()));
  res.json({ ok: true });
});

// ── Member: renewal ───────────────────────────────────────────────────────────
app.post('/api/member/renew', requireMember, submitLimiter, (req, res) => {
  const m = req.session.member;
  const { notes } = req.body;
  db.prepare(`INSERT INTO applicants (id, first_name, last_name, email, notes, type) VALUES (?, ?, ?, ?, ?, 'renewal')`)
    .run(genId(), m.first_name, m.last_name, m.email, notes||'');
  res.json({ ok: true });
});

// ── Member: support ───────────────────────────────────────────────────────────
app.post('/api/member/support', requireMember, submitLimiter, (req, res) => {
  const m = req.session.member;
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });
  db.prepare(`INSERT INTO support_messages (id, member_id, member_name, member_email, subject, message) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(genId(), m.id, `${m.first_name} ${m.last_name}`, m.email, subject.trim(), message.trim());
  res.json({ ok: true });
});

// ── Member: suggest ───────────────────────────────────────────────────────────
app.post('/api/member/suggest', requireMember, submitLimiter, (req, res) => {
  const m = req.session.member;
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Both fields are required.' });
  db.prepare(`INSERT INTO support_messages (id, member_id, member_name, member_email, subject, message) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(genId(), m.id, `${m.first_name} ${m.last_name}`, m.email, '[Suggestion] ' + subject.trim(), message.trim());
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
  if (!['pending','approved','denied','mod_approved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE applicants SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/applicants/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM applicants WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Promote applicant → member + profile upgrade
app.post('/api/applicants/:id/promote', requireAuth, async (req, res) => {
  const applicant = db.prepare('SELECT * FROM applicants WHERE id=?').get(req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Not found' });

  const { stremio_email, stremio_pass } = req.body;
  const memberId = genId();
  const now = new Date();
  const end = new Date(now); end.setMonth(end.getMonth() + 1);

  db.prepare(`INSERT INTO members (id, first_name, last_name, email, phone, language, referral, notes, stremio_email, stremio_pass, applicant_id, subscription_start, subscription_end) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(memberId, applicant.first_name, applicant.last_name, applicant.email, applicant.phone, applicant.language, applicant.referral, applicant.notes, stremio_email||'', stremio_pass||'', applicant.id, now.toISOString(), end.toISOString());

  db.prepare('UPDATE applicants SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run('approved', applicant.id);

  // Upgrade profile: neut → member, link member_id
  const profile = db.prepare('SELECT * FROM profiles WHERE applicant_id=?').get(applicant.id);
  if (profile) {
    db.prepare("UPDATE profiles SET tier='member', member_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(memberId, profile.id);
    db.prepare('UPDATE members SET profile_id=? WHERE id=?').run(profile.id, memberId);
  } else {
    // Create profile if it didn't exist yet
    const profileId = genId();
    db.prepare(`INSERT INTO profiles (id, screen_name, email, avatar_color, tier, applicant_id, member_id) VALUES (?,?,?,?,'member',?,?)`)
      .run(profileId, applicant.screen_name || applicant.first_name, applicant.email, avatarColors(), applicant.id, memberId);
    db.prepare('UPDATE members SET profile_id=? WHERE id=?').run(profileId, memberId);
  }

  // Warden profile is special
  if (applicant.email.toLowerCase() === WARDEN_EMAIL.toLowerCase()) {
    const prof = db.prepare('SELECT id FROM profiles WHERE member_id=?').get(memberId);
    if (prof) db.prepare("UPDATE profiles SET tier='warden' WHERE id=?").run(prof.id);
  }

  await sendMail(applicant.email, 'Access Granted — Dungeon', emailWelcome(applicant.first_name, applicant.screen_name||applicant.first_name, stremio_email||'', stremio_pass||'', end.toISOString()));
  res.json({ ok: true });
});

// Renew member
app.post('/api/members/:id/renew', requireAuth, (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const base = member.subscription_end && new Date(member.subscription_end) > new Date() ? new Date(member.subscription_end) : new Date();
  const newEnd = new Date(base); newEnd.setMonth(newEnd.getMonth() + 1);
  db.prepare(`UPDATE members SET subscription_start=?, subscription_end=?, expiry_warned=0, expired_notified=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(member.subscription_start || new Date().toISOString(), newEnd.toISOString(), member.id);
  res.json({ ok: true });
});

// ── Admin: members ────────────────────────────────────────────────────────────
app.get('/api/members', requireAuth, (req, res) => {
  const members = db.prepare('SELECT m.*, p.id as profile_id_val, p.screen_name, p.tier, p.avatar_url, p.avatar_color FROM members m LEFT JOIN profiles p ON p.member_id=m.id ORDER BY m.created_at DESC').all();
  res.json(members);
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

// ── Admin: support ────────────────────────────────────────────────────────────
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
    mod_approved: db.prepare("SELECT COUNT(*) as n FROM applicants WHERE status='mod_approved'").get().n,
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Dungeon running on port ${PORT}`);
  console.log(`Admin password: "${(process.env.ADMIN_PASSWORD || 'p00p').trim()}"`);
  console.log(`Warden email: ${WARDEN_EMAIL}`);
  console.log(`Email: ${transporter ? `configured (${GMAIL_USER})` : 'not configured'}`);
});
