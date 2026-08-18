import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/**
 * One SQLite file for everything NowForge needs to remember: sessions,
 * messages, tool events, the per-instance knowledge ledger, and recall
 * embeddings.
 *
 * Why the built-in `node:sqlite` rather than better-sqlite3 — this was checked,
 * not assumed. On this machine (Node v24.18.0) the built-in covers every need:
 *
 *   DatabaseSync / StatementSync   present
 *   BLOB round-trip (Uint8Array)   works — needed for float32 embeddings
 *   FTS5 virtual tables            available — needed for the keyword fallback
 *
 * That makes the whole storage layer dependency-free, which matters here: this
 * is a Windows machine with no node-gyp toolchain, and better-sqlite3 would
 * have meant relying on a prebuilt binary matching this exact Node ABI.
 *
 * Migrations are idempotent and run on boot, keyed on `PRAGMA user_version`, so
 * starting an older or newer server against an existing file is safe.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'nowforge.db');

let handle = null;

/**
 * Each migration runs exactly once, in order. NEVER edit one that has shipped —
 * append a new one. `user_version` is the only thing that decides what has run,
 * and an edited migration would silently skip on every existing database.
 */
const MIGRATIONS = [
  // 1 — sessions, messages, tool events (A-1)
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id       TEXT PRIMARY KEY,
    title    TEXT,
    created  TEXT NOT NULL,
    updated  TEXT NOT NULL,
    instance TEXT
  );

  -- One row per neutral-history entry. \`json\` is the entry verbatim, so the
  -- orchestrator's format stays the single source of truth and this table does
  -- not have to be migrated every time a provider adapter learns something new.
  CREATE TABLE IF NOT EXISTS messages (
    session TEXT NOT NULL,
    seq     INTEGER NOT NULL,
    role    TEXT NOT NULL,
    json    TEXT NOT NULL,
    ts      TEXT NOT NULL,
    PRIMARY KEY (session, seq),
    FOREIGN KEY (session) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- Separate from messages on purpose: this is the audit trail of what the
  -- agent DID to the instance, including whether a human approved it. It
  -- outlives compaction, which rewrites messages but must never rewrite this.
  CREATE TABLE IF NOT EXISTS tool_events (
    session       TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    kind          TEXT NOT NULL,
    name          TEXT,
    payload       TEXT,
    result_status TEXT,
    mutating      INTEGER NOT NULL DEFAULT 0,
    approval      TEXT,
    ts            TEXT NOT NULL,
    PRIMARY KEY (session, seq),
    FOREIGN KEY (session) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated DESC);
  CREATE INDEX IF NOT EXISTS idx_tool_events_name ON tool_events(session, name);
  `,

  // 2 — instance knowledge ledger (A-4)
  `
  CREATE TABLE IF NOT EXISTS facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    instance   TEXT NOT NULL,
    kind       TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    provenance TEXT,
    confidence REAL NOT NULL DEFAULT 0.5,
    ts         TEXT NOT NULL,
    UNIQUE (instance, kind, key)
  );
  CREATE INDEX IF NOT EXISTS idx_facts_instance ON facts(instance, kind);
  `,

  // 3 — recall: embeddings, and an FTS index for the no-embedding fallback (A-5)
  `
  CREATE TABLE IF NOT EXISTS chunks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    kind     TEXT NOT NULL,          -- 'message' | 'fact'
    session  TEXT,                   -- null for facts
    ref      TEXT NOT NULL,          -- message seq, or fact id
    instance TEXT,
    text     TEXT NOT NULL,
    ts       TEXT NOT NULL,
    UNIQUE (kind, session, ref)
  );

  -- float32 little-endian blob + its dimension, so a model change is detectable
  -- rather than producing silently meaningless cosine scores.
  CREATE TABLE IF NOT EXISTS embeddings (
    chunk  INTEGER PRIMARY KEY,
    model  TEXT NOT NULL,
    dim    INTEGER NOT NULL,
    vec    BLOB NOT NULL,
    FOREIGN KEY (chunk) REFERENCES chunks(id) ON DELETE CASCADE
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='id',
    tokenize='porter unicode61'
  );

  -- Triggers keep FTS in step with chunks. Without them the fallback search
  -- silently returns stale rows, which is exactly the class of quiet wrongness
  -- this project keeps having to dig out.
  CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
  END;

  CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session);
  `,

  // 4 — compaction digests (A-3)
  `
  CREATE TABLE IF NOT EXISTS digests (
    session   TEXT NOT NULL,
    from_seq  INTEGER NOT NULL,
    to_seq    INTEGER NOT NULL,
    text      TEXT NOT NULL,
    ts        TEXT NOT NULL,
    PRIMARY KEY (session, from_seq),
    FOREIGN KEY (session) REFERENCES sessions(id) ON DELETE CASCADE
  );
  `,
];

/**
 * Bring one database up to the current schema. Exported so the offline test
 * suite can build a scratch database through the SAME code path — copying
 * `sqlite_master` instead would drag in FTS5's internal shadow tables, which
 * cannot be created directly, and would test a replica rather than the real
 * migrations.
 */
export function migrate(db) {
  db.exec('PRAGMA foreign_keys = ON');
  const current = db.prepare('PRAGMA user_version').get().user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      // Loud: a half-migrated database is worse than one that refuses to open.
      throw new Error(`NowForge database migration ${v + 1} failed: ${err.message}`);
    }
  }
  return db;
}

/** Opens the database, applying any migrations this file has not yet seen. */
export function getDb() {
  if (handle) return handle;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);

  // WAL survives a hard kill mid-write, which is exactly the acceptance test
  // for A-2 ("kill and restart the server, resume the same session").
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  handle = migrate(db);
  return handle;
}

/** Test hook: point the store at a scratch file, or back at the real one. */
export function _setDbForTests(db) {
  handle = db;
}

export const DB_PATH = DB_FILE;
