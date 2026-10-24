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
  created_at INTEGER NOT NULL,
  quality TEXT NOT NULL DEFAULT '1080p',
  audio INTEGER NOT NULL DEFAULT 1,
  reactions INTEGER NOT NULL DEFAULT 1,
  admin_seen_at INTEGER,
  active_at INTEGER
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
  deadline INTEGER,
  paused_left INTEGER,
  last_seen_at INTEGER NOT NULL,
  bye_at INTEGER,
  fp TEXT,
  UNIQUE (session_id, client_token)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_entry ON queue_entries(session_id) WHERE status IN ('called','live');

-- Reaction batches in transit between instances; pruned after a minute.
CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  counts TEXT NOT NULL
);

-- Devices (browser fingerprints) that passed the first-time quiz. Kept across checkpoints.
CREATE TABLE IF NOT EXISTS passed_devices (
  fp TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
`

// Awaited by every query; creates the tables on first use (also fine against an existing Turso db).
// Columns added after the first deploy. SQLite has no ADD COLUMN IF NOT EXISTS, so ignore "duplicate column".
const ADDED = [
  `ALTER TABLE sessions ADD COLUMN admin_seen_at INTEGER`, // nullable: a session from older code never auto-ends
  `ALTER TABLE sessions ADD COLUMN active_at INTEGER`,
  `ALTER TABLE queue_entries ADD COLUMN paused_left INTEGER`,
  `ALTER TABLE sessions ADD COLUMN quality TEXT NOT NULL DEFAULT '1080p'`,
  `ALTER TABLE sessions ADD COLUMN audio INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE sessions ADD COLUMN reactions INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE queue_entries ADD COLUMN bye_at INTEGER`, // nullable, so older code that never sets it keeps working
  `ALTER TABLE queue_entries ADD COLUMN fp TEXT`, // nullable: entries from older clients have no fingerprint
]
export const ready = db.executeMultiple(SCHEMA).then(async () => {
  for (const sql of ADDED) await db.execute(sql).catch((e) => { if (!/duplicate column/i.test(String(e))) throw e })
})
