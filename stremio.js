// stremio.js — Stremio account auto-provisioning for enterdungeon.cc
// Drop this file next to server.js (same pattern as stremgate.js).
//
// What it does: creates a real Stremio account for a member (their email +
// a generated 8-char password), then sets their addon collection to ONLY
// Cinemeta + their personal Dungeon (StremGate) addon. The member never
// touches the Add-ons screen — they just log into the Stremio app.
//
// No env vars needed — api.strem.io is public and unauthenticated
// (the authKey returned by register/login IS the auth).

const STREMIO_API = 'https://api.strem.io/api';
const STREMIO_TIMEOUT_MS = 10000; // registration can be slow; still fail fast

// 8-char random password, unambiguous charset (no 0/O/1/l/I)
function mkStremioPass() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 8; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

function stFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREMIO_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// All Stremio API endpoints are POST with a JSON body and return
// { result } on success or { error: { code, message } } on failure.
async function stCall(path, body) {
  const r = await stFetch(`${STREMIO_API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (d.error) {
    const err = new Error(d.error.message || JSON.stringify(d.error));
    err.code = d.error.code;
    throw err;
  }
  return d.result;
}

async function stRegister(email, password) {
  return stCall('register', {
    type: 'Register',
    email,
    password,
    gdpr_consent: { tos: true, privacy: true, marketing: false, from: 'web' },
  });
}

async function stLogin(email, password) {
  return stCall('login', { type: 'Login', email, password });
}

async function stGetAddons(authKey) {
  const r = await stCall('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  return (r && r.addons) || [];
}

async function stSetAddons(authKey, addons) {
  return stCall('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons });
}

async function fetchManifest(manifestUrl) {
  const r = await stFetch(manifestUrl);
  if (!r.ok) throw new Error(`manifest fetch ${r.status}: ${manifestUrl}`);
  return r.json();
}

// Build the collection: Cinemeta (posters/metadata/home board) + Dungeon addon.
// Everything else Stremio installs by default gets dropped.
async function applyDungeonCollection(authKey, manifestUrl) {
  const current = await stGetAddons(authKey);
  const manifest = await fetchManifest(manifestUrl);
  const cinemeta = current.filter(a => a.manifest && a.manifest.id === 'com.linvo.cinemeta');
  await stSetAddons(authKey, [
    ...cinemeta,
    { transportUrl: manifestUrl, transportName: 'http', manifest },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provision a brand-new Stremio account for a member and install their addon.
// Returns:
//   { ok: true,  email, password, authKey }
//   { ok: false, existed: true }             ← email already has a Stremio account
//   { ok: false, error }                     ← anything else
//
// On `existed`, store nothing — the DungeonStream page falls back to the
// manual "Add to Stremio" link flow for that member.
// ─────────────────────────────────────────────────────────────────────────────
async function stremioProvision({ email, manifestUrl }) {
  const password = mkStremioPass();
  let authKey;

  try {
    const reg = await stRegister(email, password);
    authKey = reg.authKey;
  } catch (e) {
    if (/exist|taken|already|registered/i.test(e.message)) {
      return { ok: false, existed: true };
    }
    console.error('[stremio] register error:', e.message);
    return { ok: false, error: e.message };
  }

  try {
    await applyDungeonCollection(authKey, manifestUrl);
  } catch (e) {
    // Account exists but addon install failed (StremGate hiccup, manifest 404).
    // Still return ok with creds — a resync can finish the job later, and the
    // member can at least log in.
    console.error('[stremio] addon install error (account created):', e.message);
  }

  return { ok: true, email, password, authKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-sync an auto-provisioned account's addons (manifest URL changed, member
// installed junk, addon install failed during provision).
// Tries the stored authKey first; if it was invalidated (password reset,
// "log out all devices"), falls back to email+password login.
// Returns { ok, authKey, newAuthKey } — persist authKey when newAuthKey=true.
// ─────────────────────────────────────────────────────────────────────────────
async function stremioResync({ authKey, email, password, manifestUrl }) {
  let key = authKey;
  let newAuthKey = false;

  try {
    if (!key) throw new Error('no stored authKey');
    await stGetAddons(key); // cheap validity check
  } catch (_) {
    try {
      const login = await stLogin(email, password);
      key = login.authKey;
      newAuthKey = true;
    } catch (e) {
      console.error('[stremio] resync login failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  try {
    await applyDungeonCollection(key, manifestUrl);
    return { ok: true, authKey: key, newAuthKey };
  } catch (e) {
    console.error('[stremio] resync error:', e.message);
    return { ok: false, error: e.message, authKey: key, newAuthKey };
  }
}

module.exports = { stremioProvision, stremioResync, mkStremioPass };
