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




  CREATE TABLE IF NOT EXISTS iptv_accounts (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL UNIQUE,
    nodecast_user   TEXT,
    xtream_url      TEXT,
    xtream_user     TEXT,
    xtream_pass     TEXT,
    status          TEXT DEFAULT 'pending',
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS credits (
    id         TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    amount     INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS credit_transactions (
    id          TEXT PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    type        TEXT NOT NULL,
    note        TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id                  TEXT PRIMARY KEY,
    sender_profile_id   TEXT NOT NULL,
    recipient_profile_id TEXT NOT NULL,
    subject             TEXT NOT NULL,
    content             TEXT NOT NULL,
    read                INTEGER DEFAULT 0,
    deleted_by_sender   INTEGER DEFAULT 0,
    deleted_by_recipient INTEGER DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS forum_categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    position    INTEGER DEFAULT 0,
    restricted  INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS forum_threads (
    id           TEXT PRIMARY KEY,
    category_id  TEXT NOT NULL,
    profile_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    pinned       INTEGER DEFAULT 0,
    locked       INTEGER DEFAULT 0,
    post_count   INTEGER DEFAULT 0,
    last_post_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS forum_posts (
    id         TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    content    TEXT NOT NULL,
    edited_at  DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS forum_notifications (
    id         TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    thread_id  TEXT NOT NULL,
    post_id    TEXT NOT NULL,
    read       INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  warden:  { label: 'Dungeon Master',    color: '#fbbf24' },
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
    await transporter.sendMail({ from: `"Dungeon Master" <${GMAIL_USER}>`, to, subject, html });
    console.log(`[email sent] To: ${to} | ${subject}`);
  } catch (err) { console.error(`[email failed] ${err.message}`); }
}

function emailShell(body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0b0f0e;font-family:Inter,sans-serif;color:#e2e8e4;padding:32px 16px}.shell{max-width:560px;margin:0 auto;background:#111915;border:1px solid rgba(52,211,153,0.15);border-radius:12px;overflow:hidden}.top{background:#0b0f0e;padding:18px 28px;border-bottom:1px solid rgba(52,211,153,0.12)}.logo{font-size:18px;font-weight:700;color:#34d399;letter-spacing:0.1em}.body{padding:32px 28px}.rule{height:1px;background:linear-gradient(90deg,transparent,rgba(52,211,153,0.3),transparent);margin:24px 0}h2{font-size:18px;font-weight:600;color:#e2e8e4;margin-bottom:12px}p{font-size:14px;color:#94a3a0;line-height:1.8;margin-bottom:12px}p strong{color:#e2e8e4;font-weight:500}.box{background:#172118;border:1px solid rgba(52,211,153,0.15);border-radius:8px;padding:16px 18px;margin:18px 0}.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(52,211,153,0.08);font-size:13px}.row:last-child{border-bottom:none}.lbl{color:#6b8f7a}.val{color:#e2e8e4}.btn{display:inline-block;margin-top:20px;padding:12px 24px;background:#34d399;border-radius:8px;color:#0b0f0e;font-size:13px;font-weight:600;text-decoration:none}.foot{padding:16px 28px;border-top:1px solid rgba(52,211,153,0.08);text-align:center;font-size:11px;color:#6b8f7a}</style>
</head><body><div class="shell"><div class="top"><div class="logo">Dungeon</div></div><div class="body">${body}</div><div class="foot">Dungeon &mdash; ${GMAIL_USER}</div></div></body></html>`;
}

function emailApplicationReceived(firstName, screenName) {
  return emailShell(`<h2>Application Received</h2><div class="rule"></div><p>Hi <strong>${firstName}</strong>,</p><p>Your application has been received. A moderator will review it shortly and you'll hear back at this email address.</p><p>Your username <strong>@${screenName}</strong> has been reserved while your application is pending.</p><br><p style="font-size:12px;color:#6b8f7a">— The Dungeon Master</p>`);
}

function emailWelcome(firstName, screenName, stremioEmail, stremioPass, subEnd) {
  const fmtDate = new Date(subEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return emailShell(`<h2>Welcome to Dungeon</h2><div class="rule"></div><p>Welcome, <strong>${firstName}</strong>. Your application has been approved and your Dungeon account is ready.</p><div class="box"><div class="row"><span class="lbl">Username</span><span class="val">@${screenName}</span></div></div><p>Log into your dashboard to get started. When you're ready to activate a service, redeem a credit from your dashboard.</p><a href="${SITE_URL}/login.html" class="btn">Go to Dashboard</a><div class="rule"></div><p style="font-size:12px;color:#6b8f7a">— The Dungeon Master</p>`);
}

function emailExpiringSoon(firstName, subEnd) {
  const fmtDate = new Date(subEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return emailShell(`<h2>Subscription Expiring Soon</h2><div class="rule"></div><p>Hi <strong>${firstName}</strong>,</p><p>Your Dungeon subscription expires on <strong>${fmtDate}</strong> — 3 days from now. Submit a renewal request from your dashboard to keep your access.</p><a href="${SITE_URL}/renew.html" class="btn">Request Renewal</a><br><p style="margin-top:20px;font-size:12px;color:#6b8f7a">— The Dungeon Master</p>`);
}

function emailExpired(firstName) {
  return emailShell(`<h2>Subscription Expired</h2><div class="rule"></div><p>Hi <strong>${firstName}</strong>,</p><p>Your Dungeon subscription has ended. Your Stremio access is no longer active.</p><p>If you'd like to return, submit a new application and the team will get you set up again.</p><a href="${SITE_URL}/apply.html" class="btn">Apply Again</a><br><p style="margin-top:20px;font-size:12px;color:#6b8f7a">— The Dungeon Master</p>`);
}

function emailModApproval(applicantName, screenName, applicantEmail, applicantId) {
  return emailShell(`<h2>Mod Approval — Action Required</h2><div class="rule"></div><p>A moderator has approved an application. You need to create their Stremio account and grant access.</p><div class="box"><div class="row"><span class="lbl">Name</span><span class="val">${applicantName}</span></div><div class="row"><span class="lbl">Username</span><span class="val">@${screenName}</span></div><div class="row"><span class="lbl">Email</span><span class="val">${applicantEmail}</span></div></div><p>Log into the admin panel and grant access to complete the process.</p><a href="${SITE_URL}/admin.html" class="btn">Open Dungeon Master Panel</a>`);
}




  // Add archived column to applicants if not exists
  try { db.prepare('ALTER TABLE applicants ADD COLUMN archived INTEGER DEFAULT 0').run(); } catch(e) {}

  // ── Migrate: add Stremio + IPTV subscription columns ────────────────────────
  const migrateSteps = [
    'ALTER TABLE members ADD COLUMN stremio_start DATETIME',
    'ALTER TABLE members ADD COLUMN stremio_end   DATETIME',
    'ALTER TABLE members ADD COLUMN iptv_start    DATETIME',
    'ALTER TABLE members ADD COLUMN iptv_end      DATETIME',
  ];
  for (const sql of migrateSteps) {
    try { db.prepare(sql).run(); } catch(e) { /* column already exists */ }
  }

  // Reset all existing subscriptions to null (fresh launch)
  try {
    db.prepare("UPDATE members SET subscription_start=NULL, subscription_end=NULL, stremio_start=NULL, stremio_end=NULL, iptv_start=NULL, iptv_end=NULL").run();
  } catch(e) {}

// ── Seed forum categories ─────────────────────────────────────────────────────
(function seedCategories() {
  const count = db.prepare('SELECT COUNT(*) as n FROM forum_categories').get().n;
  if (count > 0) return;
  const cats = [
    { id: genId(), name: 'Announcements', description: 'Official updates from the Dungeon Master.', position: 0, restricted: 1 },
    { id: genId(), name: 'General',       description: 'General discussion for members.',   position: 1, restricted: 0 },
    { id: genId(), name: 'Help & Support',description: 'Need help? Ask here.',              position: 2, restricted: 0 },
    { id: genId(), name: 'Recommendations',description: 'Share and discover great content.', position: 3, restricted: 0 },
    { id: genId(), name: 'Off Topic',     description: 'Anything goes.',                    position: 4, restricted: 0 },
  ];
  for (const c of cats) {
    db.prepare('INSERT INTO forum_categories (id,name,description,position,restricted) VALUES (?,?,?,?,?)').run(c.id,c.name,c.description,c.position,c.restricted);
  }
  console.log('[forum] Default categories seeded');
})();

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

  // Find profile — try member_id first, then email fallback for legacy accounts
  let profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(m.id);
  if (!profile) {
    profile = db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(m.email);
    // If found by email, fix the link so future lookups work
    if (profile) {
      db.prepare('UPDATE profiles SET member_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(m.id, profile.id);
      db.prepare('UPDATE members SET profile_id=? WHERE id=?').run(profile.id, m.id);
    }
  }

  res.json({ authenticated: true, member: {
    id: m.id, first_name: m.first_name, last_name: m.last_name, email: m.email,
    subscription_start: m.subscription_start, subscription_end: m.subscription_end,
    stremio_email: m.stremio_email,
    stremio_pass: m.stremio_pass,
    stremio_start: m.stremio_start,
    stremio_end: m.stremio_end,
    iptv_start: m.iptv_start,
    iptv_end: m.iptv_end,
    profile: profile || null,
    setup_done: profile ? (profile.setup_done || 0) : 0,
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

  let profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id);
  // Fallback: find by email if member_id link is missing (existing members)
  if (!profile) {
    profile = db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
    if (profile) {
      // Link the member_id so future lookups work
      db.prepare('UPDATE profiles SET member_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.session.member.id, profile.id);
      db.prepare('UPDATE members SET profile_id=? WHERE id=?').run(profile.id, req.session.member.id);
    }
  }
  if (profile) {
    db.prepare('UPDATE profiles SET screen_name=?, avatar_color=?, setup_done=1, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(screen_name.trim(), avatar_color || profile.avatar_color, profile.id);
  } else {
    db.prepare('INSERT INTO profiles (id, screen_name, email, avatar_color, tier, member_id, setup_done) VALUES (?,?,?,?,?,?,1)')
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

  db.prepare(`INSERT INTO members (id, first_name, last_name, email, phone, language, referral, notes, stremio_email, stremio_pass, applicant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(memberId, applicant.first_name, applicant.last_name, applicant.email, applicant.phone, applicant.language, applicant.referral, applicant.notes, stremio_email||'', stremio_pass||'', applicant.id);

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

  await sendMail(applicant.email, 'Welcome to Dungeon', emailWelcome(applicant.first_name, applicant.screen_name||applicant.first_name, '', '', ''));
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
  const members = db.prepare('SELECT m.*, p.id as profile_id_val, p.screen_name, p.tier, p.avatar_url, p.avatar_color, COALESCE(c.amount,0) as credit_balance FROM members m LEFT JOIN profiles p ON p.member_id=m.id LEFT JOIN credits c ON c.profile_id=p.id ORDER BY m.created_at DESC').all();
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






// ── Admin: Stremio subscriptions ──────────────────────────────────────────────

app.get('/api/admin/stremio', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.first_name, m.last_name, m.email, m.stremio_email, m.stremio_pass,
           m.stremio_start, m.stremio_end,
           p.screen_name, p.avatar_url, p.avatar_color, p.tier, p.id as profile_id
    FROM members m
    LEFT JOIN profiles p ON p.member_id = m.id
    ORDER BY m.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/admin/stremio/:memberId', requireAuth, (req, res) => {
  const { stremio_email, stremio_pass, stremio_start, stremio_end } = req.body;
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.memberId);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  db.prepare(`UPDATE members SET stremio_email=?, stremio_pass=?, stremio_start=?, stremio_end=? WHERE id=?`)
    .run(stremio_email||m.stremio_email, stremio_pass||m.stremio_pass, stremio_start||null, stremio_end||null, req.params.memberId);
  res.json({ ok: true });
});

// Admin: update IPTV subscription dates
app.post('/api/admin/iptv-dates/:memberId', requireAuth, (req, res) => {
  const { iptv_start, iptv_end } = req.body;
  db.prepare('UPDATE members SET iptv_start=?, iptv_end=? WHERE id=?')
    .run(iptv_start||null, iptv_end||null, req.params.memberId);
  res.json({ ok: true });
});

// ── IPTV Accounts ─────────────────────────────────────────────────────────────

// Get all IPTV accounts (admin)
app.get('/api/admin/iptv', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, p.screen_name, p.email, p.avatar_url, p.avatar_color, p.tier
    FROM iptv_accounts i
    JOIN profiles p ON i.profile_id = p.id
    ORDER BY i.created_at DESC
  `).all();
  res.json(rows);
});

// Get my IPTV account (member)
app.get('/api/iptv/me', requireMember, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.json(null);
  const account = db.prepare('SELECT * FROM iptv_accounts WHERE profile_id=?').get(profile.id);
  res.json(account || null);
});

// Create or update IPTV account (admin)
app.post('/api/admin/iptv/:profileId', requireAuth, (req, res) => {
  const { nodecast_user, xtream_url, xtream_user, xtream_pass, status, notes } = req.body;
  const profileId = req.params.profileId;
  const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const existing = db.prepare('SELECT * FROM iptv_accounts WHERE profile_id=?').get(profileId);
  if (existing) {
    db.prepare(`UPDATE iptv_accounts SET nodecast_user=?, xtream_url=?, xtream_user=?, xtream_pass=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE profile_id=?`)
      .run(nodecast_user||existing.nodecast_user, xtream_url||existing.xtream_url, xtream_user||existing.xtream_user, xtream_pass||existing.xtream_pass, status||existing.status, notes||existing.notes, profileId);
  } else {
    db.prepare(`INSERT INTO iptv_accounts (id,profile_id,nodecast_user,xtream_url,xtream_user,xtream_pass,status,notes) VALUES (?,?,?,?,?,?,?,?)`)
      .run(genId(), profileId, nodecast_user||'', xtream_url||'', xtream_user||'', xtream_pass||'', status||'pending', notes||'');
  }
  res.json({ ok: true });
});

// Delete IPTV account (admin)
app.delete('/api/admin/iptv/:profileId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM iptv_accounts WHERE profile_id=?').run(req.params.profileId);
  res.json({ ok: true });
});


// ── Buy Me a Coffee Webhook ───────────────────────────────────────────────────
// Each "extra" purchase = 1 credit. Member must include @screenname in message.
app.post('/api/webhook/bmac', express.raw({type:'application/json'}), (req, res) => {
  try {
    const payload = JSON.parse(req.body.toString());
    const type = payload.type || payload.response_message_type;

    // Only handle successful payments
    if (!['succeeded','payment_succeeded','extra.purchased'].some(t => JSON.stringify(payload).includes(t))) {
      return res.json({ ok: true });
    }

    const data = payload.data || payload.response || payload;
    const message = (data.message || data.supporter_message || data.note || '').toLowerCase();
    const amount = parseFloat(data.amount || data.total_amount || 5);
    const creditsToAdd = Math.max(1, Math.floor(amount / 5));

    // Extract @screenname from message
    const match = message.match(/@([a-z0-9_]+)/i);
    if (!match) {
      console.log('[BMAC] No @screenname in message:', message);
      return res.json({ ok: true, note: 'No screenname found' });
    }

    const screenName = match[1].toLowerCase();
    const profile = db.prepare("SELECT * FROM profiles WHERE LOWER(screen_name)=?").get(screenName);
    if (!profile) {
      console.log('[BMAC] Profile not found for:', screenName);
      return res.json({ ok: true, note: 'Profile not found' });
    }

    // Add credits
    addCredit(profile.id, creditsToAdd, 'purchased', `Buy Me a Coffee — $${amount}`);

    // Check referral credit
    const member = db.prepare('SELECT * FROM members WHERE id=?').get(profile.member_id);
    if (member && member.referral) {
      const referrerProfile = db.prepare("SELECT * FROM profiles WHERE LOWER(screen_name)=LOWER(?)").get(member.referral);
      if (referrerProfile) {
        const alreadyRewarded = db.prepare("SELECT * FROM credit_transactions WHERE profile_id=? AND note LIKE ?").get(referrerProfile.id, `%Referral%${profile.screen_name}%`);
        if (!alreadyRewarded) {
          addCredit(referrerProfile.id, 1, 'referral', `Referral bonus — @${profile.screen_name} made their first purchase`);
        }
      }
    }

    // Notify via Dungeon message
    const warden = db.prepare("SELECT * FROM profiles WHERE tier='warden' LIMIT 1").get();
    if (warden) {
      db.prepare('INSERT INTO messages (id,sender_profile_id,recipient_profile_id,subject,content) VALUES (?,?,?,?,?)')
        .run(genId(), warden.id, profile.id, 'Credits Added', `${creditsToAdd} credit${creditsToAdd>1?'s':''} have been added to your account from your Buy Me a Coffee purchase. Enjoy!`);
    }

    console.log('[BMAC] Added', creditsToAdd, 'credits to', screenName);
    res.json({ ok: true, credits_added: creditsToAdd, profile: screenName });
  } catch(e) {
    console.error('[BMAC] Webhook error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Credits ───────────────────────────────────────────────────────────────────

function getOrCreateCredits(profileId) {
  let row = db.prepare('SELECT * FROM credits WHERE profile_id=?').get(profileId);
  if (!row) {
    db.prepare('INSERT INTO credits (id, profile_id, amount) VALUES (?,?,0)').run(genId(), profileId);
    row = db.prepare('SELECT * FROM credits WHERE profile_id=?').get(profileId);
  }
  return row;
}

function addCredit(profileId, amount, type, note) {
  getOrCreateCredits(profileId);
  db.prepare('UPDATE credits SET amount=amount+?, updated_at=CURRENT_TIMESTAMP WHERE profile_id=?').run(amount, profileId);
  db.prepare('INSERT INTO credit_transactions (id,profile_id,amount,type,note) VALUES (?,?,?,?,?)').run(genId(), profileId, amount, type, note||'');
}

function deductCredit(profileId, amount, type, note) {
  const row = getOrCreateCredits(profileId);
  if (row.amount < amount) return false;
  db.prepare('UPDATE credits SET amount=amount-?, updated_at=CURRENT_TIMESTAMP WHERE profile_id=?').run(amount, profileId);
  db.prepare('INSERT INTO credit_transactions (id,profile_id,amount,type,note) VALUES (?,?,?,?,?)').run(genId(), profileId, -amount, type, note||'');
  return true;
}

// Get my balance + history
app.get('/api/credits', requireMember, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.json({ balance: 0, transactions: [] });
  const row = getOrCreateCredits(profile.id);
  const transactions = db.prepare(`
    SELECT ct.*, p.screen_name as actor_name
    FROM credit_transactions ct
    LEFT JOIN profiles p ON p.id = ct.profile_id
    WHERE ct.profile_id=?
    ORDER BY ct.created_at DESC LIMIT 50
  `).all(profile.id);
  res.json({ balance: row.amount, transactions, profile_id: profile.id, screen_name: profile.screen_name });
});

// Leaderboard — top referrers
app.get('/api/credits/leaderboard', requireMember, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.screen_name, p.avatar_url, p.avatar_color, p.tier,
           COALESCE(SUM(CASE WHEN ct.type='referral' AND ct.amount > 0 THEN ct.amount ELSE 0 END), 0) as referral_credits
    FROM profiles p
    LEFT JOIN credit_transactions ct ON ct.profile_id = p.id
    GROUP BY p.id
    HAVING referral_credits > 0
    ORDER BY referral_credits DESC
    LIMIT 20
  `).all();
  res.json(rows);
});

// Admin: get all credit balances
app.get('/api/admin/credits', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.screen_name, p.email, p.tier, p.avatar_url, p.avatar_color,
           COALESCE(c.amount, 0) as balance
    FROM profiles p
    LEFT JOIN credits c ON c.profile_id = p.id
    ORDER BY balance DESC, p.screen_name ASC
  `).all();
  res.json(rows);
});

// Admin: add or remove credits — also fires referral credit automatically
app.post('/api/admin/credits/:profileId', requireAuth, (req, res) => {
  const { amount, type, note } = req.body;
  const profileId = req.params.profileId;
  const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const amt = parseInt(amount);
  if (isNaN(amt) || amt === 0) return res.status(400).json({ error: 'Invalid amount' });

  if (amt > 0) {
    addCredit(profileId, amt, type || 'purchased', note || 'Added by Dungeon Master');
  } else {
    const ok = deductCredit(profileId, Math.abs(amt), type || 'deducted', note || 'Removed by Dungeon Master');
    if (!ok) return res.status(400).json({ error: 'Insufficient credits' });
  }

  // If this is a purchase credit and the profile was referred by someone, reward the referrer
  if (amt > 0 && (type === 'purchased' || !type)) {
    const member = db.prepare('SELECT * FROM members WHERE profile_id=?').get(profileId)
      || db.prepare('SELECT * FROM members WHERE id=(SELECT member_id FROM profiles WHERE id=?)').get(profileId);
    if (member) {
      const applicant = db.prepare('SELECT * FROM applicants WHERE id=?').get(member.applicant_id);
      if (applicant?.referral) {
        // Find referrer profile by screen_name
        const referrer = db.prepare('SELECT * FROM profiles WHERE LOWER(screen_name)=LOWER(?)').get(applicant.referral.trim());
        if (referrer && referrer.id !== profileId) {
          // Check they haven't already received a referral credit for this person
          const already = db.prepare(`SELECT id FROM credit_transactions WHERE profile_id=? AND type='referral' AND note=?`).get(referrer.id, `Referral: @${profile.screen_name}`);
          if (!already) {
            addCredit(referrer.id, 1, 'referral', `Referral: @${profile.screen_name}`);
            console.log(`[credits] Referral credit awarded to @${referrer.screen_name} for referring @${profile.screen_name}`);
          }
        }
      }
    }
  }

  res.json({ ok: true });
});


// Member redeem credit
app.post('/api/credits/redeem', requireMember, (req, res) => {
  const { service } = req.body;
  if (!['stremio','iptv'].includes(service))
    return res.status(400).json({ error: 'Invalid service' });

  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.status(403).json({ error: 'Profile required' });

  const ok = deductCredit(profile.id, 1, 'redeemed', `Redeemed for ${service === 'stremio' ? 'Stremio' : 'DungeonCast'} subscription`);
  if (!ok) return res.status(400).json({ error: 'Insufficient credits' });

  // Notify warden via internal message
  const warden = db.prepare("SELECT * FROM profiles WHERE tier='warden' LIMIT 1").get();
  if (warden) {
    const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.session.member.id);
    const subject = `Credit Redemption — @${profile.screen_name} → ${service === 'stremio' ? 'Stremio' : 'DungeonCast'}`;
    const content = `@${profile.screen_name} has redeemed 1 credit for a ${service === 'stremio' ? 'Stremio' : 'DungeonCast'} subscription.\n\nEmail: ${req.session.member.email}\n\nPlease set up their account and message them with their credentials.`;
    db.prepare('INSERT INTO messages (id,sender_profile_id,recipient_profile_id,subject,content) VALUES (?,?,?,?,?)')
      .run(genId(), profile.id, warden.id, subject, content);
  }

  res.json({ ok: true });
});

// Admin: redeem credit for subscription (deducts 1 credit)
app.post('/api/admin/credits/:profileId/redeem', requireAuth, (req, res) => {
  const { service } = req.body; // 'stremio' or 'iptv'
  const profileId = req.params.profileId;
  const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const ok = deductCredit(profileId, 1, 'redeemed', `Redeemed for ${service || 'Stremio'} subscription`);
  if (!ok) return res.status(400).json({ error: 'Insufficient credits' });
  res.json({ ok: true });
});

// ── Private Messages ──────────────────────────────────────────────────────────

function getProfile(req) {
  return db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
}

// Inbox
app.get('/api/messages', requireMember, (req, res) => {
  const profile = getProfile(req);
  if (!profile) return res.json([]);
  const rows = db.prepare(`
    SELECT m.*, 
      sp.screen_name as sender_name, sp.avatar_url as sender_avatar, sp.avatar_color as sender_color, sp.tier as sender_tier,
      rp.screen_name as recipient_name
    FROM messages m
    JOIN profiles sp ON m.sender_profile_id = sp.id
    JOIN profiles rp ON m.recipient_profile_id = rp.id
    WHERE m.recipient_profile_id=? AND m.deleted_by_recipient=0
    ORDER BY m.created_at DESC
  `).all(profile.id);
  res.json(rows);
});

// Sent
app.get('/api/messages/sent', requireMember, (req, res) => {
  const profile = getProfile(req);
  if (!profile) return res.json([]);
  const rows = db.prepare(`
    SELECT m.*,
      rp.screen_name as recipient_name, rp.avatar_url as recipient_avatar, rp.avatar_color as recipient_color, rp.tier as recipient_tier,
      sp.screen_name as sender_name
    FROM messages m
    JOIN profiles rp ON m.recipient_profile_id = rp.id
    JOIN profiles sp ON m.sender_profile_id = sp.id
    WHERE m.sender_profile_id=? AND m.deleted_by_sender=0
    ORDER BY m.created_at DESC
  `).all(profile.id);
  res.json(rows);
});

// Unread count
app.get('/api/messages/unread', requireMember, (req, res) => {
  const profile = getProfile(req);
  if (!profile) return res.json({ count: 0 });
  const n = db.prepare('SELECT COUNT(*) as n FROM messages WHERE recipient_profile_id=? AND read=0 AND deleted_by_recipient=0').get(profile.id);
  res.json({ count: n.n });
});

// Send
app.post('/api/messages', requireMember, submitLimiter, (req, res) => {
  const { recipient_id, subject, content } = req.body;
  if (!recipient_id || !subject?.trim() || !content?.trim())
    return res.status(400).json({ error: 'Recipient, subject and content are required.' });

  const sender = getProfile(req);
  if (!sender) return res.status(403).json({ error: 'Profile required.' });
  if (sender.id === recipient_id) return res.status(400).json({ error: 'You cannot message yourself.' });

  const recipient = db.prepare('SELECT id FROM profiles WHERE id=?').get(recipient_id);
  if (!recipient) return res.status(404).json({ error: 'Recipient not found.' });

  db.prepare('INSERT INTO messages (id, sender_profile_id, recipient_profile_id, subject, content) VALUES (?,?,?,?,?)')
    .run(genId(), sender.id, recipient_id, subject.trim(), content.trim());

  res.json({ ok: true });
});

// Mark read
app.patch('/api/messages/:id/read', requireMember, (req, res) => {
  const profile = getProfile(req);
  if (!profile) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE messages SET read=1 WHERE id=? AND recipient_profile_id=?').run(req.params.id, profile.id);
  res.json({ ok: true });
});

// Delete
app.delete('/api/messages/:id', requireMember, (req, res) => {
  const profile = getProfile(req);
  if (!profile) return res.status(403).json({ error: 'Forbidden' });
  // Soft delete — mark deleted for sender or recipient
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  if (msg.sender_profile_id === profile.id)
    db.prepare('UPDATE messages SET deleted_by_sender=1 WHERE id=?').run(req.params.id);
  else if (msg.recipient_profile_id === profile.id)
    db.prepare('UPDATE messages SET deleted_by_recipient=1 WHERE id=?').run(req.params.id);
  else
    return res.status(403).json({ error: 'Forbidden' });
  res.json({ ok: true });
});

// ── Forum: categories ─────────────────────────────────────────────────────────
app.get('/api/forum/categories', requireMember, (req, res) => {
  const cats = db.prepare('SELECT * FROM forum_categories ORDER BY position').all();
  // Add thread + post counts
  const result = cats.map(c => ({
    ...c,
    thread_count: db.prepare('SELECT COUNT(*) as n FROM forum_threads WHERE category_id=?').get(c.id).n,
    post_count:   db.prepare('SELECT COUNT(*) as n FROM forum_posts p JOIN forum_threads t ON p.thread_id=t.id WHERE t.category_id=?').get(c.id).n,
    last_thread:  db.prepare('SELECT t.id, t.title, t.last_post_at, p.screen_name FROM forum_threads t JOIN profiles p ON t.profile_id=p.id WHERE t.category_id=? ORDER BY t.last_post_at DESC LIMIT 1').get(c.id) || null,
  }));
  res.json(result);
});

// ── Forum: threads in category ────────────────────────────────────────────────
app.get('/api/forum/categories/:id/threads', requireMember, (req, res) => {
  const threads = db.prepare(`
    SELECT t.*, p.screen_name, p.avatar_url, p.avatar_color, p.tier,
           (SELECT COUNT(*) FROM forum_posts WHERE thread_id=t.id) as reply_count,
           (SELECT screen_name FROM profiles WHERE id=(SELECT profile_id FROM forum_posts WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1)) as last_poster
    FROM forum_threads t
    JOIN profiles p ON t.profile_id=p.id
    WHERE t.category_id=?
    ORDER BY t.pinned DESC, t.last_post_at DESC
  `).all(req.params.id);
  res.json(threads);
});

// ── Forum: single thread + posts ──────────────────────────────────────────────
app.get('/api/forum/threads/:id', requireMember, (req, res) => {
  const thread = db.prepare(`
    SELECT t.*, p.screen_name, p.avatar_url, p.avatar_color, p.tier, c.name as category_name, c.id as category_id
    FROM forum_threads t
    JOIN profiles p ON t.profile_id=p.id
    JOIN forum_categories c ON t.category_id=c.id
    WHERE t.id=?
  `).get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const posts = db.prepare(`
    SELECT po.*, p.screen_name, p.avatar_url, p.avatar_color, p.tier
    FROM forum_posts po
    JOIN profiles p ON po.profile_id=p.id
    WHERE po.thread_id=?
    ORDER BY po.created_at ASC
  `).all(req.params.id);

  // Mark notifications read
  if (req.session.member) {
    const profile = db.prepare('SELECT id FROM profiles WHERE member_id=?').get(req.session.member.id);
    if (profile) {
      db.prepare("UPDATE forum_notifications SET read=1 WHERE profile_id=? AND thread_id=?").run(profile.id, req.params.id);
    }
  }

  res.json({ thread, posts });
});

// ── Forum: create thread ──────────────────────────────────────────────────────
app.post('/api/forum/threads', requireMember, submitLimiter, (req, res) => {
  const { category_id, title, content } = req.body;
  if (!category_id || !title?.trim() || !content?.trim())
    return res.status(400).json({ error: 'Category, title and content are required.' });
  if (title.trim().length > 200)
    return res.status(400).json({ error: 'Title must be under 200 characters.' });

  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.status(403).json({ error: 'Profile required.' });

  // Neuts cannot post
  if (profile.tier === 'neut') return res.status(403).json({ error: 'You must be an approved member to post.' });

  // Restricted categories — only warden/admin
  const cat = db.prepare('SELECT * FROM forum_categories WHERE id=?').get(category_id);
  if (!cat) return res.status(404).json({ error: 'Category not found.' });
  if (cat.restricted && !['warden','admin'].includes(profile.tier))
    return res.status(403).json({ error: 'Only the Dungeon Master can post in Announcements.' });

  const threadId = genId();
  const postId   = genId();
  const now = new Date().toISOString();

  db.prepare('INSERT INTO forum_threads (id,category_id,profile_id,title,last_post_at) VALUES (?,?,?,?,?)')
    .run(threadId, category_id, profile.id, title.trim(), now);
  db.prepare('INSERT INTO forum_posts (id,thread_id,profile_id,content) VALUES (?,?,?,?)')
    .run(postId, threadId, profile.id, content.trim());
  db.prepare('UPDATE forum_threads SET post_count=1 WHERE id=?').run(threadId);

  res.json({ ok: true, thread_id: threadId });
});

// ── Forum: reply to thread ────────────────────────────────────────────────────
app.post('/api/forum/threads/:id/posts', requireMember, submitLimiter, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Reply cannot be empty.' });

  const thread = db.prepare('SELECT * FROM forum_threads WHERE id=?').get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'Thread not found.' });
  if (thread.locked) return res.status(403).json({ error: 'This thread is locked.' });

  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.status(403).json({ error: 'Profile required.' });
  if (profile.tier === 'neut') return res.status(403).json({ error: 'You must be an approved member to post.' });

  const postId = genId();
  const now    = new Date().toISOString();

  db.prepare('INSERT INTO forum_posts (id,thread_id,profile_id,content) VALUES (?,?,?,?)').run(postId, thread.id, profile.id, content.trim());
  db.prepare('UPDATE forum_threads SET post_count=post_count+1, last_post_at=? WHERE id=?').run(now, thread.id);

  // Notify thread author and anyone who replied (except poster)
  const notifyProfiles = db.prepare(`
    SELECT DISTINCT profile_id FROM forum_posts WHERE thread_id=? AND profile_id!=?
  `).all(thread.id, profile.id).map(r => r.profile_id);
  if (thread.profile_id !== profile.id) notifyProfiles.push(thread.profile_id);
  const unique = [...new Set(notifyProfiles)];
  for (const pid of unique) {
    db.prepare('INSERT INTO forum_notifications (id,profile_id,thread_id,post_id) VALUES (?,?,?,?)').run(genId(), pid, thread.id, postId);
  }

  res.json({ ok: true, post_id: postId });
});

// ── Forum: delete post (mod+) ─────────────────────────────────────────────────
app.delete('/api/forum/posts/:id', requireMember, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.status(403).json({ error: 'Forbidden' });

  const post = db.prepare('SELECT * FROM forum_posts WHERE id=?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });

  // Can delete own posts or mod+
  if (post.profile_id !== profile.id && !['mod','admin','warden'].includes(profile.tier))
    return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM forum_posts WHERE id=?').run(req.params.id);
  db.prepare('UPDATE forum_threads SET post_count=MAX(0,post_count-1) WHERE id=?').run(post.thread_id);
  res.json({ ok: true });
});

// ── Forum: pin/lock thread (mod+) ─────────────────────────────────────────────
app.patch('/api/forum/threads/:id', requireMember, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile || !['mod','admin','warden'].includes(profile.tier))
    return res.status(403).json({ error: 'Forbidden' });

  const { pinned, locked } = req.body;
  const updates = [];
  const vals    = [];
  if (pinned !== undefined) { updates.push('pinned=?'); vals.push(pinned ? 1 : 0); }
  if (locked !== undefined) { updates.push('locked=?'); vals.push(locked ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE forum_threads SET ${updates.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

// ── Forum: delete thread (mod+) ───────────────────────────────────────────────
app.delete('/api/forum/threads/:id', requireMember, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.status(403).json({ error: 'Forbidden' });

  const thread = db.prepare('SELECT * FROM forum_threads WHERE id=?').get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'Not found' });

  if (thread.profile_id !== profile.id && !['mod','admin','warden'].includes(profile.tier))
    return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM forum_posts WHERE thread_id=?').run(req.params.id);
  db.prepare('DELETE FROM forum_threads WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM forum_notifications WHERE thread_id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Forum: notifications ──────────────────────────────────────────────────────
app.get('/api/forum/notifications', requireMember, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.json([]);
  const notifs = db.prepare(`
    SELECT n.*, t.title as thread_title, p.screen_name as replier
    FROM forum_notifications n
    JOIN forum_threads t ON n.thread_id=t.id
    JOIN forum_posts po ON n.post_id=po.id
    JOIN profiles p ON po.profile_id=p.id
    WHERE n.profile_id=? AND n.read=0
    ORDER BY n.created_at DESC LIMIT 20
  `).all(profile.id);
  res.json(notifs);
});


// Archive applicant
app.post('/api/applicants/:id/archive', requireAuth, (req, res) => {
  db.prepare('UPDATE applicants SET archived=1 WHERE id=?').run(req.params.id);
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
