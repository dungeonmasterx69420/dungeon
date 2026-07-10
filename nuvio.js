// nuvio.js - Nuvio account auto-provisioning for enterdungeon.cc
// Drop this file next to server.js (same pattern as stremio.js).
//
// What it does: creates a real Nuvio account for a member (their email +
// a generated password), creates their first profile (Nuvio accounts are
// born with zero profiles - the app normally makes one during onboarding),
// then installs their personal Dungeon (StremGate) addon. The member never
// touches the Addons screen - they just log into the Nuvio app.
//
// Nuvio's backend is Supabase (api.nuvio.tv). The anon key below is the
// public client key shipped inside the open-source Nuvio apps - it is not
// a secret, but it can rotate, so it is env-overridable.
//
// Expiry needs no handling here: the installed addon is the member's
// StremGate proxy URL, so access control stays in StremGate exactly like
// the Stremio flow.
//
// Verified end to end 2026-07-10 (signup session, profile push, addon
// persistence, refresh grant) against api.nuvio.tv.

const NUVIO_API = process.env.NUVIO_API_URL || 'https://api.nuvio.tv';
const NUVIO_ANON_KEY = process.env.NUVIO_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI';
const NUVIO_TIMEOUT_MS = 10000;
const NUVIO_CLIENT_ID = 'dungeon-provisioner-enterdungeon';
const NUVIO_MAX_PROFILES = 6;
const NUVIO_PROFILE_COLOR = '#34D399'; // Dungeon glow green

// 10-char random password, unambiguous charset (no 0/O/1/l/I).
// Supabase minimum is 6; 10 keeps parity with the site's own rules.
function mkNuvioPass() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p + '!';
}

function nvFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NUVIO_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Generic Supabase call. GoTrue and PostgREST both return JSON bodies with
// { message } or { error_description } on failure and a non-2xx status.
async function nvCall(path, { token, method = 'POST', body } = {}) {
  const r = await nvFetch(`${NUVIO_API}${path}`, {
    method,
    headers: {
      'apikey': NUVIO_ANON_KEY,
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let d = null;
  try { d = text ? JSON.parse(text) : null; } catch (_) { d = text; }
  if (!r.ok) {
    const msg = (d && (d.msg || d.message || d.error_description || d.error)) || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return d;
}

// Signup returns a live session directly (confirmations are off on Nuvio's
// project). 422 "User already registered" when the email is taken.
async function nvSignup(email, password) {
  return nvCall('/auth/v1/signup', { body: { email, password } });
}

async function nvLogin(email, password) {
  return nvCall('/auth/v1/token?grant_type=password', { body: { email, password } });
}

async function nvGetProfiles(token) {
  return nvCall('/rest/v1/rpc/sync_pull_profiles', { token, body: {} }) || [];
}

// Nuvio accounts start with no profile. Create profile 1 if missing and
// return the profile_index to target addon pushes at.
async function ensureProfile(token, profileName) {
  const profiles = await nvGetProfiles(token);
  if (Array.isArray(profiles) && profiles.length > 0) {
    return profiles[0].profile_index;
  }
  await nvCall('/rest/v1/rpc/sync_push_profiles', {
    token,
    body: {
      p_client_max_profiles: NUVIO_MAX_PROFILES,
      p_profiles: [{
        profile_index: 1,
        name: profileName || 'Dungeon',
        avatar_color_hex: NUVIO_PROFILE_COLOR,
        uses_primary_addons: false,
        uses_primary_plugins: false,
        avatar_id: null,
        avatar_url: null,
      }],
      p_origin_client_id: NUVIO_CLIENT_ID,
    },
  });
  return 1;
}

async function fetchManifest(manifestUrl) {
  const r = await nvFetch(manifestUrl);
  if (!r.ok) throw new Error(`manifest fetch ${r.status}: ${manifestUrl}`);
  return r.json();
}

// Install the Dungeon addon on a profile. sync_push_addons REPLACES the
// profile's addon list, which is exactly what we want (mirrors the Stremio
// flow where everything but the Dungeon collection gets dropped).
async function applyDungeonAddons(token, profileId, manifestUrl) {
  let name = 'The Dungeon';
  try {
    const manifest = await fetchManifest(manifestUrl);
    if (manifest && manifest.name) name = manifest.name;
  } catch (_) { /* cosmetic only - keep default name */ }
  await nvCall('/rest/v1/rpc/sync_push_addons', {
    token,
    body: {
      p_profile_id: profileId,
      p_addons: [{ url: manifestUrl, name, enabled: true, sort_order: 0 }],
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Provision a brand-new Nuvio account for a member, create their profile,
// and install their addon.
// Returns:
//   { ok: true,  email, password, userId }
//   { ok: false, existed: true }             <- email already has a Nuvio account
//   { ok: false, error }                     <- anything else
//
// On `existed`, store nothing - fall back to the manual "add this URL in
// Nuvio" flow for that member, same as the Stremio email-collision path.
// ─────────────────────────────────────────────────────────────────────────────
async function nuvioProvision({ email, manifestUrl, profileName }) {
  const password = mkNuvioPass();
  let session;

  try {
    session = await nvSignup(email, password);
    if (!session || !session.access_token) {
      // Would indicate email confirmations were turned on upstream.
      return { ok: false, error: 'signup returned no session' };
    }
  } catch (e) {
    if (e.status === 422 || /exist|taken|already|registered/i.test(e.message)) {
      return { ok: false, existed: true };
    }
    console.error('[nuvio] signup error:', e.message);
    return { ok: false, error: e.message };
  }

  try {
    const profileId = await ensureProfile(session.access_token, profileName);
    await applyDungeonAddons(session.access_token, profileId, manifestUrl);
  } catch (e) {
    // Account exists but profile/addon setup failed. Still return ok with
    // creds - a resync can finish the job later, and the member can log in.
    console.error('[nuvio] setup error (account created):', e.message);
  }

  return { ok: true, email, password, userId: session.user && session.user.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-sync an auto-provisioned account (manifest URL changed, member installed
// junk, setup failed during provision). Supabase access tokens only live an
// hour, so unlike Stremio's authKey there is nothing worth storing - we just
// log in fresh with the stored email + password every time.
// Returns { ok } or { ok: false, error }.
// ─────────────────────────────────────────────────────────────────────────────
async function nuvioResync({ email, password, manifestUrl, profileName }) {
  let session;
  try {
    session = await nvLogin(email, password);
  } catch (e) {
    console.error('[nuvio] resync login failed:', e.message);
    return { ok: false, error: e.message };
  }

  try {
    const profileId = await ensureProfile(session.access_token, profileName);
    await applyDungeonAddons(session.access_token, profileId, manifestUrl);
    return { ok: true };
  } catch (e) {
    console.error('[nuvio] resync error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { nuvioProvision, nuvioResync, mkNuvioPass };
