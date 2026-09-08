CREATE TABLE IF NOT EXISTS saved_strategies (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  state_json TEXT NOT NULL,
  snapshot_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_strategies_owner_updated ON saved_strategies(owner, updated_at DESC, id);
