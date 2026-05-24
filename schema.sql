-- Heavenward D1 Schema
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google', 'microsoft')),
  email_consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',         -- active | paused | blocked | banned
  status_reason TEXT,
  status_changed_at TEXT,
  status_changed_by TEXT,
  last_login_at TEXT,
  last_login_ip TEXT,
  last_login_country TEXT,
  last_login_city TEXT,
  login_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- Analytics: page views, clicks, dwell — used for /admin audit log
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_id TEXT,
  event TEXT NOT NULL,
  path TEXT NOT NULL,
  detail TEXT,
  ua TEXT,
  ip TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  tz TEXT,
  referrer TEXT,
  dwell_ms INTEGER,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, ts);

-- Migration for existing deployments (idempotent ALTERs handled in code).

-- Saved observing sessions (lightweight diary, ~1 row per evening per user).
-- Coarse region only — never raw GPS coordinates.
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  region TEXT,
  lat_coarse REAL,
  lon_coarse REAL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  entries_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_user
  ON observations(user_id, started_at DESC);

-- Admin actions audit (who blocked/banned/paused whom and when).
CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_user TEXT,
  detail TEXT,
  ip TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_ts ON admin_actions(ts);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_user);
CREATE INDEX IF NOT EXISTS idx_events_user_ts ON events(user_id, ts);
