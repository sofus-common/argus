CREATE TABLE IF NOT EXISTS analysis_traces (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('running','accepted','failed','incomplete')),
  event_count INTEGER NOT NULL DEFAULT 0,
  part_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS analysis_traces_owner ON analysis_traces(owner,id);
CREATE TABLE IF NOT EXISTS analysis_trace_parts (
  trace_id TEXT NOT NULL REFERENCES analysis_traces(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_index INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_json TEXT NOT NULL,
  PRIMARY KEY(trace_id,seq)
);
