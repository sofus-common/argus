CREATE TABLE IF NOT EXISTS quote_snapshots (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL CHECK (length(credential_fingerprint) = 64),
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quote_snapshots_expiry ON quote_snapshots(expires_at);
