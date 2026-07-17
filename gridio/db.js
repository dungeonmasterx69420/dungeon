// GRIDIO - SQLite layer (better-sqlite3)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'gridio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS picks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  game_id    TEXT NOT NULL,
  pick       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, season, week, game_id)
);

CREATE TABLE IF NOT EXISTS games_cache (
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  json       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (season, week)
);

CREATE TABLE IF NOT EXISTS weekly_results (
  season    INTEGER NOT NULL,
  week      INTEGER NOT NULL,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  correct   INTEGER NOT NULL,
  total     INTEGER NOT NULL,
  is_winner INTEGER NOT NULL DEFAULT 0,
  complete  INTEGER NOT NULL DEFAULT 1,
  finalized_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season, week, user_id)
);

CREATE TABLE IF NOT EXISTS seasons (
  season       INTEGER PRIMARY KEY,
  week1_monday INTEGER NOT NULL,
  total_weeks  INTEGER NOT NULL DEFAULT 18
);

CREATE INDEX IF NOT EXISTS idx_picks_week ON picks(season, week);
CREATE INDEX IF NOT EXISTS idx_results_season ON weekly_results(season);
`);

// Migration for databases created before the pot-eligibility rule.
try {
  db.exec("ALTER TABLE weekly_results ADD COLUMN complete INTEGER NOT NULL DEFAULT 1");
} catch (e) {
  // column already exists
}

const stmts = {
  // users
  userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare(
    'INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?, ?, ?, ?)'
  ),
  setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE username = ?'),
  allUsers: db.prepare('SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY id'),

  // sessions
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionByToken: db.prepare(`
    SELECT s.token, s.expires_at, u.id, u.username, u.display_name, u.is_admin
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

  // picks
  upsertPick: db.prepare(`
    INSERT INTO picks (user_id, season, week, game_id, pick, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, season, week, game_id)
    DO UPDATE SET pick = excluded.pick, updated_at = datetime('now')`),
  picksForUserWeek: db.prepare(
    'SELECT game_id, pick FROM picks WHERE user_id = ? AND season = ? AND week = ?'
  ),
  picksForWeek: db.prepare(`
    SELECT p.user_id, p.game_id, p.pick, u.display_name
    FROM picks p JOIN users u ON u.id = p.user_id
    WHERE p.season = ? AND p.week = ?`),

  // games cache
  cacheGet: db.prepare('SELECT json, fetched_at FROM games_cache WHERE season = ? AND week = ?'),
  cachePut: db.prepare(`
    INSERT INTO games_cache (season, week, json, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(season, week) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`),
  cacheClear: db.prepare('DELETE FROM games_cache WHERE season = ? AND week = ?'),

  // weekly results
  resultsForWeek: db.prepare(
    'SELECT user_id, correct, total, is_winner, complete FROM weekly_results WHERE season = ? AND week = ?'
  ),
  resultsForSeason: db.prepare(`
    SELECT wr.week, wr.user_id, wr.correct, wr.total, wr.is_winner, wr.complete, u.display_name
    FROM weekly_results wr JOIN users u ON u.id = wr.user_id
    WHERE wr.season = ? ORDER BY wr.week, wr.correct DESC`),
  insertResult: db.prepare(`
    INSERT OR REPLACE INTO weekly_results (season, week, user_id, correct, total, is_winner, complete)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  deleteWeekResults: db.prepare('DELETE FROM weekly_results WHERE season = ? AND week = ?'),

  // seasons registry (one row per season the league has run)
  upsertSeason: db.prepare(`
    INSERT INTO seasons (season, week1_monday, total_weeks) VALUES (?, ?, ?)
    ON CONFLICT(season) DO UPDATE SET
      week1_monday = excluded.week1_monday,
      total_weeks = excluded.total_weeks`),
  getSeason: db.prepare('SELECT * FROM seasons WHERE season = ?'),
  listSeasons: db.prepare('SELECT season, total_weeks FROM seasons ORDER BY season DESC'),

  // reigning champ (winners of the most recently scored week)
  latestChamps: db.prepare(`
    SELECT wr.week, wr.correct, wr.total, u.display_name
    FROM weekly_results wr JOIN users u ON u.id = wr.user_id
    WHERE wr.season = ? AND wr.is_winner = 1
      AND wr.week = (SELECT MAX(week) FROM weekly_results WHERE season = ?)
    ORDER BY u.display_name COLLATE NOCASE`),

  // leaderboard
  standings: db.prepare(`
    SELECT u.id AS user_id, u.display_name,
           COALESCE(SUM(wr.is_winner), 0) AS weekly_wins,
           COALESCE(SUM(wr.correct), 0)   AS correct,
           COALESCE(SUM(wr.total), 0)     AS total,
           COUNT(wr.week)                 AS weeks_played
    FROM users u
    LEFT JOIN weekly_results wr ON wr.user_id = u.id AND wr.season = ?
    GROUP BY u.id
    ORDER BY weekly_wins DESC, correct DESC, u.display_name COLLATE NOCASE`)
};

module.exports = { db, stmts };
