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
    devices       TEXT,
    archived      INTEGER DEFAULT 0,
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






  CREATE TABLE IF NOT EXISTS demo_requests (
    id          TEXT PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    service     TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',
    email       TEXT,
    screen_name TEXT,
    notes       TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    fulfilled_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS redemptions (
    id          TEXT PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    service     TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',
    fulfilled_at DATETIME,
    account_user TEXT,
    account_pass TEXT,
    notes       TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
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
  return emailShell(`<h2>Welcome to Dungeon</h2><div class="rule"></div><p>Welcome, <strong>${firstName}</strong>. Your application has been approved and your Dungeon account is ready.</p><div class="box"><div class="row"><span class="lbl">Screen Name</span><span class="val">@${screenName}</span></div><div class="row"><span class="lbl">Email</span><span class="val">${stremioEmail}</span></div><div class="row"><span class="lbl">Password</span><span class="val">${stremioPass}</span></div></div><p>Use the email and password above to log into your dashboard. Keep your credentials safe — do not share them.</p><a href="${SITE_URL}/login.html" class="btn">Go to Dashboard</a><div class="rule"></div><p style="font-size:12px;color:#6b8f7a">— The Dungeon Master</p>`);
}

function emailExpiringSoon(firstName, subEnd) {
  const fmtDate = new Date(subEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return emailShell(`<h2>Subscription Expiring Soon</h2><div class="rule"></div><p>Hi <strong>${firstName}</strong>,</p><p>Your Dungeon subscription expires on <strong>${fmtDate}</strong> — 3 days from now. Submit a renewal request from your dashboard to keep your access.</p><a href="${SITE_URL}/renew.html" class="btn">Request Renewal</a><br><p style="margin-top:20px;font-size:12px;color:#6b8f7a">— The Dungeon Master</p>`);
}

function emailExpired(firstName) {
  return emailShell(`<h2>Subscription Expired</h2><div class="rule"></div><p>Hi <strong>${firstName}</strong>,</p><p>Your Dungeon subscription has ended. Your Stremio access is no longer active.</p><p>If you'd like to return, submit a new application and the team will get you set up again.</p><a href="${SITE_URL}/apply.html" class="btn">Apply Again</a><br><p style="margin-top:20px;font-size:12px;color:#6b8f7a">— The Dungeon Master</p>`);
}

function emailModApproval(applicantName, screenName, applicantEmail, applicantId) {
  return emailShell(`<h2>Mod Approval — Action Required</h2><div class="rule"></div><p>A moderator has approved an application. You need to create their DungeonStream account and grant access.</p><div class="box"><div class="row"><span class="lbl">Name</span><span class="val">${applicantName}</span></div><div class="row"><span class="lbl">Username</span><span class="val">@${screenName}</span></div><div class="row"><span class="lbl">Email</span><span class="val">${applicantEmail}</span></div></div><p>Log into the admin panel and grant access to complete the process.</p><a href="${SITE_URL}/admin.html" class="btn">Open Dungeon Master Panel</a>`);
}




  // Add archived column to applicants if not exists
  try { db.prepare('ALTER TABLE applicants ADD COLUMN archived INTEGER DEFAULT 0').run(); } catch(e) {}
  // Add password column to members if not exists

  // Add missing columns from Jellyfin migration
  try { db.prepare('ALTER TABLE members ADD COLUMN jellyfin_user TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE members ADD COLUMN jellyfin_pass TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE members ADD COLUMN jellyfin_server TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE profiles ADD COLUMN devices TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE members ADD COLUMN phone TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE members ADD COLUMN referred_by TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE members ADD COLUMN reset_token TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE members ADD COLUMN reset_token_expires DATETIME').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE members ADD COLUMN notes TEXT').run(); } catch(e) {}
  // Create dealer earnings table
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS dealer_earnings (
      id TEXT PRIMARY KEY,
      dealer_profile_id TEXT NOT NULL,
      invite_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      dealer_cut INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME
    )`).run();
  } catch(e) { console.error('dealer_earnings table:', e.message); }

  // Create invites table
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      email TEXT,
      created_by TEXT,
      amount INTEGER NOT NULL,
      note TEXT,
      status TEXT DEFAULT 'pending',
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      member_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      used_at DATETIME,
      expires_at DATETIME
    )`).run();
  try { db.prepare('ALTER TABLE invites ADD COLUMN expires_at DATETIME').run(); } catch(e) {}
  } catch(e) { console.error('invites table:', e.message); }
  // Migrate stremio credentials to jellyfin fields for existing members
  try {
    db.prepare(`UPDATE members SET jellyfin_user=stremio_email, jellyfin_pass=stremio_pass 
      WHERE jellyfin_user IS NULL AND stremio_email IS NOT NULL AND stremio_email != ''`).run();
  } catch(e) {}

  try { db.prepare('ALTER TABLE members ADD COLUMN password TEXT').run(); } catch(e) {}
  // Add plain_pass column for admin visibility
  try { db.prepare('ALTER TABLE members ADD COLUMN plain_pass TEXT').run(); } catch(e) {}
  // Add stremio_auth_key column
  try { db.prepare('ALTER TABLE members ADD COLUMN stremio_auth_key TEXT').run(); } catch(e) {}
  // Fix unlinked profiles - match by email
  try {
    db.prepare(`UPDATE profiles SET member_id=(SELECT m.id FROM members m WHERE LOWER(m.email)=LOWER(profiles.email) LIMIT 1) WHERE member_id IS NULL AND email IS NOT NULL`).run();
  } catch(e) { console.log('Profile link fix:', e.message); }

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
async function runSubscriptionCron() {
  const now = new Date();
  const nowISO = now.toISOString();
  const in3days = new Date(now); in3days.setDate(in3days.getDate() + 3);

  // Warn expiring soon (uses stremio_end as primary sub date)
  const expiring = db.prepare(`
    SELECT * FROM members
    WHERE stremio_end IS NOT NULL AND expiry_warned=0
    AND datetime(stremio_end) <= datetime(?) AND datetime(stremio_end) > datetime(?)
  `).all(in3days.toISOString(), nowISO);
  for (const m of expiring) {
    sendMail(m.email, 'Your Dungeon subscription is expiring soon', emailExpiringSoon(m.first_name, m.stremio_end)).catch(()=>{});
    db.prepare('UPDATE members SET expiry_warned=1 WHERE id=?').run(m.id);
  }

  // Revoke DungeonStream access when stremio_end has passed
  const streamExpired = db.prepare(`
    SELECT * FROM members
    WHERE stremio_end IS NOT NULL AND expired_notified=0
    AND datetime(stremio_end) <= datetime(?)
  `).all(nowISO);
  for (const m of streamExpired) {
    // Skip staff — they have permanent access
    const profile = db.prepare('SELECT tier FROM profiles WHERE member_id=?').get(m.id);
    const isStaff = ['dealer','mod','admin','warden'].includes(profile?.tier);
    if (isStaff) continue;

    // Disable on VPS Jellyfin
    try {
      const jfId = await jellyfinGetUserId(m.jellyfin_user||m.stremio_email, JELLYFIN_URL, JELLYFIN_API_KEY);
      if (jfId) {
        await jellyfinRequest('POST', '/Users/'+jfId+'/Policy', { IsDisabled: true, EnableAllFolders: false, EnabledFolders: [] }, JELLYFIN_URL, JELLYFIN_API_KEY);
        console.log('[cron] DungeonStream expired — disabled Jellyfin for:', m.stremio_email||m.jellyfin_user);
      }
    } catch(e) { console.error('[cron] Jellyfin disable error:', e.message); }

    sendMail(m.email, 'Your Dungeon subscription has ended', emailExpired(m.first_name)).catch(()=>{});
    db.prepare('UPDATE members SET expired_notified=1 WHERE id=?').run(m.id);
  }

  // Revoke DungeonCast access when iptv_end has passed (only members not already notified)
  const castExpired = db.prepare(`
    SELECT * FROM members
    WHERE iptv_end IS NOT NULL AND datetime(iptv_end) <= datetime(?)
    AND expired_notified = 0
  `).all(nowISO);
  for (const m of castExpired) {
    const profile = db.prepare('SELECT tier FROM profiles WHERE member_id=?').get(m.id);
    const isStaff = ['dealer','mod','admin','warden'].includes(profile?.tier);
    if (isStaff) continue;

    try {
      const jfTVId = await jellyfinGetUserId(m.jellyfin_user||m.stremio_email, JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
      if (jfTVId) {
        await jellyfinRequest('POST', '/Users/'+jfTVId+'/Policy', { IsDisabled: true }, JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
        console.log('[cron] DungeonCast expired — disabled for:', m.jellyfin_user||m.stremio_email);
      }
    } catch(e) { console.error('[cron] Jellyfin TV disable error:', e.message); }
  }
}
runSubscriptionCron();
setInterval(runSubscriptionCron, 60 * 60 * 1000);

// ── Middleware ────────────────────────────────────────────────────────────────

// ── Jellyfin Integration ────────────────────────────────────────────────────
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

const JELLYFIN_URL = process.env.JELLYFIN_URL || 'https://dungeoncast.cc';
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY || '';
const JELLYFIN_TV_URL = process.env.JELLYFIN_TV_URL || JELLYFIN_URL; // same server now
const JELLYFIN_TV_API_KEY = process.env.JELLYFIN_TV_API_KEY || JELLYFIN_API_KEY; // same server now

async function jellyfinCreateUser(username, password, serverUrl, apiKey) {
  serverUrl = serverUrl || JELLYFIN_URL;
  apiKey = apiKey || JELLYFIN_API_KEY;
  if (!apiKey) { console.log('[Jellyfin] No API key set'); return null; }
  try {
    const https = require('https');
    const body = JSON.stringify({ Name: username, Password: password });
    return await new Promise((resolve, reject) => {
      const url = new URL(serverUrl + '/Users/New');
      const opts = {
        hostname: url.hostname,
        port: 443,
        path: '/Users/New',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': 'MediaBrowser Token="' + JELLYFIN_API_KEY + '"',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const req = https.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch(e) { resolve({ status: res.statusCode, body: d }); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch(e) {
    console.error('[Jellyfin] Create user error:', e.message);
    return null;
  }
}
// ────────────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') return next();
  express.json({ limit: '10mb' })(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') return next();
  express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
});

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));



// Get members list for referral dropdown (public)
app.get('/api/members/list', (req, res) => {
  try {
    const rows = db.prepare("SELECT p.screen_name FROM profiles p WHERE p.tier != 'neut' ORDER BY p.screen_name").all();
    res.json(rows.map(r => r.screen_name));
  } catch(e) { res.status(500).json([]); }
});

// Check screen name availability (public)
app.get('/api/check/screen-name/:sn', (req, res) => {
  try {
    const sn = req.params.sn.trim();
    if (!sn || sn.length < 2) return res.json({ available: false, reason: 'Too short' });
    if (!/^[a-zA-Z0-9_]{2,20}$/.test(sn)) return res.json({ available: false, reason: 'Invalid characters' });
    const taken = db.prepare('SELECT id FROM profiles WHERE LOWER(screen_name)=LOWER(?)').get(sn);
    res.json({ available: !taken });
  } catch(e) { res.status(500).json({ available: false }); }
});


// GET dungeon master profile for welcome page (public)
app.get('/api/dungeon-master', (req, res) => {
  try {
    const profile = db.prepare("SELECT screen_name, avatar_url, avatar_color FROM profiles WHERE tier='warden' LIMIT 1").get();
    res.json(profile || { screen_name: 'one', avatar_url: null, avatar_color: '#a78bfa' });
  } catch(e) { res.json({ screen_name: 'one', avatar_url: null, avatar_color: '#a78bfa' }); }
});

// Serve join page (token is handled client-side)
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

// Serve welcome/onboarding guide
app.get('/welcome', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'welcome.html'));
});

// Serve avatars
app.use('/avatars', express.static(AVATAR_DIR));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dungeon-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 },
}));

app.set('trust proxy', 1);

const submitLimiter = rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: 'Too many requests.' } });
const loginLimiter = rateLimit({ windowMs: 5*60*1000, max: 10, message: { error: 'Too many attempts. Try again in 5 minutes.' } });

// Per-email lockout tracking
const loginAttempts = new Map(); // email -> { count, lockedUntil }

function checkLockout(email) {
  const key = email.toLowerCase();
  const record = loginAttempts.get(key);
  if (!record) return null;
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return `Account locked. Try again in ${mins} minute${mins>1?'s':''}.`;
  }
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    loginAttempts.delete(key);
  }
  return null;
}

function recordFailedAttempt(email) {
  const key = email.toLowerCase();
  const record = loginAttempts.get(key) || { count: 0, lockedUntil: null };
  record.count++;
  if (record.count >= 3) {
    record.lockedUntil = Date.now() + 5 * 60 * 1000;
    record.count = 0;
  }
  loginAttempts.set(key, record);
}

function clearAttempts(email) {
  loginAttempts.delete(email.toLowerCase());
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireMember(req, res, next) {
  if (req.session?.member) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireDealer(req, res, next) {
  if (!req.session?.member) return res.status(401).json({ error: 'Unauthorized' });
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id);
  if (!profile || !['dealer','mod','admin','warden'].includes(profile.tier)) return res.status(403).json({ error: 'Forbidden' });
  req.profile = profile;
  next();
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
  // Check per-email lockout
  const lockMsg = checkLockout(email.trim());
  if (lockMsg) return res.status(429).json({ error: lockMsg });

  const member = db.prepare('SELECT * FROM members WHERE LOWER(email)=LOWER(?)').get(email.trim())
    || db.prepare('SELECT * FROM members WHERE LOWER(stremio_email)=LOWER(?)').get(email.trim());
  if (!member) { recordFailedAttempt(email.trim()); return res.status(401).json({ error: 'Incorrect email or password.' }); }

  // Check new hashed password first, then fall back to legacy stremio_pass
  const passMatch = member.password
    ? bcrypt.compareSync(password.trim(), member.password)
    : member.stremio_pass === password.trim();
  if (!passMatch) {
    recordFailedAttempt(email.trim());
    const remaining = 3 - ((loginAttempts.get(email.toLowerCase()) || {}).count || 0);
    const msg = remaining > 0 ? `Incorrect email or password. ${remaining} attempt${remaining>1?'s':''} remaining.` : 'Account locked for 5 minutes.';
    return res.status(401).json({ error: msg });
  }
  clearAttempts(email.trim());
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
  try {
  const { first_name, last_name, email, phone, language, referral, notes, screen_name, devices } = req.body;
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

  try { await sendMail(email.trim(), 'Application Received — Dungeon', emailApplicationReceived(first_name.trim(), screen_name.trim())); } catch(e) { console.error('Apply email error:', e.message); }
  res.json({ ok: true });
  } catch(e) { console.error('[apply]', e.message); res.status(500).json({ error: e.message }); }
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
  const members = db.prepare(`SELECT m.id, m.first_name, m.last_name, m.email, m.stremio_email, m.stremio_pass, m.stremio_start, m.stremio_end, m.iptv_start, m.iptv_end, m.notes, m.created_at, m.plain_pass, m.stremio_auth_key, p.id as profile_id_val, p.screen_name, p.tier, p.avatar_url, p.avatar_color, COALESCE(c.amount,0) as credit_balance FROM members m LEFT JOIN profiles p ON (p.member_id=m.id OR (p.member_id IS NULL AND LOWER(p.email)=LOWER(m.email))) LEFT JOIN credits c ON c.profile_id=p.id ORDER BY m.created_at DESC`).all();
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








// Extend member subscription
app.post('/api/admin/members/:id/extend', requireAuth, (req, res) => {
  const { service, new_end } = req.body;
  const field = service === 'stream' ? 'stremio_end' : 'iptv_end';
  db.prepare(`UPDATE members SET ${field}=? WHERE id=?`).run(new_end, req.params.id);
  res.json({ ok: true });
});

// ── Admin: DungeonStream subscriptions ──────────────────────────────────────────────

app.get('/api/admin/stremio', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.first_name, m.last_name, m.email, m.stremio_email, m.stremio_pass,
           m.stremio_start, m.stremio_end, m.stremio_auth_key,
           p.screen_name, p.avatar_url, p.avatar_color, p.tier, p.id as profile_id
    FROM members m
    LEFT JOIN profiles p ON (p.member_id=m.id OR (p.member_id IS NULL AND LOWER(p.email)=LOWER(m.email)))
    WHERE m.stremio_email IS NOT NULL OR m.stremio_end IS NOT NULL
    ORDER BY m.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/admin/stremio/:memberId', requireMod, (req, res) => {
  const { stremio_email, stremio_pass, stremio_start, stremio_end, stremio_auth_key } = req.body;
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.memberId);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  const now = new Date();
  const autoEnd = new Date(now); autoEnd.setMonth(autoEnd.getMonth()+1);
  // Respect explicitly sent dates, convert date strings to ISO
  const toISO = d => d ? (d.includes('T') ? d : d + 'T00:00:00.000Z') : null;
  const finalStart = stremio_start !== undefined ? toISO(stremio_start) : (m.stremio_start || now.toISOString());
  const finalEnd = stremio_end !== undefined ? toISO(stremio_end) : (m.stremio_end || autoEnd.toISOString());
  const newUser = stremio_email||m.stremio_email;
  const newPass = stremio_pass||m.stremio_pass;
  db.prepare(`UPDATE members SET stremio_email=?, stremio_pass=?, jellyfin_user=?, jellyfin_pass=?, stremio_start=?, stremio_end=? WHERE id=?`)
    .run(newUser, newPass, newUser, newPass, finalStart, finalEnd, req.params.memberId);
  res.json({ ok: true });
});

// Admin: update IPTV subscription dates
app.post('/api/admin/iptv-dates/:memberId', requireMod, (req, res) => {
  const { iptv_start, iptv_end } = req.body;
  db.prepare('UPDATE members SET iptv_start=?, iptv_end=? WHERE id=?')
    .run(iptv_start||null, iptv_end||null, req.params.memberId);
  res.json({ ok: true });
});




// ── Demo Requests ─────────────────────────────────────────────────────────────

app.post('/api/demo-request', requireMember, (req, res) => {
  const { service } = req.body;
  if (!['stream','cast'].includes(service)) return res.status(400).json({ error: 'Invalid service' });

  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.session.member.id)
    || db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(req.session.member.email);
  if (!profile) return res.status(403).json({ error: 'Profile required' });

  // Check for recent pending request
  const recent = db.prepare("SELECT * FROM demo_requests WHERE profile_id=? AND service=? AND status='pending' AND datetime(created_at) > datetime('now','-24 hours')").get(profile.id, service);
  if (recent) return res.status(400).json({ error: 'You already have a pending demo request for this service.' });

  db.prepare('INSERT INTO demo_requests (id,profile_id,service,email,screen_name) VALUES (?,?,?,?,?)')
    .run(genId(), profile.id, service, req.session.member.email, profile.screen_name);

  // Notify warden
  const warden = db.prepare("SELECT * FROM profiles WHERE tier='warden' LIMIT 1").get();
  if (warden) {
    const svcName = service === 'stream' ? 'DungeonStream' : 'DungeonCast';
    db.prepare('INSERT INTO messages (id,sender_profile_id,recipient_profile_id,subject,content) VALUES (?,?,?,?,?)')
      .run(genId(), profile.id, warden.id, `Demo Request — ${svcName}`,
        `@${profile.screen_name} has requested a 24-hour ${svcName} demo.\n\nEmail: ${req.session.member.email}\n\nReview in the Admin Panel → Demos tab.`);
  }

  res.json({ ok: true });
});

// Admin: get all demo requests
app.get('/api/admin/demo-requests', requireAuth, (req, res) => {
  const status = req.query.status || 'pending';
  const rows = db.prepare(`
    SELECT * FROM demo_requests
    ${status === 'all' ? '' : 'WHERE status = ?'}
    ORDER BY created_at DESC
  `).all(...(status === 'all' ? [] : [status]));
  res.json(rows);
});

// Admin: fulfill demo request
app.post('/api/admin/demo-requests/:id/fulfill', requireAuth, async (req, res) => {
  const { username, password } = req.body;
  const demo = db.prepare('SELECT * FROM demo_requests WHERE id=?').get(req.params.id);
  if (!demo) return res.status(404).json({ error: 'Not found' });

  db.prepare("UPDATE demo_requests SET status='fulfilled', fulfilled_at=CURRENT_TIMESTAMP, notes=? WHERE id=?")
    .run(`${username} / ${password}`, req.params.id);

  const svcName = demo.service === 'stream' ? 'DungeonStream' : 'DungeonCast';
  const now = new Date();
  const expiry = new Date(now.getTime() + 24*60*60*1000);
  const fmtExpiry = expiry.toLocaleString('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});

  const html = emailShell(`
    <h2>Your ${svcName} Demo</h2>
    <div class="rule"></div>
    <p>Your 24-hour demo is ready. Here are your credentials:</p>
    <div class="box">
      <div class="row"><span class="lbl">Service</span><span class="val">${svcName}</span></div>
      <div class="row"><span class="lbl">URL</span><span class="val">${demo.service==='stream'?'http://dungeonstream.enterdungeon.cc':'http://dungeoncast.cc'}</span></div>
      <div class="row"><span class="lbl">Username</span><span class="val">${username}</span></div>
      <div class="row"><span class="lbl">Password</span><span class="val">${password}</span></div>
      <div class="row"><span class="lbl">Expires</span><span class="val">${fmtExpiry}</span></div>
    </div>
    <p>Enjoying the demo? Get full access through Dungeon for just 1 credit per month.</p>
    <a href="https://enterdungeon.cc/redeem.html" class="btn">Get Full Access</a>
    <div class="rule"></div>
    <p style="font-size:12px;color:#6b8f7a">Demo expires ${fmtExpiry}. — The Dungeon Master</p>
  `);

  try {
    await sendMail(demo.email, `Your ${svcName} Demo is Ready`, html);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: dismiss demo request
app.post('/api/admin/demo-requests/:id/dismiss', requireAuth, (req, res) => {
  db.prepare("UPDATE demo_requests SET status='dismissed' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});


// ── Trex / ActivationPanel API ────────────────────────────────────────────────
const TREX_API_KEY = process.env.TREX_API_KEY || '';
const TREX_BASE    = 'https://activationpanel.ru/api/resellers';

async function trexRequest(endpoint, params = {}) {
  const https = require('https');
  const url = new URL(TREX_BASE + endpoint);
  url.searchParams.set('api_key', TREX_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  return new Promise((resolve, reject) => {
    https.get(url.toString(), res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

// Create a new DungeonCast line (called during fulfill)
async function trexCreateLine(username, password, months = 1) {
  // Try creating the line
  const res = await trexRequest('/lines/create', {
    username,
    password,
    bouquet: '',          // leave blank for all bouquets (reseller default)
    max_connections: 1,
    months
  });
  return res;
}

// Admin: auto-create DungeonCast account via Trex
app.post('/api/admin/trex/create-line', requireAuth, async (req, res) => {
  const { memberId, username, password, months } = req.body;
  if (!TREX_API_KEY) return res.status(400).json({ error: 'TREX_API_KEY not configured in environment variables.' });
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const result = await trexCreateLine(username, password, months || 1);
    console.log('[Trex] Create line result:', JSON.stringify(result.body).substring(0, 200));

    if (result.status !== 200 || result.body?.error || result.body?.status === 'error') {
      return res.status(400).json({ error: result.body?.message || result.body?.error || 'Trex API error', raw: result.body });
    }

    // Update member iptv dates
    if (memberId) {
      const now = new Date();
      const end = new Date(now); end.setMonth(end.getMonth() + (months || 1));
      db.prepare('UPDATE members SET iptv_start=?, iptv_end=? WHERE id=?')
        .run(now.toISOString(), end.toISOString(), memberId);

      // Create/update iptv_accounts record
      const profile = db.prepare('SELECT * FROM profiles WHERE member_id=? OR (member_id IS NULL AND LOWER(email)=LOWER((SELECT email FROM members WHERE id=?)))').get(memberId, memberId);
      if (profile) {
        const existing = db.prepare('SELECT * FROM iptv_accounts WHERE profile_id=?').get(profile.id);
        if (existing) {
          db.prepare('UPDATE iptv_accounts SET nodecast_user=?, xtream_user=?, xtream_pass=?, status=? WHERE profile_id=?')
            .run(username, username, password, 'active', profile.id);
        } else {
          db.prepare('INSERT INTO iptv_accounts (id,profile_id,nodecast_user,xtream_url,xtream_user,xtream_pass,status) VALUES (?,?,?,?,?,?,?)')
            .run(genId(), profile.id, username, 'http://line.dungeoncast.cc', username, password, 'active');
        }
      }
    }

    res.json({ ok: true, username, password, result: result.body });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: list all lines from Trex
app.get('/api/admin/trex/lines', requireAuth, async (req, res) => {
  if (!TREX_API_KEY) return res.status(400).json({ error: 'TREX_API_KEY not configured' });
  try {
    const result = await trexRequest('/lines');
    res.json(result.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: renew a line
app.post('/api/admin/trex/renew-line', requireAuth, async (req, res) => {
  if (!TREX_API_KEY) return res.status(400).json({ error: 'TREX_API_KEY not configured' });
  const { username, months } = req.body;
  try {
    const result = await trexRequest('/lines/renew', { username, months: months || 1 });
    res.json(result.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Nodecast API Integration ───────────────────────────────────────────────────
const NODECAST_URL     = process.env.NODECAST_URL || 'http://150.136.222.167:3000';
const NODECAST_ADMIN   = process.env.NODECAST_ADMIN || 'admin';
const NODECAST_PASS    = process.env.NODECAST_PASS || '';
const DUNGEON_API_KEY  = process.env.DUNGEON_API_KEY || 'dungeon-internal-key';

async function nodeCastLogin() {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username: NODECAST_ADMIN, password: NODECAST_PASS });
    const opts = {
      hostname: '150.136.222.167',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: d }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function nodeCastRequest(method, path, body, token) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '150.136.222.167',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Admin: create a DungeonCast (Nodecast) account for a member
app.post('/api/admin/nodecast/create-user', requireAuth, async (req, res) => {
  const { username, password, xtream_url, xtream_user, xtream_pass, memberId, profileId } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    // 1. Login to Nodecast
    const loginRes = await nodeCastLogin();
    console.log('[Nodecast] Login response:', JSON.stringify(loginRes).substring(0,200));
    const token = loginRes.token;
    if (!token) return res.status(500).json({ error: 'DungeonCast login failed: ' + JSON.stringify(loginRes) });

    // 2. Create the user
    const userRes = await nodeCastRequest('POST', '/api/users', { username, password, role: 'viewer' }, token);
    console.log('[Nodecast] Create user response:', JSON.stringify(userRes).substring(0,300));
    if (userRes.status !== 200 && userRes.status !== 201) {
      const msg = typeof userRes.body === 'object' ? (userRes.body?.error || JSON.stringify(userRes.body)) : userRes.body;
      return res.status(400).json({ error: 'Nodecast: ' + msg });
    }
    const newUser = userRes.body;

    // 3. Optionally create Xtream source for this user
    let sourceResult = null;
    if (xtream_url && xtream_user && xtream_pass) {
      const srcRes = await nodeCastRequest('POST', '/api/sources', {
        type: 'xtream',
        name: `${username}'s Source`,
        url: xtream_url,
        username: xtream_user,
        password: xtream_pass
      }, token);
      sourceResult = srcRes.body;
    }

    // 4. Update Dungeon DB
    if (profileId) {
      const now = new Date();
      const end = new Date(now); end.setMonth(end.getMonth() + 1);
      const existing = db.prepare('SELECT * FROM iptv_accounts WHERE profile_id=?').get(profileId);
      if (existing) {
        db.prepare('UPDATE iptv_accounts SET nodecast_user=?, xtream_url=?, xtream_user=?, xtream_pass=?, status=? WHERE profile_id=?')
          .run(username, xtream_url||existing.xtream_url, xtream_user||existing.xtream_user, xtream_pass||existing.xtream_pass, 'active', profileId);
      } else {
        db.prepare('INSERT INTO iptv_accounts (id,profile_id,nodecast_user,xtream_url,xtream_user,xtream_pass,status) VALUES (?,?,?,?,?,?,?)')
          .run(genId(), profileId, username, xtream_url||'', xtream_user||'', xtream_pass||'', 'active');
      }
      if (memberId) {
        const mNow = new Date(); const mEnd = new Date(mNow); mEnd.setMonth(mEnd.getMonth()+1);
        db.prepare('UPDATE members SET iptv_start=?, iptv_end=? WHERE id=?').run(mNow.toISOString(), mEnd.toISOString(), memberId);
      }
    }

    res.json({ ok: true, user: newUser, source: sourceResult });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// Clear subscription dates for a member


// Debug: test Nodecast connection
app.get('/api/admin/nodecast/test', requireAuth, async (req, res) => {
  try {
    const loginRes = await nodeCastLogin();
    res.json({ 
      nodecast_url: NODECAST_URL,
      nodecast_admin: NODECAST_ADMIN,
      nodecast_pass_length: NODECAST_PASS.length,
      nodecast_pass_first2: NODECAST_PASS.substring(0,2),
      login_response: loginRes
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// ── DungeonCast Demo ──────────────────────────────────────────────────────────
app.post('/api/admin/dc-demo', requireAuth, async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.status(400).json({ error: 'All fields required' });

  const now = new Date();
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const fmtExpiry = expiry.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  const html = emailShell(`
    <h2>Your DungeonCast Demo</h2>
    <div class="rule"></div>
    <p>You've been granted a <strong>24-hour demo</strong> of DungeonCast — our live TV streaming service with hundreds of channels including sports, news, entertainment, and Formula 1.</p>
    <div class="box">
      <div class="row"><span class="lbl">URL</span><span class="val">https://dungeoncast.cc</span></div>
      <div class="row"><span class="lbl">Username</span><span class="val">${username}</span></div>
      <div class="row"><span class="lbl">Password</span><span class="val">${password}</span></div>
      <div class="row"><span class="lbl">Expires</span><span class="val">${fmtExpiry}</span></div>
    </div>
    <p>Open <a href="https://dungeoncast.cc" style="color:#34d399">dungeoncast.cc</a> in your browser and sign in with the credentials above. On iPhone, use Safari for the best experience.</p>
    <p>If you enjoy the service, you can get full access through Dungeon — 1 credit per month.</p>
    <a href="https://enterdungeon.cc" class="btn">Learn More</a>
    <div class="rule"></div>
    <p style="font-size:12px;color:#6b8f7a">Demo access expires ${fmtExpiry}. Credentials are single-use and non-transferable. — The Dungeon Master</p>
  `);

  try {
    await sendMail(email, 'Your DungeonCast Demo — 24 Hours Starting Now', html);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Redemptions ────────────────────────────────────────────────────────────────

// Get all redemptions (admin)

// Fulfill a redemption (admin)
app.post('/api/admin/redemptions/:id/fulfill', requireMod, async (req, res) => {
  const { account_user, account_pass, notes, xtream_url, xtream_user, xtream_pass } = req.body;
  const redemption = db.prepare('SELECT * FROM redemptions WHERE id=?').get(req.params.id);
  if (!redemption) return res.status(404).json({ error: 'Redemption not found' });

  // Update redemption record
  db.prepare(`UPDATE redemptions SET status='fulfilled', fulfilled_at=CURRENT_TIMESTAMP, account_user=?, account_pass=?, notes=? WHERE id=?`)
    .run(account_user, account_pass, notes||'', req.params.id);

  // Update member's subscription dates
  const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(redemption.profile_id);
  let member = null;
  if (profile) {
    // Try member_id first, then fall back to email match
    member = profile.member_id
      ? db.prepare('SELECT * FROM members WHERE id=?').get(profile.member_id)
      : db.prepare('SELECT * FROM members WHERE LOWER(email)=LOWER(?)').get(profile.email);
    // Also update profile.member_id if missing
    if (member && !profile.member_id) {
      db.prepare('UPDATE profiles SET member_id=? WHERE id=?').run(member.id, profile.id);
    }
  }
  if (member) {
    const now = new Date();
    if (redemption.service === 'stremio') {
      // Stack subscription — add 30 days to existing end date if still active
      const existingEnd = member.stremio_end ? new Date(member.stremio_end) : null;
      const startBase = (existingEnd && existingEnd > now) ? existingEnd : now;
      const end = new Date(startBase); end.setMonth(end.getMonth() + 1);
      const start = member.stremio_start ? new Date(member.stremio_start) : now;
      db.prepare('UPDATE members SET stremio_email=?, stremio_pass=?, jellyfin_user=?, jellyfin_pass=?, stremio_start=?, stremio_end=?, expired_notified=0, expiry_warned=0 WHERE id=?')
        .run(account_user, account_pass, account_user, account_pass, start.toISOString(), end.toISOString(), member.id);
      // Create Jellyfin account and grant library access on VPS
      try {
        // Create account first
        const createRes = await jellyfinCreateUser(account_user, account_pass, JELLYFIN_URL, JELLYFIN_API_KEY);
        console.log('[Jellyfin VPS] Create result:', createRes?.status, JSON.stringify(createRes?.body)?.substring(0,100));
        // Get user ID (works whether account was just created or already existed)
        const jfUserId = await jellyfinGetUserId(account_user, JELLYFIN_URL, JELLYFIN_API_KEY);
        if (jfUserId) {
          await jellyfinGrantLibraryAccess(jfUserId, ['Movies', 'Shows'], JELLYFIN_URL, JELLYFIN_API_KEY);
          console.log('[Jellyfin VPS] Granted Movies+Shows to:', account_user);
        } else {
          console.log('[Jellyfin VPS] Could not find user after create:', account_user);
        }
      } catch(e) { console.error('[Jellyfin VPS] Error:', e.message); }
    } else {
      // Update IPTV account
      const existing = db.prepare('SELECT * FROM iptv_accounts WHERE profile_id=?').get(profile.id);
      if (existing) {
        db.prepare('UPDATE iptv_accounts SET nodecast_user=?, xtream_url=?, xtream_user=?, xtream_pass=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE profile_id=?')
          .run(account_user, xtream_url||existing.xtream_url||'http://line.dungeoncast.cc', xtream_user||existing.xtream_user||account_user, xtream_pass||account_pass, 'active', profile.id);
      } else {
        db.prepare('INSERT INTO iptv_accounts (id,profile_id,nodecast_user,xtream_url,xtream_user,xtream_pass,status) VALUES (?,?,?,?,?,?,?)')
          .run(genId(), profile.id, account_user, xtream_url||'http://line.dungeoncast.cc', xtream_user||account_user, xtream_pass||account_pass, 'active');
      }
      db.prepare('UPDATE members SET iptv_start=?, iptv_end=? WHERE id=?')
        .run(now.toISOString(), end.toISOString(), member.id);

      // Create Jellyfin account on TV server + grant Live TV access
      try {
        const createTVRes = await jellyfinCreateUser(account_user, account_pass, JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
        console.log('[Jellyfin TV] Create result:', createTVRes?.status);
        const jfTVUserId = await jellyfinGetUserId(account_user, JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
        if (jfTVUserId) {
          await jellyfinGrantLibraryAccess(jfTVUserId, ['Live TV'], JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
          console.log('[Jellyfin TV] Granted Live TV to:', account_user);
        }
      } catch(e) { console.error('[Jellyfin TV] Error:', e.message); }
    }
  }

  // Send credentials message + email to member
  const warden = db.prepare("SELECT * FROM profiles WHERE tier='warden' LIMIT 1").get();
  const svcName = redemption.service === 'stremio' ? 'DungeonStream' : 'DungeonCast';
  const subject = `Your ${svcName} Account is Ready`;

  if (warden && profile) {
    const content = redemption.service === 'stremio'
      ? `Your DungeonStream account has been set up.\n\nServer: https://dungeoncast.cc\nUsername: ${account_user}\nPassword: ${account_pass}\n\nDownload the Jellyfin app and use these credentials to sign in. Check the Guides on your dashboard for device-specific setup help.${notes ? '\n\nNotes: ' + notes : ''}`
      : `Your DungeonCast account has been set up.\n\nServer: https://dungeoncast.cc\nUsername: ${account_user}\nPassword: ${account_pass}\n\nDownload Moonfin and add the server to get started. Check the Guides on your dashboard for setup help.${notes ? '\n\nNotes: ' + notes : ''}`;
    db.prepare('INSERT INTO messages (id,sender_profile_id,recipient_profile_id,subject,content) VALUES (?,?,?,?,?)')
      .run(genId(), warden.id, profile.id, subject, content);
  }

  // Send email
  if (member) {
    const html = emailShell(redemption.service === 'stremio' ? `
      <h2>Your DungeonStream Account is Ready</h2>
      <div class="rule"></div>
      <p>Your DungeonStream account has been set up and is ready to use.</p>
      <div class="box">
        <div class="row"><span class="lbl">Server URL</span><span class="val">https://dungeoncast.cc</span></div>
        <div class="row"><span class="lbl">Username</span><span class="val">${account_user}</span></div>
        <div class="row"><span class="lbl">Password</span><span class="val">${account_pass}</span></div>
      </div>
      <p>Download the Jellyfin app on your device and use the Server URL, username and password above to sign in.${notes ? '<br><br>Notes: ' + notes : ''}</p>
      <p>Follow our <a href="https://enterdungeon.cc/welcome" style="color:#34d399">Getting Started Guide</a> to download the app and connect in under 2 minutes.</p>
      <a href="https://enterdungeon.cc/welcome" class="btn">Get Started →</a>
      <div class="rule"></div>
      <p style="font-size:12px;color:#6b8f7a">Keep your credentials private. — The Dungeon Master</p>
    ` : `
      <h2>Your DungeonCast Account is Ready</h2>
      <div class="rule"></div>
      <p>Your DungeonCast account has been set up and is ready to use.</p>
      <div class="box">
        <div class="row"><span class="lbl">Username</span><span class="val">${account_user}</span></div>
        <div class="row"><span class="lbl">Password</span><span class="val">${account_pass}</span></div>
        <div class="row"><span class="lbl">URL</span><span class="val">https://dungeoncast.cc</span></div>
      </div>
      <p>Open <a href="https://dungeoncast.cc" style="color:#34d399">dungeoncast.cc</a> in your browser and sign in with the credentials above.${notes ? '<br><br>Notes: ' + notes : ''}</p>
      <a href="https://dungeoncast.cc" class="btn">Open DungeonCast</a>
      <div class="rule"></div>
      <p style="font-size:12px;color:#6b8f7a">Keep your credentials private. — The Dungeon Master</p>
    `);
    try { await sendMail(member.email, subject, html); } catch(e) { console.error('Fulfill email error:', e); }
  }

  res.json({ ok: true });
});

// ── IPTV Accounts ─────────────────────────────────────────────────────────────

// Get all IPTV accounts (admin)
app.get('/api/admin/iptv', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, p.screen_name, p.email, p.avatar_url, p.avatar_color, p.tier
    FROM iptv_accounts i
    JOIN profiles p ON i.profile_id = p.id
    ORDER BY p.screen_name ASC
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
    let profile = db.prepare("SELECT * FROM profiles WHERE LOWER(screen_name)=?").get(screenName);

    // Fallback: try matching by email from payload
    if (!profile) {
      const email = (data.supporter_email || data.email || '').toLowerCase();
      if (email) {
        profile = db.prepare("SELECT * FROM profiles WHERE LOWER(email)=?").get(email);
        if (profile) console.log('[BMAC] Matched by email:', email);
      }
    }

    if (!profile) {
      console.log('[BMAC] Profile not found for:', screenName);
      // Log the full payload for debugging
      console.log('[BMAC] Full payload:', JSON.stringify(payload).substring(0, 500));
      return res.json({ ok: true, note: 'Profile not found for: ' + screenName });
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

  const ok = deductCredit(profile.id, 1, 'redeemed', `Redeemed for ${service === 'stremio' ? 'DungeonStream' : 'DungeonCast'} subscription`);
  if (!ok) return res.status(400).json({ error: 'Insufficient credits' });

  // Create redemption record
  const redemptionId = genId();
  db.prepare('INSERT INTO redemptions (id,profile_id,service,status) VALUES (?,?,?,?)').run(redemptionId, profile.id, service, 'pending');

  res.json({ ok: true, redemption_id: redemptionId });
});

// Admin: redeem credit for subscription (deducts 1 credit)
app.post('/api/admin/credits/:profileId/redeem', requireAuth, (req, res) => {
  const { service } = req.body; // 'stremio' or 'iptv'
  const profileId = req.params.profileId;
  const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const ok = deductCredit(profileId, 1, 'redeemed', `Redeemed for ${service || 'DungeonStream'} subscription`);
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


// ── Resend Emails ──────────────────────────────────────────────────────────────

// Resend application received email
app.post('/api/admin/resend/application/:id', requireAuth, async (req, res) => {
  try {
    const applicant = db.prepare('SELECT * FROM applicants WHERE id=?').get(req.params.id);
    if (!applicant) return res.status(404).json({ error: 'Not found' });
    await sendMail(applicant.email, 'Application Received — Dungeon', emailApplicationReceived(applicant.first_name, applicant.screen_name||applicant.first_name));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Resend welcome/grant access email
app.post('/api/admin/resend/welcome/:memberId', requireAuth, async (req, res) => {
  try {
    const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.memberId);
    if (!member) return res.status(404).json({ error: 'Not found' });
    const profile = db.prepare('SELECT * FROM profiles WHERE member_id=?').get(req.params.memberId);
    const { new_pass } = req.body;
    // If new password provided, update it
    if (new_pass && new_pass.trim()) {
      const hashed = bcrypt.hashSync(new_pass.trim(), 10);
      db.prepare('UPDATE members SET password=?, plain_pass=? WHERE id=?').run(hashed, new_pass.trim(), member.id);
    }
    const pass = new_pass || '(your existing password)';
    await sendMail(member.email, 'Welcome to Dungeon', emailWelcome(member.first_name, profile?.screen_name||member.first_name, member.email, pass, ''));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Admin: Fix unlinked profiles ─────────────────────────────────────────────
app.post('/api/admin/fix-profile-links', requireAuth, (req, res) => {
  const result = db.prepare(`
    UPDATE profiles 
    SET member_id=(SELECT m.id FROM members m WHERE LOWER(m.email)=LOWER(profiles.email) LIMIT 1)
    WHERE member_id IS NULL AND email IS NOT NULL
  `).run();
  
  // Also try matching by applicant email if available
  const unlinked = db.prepare("SELECT * FROM profiles WHERE member_id IS NULL").all();
  let fixed = result.changes;
  
  res.json({ ok: true, fixed, remaining_unlinked: unlinked.length });
});



// Save member devices
app.post('/api/member/profile/devices', requireMember, (req, res) => {
  const { devices } = req.body;
  if (!devices || typeof devices !== 'object') return res.status(400).json({ error: 'Invalid devices data' });
  const member = req.session.member;
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=? OR (member_id IS NULL AND LOWER(email)=LOWER(?))').get(member.id, member.email);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  db.prepare('UPDATE profiles SET devices=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(JSON.stringify(devices), profile.id);
  res.json({ ok: true });
});


// ── One-time DB Cleanup (remove after use) ────────────────────────────────
app.post('/api/admin/cleanup-db', requireAuth, (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'CLEANUP') return res.status(400).json({ error: 'Must confirm with CLEANUP' });

  const keepScreenNames = ['lqbanito1', 'one', 'burnerburns79'];

  // Get profile IDs to keep
  const keepProfiles = db.prepare(
    `SELECT p.id, p.member_id FROM profiles p WHERE LOWER(p.screen_name) IN (${keepScreenNames.map(()=>'?').join(',')})`
  ).all(...keepScreenNames);

  const keepProfileIds = keepProfiles.map(p => p.id);
  const keepMemberIds = keepProfiles.map(p => p.member_id).filter(Boolean);

  // Delete all applicants
  db.prepare('DELETE FROM applicants').run();

  // Delete demo requests
  try { db.prepare('DELETE FROM demo_requests').run(); } catch(e) {}

  // Delete support messages
  try { db.prepare('DELETE FROM support_messages').run(); } catch(e) {}

  // Delete messages not involving kept members
  try {
    const keepEmails = db.prepare(`SELECT email FROM members WHERE id IN (${keepMemberIds.map(()=>'?').join(',')})`).all(...keepMemberIds).map(m=>m.email);
    db.prepare('DELETE FROM messages WHERE sender_email NOT IN (' + keepEmails.map(()=>'?').join(',') + ') AND recipient_email NOT IN (' + keepEmails.map(()=>'?').join(',') + ')').run(...keepEmails, ...keepEmails);
  } catch(e) {}

  // Delete forum posts/threads
  try { db.prepare('DELETE FROM forum_posts').run(); } catch(e) {}
  try { db.prepare('DELETE FROM forum_threads').run(); } catch(e) {}

  // Delete redemptions not belonging to kept profiles
  if (keepProfileIds.length > 0) {
    db.prepare(`DELETE FROM redemptions WHERE profile_id NOT IN (${keepProfileIds.map(()=>'?').join(',')})`).run(...keepProfileIds);
  } else {
    db.prepare('DELETE FROM redemptions').run();
  }

  // Delete credit transactions not belonging to kept profiles
  try {
    if (keepProfileIds.length > 0) {
      db.prepare(`DELETE FROM credit_transactions WHERE profile_id NOT IN (${keepProfileIds.map(()=>'?').join(',')})`).run(...keepProfileIds);
      db.prepare(`DELETE FROM credits WHERE profile_id NOT IN (${keepProfileIds.map(()=>'?').join(',')})`).run(...keepProfileIds);
    } else {
      db.prepare('DELETE FROM credit_transactions').run();
      db.prepare('DELETE FROM credits').run();
    }
  } catch(e) {}

  // Delete iptv_accounts not belonging to kept profiles
  try {
    if (keepProfileIds.length > 0) {
      db.prepare(`DELETE FROM iptv_accounts WHERE profile_id NOT IN (${keepProfileIds.map(()=>'?').join(',')})`).run(...keepProfileIds);
    } else {
      db.prepare('DELETE FROM iptv_accounts').run();
    }
  } catch(e) {}

  // Delete members not in keep list
  if (keepMemberIds.length > 0) {
    db.prepare(`DELETE FROM members WHERE id NOT IN (${keepMemberIds.map(()=>'?').join(',')})`).run(...keepMemberIds);
  }

  // Delete profiles not in keep list
  if (keepProfileIds.length > 0) {
    db.prepare(`DELETE FROM profiles WHERE id NOT IN (${keepProfileIds.map(()=>'?').join(',')})`).run(...keepProfileIds);
  }

  res.json({ ok: true, kept: keepScreenNames, keptProfiles: keepProfileIds.length, keptMembers: keepMemberIds.length });
});
// ────────────────────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES — Clean rewrite
// ══════════════════════════════════════════════════════════════════════════════

// Helper: get full member data
function getMemberFull(id) {
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(id);
  if (!m) return null;
  const profile = db.prepare('SELECT * FROM profiles WHERE member_id=? OR (member_id IS NULL AND LOWER(email)=LOWER(?))').get(id, m.email);
  const credits = profile ? db.prepare('SELECT amount FROM credits WHERE profile_id=?').get(profile.id) : null;
  return { ...m, profile_id_val: profile?.id||null, screen_name: profile?.screen_name||null, avatar_url: profile?.avatar_url||null, avatar_color: profile?.avatar_color||null, tier: profile?.tier||'member', devices: profile?.devices||null, credit_balance: credits?.amount||0 };
}

// GET all members
app.get('/api/admin/members', requireMod, (req, res) => {
  try {
    const members = db.prepare('SELECT * FROM members ORDER BY first_name').all();
    res.json(members.map(m => getMemberFull(m.id)));
  } catch(e) { console.error('[admin/members]', e.message); res.status(500).json({ error: e.message }); }
});

// POST update member info
app.post('/api/admin/members/:id', requireMod, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, notes, tier } = req.body;
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE members SET first_name=?, last_name=?, email=?, phone=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(first_name??m.first_name, last_name??m.last_name, email??m.email, phone??m.phone, notes??m.notes, req.params.id);

    if (tier) {
      const profile = db.prepare('SELECT * FROM profiles WHERE member_id=? OR (member_id IS NULL AND LOWER(email)=LOWER(?))').get(req.params.id, m.email);
      if (profile) {
        const oldTier = profile.tier;
        db.prepare('UPDATE profiles SET tier=? WHERE id=?').run(tier, profile.id);

        const staffTiers = ['dealer','mod','admin','warden'];
        const isNowStaff = staffTiers.includes(tier);
        const wasStaff = staffTiers.includes(oldTier);

        if (isNowStaff && !wasStaff) {
          // Promoted to staff — grant permanent Jellyfin access
          try {
            const username = m.jellyfin_user || m.stremio_email || profile.screen_name?.toLowerCase().replace(/[^a-z0-9_]/g,'_');
            const password = m.jellyfin_pass || m.stremio_pass || mkRandPass();
            // Create account on VPS
            const jfRes = await jellyfinCreateUser(username, password, JELLYFIN_URL, JELLYFIN_API_KEY);
            if (jfRes?.status === 200 || jfRes?.status === 201 || jfRes?.status === 400) {
              // 400 may mean user already exists — either way get their ID
              const jfId = await jellyfinGetUserId(username, JELLYFIN_URL, JELLYFIN_API_KEY);
              if (jfId) await jellyfinGrantLibraryAccess(jfId, ['Movies', 'Shows'], JELLYFIN_URL, JELLYFIN_API_KEY);
            }
            // Create on TV server too
            const jfTVRes = await jellyfinCreateUser(username, password, JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
            if (jfTVRes?.status === 200 || jfTVRes?.status === 201 || jfTVRes?.status === 400) {
              const jfTVId = await jellyfinGetUserId(username, JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
              if (jfTVId) await jellyfinGrantLibraryAccess(jfTVId, ['Live TV'], JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
            }
            // Set permanent subscription (10 years)
            const forever = new Date(Date.now() + 10*365*24*60*60*1000).toISOString();
            db.prepare('UPDATE members SET jellyfin_user=?, jellyfin_pass=?, stremio_email=?, stremio_pass=?, stremio_start=?, stremio_end=?, iptv_start=?, iptv_end=? WHERE id=?')
              .run(username, password, username, password, new Date().toISOString(), forever, new Date().toISOString(), forever, req.params.id);
            console.log('[tier] Staff promotion — granted permanent access to:', username);
          } catch(e) { console.error('[tier] Jellyfin grant error:', e.message); }

        } else if (!isNowStaff && wasStaff) {
          // Demoted from staff — revoke Jellyfin access
          try {
            const username = m.jellyfin_user || m.stremio_email;
            if (username) {
              // Disable on VPS
              const jfId = await jellyfinGetUserId(username, JELLYFIN_URL, JELLYFIN_API_KEY);
              if (jfId) {
                await jellyfinRequest('POST', '/Users/' + jfId + '/Policy', { IsDisabled: true }, JELLYFIN_URL, JELLYFIN_API_KEY);
              }
              // Disable on TV server
              const jfTVId = await jellyfinGetUserId(username, JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
              if (jfTVId) {
                await jellyfinRequest('POST', '/Users/' + jfTVId + '/Policy', { IsDisabled: true }, JELLYFIN_TV_URL, JELLYFIN_TV_API_KEY);
              }
            }
            // Clear subscription dates
            db.prepare('UPDATE members SET stremio_end=NULL, iptv_end=NULL WHERE id=?').run(req.params.id);
            console.log('[tier] Staff demotion — revoked access for:', username);
          } catch(e) { console.error('[tier] Jellyfin revoke error:', e.message); }
        }
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST update DungeonStream subscription
app.post('/api/admin/members/:id/stream', requireMod, (req, res) => {
  try {
    const { username, password, start, end } = req.body;
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    const toISO = d => !d ? null : d.includes('T') ? d : d + 'T00:00:00.000Z';
    const u = username ?? m.jellyfin_user ?? m.stremio_email;
    const p = password ?? m.jellyfin_pass ?? m.stremio_pass;
    db.prepare('UPDATE members SET stremio_email=?, stremio_pass=?, jellyfin_user=?, jellyfin_pass=?, stremio_start=?, stremio_end=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(u, p, u, p, toISO(start), toISO(end), req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST update DungeonCast subscription
app.post('/api/admin/members/:id/cast', requireMod, (req, res) => {
  try {
    const { start, end } = req.body;
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    const toISO = d => !d ? null : d.includes('T') ? d : d + 'T00:00:00.000Z';
    db.prepare('UPDATE members SET iptv_start=?, iptv_end=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(toISO(start), toISO(end), req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST clear subscription dates
app.post('/api/admin/members/:id/clear-sub', requireMod, (req, res) => {
  try {
    const { service } = req.body;
    if (service === 'stream') db.prepare('UPDATE members SET stremio_start=NULL, stremio_end=NULL WHERE id=?').run(req.params.id);
    else if (service === 'cast') db.prepare('UPDATE members SET iptv_start=NULL, iptv_end=NULL WHERE id=?').run(req.params.id);
    else db.prepare('UPDATE members SET stremio_start=NULL, stremio_end=NULL, iptv_start=NULL, iptv_end=NULL WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST add credits
app.post('/api/admin/credits', requireMod, (req, res) => {
  try {
    const { profile_id, amount, reason } = req.body;
    if (!profile_id || !amount) return res.status(400).json({ error: 'profile_id and amount required' });
    addCredit(profile_id, parseInt(amount), 'admin', reason || 'Admin adjustment');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET applicants
app.get('/api/applicants', requireMod, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM applicants ORDER BY created_at DESC').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// POST approve applicant
app.post('/api/applicants/:id/promote', requireMod, async (req, res) => {
  try {
    const applicant = db.prepare('SELECT * FROM applicants WHERE id=?').get(req.params.id);
    if (!applicant) return res.status(404).json({ error: 'Not found' });
    const { stremio_pass } = req.body;
    const plain = stremio_pass || mkRandPass();
    let hashedPass = null;
    try { hashedPass = require('bcryptjs').hashSync(plain, 10); } catch(e) {}

    // Get or create member
    let existing = db.prepare('SELECT * FROM members WHERE LOWER(email)=LOWER(?)').get(applicant.email);
    let memberId = existing?.id;
    if (!existing) {
      memberId = genId();
      db.prepare('INSERT INTO members (id, first_name, last_name, email, phone, password, plain_pass) VALUES (?,?,?,?,?,?,?)')
        .run(memberId, applicant.first_name, applicant.last_name, applicant.email, applicant.phone||null, hashedPass, plain);
    } else {
      // Always update password to what was entered in the grant sheet
      db.prepare('UPDATE members SET password=?, plain_pass=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashedPass, plain, memberId);
    }

    // Get or create profile
    let profile = db.prepare('SELECT * FROM profiles WHERE LOWER(email)=LOWER(?)').get(applicant.email);
    if (profile) {
      db.prepare("UPDATE profiles SET member_id=?, tier='member', screen_name=COALESCE(NULLIF(screen_name,''),?), updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(memberId, applicant.screen_name||applicant.first_name, profile.id);
    } else {
      const profileId = genId();
      const colors = ['#34d399','#60a5fa','#f87171','#fbbf24','#a78bfa'];
      db.prepare("INSERT INTO profiles (id, screen_name, email, avatar_color, tier, member_id, applicant_id) VALUES (?,?,?,?,'member',?,?)")
        .run(profileId, applicant.screen_name||applicant.first_name, applicant.email, colors[Math.floor(Math.random()*colors.length)], memberId, applicant.id);
      profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
    }

    // Warden check
    const WARDEN_EMAIL = process.env.WARDEN_EMAIL || '';
    if (WARDEN_EMAIL && applicant.email.toLowerCase() === WARDEN_EMAIL.toLowerCase()) {
      db.prepare("UPDATE profiles SET tier='warden' WHERE id=?").run(profile.id);
    }

    db.prepare("UPDATE applicants SET status='approved', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(applicant.id);

    try { await sendMail(applicant.email, 'Welcome to Dungeon', emailWelcome(applicant.first_name, applicant.screen_name||applicant.first_name, applicant.email, plain, '')); }
    catch(e) { console.error('Welcome email error:', e.message); }

    res.json({ ok: true });
  } catch(e) { console.error('[promote]', e.message); res.status(500).json({ error: e.message }); }
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function mkRandPass() {
  const c='abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({length:10},()=>c[Math.floor(Math.random()*c.length)]).join('');
}

// POST deny applicant
app.post('/api/applicants/:id/deny', requireMod, (req, res) => {
  try {
    db.prepare("UPDATE applicants SET status='denied', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET redemptions
app.get('/api/admin/redemptions', requireMod, (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT r.*, p.screen_name, p.email as profile_email, p.avatar_color,
             m.jellyfin_user, m.jellyfin_pass, m.stremio_end, m.iptv_end
      FROM redemptions r
      LEFT JOIN profiles p ON r.profile_id = p.id
      LEFT JOIN members m ON m.id = p.member_id
      ORDER BY r.created_at DESC
    `).all());
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Stripe / Invite System ────────────────────────────────────────────────────

// POST create invite + Stripe checkout session
app.post('/api/admin/invites/create', requireMod, async (req, res) => {
  try {
    const { email, amount, note } = req.body;
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });
    if (!amount || amount < 1) return res.status(400).json({ error: 'Amount must be at least $1' });
    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured — contact admin' });

    const token = require('crypto').randomBytes(24).toString('hex');
    const inviteId = genId();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    const stripeParams = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': 'Dungeon Membership',
      'line_items[0][price_data][product_data][description]': note || 'One-time signup fee for Dungeon streaming service',
      'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)),
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'success_url': SITE_URL + '/join?token=' + token,
      'cancel_url': SITE_URL + '/join?token=' + token + '&cancelled=1',
      'customer_email': email,
      'metadata[invite_token]': token,
      'metadata[invite_id]': inviteId
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: stripeParams
    });

    const session = await stripeRes.json();
    if (!session.url) return res.status(500).json({ error: session.error?.message || 'Stripe error' });

    const profile = db.prepare('SELECT id, tier FROM profiles WHERE member_id=?').get(req.session.member?.id);
    db.prepare('INSERT INTO invites (id, token, email, created_by, amount, note, stripe_session_id, expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(inviteId, token, email, profile?.id||null, Math.round(amount*100), note||null, session.id, expiresAt);

    if (profile && ['dealer','mod','admin','warden'].includes(profile.tier)) {
      db.prepare('INSERT INTO dealer_earnings (id, dealer_profile_id, invite_id, amount, dealer_cut) VALUES (?,?,?,?,?)')
        .run(genId(), profile.id, inviteId, Math.round(amount*100), Math.floor(Math.round(amount*100)*0.5));
    }

    const html = emailShell(`
      <h2>You're Invited to Dungeon</h2>
      <div class="rule"></div>
      <p>You've been personally invited to join <strong>Dungeon</strong> — a private streaming service.</p>
      <p>Click below to complete your signup. Your membership fee is <strong>$${amount}</strong>.</p>
      ${note ? `<p style="color:#94a3a0;font-size:13px">${note}</p>` : ''}
      <a href="${session.url}" class="btn">Complete Signup — $${amount}</a>
      <div class="rule"></div>
      <p style="font-size:12px;color:#6b8f7a">This link expires in 7 days. It is for you only. — The Dungeon Master</p>
    `);
    await sendMail(email, "You're Invited to Dungeon", html);

    res.json({ ok: true, url: session.url, token });
  } catch(e) {
    console.error('[invite/create]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET all invites
app.get('/api/admin/invites', requireMod, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT i.*, p.screen_name as created_by_name
      FROM invites i
      LEFT JOIN profiles p ON i.created_by = p.id
      ORDER BY i.created_at DESC
    `).all();
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE invite
app.delete('/api/admin/invites/:id', requireMod, (req, res) => {
  try {
    db.prepare('DELETE FROM invites WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET join page data (public - by token)
app.get('/api/invite/:token', (req, res) => {
  try {
    const invite = db.prepare('SELECT * FROM invites WHERE token=?').get(req.params.token);
    if (!invite) return res.status(404).json({ error: 'Invalid invite link' });
    if (invite.status === 'used') return res.status(400).json({ error: 'This invite has already been used' });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'This invite link has expired' });
    if (invite.status !== 'paid') return res.status(402).json({ error: 'payment_pending', email: invite.email, amount: invite.amount });
    res.json({ ok: true, email: invite.email, amount: invite.amount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST complete signup from invite (public)
app.post('/api/invite/:token/complete', async (req, res) => {
  try {
    const invite = db.prepare('SELECT * FROM invites WHERE token=?').get(req.params.token);
    if (!invite) return res.status(404).json({ error: 'Invalid invite' });
    if (invite.status === 'used') return res.status(400).json({ error: 'This invite has already been used' });
    if (invite.status !== 'paid') return res.status(400).json({ error: 'Payment not completed' });

    // Check expiry
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invite has expired' });
    }

    const { first_name, last_name, screen_name, phone, devices, referred_by } = req.body;
    if (!first_name || !screen_name) return res.status(400).json({ error: 'Name and screen name required' });
    if (!/^[a-zA-Z0-9_]{2,20}$/.test(screen_name)) return res.status(400).json({ error: 'Screen name must be 2-20 characters, letters/numbers/underscores only' });

    // Check screen name not taken
    const snTaken = db.prepare('SELECT id FROM profiles WHERE LOWER(screen_name)=LOWER(?)').get(screen_name);
    if (snTaken) return res.status(400).json({ error: 'Screen name already taken — try another' });

    // Check email not already a member
    const emailTaken = db.prepare('SELECT id FROM members WHERE LOWER(email)=LOWER(?)').get(invite.email);
    if (emailTaken) return res.status(400).json({ error: 'An account with this email already exists' });

    const memberId = genId();
    const profileId = genId();
    const plain = mkRandPass();
    let hashedPass = null;
    try { hashedPass = require('bcryptjs').hashSync(plain, 10); } catch(e) {}

    const email = invite.email;
    const colors = ['#34d399','#60a5fa','#f87171','#fbbf24','#a78bfa'];
    const color = colors[Math.floor(Math.random()*colors.length)];

    // Use DB transaction to prevent race conditions
    const createAccount = db.transaction(() => {
      // Re-check inside transaction
      const inviteCheck = db.prepare('SELECT status FROM invites WHERE token=?').get(req.params.token);
      if (inviteCheck.status === 'used') throw new Error('Already used');

      db.prepare('INSERT INTO members (id, first_name, last_name, email, phone, password, plain_pass, referred_by) VALUES (?,?,?,?,?,?,?,?)')
        .run(memberId, first_name, last_name||'', email, phone||null, hashedPass, plain, referred_by||null);
      db.prepare("INSERT INTO profiles (id, screen_name, email, avatar_color, tier, member_id, devices) VALUES (?,?,?,?,'member',?,?)")
        .run(profileId, screen_name, email, color, memberId, devices ? JSON.stringify(devices) : null);
      db.prepare('UPDATE members SET profile_id=? WHERE id=?').run(profileId, memberId);
      db.prepare('UPDATE invites SET status=?, member_id=?, used_at=CURRENT_TIMESTAMP WHERE token=?').run('used', memberId, req.params.token);
    });

    createAccount();

    req.session.member = db.prepare('SELECT * FROM members WHERE id=?').get(memberId);
    req.session.authenticated = true;

    try {
      await sendMail(email, 'Welcome to Dungeon', emailWelcome(first_name, screen_name, email, plain, ''));
    } catch(e) { console.error('Welcome email error:', e.message); }

    res.json({ ok: true });
  } catch(e) {
    console.error('[invite/complete]', e.message);
    if (e.message === 'Already used') return res.status(400).json({ error: 'This invite has already been used' });
    res.status(500).json({ error: e.message });
  }
});

// POST Stripe webhook
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    let event;
    // Must use raw body for signature verification
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const payload = rawBody.toString('utf8');

    if (STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers['stripe-signature'];
      if (!sig) return res.status(400).json({ error: 'No signature header' });
      const crypto = require('crypto');
      const parts = {};
      sig.split(',').forEach(part => {
        const eqIdx = part.indexOf('=');
        if (eqIdx > 0) parts[part.substring(0, eqIdx)] = part.substring(eqIdx + 1);
      });
      if (!parts.t || !parts.v1) return res.status(400).json({ error: 'Invalid signature format' });
      const expectedSig = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET)
        .update(parts.t + '.' + payload)
        .digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(parts.v1, 'hex'))) {
        console.error('[webhook] Sig mismatch. Expected:', expectedSig.substring(0,20), 'Got:', parts.v1.substring(0,20));
        return res.status(400).json({ error: 'Invalid signature' });
      }
    }

    event = JSON.parse(payload);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const token = session.metadata?.invite_token;
      if (token) {
        db.prepare('UPDATE invites SET status=?, stripe_payment_intent=?, paid_at=CURRENT_TIMESTAMP WHERE token=?')
          .run('paid', session.payment_intent, token);
        // Mark dealer earnings as earned (client paid - NOT yet paid out to dealer)
        const paidInvite = db.prepare('SELECT * FROM invites WHERE token=?').get(token);
        if (paidInvite) {
          db.prepare("UPDATE dealer_earnings SET status='earned' WHERE invite_id=?").run(paidInvite.id);
        }
        console.log('[stripe] Invite paid:', token);
      }
    }

    res.json({ received: true });
  } catch(e) {
    console.error('[stripe/webhook]', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────


// ── Dealer Routes ─────────────────────────────────────────────────────────────

// GET dealer dashboard data
app.get('/api/dealer/dashboard', requireDealer, (req, res) => {
  try {
    const pid = req.profile.id;
    const invites = db.prepare('SELECT * FROM invites WHERE created_by=? ORDER BY created_at DESC').all(pid);

    // Join earnings with invite status so we know which ones are actually paid by client
    const earnings = db.prepare(`
      SELECT de.*, i.status as invite_status, i.email as invite_email, i.paid_at as invite_paid_at
      FROM dealer_earnings de
      LEFT JOIN invites i ON de.invite_id = i.id
      WHERE de.dealer_profile_id=?
      ORDER BY de.created_at DESC
    `).all(pid);

    // Awaiting payout = invite was paid by client, but dealer hasn't been paid out yet
    const awaitingPayout = earnings.filter(e => e.status === 'earned');
    const paidOut = earnings.filter(e => e.status === 'paid_out');
    const totalSales = invites.filter(i => i.status === 'paid' || i.status === 'used').length;
    const totalRevenue = invites.filter(i => i.status === 'paid' || i.status === 'used').reduce((sum, i) => sum + i.amount, 0);

    res.json({
      invites,
      earnings,
      awaitingPayout: awaitingPayout.reduce((sum, e) => sum + e.dealer_cut, 0),
      paidOut: paidOut.reduce((sum, e) => sum + e.dealer_cut, 0),
      totalSales,
      totalRevenue,
      profile: req.profile
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST create invite as dealer
app.post('/api/dealer/invites/create', requireDealer, async (req, res) => {
  try {
    const { email, amount, note } = req.body;
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });
    if (!amount || amount < 1) return res.status(400).json({ error: 'Amount must be at least $1' });
    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured — contact admin' });

    const token = require('crypto').randomBytes(24).toString('hex');
    const inviteId = genId();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const stripeParams = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': 'Dungeon Membership',
      'line_items[0][price_data][product_data][description]': note || 'One-time signup fee for Dungeon streaming service',
      'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)),
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'success_url': SITE_URL + '/join?token=' + token,
      'cancel_url': SITE_URL + '/join?token=' + token + '&cancelled=1',
      'customer_email': email,
      'metadata[invite_token]': token,
      'metadata[invite_id]': inviteId
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: stripeParams
    });

    const session = await stripeRes.json();
    if (!session.url) return res.status(500).json({ error: session.error?.message || 'Stripe error' });

    db.prepare('INSERT INTO invites (id, token, email, created_by, amount, note, stripe_session_id, expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(inviteId, token, email, req.profile.id, Math.round(amount*100), note||null, session.id, expiresAt);

    db.prepare('INSERT INTO dealer_earnings (id, dealer_profile_id, invite_id, amount, dealer_cut) VALUES (?,?,?,?,?)')
      .run(genId(), req.profile.id, inviteId, Math.round(amount*100), Math.floor(Math.round(amount*100)*0.5));

    const html = emailShell(`
      <h2>You're Invited to Dungeon</h2>
      <div class="rule"></div>
      <p>You've been personally invited to join <strong>Dungeon</strong> — a private streaming service.</p>
      <p>Click below to complete your signup. Your membership fee is <strong>$${amount}</strong>.</p>
      ${note ? `<p style="color:#94a3a0;font-size:13px">${note}</p>` : ''}
      <a href="${session.url}" class="btn">Complete Signup — $${amount}</a>
      <div class="rule"></div>
      <p style="font-size:12px;color:#6b8f7a">This link expires in 7 days. It is for you only. — The Dungeon Master</p>
    `);
    await sendMail(email, "You're Invited to Dungeon", html);

    res.json({ ok: true, url: session.url, token });
  } catch(e) {
    console.error('[dealer/invite]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH update invite (email or amount)
app.patch('/api/dealer/invites/:id', requireDealer, async (req, res) => {
  try {
    const invite = db.prepare('SELECT * FROM invites WHERE id=? AND created_by=?').get(req.params.id, req.profile.id);
    if (!invite) return res.status(404).json({ error: 'Not found' });
    if (invite.status === 'used') return res.status(400).json({ error: 'Cannot edit a used invite' });

    const { email, amount, note } = req.body;

    // If amount changed, create new Stripe session
    if (amount && Math.round(amount*100) !== invite.amount) {
      const token = invite.token;
      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'payment_method_types[]': 'card',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][product_data][name]': 'Dungeon Membership',
          'line_items[0][price_data][unit_amount]': String(Math.round(amount*100)),
          'line_items[0][quantity]': '1',
          'mode': 'payment',
          'success_url': SITE_URL + '/join?token=' + token,
          'cancel_url': SITE_URL + '/invite-cancelled.html',
          'customer_email': email || invite.email || '',
          'metadata[invite_token]': token,
          'metadata[invite_id]': invite.id
        })
      });
      const session = await stripeRes.json();
      if (!session.url) return res.status(500).json({ error: session.error?.message || 'Stripe error' });

      const newCut = Math.floor(Math.round(amount*100) * 0.5);
      db.prepare('UPDATE invites SET email=?, amount=?, note=?, stripe_session_id=?, status=? WHERE id=?')
        .run(email ?? invite.email, Math.round(amount*100), note ?? invite.note, session.id, 'pending', invite.id);
      db.prepare('UPDATE dealer_earnings SET amount=?, dealer_cut=? WHERE invite_id=?')
        .run(Math.round(amount*100), newCut, invite.id);
    } else {
      db.prepare('UPDATE invites SET email=?, note=? WHERE id=?')
        .run(email ?? invite.email, note ?? invite.note, invite.id);
    }

    // Resend email if requested
    if (req.body.resend && (email || invite.email)) {
      const updated = db.prepare('SELECT * FROM invites WHERE id=?').get(invite.id);
      const stripeSession = await fetch('https://api.stripe.com/v1/checkout/sessions/' + updated.stripe_session_id, {
        headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY }
      }).then(r => r.json());
      const inviteUrl = stripeSession.url || SITE_URL + '/join?token=' + invite.token;
      const sendTo = email || invite.email;
      const amt = (updated.amount/100).toFixed(2);
      const html = emailShell(`
        <h2>You're Invited to Dungeon</h2>
        <div class="rule"></div>
        <p>You've been personally invited to join <strong>Dungeon</strong> — a private streaming service.</p>
        <p>Click below to complete your signup. Your membership fee is <strong>$${amt}</strong>.</p>
        <a href="${inviteUrl}" class="btn">Complete Signup — $${amt}</a>
        <div class="rule"></div>
        <p style="font-size:12px;color:#6b8f7a">This invite is for you only. — The Dungeon Master</p>
      `);
      await sendMail(sendTo, "You're Invited to Dungeon", html);
    }

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE dealer invite
app.delete('/api/dealer/invites/:id', requireDealer, (req, res) => {
  try {
    const invite = db.prepare('SELECT * FROM invites WHERE id=? AND created_by=?').get(req.params.id, req.profile.id);
    if (!invite) return res.status(404).json({ error: 'Not found' });
    if (invite.status === 'used') return res.status(400).json({ error: 'Cannot delete a used invite' });
    db.prepare('DELETE FROM dealer_earnings WHERE invite_id=?').run(invite.id);
    db.prepare('DELETE FROM invites WHERE id=?').run(invite.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────


// ── Admin Payout Routes ───────────────────────────────────────────────────────

// GET all dealers with their earnings summary
app.get('/api/admin/payouts', requireMod, (req, res) => {
  try {
    // Get all dealers
    const dealers = db.prepare("SELECT * FROM profiles WHERE tier IN ('dealer','mod','admin','warden')").all();
    const result = dealers.map(dealer => {
      const earnings = db.prepare(`
        SELECT de.*, i.email as invite_email, i.amount as invite_amount, i.status as invite_status, i.used_at, i.paid_at
        FROM dealer_earnings de
        LEFT JOIN invites i ON de.invite_id = i.id
        WHERE de.dealer_profile_id = ?
        ORDER BY de.created_at DESC
      `).all(dealer.id);
      const owed = earnings.filter(e => e.status === 'earned').reduce((s,e) => s + e.dealer_cut, 0);
      const paidOut = earnings.filter(e => e.status === 'paid_out').reduce((s,e) => s + e.dealer_cut, 0);
      const totalSales = earnings.filter(e => e.status === 'earned' || e.status === 'paid_out').length;
      return { ...dealer, earnings, owed, paidOut, totalSales };
    }).filter(d => d.tier === 'dealer'); // only show actual dealers, not mods/admins
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST mark single earning as paid out
app.post('/api/admin/payouts/:earningId/mark-paid', requireMod, (req, res) => {
  try {
    db.prepare("UPDATE dealer_earnings SET status='paid_out', paid_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.earningId);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST mark ALL owed earnings for a dealer as paid out
app.post('/api/admin/payouts/dealer/:profileId/pay-all', requireMod, (req, res) => {
  try {
    db.prepare("UPDATE dealer_earnings SET status='paid_out', paid_at=CURRENT_TIMESTAMP WHERE dealer_profile_id=? AND status='earned'").run(req.params.profileId);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────


// Admin: fix earning status (one-time migration helper)
app.post('/api/admin/fix-earning-status', requireMod, (req, res) => {
  try {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    db.prepare('UPDATE dealer_earnings SET status=? WHERE id=?').run(status, id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: migrate old dealer earnings statuses
app.post('/api/admin/migrate-earnings', requireMod, (req, res) => {
  try {
    // 'paid' was old status meaning client paid - rename to 'earned'
    const r1 = db.prepare("UPDATE dealer_earnings SET status='earned' WHERE status='paid' AND paid_at IS NULL").run();
    // 'paid' with paid_at = we manually paid out - rename to 'paid_out'  
    const r2 = db.prepare("UPDATE dealer_earnings SET status='paid_out' WHERE status='paid' AND paid_at IS NOT NULL").run();
    // Delete orphaned earnings (invite_id points to non-existent invite)
    const r3 = db.prepare("DELETE FROM dealer_earnings WHERE invite_id NOT IN (SELECT id FROM invites)").run();
    res.json({ ok: true, earned: r1.changes, paid_out: r2.changes, deleted: r3.changes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// POST change password
app.post('/api/member/change-password', requireMember, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.session.member.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // Verify current password
    const bcrypt = require('bcryptjs');
    const valid = member.password ? bcrypt.compareSync(current_password, member.password) : current_password === member.plain_pass;
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const hashed = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE members SET password=?, plain_pass=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashed, new_password, member.id);

    // Update Jellyfin password too
    const username = member.jellyfin_user || member.stremio_email;
    if (username && JELLYFIN_API_KEY) {
      try {
        const jfId = await jellyfinGetUserId(username, JELLYFIN_URL, JELLYFIN_API_KEY);
        if (jfId) {
          await jellyfinRequest('POST', '/Users/'+jfId+'/Password', { CurrentPw: member.plain_pass||'', NewPw: new_password }, JELLYFIN_URL, JELLYFIN_API_KEY);
          console.log('[password] Updated Jellyfin password for:', username);
        }
      } catch(e) { console.error('[password] Jellyfin update error:', e.message); }
    }

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Password Reset ────────────────────────────────────────────────────────────

// POST request password reset
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const member = db.prepare('SELECT * FROM members WHERE LOWER(email)=LOWER(?)').get(email);
    // Always return success to prevent email enumeration
    if (!member) return res.json({ ok: true });

    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // Store token (reuse plain_pass column temporarily with prefix, or add to members)
    db.prepare('UPDATE members SET reset_token=?, reset_token_expires=? WHERE id=?').run(token, expires, member.id);

    const resetUrl = SITE_URL + '/reset-password?token=' + token;
    const html = emailShell(`
      <h2>Reset Your Password</h2>
      <div class="rule"></div>
      <p>Hi <strong>${member.first_name}</strong>,</p>
      <p>We received a request to reset your Dungeon password. Click below to set a new one.</p>
      <a href="${resetUrl}" class="btn">Reset Password</a>
      <div class="rule"></div>
      <p style="font-size:12px;color:#6b8f7a">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `);
    await sendMail(member.email, 'Reset Your Dungeon Password', html);
    res.json({ ok: true });
  } catch(e) { console.error('[forgot-password]', e.message); res.status(500).json({ error: e.message }); }
});

// POST reset password with token
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: 'Token and password required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const member = db.prepare('SELECT * FROM members WHERE reset_token=?').get(token);
    if (!member) return res.status(400).json({ error: 'Invalid or expired reset link' });
    if (new Date(member.reset_token_expires) < new Date()) return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });

    const bcrypt = require('bcryptjs');
    const hashed = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE members SET password=?, plain_pass=?, reset_token=NULL, reset_token_expires=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(hashed, new_password, member.id);

    res.json({ ok: true });
  } catch(e) { console.error('[reset-password]', e.message); res.status(500).json({ error: e.message }); }
});

// GET serve reset password page
app.get('/reset-password', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'reset-password.html'));
});

// ─────────────────────────────────────────────────────────────────────────────

// ── Admin: Subscribers ────────────────────────────────────────────────────────
app.get('/api/admin/subscribers', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.first_name, m.last_name, m.email,
           m.stremio_email, m.stremio_start, m.stremio_end,
           m.iptv_start, m.iptv_end,
           COALESCE(p.screen_name, m.first_name || ' ' || m.last_name) as screen_name
    FROM members m
    LEFT JOIN profiles p ON (p.member_id=m.id OR (p.member_id IS NULL AND LOWER(p.email)=LOWER(m.email)))
    WHERE m.stremio_end IS NOT NULL OR m.iptv_end IS NOT NULL
    ORDER BY m.first_name
  `).all();
  res.json(rows);
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, (req, res) => {
  res.json({
    applicants: db.prepare('SELECT COUNT(*) as n FROM applicants WHERE archived=0').get().n,
    pending: db.prepare("SELECT COUNT(*) as n FROM applicants WHERE status='pending' AND archived=0").get().n,
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
