import { db } from '../db.ts';

/**
 * Tables the learning loop owns on top of the Phase 0 `agent_traces` table.
 * Additive and idempotent, created on first import (A05's / A08's pattern), so
 * A06 never edits db.ts.
 *
 * - agent_runs:          one row per agentFill: how it ended, steps, cost, prompt-injection attempts seen.
 * - agent_learning:      the compile queue. A trace with no row here was never queued (A07 stored external
 *                        traces itself while A06 was a stub): runRecipeJobs() picks those up.
 * - recipe_shadow_runs:  a candidate recipe compared, in dry mode, with a real run. Only internal runs count
 *                        towards promotion; external ones are kept for the record.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    id                 TEXT PRIMARY KEY,
    trace_id           TEXT,
    job_id             TEXT,
    url                TEXT,
    ats                TEXT,
    mode               TEXT NOT NULL DEFAULT 'agent',
    recipe_id          TEXT,
    status             TEXT NOT NULL,
    reason             TEXT NOT NULL DEFAULT '',
    steps              INTEGER NOT NULL DEFAULT 0,
    cost_usd           REAL NOT NULL DEFAULT 0,
    injection_attempts INTEGER NOT NULL DEFAULT 0,
    injections         TEXT NOT NULL DEFAULT '[]',
    started_at         TEXT NOT NULL,
    finished_at        TEXT
  );
  CREATE INDEX IF NOT EXISTS agent_runs_started ON agent_runs(started_at);

  CREATE TABLE IF NOT EXISTS agent_learning (
    trace_id   TEXT PRIMARY KEY,
    origin     TEXT NOT NULL,
    status     TEXT NOT NULL,
    recipe_id  TEXT,
    detail     TEXT NOT NULL DEFAULT '',
    queued_at  TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_learning_status ON agent_learning(status);

  CREATE TABLE IF NOT EXISTS recipe_shadow_runs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    source    TEXT NOT NULL,
    ref       TEXT,
    ok        INTEGER NOT NULL,
    found     INTEGER NOT NULL DEFAULT 0,
    total     INTEGER NOT NULL DEFAULT 0,
    diff      TEXT NOT NULL DEFAULT '[]',
    at        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS recipe_shadow_runs_recipe ON recipe_shadow_runs(recipe_id, id);
`);
