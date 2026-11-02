import { db } from '../db.ts';

/**
 * Tables the campaign engine owns on top of the Phase 0 schema. Additive and
 * idempotent, created on first import. (Requested for db.ts in
 * docs/build/requests/A08.md; kept here so A08 never edits db.ts.)
 *
 * - campaign_meta: lifecycle facts the CampaignConfig contract has no room for
 *   (first activation, when dry-run went live, why it is paused or ended).
 * - campaign_steps: the apply worker's durable journal. Every side effect that
 *   must never happen twice (a live submit, an email) writes an `*_intent` row
 *   BEFORE it starts and a result row after, so a restart can tell "finished",
 *   "never started" and "unknown" apart.
 * - campaign_packets: the writer's packet per job, so a resumed or re-queued job
 *   never re-runs the writer.
 * - campaign_tasks: when each scheduled task last ran, so restarts keep cadence.
 * - campaign_question_notices: which unknown questions went to Telegram.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS campaign_meta (
    campaign_id     TEXT PRIMARY KEY,
    first_active_at TEXT,
    live_since      TEXT,
    rehearse_only   INTEGER NOT NULL DEFAULT 0,
    compat          INTEGER NOT NULL DEFAULT 0,
    status_reason   TEXT,
    final_digest_id TEXT,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaign_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    campaign_id TEXT,
    job_id      TEXT,
    step        TEXT NOT NULL,
    status      TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS campaign_steps_job ON campaign_steps(job_id, id);
  CREATE INDEX IF NOT EXISTS campaign_steps_day ON campaign_steps(campaign_id, step, ts);

  CREATE TABLE IF NOT EXISTS campaign_packets (
    job_id         TEXT PRIMARY KEY,
    campaign_id    TEXT,
    application_id TEXT NOT NULL,
    packet         TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaign_tasks (
    scope       TEXT NOT NULL,
    task        TEXT NOT NULL,
    last_run_at TEXT,
    last_ok_at  TEXT,
    last_error  TEXT,
    PRIMARY KEY (scope, task)
  );

  CREATE TABLE IF NOT EXISTS campaign_question_notices (
    question_id TEXT PRIMARY KEY,
    short_id    TEXT NOT NULL,
    message_id  INTEGER,
    sent_at     TEXT NOT NULL
  );
`);

export const CAMPAIGN_SCHEMA_READY = true;
