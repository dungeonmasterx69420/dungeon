# The Dungeon

Member management platform for a private, invite-only streaming community. This repo is the web portal ("The Gate") that handles applications, invites, member accounts, credits, renewals, and auto-provisioning across the whole Dungeon stack: DungeonStream (Stremio + StremGate), DungeonCast (Jellyfin Live TV), and IPTV lines.

Built as a single Node.js service: one Express server, one SQLite database, static HTML frontend. No build step, no framework.

## Features

**Membership lifecycle**
- Public application form with admin/mod review queue (approve, deny, archive, promote)
- Tokenized invite links with expiry; invite completion creates the member account
- Member login with sessions, forced first-run password change, password reset via email
- Profiles with avatars, screen names, and device info
- Tier system: regular, family, staff, and dealer (dealers earn commission on invites)

**Billing and credits**
- Universal credit system: 1 credit = 1 month of everything
- Buy Me a Coffee webhook converts payments to credits automatically
- Stripe webhook support
- Credit redemption, transaction history, and a leaderboard
- Bundle redemption codes
- Dealer earnings tracking and payout management

**Auto-provisioning**
- StremGate accounts created and torn down via admin API (tier-aware durations: family/staff get long-lived access, regular members get 30 days)
- Stremio accounts registered on api.strem.io with the member's personal addon collection pre-installed (Cinemeta + their Dungeon addon), so members never touch the Add-ons screen
- Jellyfin users enabled/disabled for both DungeonStream and DungeonCast
- DungeonAmp (Navidrome music) accounts created per member; passwords are never stored or emailed — members set their own from the dashboard (shown once), expiry locks the account by scrambling the password (which also revokes all password-derived Subsonic tokens), purge deletes it
- IPTV line creation and renewal (T-Rex, NodeCast)
- Hourly expiry cron revokes access across all services when a subscription lapses; renewals re-enable everything

**Community**
- Forum with categories, threads, posts, and notifications
- Direct messages between members and the warden
- Support tickets, content suggestions, and Live TV channel requests
- Events schedule with bulk import
- Demo system: time-limited trial links for prospects, creatable by admin or dealers

**Admin ("Warden's Gate")**
- Full dashboard: members, subscribers, invites, credits, payouts, redemptions, IPTV lines, demo requests
- Account lookup, resend welcome/application emails, extend/clear subscriptions
- Permanent account purge with teardown across all connected services
- Push notifications via ntfy, email via Gmail (nodemailer) or Resend

## Stack

| Layer | Tech |
|---|---|
| Server | Node 20, Express 4 |
| Database | better-sqlite3 (single file at `DATA_DIR/streamhub.db`) |
| Sessions | express-session + connect-sqlite3 |
| Auth | bcryptjs password hashing, express-rate-limit on sensitive routes |
| Email | nodemailer (Gmail app password) or Resend |
| Frontend | Static HTML/CSS/JS in `public/`, no build step |
| Deploy | Docker on Render with a persistent disk |

## Repo structure

```
dungeon/
├── server.js          # Entire backend: routes, DB schema, cron, email
├── stremgate.js       # StremGate provisioning helper (X-Admin-Key API)
├── stremio.js         # Stremio account auto-provisioning (api.strem.io)
├── navidrome.js       # DungeonAmp (Navidrome music) provisioning helper
├── notif-bell.js      # Shared notification bell component
├── public/            # All member-facing and admin pages
│   ├── index.html         # The Gate (public landing / application)
│   ├── admin.html         # Warden's Gate (admin dashboard)
│   ├── dashboard.html     # Member dashboard
│   ├── welcome.html       # Post-invite onboarding
│   ├── setup.html         # First-run flow (password change, profile)
│   ├── stream-setup.html  # DungeonStream install walkthrough
│   ├── guides.html        # Member guides (Stream + Cast)
│   ├── dealer.html        # Dealer dashboard
│   ├── forum/messages/... # Community pages
│   └── ...
├── Dockerfile
├── SETUP.md           # Render deployment walkthrough
└── package.json
```

Note: the Dockerfile uses selective COPY lines. Any new root-level JS module must be added to the Dockerfile explicitly or it will not ship in the image.

## Environment variables

Core:

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Warden's Gate login |
| `SESSION_SECRET` | Session signing secret (32+ random chars) |
| `SITE_URL` | Public base URL, used in emails and invite links |
| `DATA_DIR` | SQLite location (defaults to `/data` in Docker) |
| `PORT` | Listen port (default 3000) |
| `NODE_ENV` | `production` in deploys |

Email:

| Variable | Purpose |
|---|---|
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Outbound mail via Gmail |
| `RESEND_API_KEY` / `FROM_EMAIL` | Alternative: Resend |
| `WARDEN_EMAIL` | Where admin notifications land |

Integrations (all optional; features degrade gracefully if unset):

| Variable | Purpose |
|---|---|
| `STREMGATE_URL` / `STREMGATE_API_KEY` | StremGate admin API for provisioning |
| `JELLYFIN_URL` / `JELLYFIN_API_KEY` | DungeonStream Jellyfin server |
| `JELLYFIN_TV_URL` / `JELLYFIN_TV_API_KEY` | DungeonCast Live TV server |
| `TREX_API_KEY` | T-Rex IPTV line management |
| `NODECAST_URL` / `NODECAST_ADMIN` / `NODECAST_PASS` | NodeCast IPTV |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe payments |
| `NTFY_SERVER` / `NTFY_TOPIC` | Push notifications |
| `DUNGEON_API_KEY` | API key for external integrations |

## Deployment (Render)

1. Push to GitHub, create a new Web Service with environment set to Docker
2. Add the environment variables above
3. Add a persistent disk mounted at `/data` (1 GB is plenty); the SQLite DB survives deploys
4. Deploy

See `SETUP.md` for the step-by-step walkthrough, including Gmail app password setup.

If a deploy does not pick up changes, check that auto-deploy is enabled on the service, and remember Docker layer caching: force a clean rebuild if a new file is not showing up in the image.

## Local development

```bash
npm install
ADMIN_PASSWORD=test SESSION_SECRET=dev-secret node server.js
```

The server creates the SQLite database and all tables on first run. Without the integration env vars, provisioning calls log a warning and no-op, so the portal itself is fully testable locally.

## How expiry works

A cron runs every hour inside the server process:

1. Finds members whose DungeonStream subscription has ended, disables their Jellyfin user, and disables their StremGate account
2. Separately checks DungeonCast expiry and disables Live TV access
3. Cleans up expired demo accounts

Renewal (by credit redemption or admin action) re-enables everything and pushes new expiry dates to each service.

## Related projects

- **StremGate**: gateway that serves each member a personal addon manifest URL
- **AIOStreams / AIOMetadata**: the addon stack StremGate fronts
- **Jellyvite**: the open-source, self-hoster-friendly rewrite of this invite system

## License

Private project. Not licensed for redistribution.
