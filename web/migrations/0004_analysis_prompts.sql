CREATE TABLE IF NOT EXISTS analysis_prompt_bundles (
  version TEXT PRIMARY KEY,
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  engine_version TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis_prompt_active (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version TEXT NOT NULL REFERENCES analysis_prompt_bundles(version)
);
CREATE TRIGGER IF NOT EXISTS analysis_prompt_immutable
BEFORE UPDATE ON analysis_prompt_bundles
BEGIN SELECT RAISE(ABORT, 'Prompt versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS analysis_prompt_no_delete
BEFORE DELETE ON analysis_prompt_bundles
BEGIN SELECT RAISE(ABORT, 'Prompt versions are immutable'); END;
