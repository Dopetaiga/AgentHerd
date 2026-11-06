// herd.db schema text and version. The Store applies it on open.

// Added in schema version 2 so databases created before plan 008 get the table too.
export const STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS state(
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

/** What the owner, the agent and its tools said in each task, for the app's task view. */
export const TRANSCRIPT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS transcript(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  at TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  tool_call_id TEXT,
  status TEXT
);
CREATE INDEX IF NOT EXISTS transcript_task ON transcript(task_id, id);`;

/** The Herder's conversation with the owner, searchable (docs/spec/08-herder-interaction.md §2). */
export const HERDER_TURNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS herder_turns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  task_id TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS herder_turns_fts USING fts5(
  text, content='herder_turns', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS herder_turns_ai AFTER INSERT ON herder_turns BEGIN
  INSERT INTO herder_turns_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS herder_turns_ad AFTER DELETE ON herder_turns BEGIN
  INSERT INTO herder_turns_fts(herder_turns_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;`;

export const LATEST_SCHEMA_VERSION = 4;

export const SCHEMA_SQL = `
CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE items(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  tool_call_json TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  risk TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  message_ref_json TEXT
);
CREATE TABLE decisions(
  item_id TEXT NOT NULL,
  action TEXT NOT NULL,
  text TEXT,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  risk TEXT NOT NULL,
  rule_id TEXT,
  owner_id TEXT,
  precedents_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE rules(
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  match_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL
);
${STATE_TABLE_SQL}
${TRANSCRIPT_TABLE_SQL}
${HERDER_TURNS_TABLE_SQL}
`;
