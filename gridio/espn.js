// GRIDIO - NFL data layer
// GRIDIO weeks run Monday through Sunday: Monday Night Football is the FIRST
// game of each week and the slate closes with Sunday's last game. Week 1 is
// the exception, opening with the Kickoff Game. All picks for a week lock
// together 30 minutes before that first kickoff, and a member must pick every
// game before the lock to be eligible for the weekly pot.
//
// Every season the league runs is registered in the seasons table with its own
// week 1 anchor, so past seasons stay browsable as read-only archives.
const fs = require('fs');
const path = require('path');
const { stmts, db } = require('./db');

const SEASON = parseInt(process.env.SEASON || '2026', 10);
const TOTAL_WEEKS = parseInt(process.env.TOTAL_WEEKS || '18', 10);
const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const LOCK_LEAD_MS = 30 * 60 * 1000;

// Monday 07:00 UTC before opening kickoff. GRIDIO week N spans
// week1_monday + (N-1) weeks up to the following Monday morning, which puts
// each MNF game at the front of the next week's slate.
const WEEK1_MONDAY = Date.parse(process.env.WEEK1_MONDAY || '2026-09-07T07:00:00Z');
const WEEK_MS = 7 * 24 * 3600 * 1000;

// Register the active season (idempotent, refreshes if env changes).
stmts.upsertSeason.run(SEASON, WEEK1_MONDAY, TOTAL_WEEKS);

let snapshot = { week: 1, games: [] };
try {
  snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshot', 'week1.json'), 'utf8'));
} catch (e) {
  console.warn('[gridio] no snapshot data found:', e.message);
}

function seasonInfo(season) {
  const row = stmts.getSeason.get(season);
  if (row) return { week1Monday: row.week1_monday, totalWeeks: row.total_weeks };
  return { week1Monday: WEEK1_MONDAY, totalWeeks: TOTAL_WEEKS };
}

function listSeasons() {
  return stmts.listSeasons.all().map((r) => ({ season: r.season, totalWeeks: r.total_weeks }));
}

function totalWeeksFor(season) {
  return seasonInfo(season).totalWeeks;
}

function weekStart(season, n) {
  return seasonInfo(season).week1Monday + (n - 1) * WEEK_MS;
}

function currentWeek(now = Date.now()) {
  if (now < WEEK1_MONDAY) return 1;
  const w = Math.floor((now - WEEK1_MONDAY) / WEEK_MS) + 1;
  return Math.min(Math.max(w, 1), TOTAL_WEEKS);
}

function teamLogo(team) {
  if (team.logo) return team.logo;
  const abbr = (team.abbreviation || '').toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png`;
}

function normalizeCompetitor(c) {
  const t = c.team || {};
  const rec = Array.isArray(c.records) && c.records[0] ? c.records[0].summary : '';
  return {
    abbr: t.abbreviation || '',
    name: t.name || t.shortDisplayName || '',
    displayName: t.displayName || '',
    logo: teamLogo(t),
    record: rec || '',
    score: c.score != null && c.score !== '' ? Number(c.score) : null,
    color: t.color || '2ee66b',
    altColor: t.alternateColor || 'ffffff'
  };
}

function normalizeEvent(ev) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const competitors = comp.competitors || [];
  const awayC = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
  const homeC = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
  const st = (ev.status && ev.status.type) || (comp.status && comp.status.type) || {};
  const away = normalizeCompetitor(awayC);
  const home = normalizeCompetitor(homeC);

  // ESPN reports "0" scores before kickoff; blank them until the game starts.
  if ((st.state || 'pre') === 'pre') {
    away.score = null;
    home.score = null;
  }

  let winner = null;
  if (st.completed) {
    if (away.score === home.score) winner = 'TIE';
    else winner = away.score > home.score ? away.abbr : home.abbr;
  }

  let broadcast = '';
  if (Array.isArray(comp.broadcasts) && comp.broadcasts[0] && comp.broadcasts[0].names) {
    broadcast = comp.broadcasts[0].names.join(' / ');
  } else if (Array.isArray(comp.geoBroadcasts) && comp.geoBroadcasts[0]) {
    broadcast = (comp.geoBroadcasts[0].media || {}).shortName || '';
  }

  return {
    id: String(ev.id),
    date: ev.date,
    shortName: ev.shortName || `${away.abbr} @ ${home.abbr}`,
    venue: (comp.venue && comp.venue.fullName) || '',
    broadcast,
    status: {
      state: st.state || 'pre', // pre | in | post
      completed: !!st.completed,
      detail: st.shortDetail || st.detail || ''
    },
    away,
    home,
    winner
  };
}

async function fetchFromESPN(season, nflWeek) {
  const url = `${ESPN_URL}?seasontype=2&week=${nflWeek}&dates=${season}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (GRIDIO pickem)' }
    });
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const data = await res.json();
    const games = (data.events || []).map(normalizeEvent);
    games.sort((a, b) => new Date(a.date) - new Date(b.date));
    return games;
  } finally {
    clearTimeout(timer);
  }
}

// Cache TTL depends on game states: tight during live windows, loose otherwise.
function ttlFor(games) {
  const now = Date.now();
  if (!games.length) return 10 * 60 * 1000;
  if (games.some((g) => g.status.state === 'in')) return 45 * 1000;
  const soon = games.some(
    (g) => g.status.state === 'pre' && new Date(g.date) - now < 2 * 3600 * 1000 && new Date(g.date) - now > -3600 * 1000
  );
  if (soon) return 2 * 60 * 1000;
  if (games.every((g) => g.status.completed)) return 24 * 3600 * 1000;
  return 10 * 60 * 1000;
}

// One NFL schedule week (ESPN's Thu-Mon framing), cached.
// Archived seasons are served straight from cache and never expire.
async function getNflWeek(season, nflWeek, force = false) {
  const archived = season !== SEASON;
  const cached = stmts.cacheGet.get(season, nflWeek);
  if (cached) {
    const games = JSON.parse(cached.json);
    if (archived) return { games, source: 'archive' };
    if (!force && Date.now() - cached.fetched_at < ttlFor(games)) {
      return { games, source: 'cache' };
    }
  }
  try {
    const games = await fetchFromESPN(season, nflWeek);
    if (games.length) {
      stmts.cachePut.run(season, nflWeek, JSON.stringify(games), Date.now());
      return { games, source: 'espn' };
    }
    if (cached) return { games: JSON.parse(cached.json), source: 'stale' };
    return { games: [], source: 'espn-empty' };
  } catch (err) {
    console.warn(`[gridio] ESPN fetch failed for ${season} nfl week ${nflWeek}:`, err.message);
    if (cached) return { games: JSON.parse(cached.json), source: 'stale' };
    if (season === SEASON && nflWeek === snapshot.week) return { games: snapshot.games, source: 'snapshot' };
    return { games: [], source: 'offline' };
  }
}

// One GRIDIO week: every game whose kickoff falls between that week's Monday
// morning and the next. Pulls the two NFL schedule weeks that can contribute
// (last week's MNF plus this week's Thu-Sun slate).
async function getRound(season, week, force = false) {
  const start = weekStart(season, week);
  const end = weekStart(season, week + 1);
  const nflWeeks = week === 1 ? [1] : [week - 1, week];
  const parts = [];
  const sources = [];
  for (const nw of nflWeeks) {
    const r = await getNflWeek(season, nw, force);
    sources.push(nw + ':' + r.source);
    parts.push(...r.games);
  }
  const seen = new Set();
  const games = parts
    .filter((g) => {
      const t = Date.parse(g.date);
      return t >= start && t < end;
    })
    .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (season === SEASON) maybeFinalize(week, games);
  return {
    games,
    source: sources.join(' '),
    lockAt: games.length ? new Date(Date.parse(games[0].date) - LOCK_LEAD_MS).toISOString() : null
  };
}

// The whole week locks together, 30 minutes before the first kickoff.
function isWeekLocked(games, now = Date.now()) {
  if (!games.length) return false;
  return now >= Date.parse(games[0].date) - LOCK_LEAD_MS;
}

function pickIsCorrect(pick, game) {
  if (!game.status.completed || !game.winner) return null;
  return pick === game.winner;
}

// When every game in a week is final, score it once. Only members who picked
// the FULL slate are in the pot: most correct among them wins, ties share the
// crown. Incomplete members keep their correct count on the books but cannot
// win the week. Scoring only ever runs for the active season.
function maybeFinalize(week, games) {
  if (!games.length || !games.every((g) => g.status.completed)) return false;
  const existing = stmts.resultsForWeek.all(SEASON, week);
  if (existing.length) return false;
  return finalizeWeek(week, games);
}

function finalizeWeek(week, games) {
  const rows = stmts.picksForWeek.all(SEASON, week);
  if (!rows.length) return false;
  const gameMap = new Map(games.map((g) => [g.id, g]));
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { correct: 0, made: 0 });
    const g = gameMap.get(r.game_id);
    if (!g) continue; // pick left over from a flexed-out game
    const u = byUser.get(r.user_id);
    u.made += 1;
    if (pickIsCorrect(r.pick, g) === true) u.correct += 1;
  }
  const total = games.length;
  let max = 0;
  for (const v of byUser.values()) {
    if (v.made === total) max = Math.max(max, v.correct);
  }
  const tx = db.transaction(() => {
    for (const [userId, v] of byUser.entries()) {
      const complete = v.made === total ? 1 : 0;
      const isWinner = complete && max > 0 && v.correct === max ? 1 : 0;
      stmts.insertResult.run(SEASON, week, userId, v.correct, total, isWinner, complete);
    }
  });
  tx();
  console.log(`[gridio] week ${week} finalized: pot high score ${max}/${total}`);
  return true;
}

function refinalize(week, games) {
  stmts.deleteWeekResults.run(SEASON, week);
  if (games.length && games.every((g) => g.status.completed)) {
    return finalizeWeek(week, games);
  }
  return false;
}

module.exports = {
  SEASON,
  TOTAL_WEEKS,
  LOCK_LEAD_MS,
  currentWeek,
  listSeasons,
  totalWeeksFor,
  getRound,
  isWeekLocked,
  pickIsCorrect,
  refinalize
};
