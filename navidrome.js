// navidrome.js - DungeonAmp (Navidrome music) provisioning helper.
// Drop this file next to server.js, require it and call the functions at the
// appropriate lifecycle points (redeem, expiry cron, purge, member self-heal).
//
// Environment variables needed in enterdungeon's .env / Render settings:
//   NAVIDROME_URL         = https://music.example.com   (admin API, server-to-server)
//   NAVIDROME_ADMIN_USER  = admin username on that Navidrome
//   NAVIDROME_ADMIN_PASS  = admin password
//
// Security model (deliberately stricter than the Jellyfin flow):
//   - Member music passwords are NEVER stored in the Dungeon DB and never
//     emailed. Accounts are created with a random throwaway password; the
//     member sets a real one from their dashboard, where it is shown exactly
//     once over their authenticated session.
//   - "Locking" an account = scrambling its password. Subsonic tokens are
//     password-derived (t = md5(password + salt)), so a scramble revokes
//     every remembered Ampio/Subsonic login instantly.

const crypto = require('crypto');

const ND_URL = (process.env.NAVIDROME_URL || '').replace(/\/$/, '');
const ND_ADMIN_USER = process.env.NAVIDROME_ADMIN_USER || '';
const ND_ADMIN_PASS = process.env.NAVIDROME_ADMIN_PASS || '';
const ND_TIMEOUT_MS = 8000; // fail fast instead of hanging redeem/cron/dashboard requests

let adminToken = null; // cached JWT from /auth/login (Navidrome rotates these)

function ndConfigured() {
  if (!ND_URL || !ND_ADMIN_USER || !ND_ADMIN_PASS) {
    console.warn('[navidrome] Not configured - set NAVIDROME_URL, NAVIDROME_ADMIN_USER, NAVIDROME_ADMIN_PASS');
    return false;
  }
  return true;
}

// Crypto-strength random password (the member-facing reset in server.js also
// uses this). No ambiguous chars so it survives being read off a phone screen.
function ndRandPass(len = 24) {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += c[bytes[i] % c.length];
  return out;
}

// Wraps fetch with a short timeout so a hung Navidrome doesn't hang the caller.
function ndFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ND_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function ndLogin() {
  const r = await ndFetch(`${ND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ND_ADMIN_USER, password: ND_ADMIN_PASS }),
  });
  if (!r.ok) throw new Error(`Navidrome admin login failed: HTTP ${r.status}`);
  const d = await r.json();
  if (!d.token) throw new Error('Navidrome admin login: no token in response');
  if (!d.isAdmin) throw new Error('NAVIDROME_ADMIN_USER is not an admin on this server');
  adminToken = d.token;
  return adminToken;
}

// Authenticated call against Navidrome's native REST API (/api/...).
// Re-logs-in once on 401 (expired/rotated JWT).
async function ndApi(method, path, body, retrying = false) {
  if (!adminToken) await ndLogin();
  const r = await ndFetch(`${ND_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-nd-authorization': 'Bearer ' + adminToken,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && !retrying) {
    adminToken = null;
    return ndApi(method, path, body, true);
  }
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    let errMsg = `HTTP ${r.status}`;
    try { errMsg = JSON.parse(errText).error || errMsg; } catch (_) {}
    const err = new Error(errMsg);
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return null;
  return r.json().catch(() => null);
}

// Find a user by userName (case-insensitive). Returns the user object or null.
async function ndFindUser(username) {
  if (!ndConfigured()) return null;
  try {
    const users = await ndApi('GET', '/api/user?_start=0&_end=1000');
    if (!Array.isArray(users)) return null;
    const want = String(username).toLowerCase();
    return users.find(u => String(u.userName || '').toLowerCase() === want) || null;
  } catch (e) {
    console.error('[navidrome] find user error:', e.message);
    return null;
  }
}

// Provision a member account. Idempotent: if the username already exists it is
// adopted instead of duplicated. The account is created with a random
// throwaway password - the member sets a real one via the dashboard.
// Returns { ok, userId, userName, existed } or { ok: false, error }.
async function ndProvision(username, displayName, email) {
  if (!ndConfigured()) return { ok: false, error: 'not configured' };
  try {
    const existing = await ndFindUser(username);
    if (existing) return { ok: true, userId: existing.id, userName: existing.userName, existed: true };

    const created = await ndApi('POST', '/api/user', {
      userName: username,
      name: displayName || username,
      email: email || '',
      password: ndRandPass(),
      isAdmin: false,
    });
    const userId = created && (created.id || (created.data && created.data.id));
    if (!userId) {
      // Some Navidrome versions return a minimal body - re-find to get the id.
      const found = await ndFindUser(username);
      if (found) return { ok: true, userId: found.id, userName: found.userName };
      return { ok: false, error: 'created but could not resolve user id' };
    }
    return { ok: true, userId, userName: username };
  } catch (e) {
    console.error('[navidrome] provision error:', e.message);
    return { ok: false, error: e.message };
  }
}

// Set a user's password (used by the member-facing reset - the caller shows it
// once and forgets it). Navidrome updates via PUT of the full user record.
async function ndSetPassword(userId, newPassword) {
  if (!ndConfigured()) return { ok: false, error: 'not configured' };
  try {
    const user = await ndApi('GET', `/api/user/${encodeURIComponent(userId)}`);
    if (!user || !user.id) return { ok: false, error: 'user not found' };
    if (user.isAdmin) return { ok: false, error: 'refusing to touch an admin account' };
    await ndApi('PUT', `/api/user/${encodeURIComponent(userId)}`, {
      ...user,
      changePassword: true,
      password: newPassword,
    });
    return { ok: true };
  } catch (e) {
    console.error('[navidrome] set password error:', e.message);
    return { ok: false, error: e.message };
  }
}

// Lock a member out by scrambling their password. Because Subsonic tokens are
// derived from the password, this revokes every remembered client login too.
async function ndLock(userId) {
  return ndSetPassword(userId, ndRandPass(32));
}

// Permanently delete a user (account purge).
async function ndDelete(userId) {
  if (!ndConfigured()) return { ok: false, error: 'not configured' };
  try {
    await ndApi('DELETE', `/api/user/${encodeURIComponent(userId)}`);
    return { ok: true };
  } catch (e) {
    if (e.status === 404) return { ok: true, missing: true };
    console.error('[navidrome] delete error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { ndConfigured, ndProvision, ndFindUser, ndSetPassword, ndLock, ndDelete, ndRandPass };
