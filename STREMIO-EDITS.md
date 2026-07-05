# Stremio Auto-Provisioning — Edits & Notes
*Members no longer create their own Stremio account or install the addon.
We do both at signup. They just log into the Stremio app.*

## What's in this zip (already done — just deploy)
- **stremio.js** — new module, drop next to server.js (same pattern as stremgate.js).
  No env vars needed. Exports `stremioProvision` and `stremioResync`.
- **server.js** — YOUR current server.js (the one you sent 2026-07-03) with three
  edits already applied:
  1. `require('./stremio')` at the top
  2. Schema: `stremio_acct_email`, `stremio_acct_pass`, `stremio_acct_attempted`
     columns (uses your existing `stremio_auth_key` for the session key)
  3. Invite/complete: after StremGate provision succeeds → gets the member's
     manifest URL → creates their Stremio account (their email + 8-char password)
     → installs Cinemeta + Dungeon addon only → stores creds + authKey.
     Email collision → stores nothing, logs it, member gets the manual flow.
- **public/dungeonstream.html** — the v2 rewrite, updated. Two states:
  - **Auto** (creds on file): "Your Stremio Account" card with email/password,
    copy buttons, show/hide toggle, app download options, and the raw addon
    link tucked into an "Advanced" collapsible.
  - **Manual** (no creds — collision or pre-existing member): exactly the v2
    behavior — Add to Stremio button, QR, copy link.
- **public/stream-setup.html** — the v2 iPhone guide, updated. Auto members see
  3 steps (open web.stremio.com → log in with creds shown inline → done, it's
  already installed). Manual members see the original 4 steps.

## ⚠️ WHY NEW COLUMNS (do not "simplify" this)
The legacy `stremio_email` / `stremio_pass` columns can NOT hold the real Stremio
account creds:
1. `/api/member/login` uses `stremio_pass` as the legacy password fallback for
   members without a bcrypt hash — overwriting it could lock old members out.
2. Seven provisioning/renewal paths write **Jellyfin** creds into
   `stremio_email`/`stremio_pass` (staff join, Father's Day promo, admin renewal,
   credit redemption…). Any renewal would clobber the Stremio account creds.
So: `stremio_acct_email` / `stremio_acct_pass` / `stremio_auth_key` are the
Stremio account. The legacy pair keeps meaning whatever it meant yesterday.

## PATCH E (from dungeon-integration-v2) — USE THIS VERSION INSTEAD
When you apply the v2 patches at launch, replace the zip's Patch E with this.
Changes vs v2: returns `stremio_account`, and the self-heal path also creates
the Stremio account (once — gated by `stremio_acct_attempted` so a collided
member doesn't hammer api.strem.io on every dashboard load).

```js
// GET the current member's DungeonStream access: addon link + auto-account creds.
// SELF-HEALING: provisions StremGate (and the Stremio account) on demand if the
// member is entitled but wasn't provisioned (comped family, pre-migration, etc).
app.get('/api/member/stremgate', requireMember, async (req, res) => {
  try {
    let m = db.prepare('SELECT * FROM members WHERE id=?').get(req.session.member.id);
    if (!m) return res.status(404).json({ error: 'Member not found' });

    const now = new Date();
    const end = m.stremio_end ? new Date(String(m.stremio_end).includes('T') ? m.stremio_end : m.stremio_end + 'T00:00:00Z') : null;
    const prof = db.prepare('SELECT screen_name, tier FROM profiles WHERE member_id=? OR (member_id IS NULL AND LOWER(email)=LOWER(?)) LIMIT 1').get(m.id, m.email);
    const isStaff = prof && STAFF_TIERS.includes(prof.tier);
    const active = isStaff || (end ? end > now : false);

    if (!active) return res.json({ active: false });

    // Self-heal StremGate
    if (!m.stremgate_member_id) {
      const sgUser = (prof?.screen_name || m.first_name || 'member')
        .toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const sgDays = isStaff ? 3650 : 30;
      const sgRes = await sgProvision(sgUser, mkRandPass() + '!1', sgDays);
      if (sgRes.ok) {
        db.prepare('UPDATE members SET stremgate_member_id=?, stremgate_username=? WHERE id=?')
          .run(sgRes.memberId, sgUser, m.id);
        m = db.prepare('SELECT * FROM members WHERE id=?').get(m.id);
        console.log('[member/stremgate] Self-provisioned on demand:', sgUser);
      } else {
        console.error('[member/stremgate] On-demand provision failed:', sgRes.error);
        return res.json({ active: true, install_url: null, error: 'provision_failed' });
      }
    }

    const manifest_url = await sgGetAddonUrl(m.stremgate_member_id);
    if (!manifest_url) return res.json({ active: true, install_url: null });

    // Self-heal the Stremio account — ONCE per member ever (attempted flag),
    // so collisions don't retry-spam api.strem.io.
    if (!m.stremio_acct_pass && !m.stremio_acct_attempted) {
      db.prepare('UPDATE members SET stremio_acct_attempted=1 WHERE id=?').run(m.id);
      const st = await stremioProvision({ email: m.email, manifestUrl: manifest_url });
      if (st.ok) {
        db.prepare('UPDATE members SET stremio_acct_email=?, stremio_acct_pass=?, stremio_auth_key=? WHERE id=?')
          .run(st.email, st.password, st.authKey, m.id);
        m = db.prepare('SELECT * FROM members WHERE id=?').get(m.id);
        console.log('[stremio] Self-provisioned account for:', m.email);
      } else if (st.existed) {
        console.log('[stremio] Email already on Stremio — manual flow for:', m.email);
      }
    }

    const install_url = manifest_url.replace(/^https?:\/\//, 'stremio://');
    res.json({
      active: true,
      install_url,
      manifest_url,
      expires_at: end ? end.getTime() : null,
      lifetime: !!isStaff,
      stremio_account: m.stremio_acct_pass
        ? { email: m.stremio_acct_email, password: m.stremio_acct_pass }
        : null,
    });
  } catch (e) {
    console.error('[member/stremgate]', e.message);
    res.status(500).json({ error: e.message });
  }
});
```

## PATCH D (migration) — ADDITION
Inside the per-member loop, after the StremGate provision succeeds, add:

```js
// Stremio account for existing members — expect collisions here, that's fine.
db.prepare('UPDATE members SET stremio_acct_attempted=1 WHERE id=?').run(m.id);
const manifestUrl = await sgGetAddonUrl(sgMemberId);
if (manifestUrl) {
  const st = await stremioProvision({ email: m.email, manifestUrl });
  if (st.ok) {
    db.prepare('UPDATE members SET stremio_acct_email=?, stremio_acct_pass=?, stremio_auth_key=? WHERE id=?')
      .run(st.email, st.password, st.authKey, m.id);
    stats.stremioCreated++;
  } else if (st.existed) { stats.stremioExisted++; }
  else { stats.stremioFailed++; }
}
await new Promise(r => setTimeout(r, 1500)); // ← stagger! see note below
```

**Stagger the loop.** Bulk-registering N accounts from one Render IP in a tight
loop is exactly what rate limiters look for. 1.5s between members is cheap
insurance; the migration endpoint already runs async.

**Count on collisions.** Any member whose email already has a Stremio account
lands in the manual flow — which is the full v2 experience, so nothing breaks.
The migration email should NOT promise "your account is ready" universally;
say "check your DungeonStream page — most of you just log in."

## PATCH H (renewal) — NO CHANGE NEEDED
Stremio accounts don't expire. Access is enforced by StremGate: when the cron
disables the member, their token dies and the addon returns nothing, even
though it's still "installed." `sgRenew` (enable + extend) brings it back.
Nothing Stremio-side to wire.

## PATCH I (onboarding gate) — NO CODE CHANGE
The gate still routes new members to /stream-setup.html — which now shows the
short login flow for auto members. Keep it: they still need to physically log
into the app on a device, which is the step people skip.

## Other gotchas
- **Password resets:** the account is on the member's real email, so Stremio's
  "forgot password" goes to their inbox. If they reset it, our stored
  `stremio_acct_pass` goes stale and the stored authKey dies. `stremioResync`
  handles a dead authKey by re-logging-in with the stored password — if BOTH
  are stale, the account is theirs now; dashboard creds are just wrong. Low
  frequency, fix by hand when it comes up (admin members page can edit
  stremio_auth_key already).
- **Don't remove Cinemeta.** stremio.js keeps it on purpose — without a
  metadata addon the home board is blank and nothing has posters. Since
  AIOMetadata sits behind StremGate rather than in the account's addon list,
  Cinemeta stays.
- **Admin visibility:** the admin members query already selects
  stremio_auth_key; add stremio_acct_email/stremio_acct_pass to it when you
  want them visible in the admin panel (one-line change to the SELECT at
  ~line 1385).

## Deploy order (delta to the v2 runbook)
1. This zip's server.js + stremio.js can go out NOW — the invite/complete
   Stremio block only fires after sgProvision succeeds, which only happens
   once STREMGATE_URL/STREMGATE_API_KEY are set. Inert until then.
2. The two HTML pages go out with the other v2 pages at launch (they depend
   on Patch E existing).
3. When applying v2 patches: use THIS doc's Patch E, add the Patch D lines,
   Patch H/I unchanged.
4. Test with one fresh invite: complete signup → check logs for
   `[stremio] Account created` → log into Stremio app with the dashboard
   creds → Dungeon rows appear, no other addons except Cinemeta.
