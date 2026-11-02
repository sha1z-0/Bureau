import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { all } from '../db.ts';
import { AppError } from '../errors.ts';
import { runRecipeJobs } from './jobs.ts';
import { learningMetrics } from './metrics.ts';
import { shadowCounts, shadowRuns } from './shadow.ts';
import { listTraces, loadTrace, shotFile, shotUrl } from './trace.ts';

/**
 * UI-facing routes (A06), behind the normal UI session guard. Shapes match
 * web/src/api.ts (AgentMetrics, TraceSummary, TraceDetail).
 *
 *   GET  /api/agent/metrics?days=30         { daily, costPerRun, totals, coverage, learning, shadow, … }
 *   GET  /api/agent/traces?limit=&jobId=&origin=internal|external   { traces: TraceSummary[] }
 *   GET  /api/agent/traces/:id              { trace: TraceSummary & { steps, startedAt, finishedAt }, learning }
 *   GET  /api/agent/shots/:name             a trace screenshot (JPEG; `<traceId>-<nnn>.jpg` only)
 *   GET  /api/agent/runs?limit=             agent runs: status, reason, steps, cost, injection attempts
 *   GET  /api/agent/recipes/:id/shadow      shadow runs of a candidate recipe and its counts
 *   POST /api/agent/jobs/run                run the learning queue now (compile, thresholds)
 */

const ID = /^[A-Za-z0-9-]{8,64}$/;

export async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agent/metrics', async (req) => {
    const q = req.query as { days?: string };
    return learningMetrics({ days: q.days ? Number(q.days) || 30 : 30 });
  });

  app.get('/api/agent/traces', async (req) => {
    const q = req.query as { limit?: string; jobId?: string; origin?: string };
    const origin = q.origin === 'internal' || q.origin === 'external' ? q.origin : undefined;
    return { traces: listTraces({ limit: Number(q.limit) || 50, jobId: q.jobId && ID.test(q.jobId) ? q.jobId : undefined, origin }) };
  });

  app.get('/api/agent/traces/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!ID.test(id)) throw new AppError(400, 'INVALID', 'id: not a trace id');
    const t = loadTrace(id);
    if (!t) throw new AppError(404, 'NOT_FOUND', 'No such trace');
    const learning = all<{ status: string; recipe_id: string | null; detail: string; updated_at: string }>('SELECT status, recipe_id, detail, updated_at FROM agent_learning WHERE trace_id = ?', id)[0] ?? null;
    return {
      trace: {
        id: t.id,
        jobId: t.jobId,
        applicationId: t.applicationId,
        origin: t.origin,
        url: t.url,
        ats: t.ats,
        outcome: t.outcome,
        steps: t.steps.map((s) => ({ ...s, beforeShot: shotUrl(s.beforeShot), afterShot: shotUrl(s.afterShot) })),
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
      },
      learning: learning ? { status: learning.status, recipeId: learning.recipe_id, detail: learning.detail, updatedAt: learning.updated_at } : null,
    };
  });

  app.get('/api/agent/shots/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const file = shotFile(name);
    if (!file) throw new AppError(404, 'NOT_FOUND', 'No such screenshot');
    reply.header('cache-control', 'private, max-age=3600');
    return reply.type('image/jpeg').send(fs.readFileSync(file));
  });

  app.get('/api/agent/runs', async (req) => {
    const q = req.query as { limit?: string };
    const rows = all<Record<string, unknown> & { injections: string }>('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?', Math.max(1, Math.min(500, Number(q.limit) || 50)));
    return {
      runs: rows.map((r) => ({
        id: r.id,
        traceId: r.trace_id,
        jobId: r.job_id,
        url: r.url,
        ats: r.ats,
        mode: r.mode,
        recipeId: r.recipe_id,
        status: r.status,
        reason: r.reason,
        steps: r.steps,
        costUsd: r.cost_usd,
        injectionAttempts: r.injection_attempts,
        injections: JSON.parse(r.injections || '[]') as unknown[],
        startedAt: r.started_at,
        finishedAt: r.finished_at,
      })),
    };
  });

  app.get('/api/agent/recipes/:id/shadow', async (req) => {
    const { id } = req.params as { id: string };
    if (!ID.test(id)) throw new AppError(400, 'INVALID', 'id: not a recipe id');
    return { counts: shadowCounts(id), runs: shadowRuns(id) };
  });

  app.post('/api/agent/jobs/run', async () => ({ summary: await runRecipeJobs() }));
}
