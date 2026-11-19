-- RC Plane Flight Journal: single-admin moderation and optional challenge window.
-- The Worker creates these tables automatically on first API use as well.

CREATE TABLE IF NOT EXISTS user_moderation (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenge_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL CHECK (status IN ('not_started', 'active', 'ended')),
  start_date TEXT,
  end_date TEXT,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);

INSERT OR IGNORE INTO challenge_settings (id, status, updated_at)
VALUES (1, 'not_started', CURRENT_TIMESTAMP);
