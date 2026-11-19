-- RC Plane Flight Tracker: initial schema
-- Passwords are stored as PBKDF2 hashes. Raw passwords are never stored.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant'
    CHECK (role IN ('participant', 'admin')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS challenge_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL DEFAULT '52-Week RC Flight Challenge',
  start_date TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO challenge_settings
  (id, title, start_date, timezone, is_active, updated_at)
VALUES
  (1, '52-Week RC Flight Challenge', NULL, 'America/Los_Angeles', 0, datetime('now'));

CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flight_date TEXT NOT NULL,
  aircraft TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 720),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flights_user_date ON flights(user_id, flight_date DESC);
CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(flight_date DESC);

-- Per-IP rate-limit counters. Only hashed IP values are kept.
CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
