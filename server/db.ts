import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { DATA_DIR } from './config.ts';

export const db = new DatabaseSync(path.join(DATA_DIR, 'bureau.db'));

// busy_timeout first: switching to WAL (even when the file already is WAL) takes a lock, and without
// a busy handler it fails at once with "database is locked" when another process (the e2e's worker
// poller, a second Bureau process) is opening or checkpointing the same file at that moment.
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

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

// ── v2 ────────────────────────────────────────────────────────────────────────
addColumn('applications', 'campaign_id', 'TEXT');
addColumn('applications', 'variant_id', 'TEXT');
addColumn('applications', 'stage', "TEXT NOT NULL DEFAULT 'applied'");
addColumn('applications', 'origin', "TEXT NOT NULL DEFAULT 'internal'");
addColumn('jobs', 'apply_url_canonical', 'TEXT');
addColumn('jobs', 'ats', 'TEXT');
addColumn('jobs', 'company_id', 'TEXT');
addColumn('jobs', 'legitimacy', 'TEXT');
addColumn('jobs', 'sources', "TEXT NOT NULL DEFAULT '[]'");
addColumn('jobs', 'priority', 'INTEGER NOT NULL DEFAULT 0');
addColumn('jobs', 'match', 'TEXT');
addColumn('ai_usage', 'campaign_id', 'TEXT');
addColumn('jobs', 'legitimacy_reasons', "TEXT NOT NULL DEFAULT '[]'");

db.exec(`
  CREATE INDEX IF NOT EXISTS jobs_canonical ON jobs(apply_url_canonical);
  CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company_id);

  CREATE TABLE IF NOT EXISTS campaigns (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','ended')),
    starts_at  TEXT NOT NULL,
    ends_at    TEXT NOT NULL,
    config     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pipeline (
    job_id         TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    campaign_id    TEXT,
    state          TEXT NOT NULL,
    attempts       INTEGER NOT NULL DEFAULT 0,
    next_action_at TEXT,
    last_error     TEXT,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pipeline_state ON pipeline(state, next_action_at);
  CREATE INDEX IF NOT EXISTS pipeline_campaign ON pipeline(campaign_id, state);

  CREATE TABLE IF NOT EXISTS pipeline_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id   TEXT NOT NULL,
    ts       TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT NOT NULL,
    reason   TEXT
  );
  CREATE INDEX IF NOT EXISTS pipeline_log_job ON pipeline_log(job_id, id);

  CREATE TABLE IF NOT EXISTS claims (
    job_id     TEXT PRIMARY KEY,
    holder     TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companies (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    domain          TEXT,
    ats             TEXT,
    ats_token       TEXT,
    careers_url     TEXT,
    discovered_via  TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    last_checked_at TEXT,
    open_roles      INTEGER,
    prev_open_roles INTEGER,
    signals         TEXT NOT NULL DEFAULT '[]'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS companies_ats_token ON companies(ats, ats_token);
  CREATE INDEX IF NOT EXISTS companies_domain ON companies(domain);

  CREATE TABLE IF NOT EXISTS job_embeddings (
    job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    model  TEXT NOT NULL,
    vector BLOB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile_facts (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    text       TEXT NOT NULL,
    source     TEXT NOT NULL CHECK (source IN ('cv','github','portfolio','manual','linkedin')),
    source_ref TEXT NOT NULL DEFAULT '',
    added_at   TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS voice_bank (
    id         TEXT PRIMARY KEY,
    prompt     TEXT NOT NULL,
    text       TEXT NOT NULL,
    tags       TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS answer_bank (
    id            TEXT PRIMARY KEY,
    question_norm TEXT NOT NULL,
    question_raw  TEXT NOT NULL,
    answer        TEXT NOT NULL,
    scope         TEXT NOT NULL DEFAULT '{}',
    source        TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner','derived')),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS answer_bank_q ON answer_bank(question_norm);

  CREATE TABLE IF NOT EXISTS unknown_questions (
    id            TEXT PRIMARY KEY,
    question_raw  TEXT NOT NULL,
    question_norm TEXT NOT NULL,
    job_id        TEXT,
    field_kind    TEXT NOT NULL,
    options       TEXT NOT NULL DEFAULT '[]',
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','ignored')),
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS learning_list (
    id         TEXT PRIMARY KEY,
    skill      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('learning','queued','done')),
    started_at TEXT,
    notes      TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS research_briefs (
    company_key TEXT PRIMARY KEY,
    brief       TEXT NOT NULL,
    fetched_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS letter_variants (
    id             TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    variant        TEXT NOT NULL,
    text           TEXT NOT NULL DEFAULT '',
    style_tags     TEXT NOT NULL DEFAULT '[]',
    passages_used  TEXT NOT NULL DEFAULT '[]',
    critic         TEXT,
    lint           TEXT,
    chosen         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS letter_variants_app ON letter_variants(application_id);

  CREATE TABLE IF NOT EXISTS form_recipes (
    id         TEXT PRIMARY KEY,
    ats        TEXT NOT NULL,
    scope      TEXT NOT NULL CHECK (scope IN ('ats','company','url')),
    scope_key  TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    recipe     TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','shadow','active','demoted')),
    successes  INTEGER NOT NULL DEFAULT 0,
    failures   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS form_recipes_scope ON form_recipes(scope, scope_key, status);

  CREATE TABLE IF NOT EXISTS agent_traces (
    id             TEXT PRIMARY KEY,
    job_id         TEXT,
    application_id TEXT,
    origin         TEXT NOT NULL,
    url            TEXT NOT NULL,
    ats            TEXT,
    trace          TEXT NOT NULL,
    outcome        TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_accounts (
    id          TEXT PRIMARY KEY,
    domain      TEXT NOT NULL UNIQUE,
    username    TEXT NOT NULL,
    secret_name TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL UNIQUE,
    hash         TEXT NOT NULL,
    scopes       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS api_audit (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id TEXT,
    ts     TEXT NOT NULL,
    route  TEXT NOT NULL,
    status INTEGER NOT NULL,
    detail TEXT
  );

  CREATE TABLE IF NOT EXISTS inbox_messages (
    id             TEXT PRIMARY KEY,
    message_id     TEXT NOT NULL UNIQUE,
    from_addr      TEXT NOT NULL,
    subject        TEXT NOT NULL,
    received_at    TEXT NOT NULL,
    class          TEXT NOT NULL,
    application_id TEXT,
    data           TEXT NOT NULL DEFAULT '{}',
    handled        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS learning_plans (
    id             TEXT PRIMARY KEY,
    application_id TEXT,
    company        TEXT NOT NULL,
    plan           TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gap_reports (
    id         TEXT PRIMARY KEY,
    period     TEXT NOT NULL,
    report     TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS digests (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT,
    date        TEXT NOT NULL,
    content     TEXT NOT NULL,
    sent_via    TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS outcomes (
    application_id TEXT PRIMARY KEY,
    replied        INTEGER NOT NULL DEFAULT 0,
    reply_class    TEXT,
    days_to_reply  REAL,
    updated_at     TEXT NOT NULL
  );
`);

// Columns added to v2 tables after Phase 0 (they must follow the CREATE TABLEs above).
addColumn('unknown_questions', 'answered_at', 'TEXT');
addColumn('unknown_questions', 'answer_id', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS profile_facts_source ON profile_facts(source, active)');

// API rate-limit counters (A07): one row per bucket ("req:<keyId>", "ai:<keyId>", "fail:<addr>") and time slot, so
// limits hold across restarts and across processes (the HTTP server and each stdio MCP process share them).
db.exec(`
  CREATE TABLE IF NOT EXISTS api_rate_windows (
    bucket TEXT NOT NULL,
    slot   INTEGER NOT NULL,
    count  INTEGER NOT NULL,
    PRIMARY KEY (bucket, slot)
  ) WITHOUT ROWID;
`);

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
