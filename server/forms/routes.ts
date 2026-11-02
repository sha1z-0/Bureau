import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { RecipeStatus } from '../contracts/forms.ts';
import { all, get, getSetting, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { body } from '../routes/util.ts';
import { ADAPTERS } from './adapters/index.ts';
import { artifactPath, RUNS_DIR } from './artifacts.ts';
import { getRecipe, listRecipes, recipeRuns, setRecipeStatus } from './recipes.ts';
import { synonymCount } from './synonyms.ts';
import './schema.ts';

/**
 * UI-facing routes (A05). Everything under /api/forms.
 *
 *   GET  /api/forms/summary                  adapters, synonym count, recipes by status, 30-day success by ATS
 *   GET  /api/forms/recipes                  every recipe (all versions) with run counts
 *   GET  /api/forms/recipes/:id              one recipe plus its last runs
 *   PUT  /api/forms/recipes/:id/status       { status: candidate|shadow|active|demoted }
 *   GET  /api/forms/runs?jobId=&limit=       fill runs (newest first)
 *   GET  /api/forms/runs/:id                 one run: outcome, notes and the field log
 *   GET  /api/forms/runs/:id/shots/:name     a step screenshot (JPEG)
 *   GET  /api/forms/accounts                 site accounts (domain, username, created) — never passwords
 *   GET  /api/forms/settings                 { accountEmail }
 *   PUT  /api/forms/settings                 { accountEmail } — the dedicated job-search email for ATS accounts
 */

interface RunRow {
  id: string;
  job_id: string | null;
  application_id: string | null;
  campaign_id: string | null;
  url: string | null;
  ats: string | null;
  via: string | null;
  recipe_id: string | null;
  submit: number;
  status: string | null;
  verified: number;
  reason: string | null;
  fields_total: number;
  fields_ok: number;
  steps: number;
  started_at: string;
  finished_at: string | null;
}

const view = (r: RunRow) => ({
  id: r.id,
  jobId: r.job_id,
  applicationId: r.application_id,
  campaignId: r.campaign_id,
  url: r.url,
  ats: r.ats,
  via: r.via,
  recipeId: r.recipe_id,
  live: !!r.submit,
  status: r.status,
  verified: !!r.verified,
  reason: r.reason,
  fields: { total: r.fields_total, ok: r.fields_ok },
  steps: r.steps,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const SAFE = /^[A-Za-z0-9-]{8,64}$/;

export async function formsRoutes(app: FastifyInstance) {
  app.get('/api/forms/summary', async () => {
    const recipes = all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM form_recipes GROUP BY status');
    const byAts = all<{ ats: string | null; runs: number; ok: number; verified: number }>(
      "SELECT ats, COUNT(*) AS runs, SUM(CASE WHEN status IN ('submitted','rehearsed') THEN 1 ELSE 0 END) AS ok, SUM(verified) AS verified FROM form_runs WHERE started_at >= ? GROUP BY ats",
      new Date(Date.now() - 30 * 86_400_000).toISOString(),
    );
    return {
      adapters: ADAPTERS.map((a) => ({ ats: a.ats, name: a.name, accounts: !!a.account })),
      synonyms: synonymCount(),
      recipes: Object.fromEntries(recipes.map((r) => [r.status, r.n])),
      last30Days: byAts.map((r) => ({ ats: r.ats ?? 'unknown', runs: r.runs, ok: r.ok, verified: r.verified, successRate: r.runs ? Math.round((r.ok / r.runs) * 100) / 100 : 0 })),
    };
  });

  app.get('/api/forms/recipes', async () => ({ recipes: listRecipes() }));

  app.get<{ Params: { id: string } }>('/api/forms/recipes/:id', async (req) => {
    const r = getRecipe(req.params.id);
    if (!r) throw new AppError(404, 'NOT_FOUND', 'No such recipe');
    return { recipe: r, runs: recipeRuns(r.id, 50) };
  });

  app.put<{ Params: { id: string } }>('/api/forms/recipes/:id/status', async (req) => {
    const { status } = body(z.object({ status: RecipeStatus }), req.body);
    if (!getRecipe(req.params.id)) throw new AppError(404, 'NOT_FOUND', 'No such recipe');
    setRecipeStatus(req.params.id, status);
    return { recipe: getRecipe(req.params.id) };
  });

  app.get<{ Querystring: { jobId?: string; limit?: string } }>('/api/forms/runs', async (req) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));
    const rows = req.query.jobId
      ? all<RunRow>('SELECT * FROM form_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?', req.query.jobId, limit)
      : all<RunRow>('SELECT * FROM form_runs ORDER BY started_at DESC LIMIT ?', limit);
    return { runs: rows.map(view) };
  });

  app.get<{ Params: { id: string } }>('/api/forms/runs/:id', async (req) => {
    if (!SAFE.test(req.params.id)) throw new AppError(400, 'BAD_ID', 'Bad run id');
    const row = get<RunRow>('SELECT * FROM form_runs WHERE id = ?', req.params.id);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'No such run');
    const file = path.join(RUNS_DIR, row.id, 'run.json');
    const detail = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>) : null;
    return { run: view(row), detail };
  });

  app.get<{ Params: { id: string; name: string } }>('/api/forms/runs/:id/shots/:name', async (req, reply) => {
    if (!SAFE.test(req.params.id) || !/^[\w.-]+\.jpg$/.test(req.params.name)) throw new AppError(400, 'BAD_ID', 'Bad screenshot name');
    const file = artifactPath(path.join('forms', 'runs', req.params.id, req.params.name));
    if (!file) throw new AppError(404, 'NOT_FOUND', 'No screenshot');
    return reply.type('image/jpeg').header('cache-control', 'private, max-age=3600').send(fs.createReadStream(file));
  });

  app.get('/api/forms/accounts', async () => ({
    accounts: all<{ domain: string; username: string; created_at: string }>('SELECT domain, username, created_at FROM site_accounts ORDER BY created_at DESC').map((a) => ({
      domain: a.domain,
      username: a.username,
      createdAt: a.created_at,
    })),
  }));

  app.get('/api/forms/settings', async () => getSetting<{ accountEmail?: string }>('forms_settings', {}));

  app.put('/api/forms/settings', async (req) => {
    const input = body(z.object({ accountEmail: z.union([z.literal(''), z.string().trim().max(200).email()]) }), req.body);
    const next = { accountEmail: input.accountEmail || undefined };
    setSetting('forms_settings', next);
    return next;
  });
}
