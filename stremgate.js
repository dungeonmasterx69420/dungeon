// stremgate.js - StremGate provisioning helper for enterdungeon.cc
// Drop this file next to server.js. Require it and call the functions
// at the appropriate points in server.js (see integration-patch.js).
//
// Environment variables needed in enterdungeon's .env / Render settings:
//   STREMGATE_URL      = https://stremgate.dungeoncast.cc
//   STREMGATE_API_KEY  = (same value as ADMIN_API_KEY in StremGate's .env)

const STREMGATE_URL = (process.env.STREMGATE_URL || '').replace(/\/$/, '');
const STREMGATE_KEY = process.env.STREMGATE_API_KEY || '';
const STREMGATE_TIMEOUT_MS = 8000; // fail fast instead of hanging invite/renewal/dashboard requests

function sgHeaders() {
  return { 'Content-Type': 'application/json', 'X-Admin-Key': STREMGATE_KEY };
}

function configured() {
  if (!STREMGATE_URL || !STREMGATE_KEY) {
    console.warn('[stremgate] Not configured - set STREMGATE_URL and STREMGATE_API_KEY');
    return false;
  }
  return true;
}

// Wraps fetch with a short timeout so a hung StremGate doesn't hang the caller
// (invite completion, renewal, dashboard load) for minutes. A timeout looks like
// any other failed fetch to callers - they already handle that case.
function sgFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREMGATE_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Provision a new StremGate member.
// Returns { ok, memberId } or { ok: false, error }.
async function sgProvision(username, password, durationDays = 30) {
  if (!configured()) return { ok: false, error: 'not configured' };
  try {
    const r = await sgFetch(`${STREMGATE_URL}/api/admin/users`, {
      method: 'POST',
      headers: sgHeaders(),
      body: JSON.stringify({ username, password, durationDays }),
    });
    if (!r.ok) {
      // Body might not be JSON (e.g. a proxy error page) - don't let that mask the real status.
      const errText = await r.text().catch(() => '');
      let errMsg = `HTTP ${r.status}`;
      try { errMsg = JSON.parse(errText).error || errMsg; } catch (_) {}
      return { ok: false, error: errMsg };
    }
    const d = await r.json();
    return { ok: true, memberId: d.user?.id };
  } catch (e) {
    console.error('[stremgate] provision error:', e.message);
    return { ok: false, error: e.message };
  }
}

// Extend an existing StremGate member by member ID.
async function sgExtend(sgMemberId, days = 30) {
  if (!configured()) return { ok: false };
  try {
    const r = await sgFetch(`${STREMGATE_URL}/api/admin/users/${sgMemberId}/extend`, {
      method: 'POST',
      headers: sgHeaders(),
      body: JSON.stringify({ days }),
    });
    return { ok: r.ok };
  } catch (e) {
    console.error('[stremgate] extend error:', e.message);
    return { ok: false };
  }
}

// Disable a StremGate member (subscription expired).
async function sgDisable(sgMemberId) {
  if (!configured()) return { ok: false };
  try {
    const r = await sgFetch(`${STREMGATE_URL}/api/admin/users/${sgMemberId}`, {
      method: 'PATCH',
      headers: sgHeaders(),
      body: JSON.stringify({ status: 'disabled' }),
    });
    return { ok: r.ok };
  } catch (e) {
    console.error('[stremgate] disable error:', e.message);
    return { ok: false };
  }
}

// Re-enable a StremGate member (renewal).
async function sgEnable(sgMemberId) {
  if (!configured()) return { ok: false };
  try {
    const r = await sgFetch(`${STREMGATE_URL}/api/admin/users/${sgMemberId}`, {
      method: 'PATCH',
      headers: sgHeaders(),
      body: JSON.stringify({ status: 'active' }),
    });
    return { ok: r.ok };
  } catch (e) {
    console.error('[stremgate] enable error:', e.message);
    return { ok: false };
  }
}

// Find a StremGate member by username.
// Returns the member object or null.
async function sgFind(username) {
  if (!configured()) return null;
  try {
    const r = await sgFetch(`${STREMGATE_URL}/api/admin/users`, { headers: sgHeaders() });
    if (!r.ok) return null;
    const users = await r.json();
    return users.find(u => u.username?.toLowerCase() === username.toLowerCase()) || null;
  } catch (e) {
    console.error('[stremgate] find error:', e.message);
    return null;
  }
}

// Get the addon install URL for a member (their personal Stremio link).
// StremGate's /token/ensure returns { token, install_url } where install_url is
// the full https://…/m/<token>/aio/manifest.json form. We return that directly.
async function sgGetAddonUrl(sgMemberId) {
  if (!configured()) return null;
  try {
    const r = await sgFetch(`${STREMGATE_URL}/api/admin/users/${sgMemberId}/token/ensure`, {
      method: 'POST',
      headers: sgHeaders(),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.install_url) return d.install_url;
    // Fallback: construct from token if install_url absent
    return d.token ? `${STREMGATE_URL}/m/${d.token}/aio/manifest.json` : null;
  } catch (e) {
    console.error('[stremgate] getAddonUrl error:', e.message);
    return null;
  }
}

// Permanently delete a StremGate member by member ID. Destroys their account
// and addon token entirely - used by the warden purge. Returns { ok }.
async function sgDelete(sgMemberId) {
  if (!configured()) return { ok: false };
  try {
    const r = await sgFetch(`${STREMGATE_URL}/api/admin/users/${sgMemberId}`, {
      method: 'DELETE',
      headers: sgHeaders(),
    });
    return { ok: r.ok };
  } catch (e) {
    console.error('[stremgate] delete error:', e.message);
    return { ok: false };
  }
}

module.exports = { sgProvision, sgExtend, sgDisable, sgEnable, sgFind, sgGetAddonUrl, sgDelete };
