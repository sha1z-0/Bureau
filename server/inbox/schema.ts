import { db } from '../db.ts';

/**
 * Tables A09 owns on top of the Phase 0 schema (inbox_messages, learning_plans,
 * gap_reports, outcomes live in db.ts). Additive and idempotent, created on
 * first import, so A09 never edits db.ts.
 *
 * - inbox_followups: one row per application that got (or was about to get) a
 *   follow-up. The row is written as `intent` BEFORE the SMTP call and becomes
 *   `sent` after, so a crash can never send a second follow-up.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS inbox_followups (
    application_id TEXT PRIMARY KEY,
    status         TEXT NOT NULL CHECK (status IN ('intent','sent','rehearsed','failed','skipped')),
    to_addr        TEXT,
    subject        TEXT NOT NULL DEFAULT '',
    body           TEXT NOT NULL DEFAULT '',
    message_id     TEXT,
    reason         TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    sent_at        TEXT
  );
  CREATE INDEX IF NOT EXISTS inbox_messages_received ON inbox_messages(received_at DESC);
  CREATE INDEX IF NOT EXISTS inbox_messages_app ON inbox_messages(application_id);
  CREATE INDEX IF NOT EXISTS learning_plans_app ON learning_plans(application_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS gap_reports_period ON gap_reports(period, created_at DESC);
`);

export const INBOX_SCHEMA_READY = true;
