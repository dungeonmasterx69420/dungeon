# Nuvio Integration - The Dungeon

nuvio.js gives members an auto-provisioned Nuvio account alongside their
Stremio one. Nuvio consumes the same StremGate proxy manifest URL, so
AIOStreams, AIOMetadata, and expiry enforcement all carry over with zero
changes. This is an ADD, not a replacement - Stremio stays for web, desktop,
and LG/Samsung members.

Verified working end to end on 2026-07-10.

## Patch 1 - require (server.js, next to the stremio require, ~line 13)

```js
const { nuvioProvision, nuvioResync } = require('./nuvio');
```

## Patch 2 - member columns (server.js, in the migrations block with the
other ALTER TABLE try/catch lines, ~line 443)

```js
try { db.prepare('ALTER TABLE members ADD COLUMN nuvio_acct_email TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE members ADD COLUMN nuvio_acct_pass TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE members ADD COLUMN nuvio_acct_attempted INTEGER DEFAULT 0').run(); } catch(e) {}
```

Naming mirrors stremio_acct_email / stremio_acct_pass / stremio_acct_attempted.

## Patch 3 - self-serve connect endpoint (server.js, near the other member
endpoints)

Member clicks "Connect Nuvio" on the dashboard or dungeonstream page, gets
an account with their profile pre-made and the Dungeon addon installed.

```js
// POST /api/member/nuvio/connect - opt-in Nuvio account provisioning
app.post('/api/member/nuvio/connect', requireMember, async (req, res) => {
  try {
    const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.session.member.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (!member.stremgate_member_id) return res.status(400).json({ error: 'No DungeonStream access on this account' });

    // Already provisioned - return stored creds so the page can re-show them
    if (member.nuvio_acct_pass) {
      return res.json({ ok: true, email: member.nuvio_acct_email, password: member.nuvio_acct_pass, existing: true });
    }
    if (member.nuvio_acct_attempted) {
      return res.status(409).json({ error: 'manual', note: 'Email already has a Nuvio account - use the manual addon URL flow' });
    }

    db.prepare('UPDATE members SET nuvio_acct_attempted=1 WHERE id=?').run(member.id);
    const manifestUrl = await sgGetAddonUrl(member.stremgate_member_id);
    if (!manifestUrl) return res.status(500).json({ error: 'Could not resolve addon URL' });

    const profile = db.prepare('SELECT screen_name FROM profiles WHERE member_id=?').get(member.id);
    const nv = await nuvioProvision({
      email: member.email,
      manifestUrl,
      profileName: (profile && profile.screen_name) || 'Dungeon'
    });

    if (nv.ok) {
      db.prepare('UPDATE members SET nuvio_acct_email=?, nuvio_acct_pass=? WHERE id=?')
        .run(nv.email, nv.password, member.id);
      console.log('[nuvio] Account created for:', member.email);
      return res.json({ ok: true, email: nv.email, password: nv.password });
    }
    if (nv.existed) {
      console.log('[nuvio] Email already on Nuvio - manual flow for:', member.email);
      return res.status(409).json({ error: 'manual', note: 'Email already has a Nuvio account - use the manual addon URL flow' });
    }
    return res.status(500).json({ error: nv.error || 'Provisioning failed' });
  } catch(e) {
    console.error('[nuvio/connect]', e.message);
    res.status(500).json({ error: e.message });
  }
});
```

## Patch 4 - admin resync (server.js, near the other admin endpoints, optional)

For when a member breaks their addon list or the StremGate URL scheme changes.

```js
app.post('/api/admin/nuvio/resync/:memberId', requireAuth, async (req, res) => {
  try {
    const member = db.prepare('SELECT * FROM members WHERE id=?').get(req.params.memberId);
    if (!member || !member.nuvio_acct_pass) return res.status(404).json({ error: 'No provisioned Nuvio account' });
    const manifestUrl = await sgGetAddonUrl(member.stremgate_member_id);
    if (!manifestUrl) return res.status(500).json({ error: 'Could not resolve addon URL' });
    const profile = db.prepare('SELECT screen_name FROM profiles WHERE member_id=?').get(member.id);
    const nv = await nuvioResync({
      email: member.nuvio_acct_email,
      password: member.nuvio_acct_pass,
      manifestUrl,
      profileName: (profile && profile.screen_name) || 'Dungeon'
    });
    res.status(nv.ok ? 200 : 500).json(nv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
```

## Wiring it into auto-provision flows (optional, later)

The three stremioProvision call sites (join, redeem, webhook) can each get a
parallel nuvioProvision block guarded by nuvio_acct_attempted, same shape as
Patch 3's core. Recommended to run the opt-in endpoint for a couple of weeks
first - Nuvio's backend is beta and the sync service has had persistence bugs.

## Notes

- No new env vars required. NUVIO_ANON_KEY and NUVIO_API_URL are
  env-overridable if the public anon key ever rotates.
- Do not bulk-migrate existing members in one burst. Supabase rate-limits
  signups per IP. New-member trickle is fine.
- On email collision (member already has a personal Nuvio account) the flow
  returns the manual path: member adds their StremGate URL themselves under
  Settings > Addons in the Nuvio app.
- Password storage is plaintext in the members table, matching the existing
  stremio_acct_pass pattern. Same tradeoff, same reason: the site has to be
  able to show creds back to the member.
