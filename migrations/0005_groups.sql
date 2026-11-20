-- Flyers group system.
-- The Worker also creates these tables lazily for existing production databases.
-- group_id on flight_posts is added by the Worker after checking PRAGMA table_info,
-- so this repeatable migration intentionally does not ALTER that table.

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  max_members INTEGER NOT NULL DEFAULT 25,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_bans (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by TEXT NOT NULL REFERENCES users(id),
  banned_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_challenge_settings (
  group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('not_started', 'active', 'ended')),
  start_date TEXT,
  end_date TEXT,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_role
  ON group_members(group_id, role);
