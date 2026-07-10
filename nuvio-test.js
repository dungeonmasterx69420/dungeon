// nuvio-test.js - verify Nuvio auto-provisioning end to end
// Usage: node nuvio-test.js
// Requires Node 18+ (built-in fetch)
//
// Tests: signup -> session -> pull profiles -> push addon -> read back addon
// The read-back step matters: there is a known beta bug where pushed
// addons do not persist server-side (NuvioMobile issue #1449).

const API = 'https://api.nuvio.tv';
// Public Supabase anon key, shipped in the open-source Nuvio clients.
// Treat as config in production - it can rotate.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI';

// Change these before running. Use a throwaway email you control.
const TEST_EMAIL = `dungeon-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'Testing!' + Math.random().toString(36).slice(2, 10);

// Harmless public addon to test with. Swap for a StremGate proxy URL later.
const TEST_ADDON_URL = 'https://v3-cinemeta.strem.io/manifest.json';

async function api(path, { token, method = 'POST', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

(async () => {
  console.log('[1/5] Signing up', TEST_EMAIL);
  const signup = await api('/auth/v1/signup', {
    body: { email: TEST_EMAIL, password: TEST_PASSWORD }
  });

  // If confirmations are OFF (expected), signup returns a session directly.
  // If they are ON, there is no access_token and provisioning needs a rethink.
  const token = signup.access_token;
  if (!token) {
    console.log('Signup response:', JSON.stringify(signup, null, 2));
    throw new Error('No access_token returned - email confirmation may be required. Auto-provisioning would need the confirm step handled.');
  }
  console.log('      OK - got session for user', signup.user?.id);

  console.log('[2/5] Pulling profiles');
  const profiles = await api('/rest/v1/rpc/sync_pull_profiles', { token, body: {} });
  console.log('      Profiles:', JSON.stringify(profiles));
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error('No default profile on fresh account - provisioning would need to create one first.');
  }
  const profileId = profiles[0].profile_index;
  console.log('      Using profile_index', profileId);

  console.log('[3/5] Pushing test addon');
  await api('/rest/v1/rpc/sync_push_addons', {
    token,
    body: {
      p_profile_id: profileId,
      p_addons: [{ url: TEST_ADDON_URL, name: 'Cinemeta Test', enabled: true, sort_order: 0 }]
    }
  });
  console.log('      Push accepted');

  console.log('[4/5] Reading addons back (persistence check for issue #1449)');
  const addons = await api(`/rest/v1/addons?select=url,name,enabled&profile_id=eq.${profileId}`, {
    token, method: 'GET'
  });
  console.log('      Server has:', JSON.stringify(addons));
  const found = Array.isArray(addons) && addons.some(a => a.url === TEST_ADDON_URL);
  if (!found) {
    throw new Error('Addon push did NOT persist. The beta sync bug is live - do not build on this yet.');
  }

  console.log('[5/5] Refresh token grant check');
  const refreshed = await api('/auth/v1/token?grant_type=refresh_token', {
    body: { refresh_token: signup.refresh_token }
  });
  console.log('      Refresh OK:', !!refreshed.access_token);

  console.log('\nALL CHECKS PASSED');
  console.log('Test account:', TEST_EMAIL, '/', TEST_PASSWORD);
  console.log('Log into it in the Nuvio app to confirm the addon shows up, then delete it from the account dashboard.');
})().catch(e => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
