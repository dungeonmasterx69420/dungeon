// GRIDIO - NFL pick'em, mounted inside the Dungeon server for any
// "gridio."-prefixed hostname (gridio.enterdungeon.cc). Exports the express
// app instead of listening; shares DATA_DIR with dungeon (separate gridio.db).
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { stmts } = require('./db');
const espn = require('./espn');

const app = express();
const INVITE_CODE = (process.env.INVITE_CODE || 'GRIDIO26').trim();
const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || '120', 10);
const COOKIE = 'gridio_session';
const SECURE_COOKIES = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());

// ---------- auth helpers ----------
function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  stmts.insertSession.run(token, userId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIES,
    maxAge: SESSION_DAYS * 24 * 3600 * 1000
  });
}

function auth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (token) {
    const row = stmts.sessionByToken.get(token);
    if (row && row.expires_at > Date.now()) {
      req.user = {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        isAdmin: !!row.is_admin
      };
      return next();
    }
  }
  return res.status(401).json({ error: 'Not signed in' });
}

function adminOnly(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
}

// Resolve ?season= to a known league season, defaulting to the active one.
function resolveSeason(req) {
  const q = parseInt((req.query || {}).season, 10);
  if (!q || q === espn.SEASON) return espn.SEASON;
  return espn.listSeasons().some((s) => s.season === q) ? q : espn.SEASON;
}

// Light brute-force guard on login
const attempts = new Map();
function throttled(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, t: now };
  if (now - rec.t > 10 * 60 * 1000) {
    rec.n = 0;
    rec.t = now;
  }
  rec.n += 1;
  attempts.set(key, rec);
  return rec.n > 25;
}

// ---------- auth routes ----------
app.post('/api/register', async (req, res) => {
  const { username, displayName, password, inviteCode } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  const dname = String(displayName || '').trim();
  const pass = String(password || '');
  const code = String(inviteCode || '').trim();

  if (!/^[a-z0-9_]{2,20}$/.test(uname)) {
    return res.status(400).json({ error: 'Username: 2-20 chars, letters, numbers, underscores.' });
  }
  if (dname.length < 1 || dname.length > 24) {
    return res.status(400).json({ error: 'Display name: 1-24 characters.' });
  }
  if (pass.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (code.toUpperCase() !== INVITE_CODE.toUpperCase()) {
    return res.status(403).json({ error: 'Invalid invite code.' });
  }
  if (stmts.userByName.get(uname)) {
    return res.status(409).json({ error: 'That username is taken.' });
  }
  const isFirst = stmts.userCount.get().n === 0;
  const hash = await bcrypt.hash(pass, 10);
  const info = stmts.insertUser.run(uname, dname, hash, isFirst ? 1 : 0);
  createSession(res, info.lastInsertRowid);
  res.json({ ok: true, isAdmin: isFirst });
});

app.post('/api/login', async (req, res) => {
  const uname = String((req.body || {}).username || '').trim().toLowerCase();
  const pass = String((req.body || {}).password || '');
  if (throttled(`${req.ip}:${uname}`)) {
    return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
  }
  const user = stmts.userByName.get(uname);
  if (!user || !(await bcrypt.compare(pass, user.password_hash))) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  createSession(res, user.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies[COOKIE];
  if (token) stmts.deleteSession.run(token);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json(req.user);
});

// ---------- game + pick routes ----------
app.get('/api/state', auth, (req, res) => {
  const champs = stmts.latestChamps.all(espn.SEASON, espn.SEASON);
  res.json({
    season: espn.SEASON,
    totalWeeks: espn.TOTAL_WEEKS,
    currentWeek: espn.currentWeek(),
    seasons: espn.listSeasons(),
    champ: champs.length
      ? {
          week: champs[0].week,
          correct: champs[0].correct,
          total: champs[0].total,
          names: champs.map((c) => c.display_name)
        }
      : null
  });
});

app.get('/api/week/:week', auth, async (req, res) => {
  const season = resolveSeason(req);
  const week = parseInt(req.params.week, 10);
  if (!week || week < 1 || week > espn.totalWeeksFor(season)) {
    return res.status(400).json({ error: 'Bad week number.' });
  }
  const { games, source, lockAt } = await espn.getRound(season, week);
  const locked = espn.isWeekLocked(games);

  const myPicks = {};
  for (const p of stmts.picksForUserWeek.all(req.user.id, season, week)) {
    myPicks[p.game_id] = p.pick;
  }

  // Everyone's picks are visible to all members, all week.
  const allRows = stmts.picksForWeek.all(season, week);
  const allPicks = {};
  const gameMap = new Map(games.map((g) => [g.id, g]));
  for (const r of allRows) {
    if (!allPicks[r.game_id]) allPicks[r.game_id] = [];
    allPicks[r.game_id].push({ userId: r.user_id, name: r.display_name, pick: r.pick });
  }

  // Live week tally (correct picks among completed games so far).
  const finalizedRows = stmts.resultsForWeek.all(season, week);
  const finalized = finalizedRows.length > 0;
  const tallyMap = new Map();
  for (const r of allRows) {
    if (!tallyMap.has(r.user_id)) {
      tallyMap.set(r.user_id, { userId: r.user_id, name: r.display_name, correct: 0, picksMade: 0 });
    }
    const t = tallyMap.get(r.user_id);
    t.picksMade += 1;
    const g = gameMap.get(r.game_id);
    if (g && espn.pickIsCorrect(r.pick, g) === true) t.correct += 1;
  }
  const winnerIds = new Set(finalizedRows.filter((r) => r.is_winner).map((r) => r.user_id));
  const tally = [...tallyMap.values()]
    .map((t) => ({
      ...t,
      complete: t.picksMade === games.length && games.length > 0,
      isWinner: finalized ? winnerIds.has(t.userId) : null
    }))
    .sort((a, b) => b.correct - a.correct || a.name.localeCompare(b.name));

  const completedCount = games.filter((g) => g.status.completed).length;

  res.json({
    season,
    archived: season !== espn.SEASON,
    week,
    source,
    games,
    lockAt,
    locked,
    myPicks,
    allPicks,
    tally,
    finalized,
    completedCount
  });
});

app.post('/api/pick', auth, async (req, res) => {
  const { week, gameId, pick } = req.body || {};
  const w = parseInt(week, 10);
  if (!w || w < 1 || w > espn.TOTAL_WEEKS) return res.status(400).json({ error: 'Bad week.' });

  const { games } = await espn.getRound(espn.SEASON, w);
  if (espn.isWeekLocked(games)) {
    return res.status(409).json({ error: 'Picks are locked for this week.' });
  }
  const game = games.find((g) => g.id === String(gameId));
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const valid = [game.away.abbr, game.home.abbr, 'TIE'];
  if (!valid.includes(pick)) return res.status(400).json({ error: 'Invalid pick.' });

  stmts.upsertPick.run(req.user.id, espn.SEASON, w, game.id, pick);
  res.json({ ok: true, gameId: game.id, pick });
});

app.get('/api/leaderboard', auth, (req, res) => {
  const season = resolveSeason(req);
  const standings = stmts.standings.all(season).map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    name: r.display_name,
    weeklyWins: r.weekly_wins,
    correct: r.correct,
    total: r.total,
    weeksPlayed: r.weeks_played,
    pct: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : 0
  }));

  const rows = stmts.resultsForSeason.all(season);
  const weeks = {};
  for (const r of rows) {
    if (!weeks[r.week]) weeks[r.week] = { week: r.week, total: r.total, results: [], winners: [] };
    const entry = { userId: r.user_id, name: r.display_name, correct: r.correct, isWinner: !!r.is_winner };
    weeks[r.week].results.push(entry);
    if (r.is_winner) weeks[r.week].winners.push(entry);
  }

  res.json({
    season,
    archived: season !== espn.SEASON,
    totalWeeks: espn.totalWeeksFor(season),
    currentWeek: espn.currentWeek(),
    seasons: espn.listSeasons(),
    standings,
    weeks: Object.values(weeks).sort((a, b) => a.week - b.week)
  });
});

// ---------- admin ----------
app.post('/api/admin/refresh', auth, adminOnly, async (req, res) => {
  const week = parseInt((req.body || {}).week, 10) || espn.currentWeek();
  const { games, source } = await espn.getRound(espn.SEASON, week, true);
  res.json({ ok: true, week, source, games: games.length });
});

app.post('/api/admin/refinalize', auth, adminOnly, async (req, res) => {
  const week = parseInt((req.body || {}).week, 10);
  if (!week) return res.status(400).json({ error: 'week required' });
  const { games } = await espn.getRound(espn.SEASON, week, true);
  const done = espn.refinalize(week, games);
  res.json({ ok: true, week, finalized: done });
});

app.post('/api/admin/reset-password', auth, adminOnly, async (req, res) => {
  const { username, newPassword } = req.body || {};
  if (!username || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'username and newPassword (8+ chars) required' });
  }
  const hash = await bcrypt.hash(String(newPassword), 10);
  const info = stmts.setPassword.run(hash, String(username).toLowerCase());
  if (!info.changes) return res.status(404).json({ error: 'No such user.' });
  res.json({ ok: true });
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  res.json(stmts.allUsers.all());
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Clean expired sessions on boot and daily.
stmts.purgeSessions.run(Date.now());
setInterval(() => stmts.purgeSessions.run(Date.now()), 24 * 3600 * 1000).unref();
console.log(`GRIDIO mounted | season ${espn.SEASON} | invite code: ${INVITE_CODE}`);

module.exports = app;
