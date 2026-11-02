import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { DATA_DIR } from './config.ts';

export const db = new DatabaseSync(path.join(DATA_DIR, 'bureau.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS secrets (
    name TEXT PRIMARY KEY,
    iv   TEXT NOT NULL,
    tag  TEXT NOT NULL,
    data TEXT NOT NULL,
    hint TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    filename   TEXT NOT NULL,
    mime       TEXT NOT NULL,
    stored_as  TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id               TEXT PRIMARY KEY,
    fingerprint      TEXT NOT NULL UNIQUE,
    source           TEXT NOT NULL,
    external_id      TEXT,
    url              TEXT NOT NULL,
    title            TEXT NOT NULL,
    company          TEXT NOT NULL,
    location         TEXT,
    remote           INTEGER NOT NULL DEFAULT 0,
    category         TEXT NOT NULL,
    description_html TEXT,
    description_text TEXT,
    salary_min       REAL,
    salary_max       REAL,
    salary_currency  TEXT,
    tags             TEXT NOT NULL DEFAULT '[]',
    posted_at        TEXT,
    found_at         TEXT NOT NULL,
    prefilter_score  INTEGER NOT NULL DEFAULT 0,
    ai_score         INTEGER,
    ai_grade         TEXT,
    ai_analysis      TEXT,
    scored_at        TEXT,
    status           TEXT NOT NULL DEFAULT 'new',
    stage            TEXT NOT NULL DEFAULT 'found',
    apply_email      TEXT,
    notes            TEXT,
    updated_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS jobs_url ON jobs(url);
  CREATE INDEX IF NOT EXISTS jobs_score ON jobs(ai_score DESC, prefilter_score DESC);
  CREATE INDEX IF NOT EXISTS jobs_stage ON jobs(stage);

  CREATE TABLE IF NOT EXISTS applications (
    id           TEXT PRIMARY KEY,
    job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    subject      TEXT NOT NULL DEFAULT '',
    cover_letter TEXT NOT NULL DEFAULT '',
    message      TEXT NOT NULL DEFAULT '',
    cv           TEXT NOT NULL DEFAULT '{}',
    notes        TEXT NOT NULL DEFAULT '[]',
    keywords     TEXT NOT NULL DEFAULT '[]',
    status       TEXT NOT NULL DEFAULT 'draft',
    channel      TEXT NOT NULL DEFAULT 'manual',
    to_email     TEXT,
    sent_at      TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS applications_job ON applications(job_id);

  CREATE TABLE IF NOT EXISTS scans (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    found       INTEGER NOT NULL DEFAULT 0,
    added       INTEGER NOT NULL DEFAULT 0,
    scored      INTEGER NOT NULL DEFAULT 0,
    log         TEXT NOT NULL DEFAULT '[]',
    error       TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL,
    kind    TEXT NOT NULL,
    job_id  TEXT,
    message TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_usage (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT NOT NULL,
    task          TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read    INTEGER NOT NULL DEFAULT 0,
    cache_write   INTEGER NOT NULL DEFAULT 0,
    web_searches  INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL
  );
`);

// Additive migrations for databases created by earlier versions.
function addColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('applications', 'reason', 'TEXT');
addColumn('applications', 'auto', 'INTEGER NOT NULL DEFAULT 0');
addColumn('applications', 'shot', 'TEXT');
addColumn('applications', 'answers', "TEXT NOT NULL DEFAULT '[]'");

export const now = () => new Date().toISOString();

type Row = Record<string, SQLInputValue>;

export function all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

export function logEvent(kind: string, message: string, jobId: string | null = null) {
  run('INSERT INTO events (ts, kind, job_id, message) VALUES (?, ?, ?, ?)', now(), kind, jobId, message);
}
