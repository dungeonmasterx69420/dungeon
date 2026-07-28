# GRIDIO

NFL pick'em for The Dungeon. Friends sign in with an invite code, pick a winner (or a tie) for every game each week, and the site scores everything automatically off live ESPN data. Weekly crowns, season leaderboard, team logos and colors throughout.

## How it plays

- A GRIDIO week runs Monday through Sunday: Monday Night Football is the FIRST game of the week and the slate closes with Sunday's last game. Week 1 is the exception and opens with the season Kickoff Game.
- Every game on the slate gets a pick: away team, home team, or TIE. Everyone's picks are visible to all members.
- The whole week locks at once, 30 minutes before the first kickoff. Until then you can change anything; after that, nothing.
- You must pick EVERY game on the slate before the lock to be in the pot. Miss even one and your correct picks still count on the season grid, but you cannot win that week.
- Correct pick = 1 point. When the last game goes final the week is scored automatically: most correct among pot-eligible members wins. Ties share the crown. If nobody in the pot gets a game right, no crown that week.
- Season leaderboard ranks by weekly wins, then total correct picks.
- Full history: every season the league runs is archived. A season selector appears on the picks page and leaderboard once there is more than one season, so you can flip back to any past year and browse it week by week, picks and crowns included, read-only.

## Quick start

```
npm install
npm start
```

Open http://localhost:8791 and create the first account. The first account to register is the admin.

## Environment variables

| Var | Default | Notes |
| --- | --- | --- |
| PORT | 8791 | Chosen to avoid 3000/8080/3232/9191 already used on the laptop stack |
| INVITE_CODE | GRIDIO26 | Case-insensitive. Share with the league |
| SEASON | 2026 | Active season year. When you bump this for a new season (with its new WEEK1_MONDAY), the old season stays browsable as an archive |
| WEEK1_MONDAY | 2026-09-07T07:00:00Z | Monday morning before opening kickoff. Drives the Monday-Sunday week windows, works offline |
| TOTAL_WEEKS | 18 | Regular season length |
| DATA_DIR | ./data | SQLite location (gridio.db) |
| SESSION_DAYS | 120 | Login cookie lifetime |
| NODE_ENV | | Set to production to mark cookies Secure (behind HTTPS) |

## Data

Live schedule, scores, records, logos, and team colors come from ESPN's public scoreboard API, cached in SQLite. Cache TTL is 45s while games are live, 2m near kickoff, 24h once a week is final, 10m otherwise. If ESPN is unreachable the app serves the last cached slate, or the built-in snapshot of confirmed week 1 games so the UI never renders empty.

## Admin

The first registered user is admin and gets a Refresh button on the picks page. Everything else is curl (use your session cookie or run from the box):

```
# force a fresh ESPN pull for a week
curl -X POST localhost:8791/api/admin/refresh -H 'Content-Type: application/json' \
  -b 'gridio_session=TOKEN' -d '{"week":3}'

# wipe and recompute a finished week (after an ESPN stat correction)
curl -X POST localhost:8791/api/admin/refinalize -H 'Content-Type: application/json' \
  -b 'gridio_session=TOKEN' -d '{"week":3}'

# reset a friend's password
curl -X POST localhost:8791/api/admin/reset-password -H 'Content-Type: application/json' \
  -b 'gridio_session=TOKEN' -d '{"username":"mike","newPassword":"newpass123"}'

# list users
curl localhost:8791/api/admin/users -b 'gridio_session=TOKEN'
```

## Deploy

**Option A - laptop Docker + Cloudflare tunnel (recommended).** Same pattern as the rest of the stack:

```
docker build -t gridio .
docker run -d --name gridio -p 8791:8791 -v gridio-data:/app/data \
  -e INVITE_CODE=YOURCODE -e NODE_ENV=production gridio
```

Add a tunnel hostname like gridio.dungeoncast.cc pointing at localhost:8791. The named volume keeps the database across rebuilds. Reminder: the Dockerfile uses selective COPY lines, so any new JS module needs its own COPY line.

**Option B - Render.** Works, but SQLite needs a persistent disk (paid instance) mounted at /app/data or the database resets on every deploy. Set NODE_ENV=production and your INVITE_CODE in the dashboard. Free tier also cold-sleeps, which is fine for picks but means the first hit on Sunday is slow.

## Install on your phone

GRIDIO is a PWA. Open the site in a browser and:

- Android Chrome: tap the Install prompt, or menu > Add to Home screen
- iPhone Safari: Share > Add to Home Screen

It launches fullscreen with the crest as the app icon. The app shell is cached so it opens instantly and survives dead spots, but live picks and scores always come from the network (the API is never cached, so nothing goes stale).

## Not in v1

Playoffs (seasontype 3), Monday-night points tiebreaker, avatars. All easy adds later.
