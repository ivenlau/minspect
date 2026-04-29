-- minspect — initial SQLite schema
-- Keep in byte-sync with INITIAL_SCHEMA_SQL in migrations.ts
-- (migrations.test.ts asserts equality to catch drift.)

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  git_remote TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  agent_version TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  git_branch_start TEXT,
  git_head_start TEXT
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  user_prompt TEXT NOT NULL,
  agent_reasoning TEXT,
  agent_final_message TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  git_head TEXT,
  UNIQUE(session_id, idx)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  explanation TEXT
);

CREATE TABLE IF NOT EXISTS edits (
  id TEXT PRIMARY KEY,
  tool_call_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  git_head TEXT
);

CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  content BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS hunks (
  id TEXT PRIMARY KEY,
  edit_id TEXT NOT NULL,
  old_start INTEGER,
  old_count INTEGER NOT NULL,
  new_start INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  old_text TEXT,
  new_text TEXT,
  explanation TEXT,
  explanation_model TEXT,
  explained_at INTEGER
);

CREATE TABLE IF NOT EXISTS line_blame (
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  edit_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, file_path, line_no)
);

CREATE TABLE IF NOT EXISTS ast_nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  qualified_name TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  last_computed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS edit_ast_impact (
  edit_id TEXT NOT NULL,
  ast_node_id TEXT NOT NULL,
  PRIMARY KEY (edit_id, ast_node_id)
);

CREATE TABLE IF NOT EXISTS commit_links (
  commit_sha TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  edit_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (commit_sha, edit_id)
);

CREATE INDEX IF NOT EXISTS idx_edits_file ON edits(workspace_id, file_path, created_at);
CREATE INDEX IF NOT EXISTS idx_edits_session ON edits(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_blame_file ON line_blame(workspace_id, file_path);
CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id, idx);
CREATE INDEX IF NOT EXISTS idx_turns_started ON turns(started_at);
CREATE INDEX IF NOT EXISTS idx_hunks_edit ON hunks(edit_id);
CREATE INDEX IF NOT EXISTS idx_edits_turn ON edits(turn_id);
