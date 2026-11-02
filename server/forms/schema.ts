import { db } from '../db.ts';

/**
 * Tables the form engine owns on top of the Phase 0 schema (`form_recipes`,
 * `site_accounts`). Additive and idempotent, created on first import, so A05
 * never edits db.ts (see docs/build/requests/A05.md).
 *
 * - form_runs: one row per fillApplication run: outcome, verification counts,
 *   where its screenshots and field log live (DATA_DIR/forms/runs/<id>/).
 * - form_recipe_runs: each recipe execution (ok / failed, healed), so
 *   consecutive failures can demote a recipe.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS form_runs (
    id             TEXT PRIMARY KEY,
    job_id         TEXT,
    application_id TEXT,
    campaign_id    TEXT,
    url            TEXT,
    ats            TEXT,
    via            TEXT,
    recipe_id      TEXT,
    submit         INTEGER NOT NULL DEFAULT 0,
    status         TEXT,
    verified       INTEGER NOT NULL DEFAULT 0,
    reason         TEXT,
    fields_total   INTEGER NOT NULL DEFAULT 0,
    fields_ok      INTEGER NOT NULL DEFAULT 0,
    steps          INTEGER NOT NULL DEFAULT 0,
    dir            TEXT,
    started_at     TEXT NOT NULL,
    finished_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS form_runs_job ON form_runs(job_id, started_at);

  CREATE TABLE IF NOT EXISTS form_recipe_runs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    ok        INTEGER NOT NULL,
    detail    TEXT,
    at        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS form_recipe_runs_recipe ON form_recipe_runs(recipe_id, id);
`);
