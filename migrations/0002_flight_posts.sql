-- RC Plane Flight Journal: community photo posts
-- The Worker also creates this table automatically on first API use so mobile
-- setup does not require a separate migration command.

CREATE TABLE IF NOT EXISTS flight_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flight_date TEXT NOT NULL,
  spot TEXT NOT NULL CHECK (
    spot IN ('chill_guy', 'unc_road', 'sports_park', 'shore_cliffs', 'other')
  ),
  other_spot TEXT NOT NULL DEFAULT '',
  planes_json TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  photo_mime TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (photo_mime = 'image/jpeg'),
  photo_base64 TEXT NOT NULL CHECK (length(photo_base64) <= 440000),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flight_posts_created
  ON flight_posts(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_flight_posts_user_created
  ON flight_posts(user_id, created_at DESC, id DESC);
