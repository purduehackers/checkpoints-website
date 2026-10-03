import { createClient } from '@libsql/client'

// Unset URL falls back to a local file so `bun dev` works without Turso credentials.
export const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  limit_sec INTEGER NOT NULL DEFAULT 120,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_session ON sessions(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS queue_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  client_token TEXT NOT NULL,
  name TEXT NOT NULL,
  project TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','called','live','done','left','removed')),
  share_state TEXT NOT NULL DEFAULT 'not_shared' CHECK (share_state IN ('not_shared','sharing','stopped')),
  sort_key REAL NOT NULL,
  joined_at INTEGER NOT NULL,
  called_at INTEGER,
  started_at INTEGER,
  deadline INTEGER,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (session_id, client_token)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_entry ON queue_entries(session_id) WHERE status IN ('called','live');
`

// Awaited by every query; creates the tables on first use (also fine against an existing Turso db).
export const ready = db.executeMultiple(SCHEMA)
