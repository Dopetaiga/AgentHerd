// herd.db schema text and version. The Store applies it on open.

// Added in schema version 2 so databases created before plan 008 get the table too.
export const STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS state(
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

export const LATEST_SCHEMA_VERSION = 2;

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
`;
